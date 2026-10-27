import * as THREE from 'three';
import { createWorld, disposeProp, paintSignal, pedestrianFigure, rails, regulatorFigure, roadSign, trafficCar, tramCar, type RegulatorFigure } from './world';
import { clamp, districtBounds, gradeAt, initialVehicle, selectGear, stepVehicle, type Gear, type DriveInput, type VehicleState, type WorldBounds } from './vehicle';
import { lessons, type Lesson } from './lesson';
import { activeZone, approachAhead, cityMap, type Approach, type RoadMap } from './roads';
import { lampsAt, type Lamp } from './signals';
import { TripJudge, type Violation } from './rules';
import { carPosition, crossStreetLanes, TrafficSystem, type TrafficCar } from './traffic';
import { ExamRunner, practiceScenes, situations, type ExamSession, type RouteStep, type SituationProgress } from './exam';
import { buildCity, cityLanes, cityTrafficLayout } from './city';
import { createCityWorld } from './cityWorld';
import { CITY_START, CityExamRunner } from './cityExam';
import { SignWatch, zoneSigns, type PlacedSign } from './signs';
import type { Maneuver, Pose as ControllerPose, Side } from './regulator';
import { allowedManeuvers, regulatorAt, sideOf } from './regulator';

export interface Telemetry { speed: number; rpm: number; gear: Gear; belt: boolean; handbrake: boolean; signal: VehicleState['signal']; steering: number; distance: number; fps: number; lessonId: string; lessonStep: number; completed: boolean; moving: boolean; speedLimit: number | null; collisions: number; violations: Violation[]; signalAhead: { lamp: Lamp; distance: number } | null; signs: Pick<PlacedSign, 'id' | 'code' | 'value'>[]; regulatorAhead: { pose: ControllerPose; side: Side; allowed: Maneuver[]; distance: number } | null; tripTime: number; throttle: number; brake: number; exam: ExamTelemetry | null; mapKind: MapKind; pose: { x: number; z: number; heading: number }; }
export type MapKind = 'district' | 'city';
const CITY_EDGE = 400;
export interface ExamTelemetry { practice: string | null; selected: string[]; steps: RouteStep[]; stepIndex: number; command: string; finished: boolean; failReason: string | null; progress: Record<string, SituationProgress>; route: string[]; target: string | null; }
export type CameraMode = 'cockpit' | 'chase';
export type Look = 'forward' | 'left' | 'rear' | 'right';
export interface GameSettings { quality: 'low' | 'balanced' | 'high'; mirrors: boolean; motion: boolean; sensitivity: number; voice: boolean; examHints: boolean; cityMap: boolean; sound: boolean; }
export class DrivingEngine {
  readonly state = initialVehicle();
  readonly input: DriveInput = { throttle: 0, brake: 0, steer: 0 };
  private keys = new Set<string>();
  private world = createWorld();
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(74, 1, .08, 300);
  private mirrorCameras = [0, 1, 2].map(() => new THREE.PerspectiveCamera(55, 2.6, .2, 85));
  private targets = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(384, 144));
  private overlayScene = new THREE.Scene();
  private overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private overlayQuad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private emitAt = 0;
  private mirrorAt = 0;
  private collisionAt = 0;
  private frames = 0;
  private fpsAt = 0;
  private fps = 60;
  private collisions = 0;
  private disposed = false;
  private suspended = false;
  private cameraReady = false;
  private lessonStep = 0;
  private lesson: Lesson = lessons[0];
  private simTime = 0;
  private mapKind: MapKind = 'district';
  private map: RoadMap = cityMap;
  /** The exam city layout: pure data, built once; its 3D scene is rebuilt per exam. */
  readonly city = buildCity();
  private judge = new TripJudge(cityMap);
  private traffic = new TrafficSystem(crossStreetLanes(cityMap));
  private trafficMeshes = new Map<number, THREE.Group>();
  private staticSigns = zoneSigns(cityMap.speedZones);
  private examSignList: PlacedSign[] = [];
  private signWatch = new SignWatch();
  private exam: ExamSession | null = null;
  private examProps: THREE.Object3D[] = [];
  private regulator: RegulatorFigure | null = null;
  private pedestrianMeshes: THREE.Group[] = [];
  private snapshotTarget = new THREE.WebGLRenderTarget(360, 240);
  private snapshotCamera = new THREE.OrthographicCamera(-21, 21, 14, -14, 1, 200);
  /** Top-down pictures of the moment each violation happened, for the debrief. */
  readonly snapshots = new Map<number, string>();
  /** Inspector phrases; the UI decides whether to speak them aloud. */
  onSay: (text: string) => void = () => {};
  private violationsSent = -1;
  private hintAt = 0;
  private pedalThrottle = 0;
  private pedalBrake = 0;
  private complete = false;
  private pan = 0;
  private lastHeading = 0;
  private turnAmount = 0;
  private mirrorElements: HTMLElement[] = [];
  private size = new THREE.Vector2();
  private settings: GameSettings = { quality: 'balanced', mirrors: true, motion: true, sensitivity: 1, voice: true, examHints: false, cityMap: false, sound: true };
  paused = true;
  cameraMode: CameraMode = 'cockpit';
  look: Look = 'forward';
  constructor(private container: HTMLElement, private emit: (t: Telemetry) => void, private notify: (message: string) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.NeutralToneMapping; this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.overlayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.overlayQuad.position.z = -1; this.overlayQuad.scale.x = -1; this.overlayScene.add(this.overlayQuad);
    this.resize(); window.addEventListener('resize', this.resize); window.addEventListener('keydown', this.keyDown); window.addEventListener('keyup', this.keyUp); window.addEventListener('blur', this.blur); document.addEventListener('visibilitychange', this.visibility);
    this.frame = requestAnimationFrame(this.tick);
  }
  setMirrorElements(elements: HTMLElement[]) { this.mirrorElements = elements; }
  setSuspended(value: boolean) { this.suspended = value; this.last = 0; }
  updateSettings(settings: GameSettings) { this.settings = settings; this.renderer.shadowMap.enabled = settings.quality !== 'low'; const resolution = settings.quality === 'high' ? [512, 192] : settings.quality === 'low' ? [256, 96] : [384, 144]; this.targets.forEach(t => t.setSize(resolution[0], resolution[1])); this.resize(); }
  setCamera(mode: CameraMode) { this.cameraMode = mode; this.cameraReady = false; this.look = 'forward'; }
  setLook(look: Look) { this.look = look; }
  setPaused(value: boolean) { this.paused = value; this.releaseInput(); this.accumulator = 0; }
  releaseInput() { this.keys.clear(); this.input.throttle = this.input.brake = this.input.steer = 0; this.pedalThrottle = this.pedalBrake = 0; }
  reset(message = 'Автомобиль возвращён на старт') { this.endExam(); Object.assign(this.state, initialVehicle()); this.lessonStep = 0; this.complete = false; this.collisions = 0; this.cameraReady = false; this.look = 'forward'; this.simTime = 0; this.judge = new TripJudge(this.map); this.traffic = this.newTraffic(); this.violationsSent = -1; this.snapshots.clear(); this.signWatch.clear(); this.notify(message); }
  private newTraffic() { return this.mapKind === 'city' ? new TrafficSystem(cityLanes(this.city), cityTrafficLayout) : new TrafficSystem(crossStreetLanes(cityMap)); }
  /** Swaps the 3D world and the road data. The city is rebuilt each time so staged signs can replace standing ones. */
  private useMap(kind: MapKind, hiddenSigns = new Set<string>()) {
    if (kind === 'district' && this.mapKind === 'district') return;
    this.endExam();
    this.trafficMeshes.forEach(disposeProp); this.trafficMeshes.clear();
    disposeScene(this.world.scene);
    this.world = kind === 'city' ? createCityWorld(this.city, hiddenSigns) : createWorld();
    this.mapKind = kind; this.map = kind === 'city' ? this.city.map : cityMap;
    this.staticSigns = kind === 'city' ? this.city.signs.filter(s => !hiddenSigns.has(s.id)) : zoneSigns(cityMap.speedZones);
    this.cameraReady = false;
  }
  /** Starts the inspector exam in the city: the chosen situations are placed along a route from the start street. */
  startExam(selected: string[]) {
    const runner = new CityExamRunner(this.city, selected);
    this.useMap('city', new Set(runner.props().signs.map(s => s.id)));
    this.reset('Экзамен: слушайте команды инспектора');
    const p = runner.lanePoint(CITY_START, .5), a = this.city.nodes[CITY_START[0]], b = this.city.nodes[CITY_START[1]];
    const heading = Math.atan2(b.x - a.x, -(b.z - a.z));
    Object.assign(this.state, { x: p.x, z: p.z, heading });
    this.lastHeading = heading; this.cameraReady = false;
    this.stage(runner);
  }
  /** One practice situation: the car stands just before the place, belted, in D with the handbrake off. */
  startPractice(id: string) {
    const scene = practiceScenes[id]; if (!scene) return;
    this.useMap('district');
    this.reset(`Практика: ${situations.find(s => s.id === id)?.title ?? ''}`);
    Object.assign(this.state, { x: scene.spawn.x, z: scene.spawn.z, heading: scene.spawn.heading, belt: true, gear: 'D', handbrake: false });
    this.lastHeading = scene.spawn.heading; this.cameraReady = false;
    this.stage(new ExamRunner([], id));
  }
  private stage(exam: ExamSession) {
    this.exam = exam;
    const scene = this.world.scene, props = exam.props();
    for (const lane of props.rails) this.examProps.push(rails(scene, lane.offset, lane.start, lane.end));
    this.examSignList = props.signs;
    for (const sign of props.signs) { const g = roadSign(scene, sign.code, sign.at, sign.facing, sign.value); g.position.y = this.ground(sign.at.x, sign.at.z); this.examProps.push(g); }
    for (const [a, b] of props.stopLines) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(Math.max(Math.abs(b.x - a.x), .4), .02, Math.max(Math.abs(b.z - a.z), .4)), new THREE.MeshBasicMaterial({ color: '#f2eddb' }));
      line.position.set((a.x + b.x) / 2, .15, (a.z + b.z) / 2); scene.add(line); this.examProps.push(line);
    }
    if (props.regulator) { this.regulator = regulatorFigure(scene); this.regulator.group.position.set(props.regulator.x, this.ground(props.regulator.x, props.regulator.z), props.regulator.z); this.examProps.push(this.regulator.group); }
  }
  endExam() {
    this.examProps.forEach(disposeProp); this.examProps = []; this.regulator = null;
    this.pedestrianMeshes.forEach(disposeProp); this.pedestrianMeshes = [];
    this.exam = null; this.examSignList = []; this.world.goal.rotation.y = 0; this.world.goal.position.set(this.lesson.goal.x, .17, this.lesson.goal.z);
  }
  setLesson(id: string) { const lesson = lessons.find(l => l.id === id); if (!lesson) return; this.useMap('district'); this.lesson = lesson; this.world.goal.position.set(lesson.goal.x, .17, lesson.goal.z); this.reset(`Занятие: ${lesson.title}`); }
  gear(gear: Gear) { const error = selectGear(this.state, gear, Math.max(this.input.brake, this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)); if (error) this.notify(error); }
  toggleBelt() { this.state.belt = !this.state.belt; }
  toggleHandbrake() { this.state.handbrake = !this.state.handbrake; }
  toggleSignal(signal: 'left' | 'right' | 'hazard') { this.state.signal = this.state.signal === signal ? null : signal; this.turnAmount = 0; }
  private keyDown = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.matches('input,select,textarea')) return;
    const handled = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyB', 'KeyC', 'KeyQ', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];
    if (!handled.includes(event.code) || this.paused) return;
    event.preventDefault(); this.keys.add(event.code); if (event.repeat) return;
    if (event.code === 'Space') this.toggleHandbrake();
    if (event.code === 'KeyB') this.toggleBelt();
    if (event.code === 'KeyC') this.setCamera(this.cameraMode === 'cockpit' ? 'chase' : 'cockpit');
    if (event.code === 'KeyQ') this.toggleSignal('left'); if (event.code === 'KeyE') this.toggleSignal('right');
    const gears: Record<string, Gear> = { Digit1: 'P', Digit2: 'R', Digit3: 'N', Digit4: 'D' }; if (gears[event.code]) this.gear(gears[event.code]);
  };
  // Keyup is cancelled too: a focused button would otherwise be activated by Space and pause the trip.
  private keyUp = (event: KeyboardEvent) => { if (this.keys.delete(event.code) && !(event.target instanceof HTMLInputElement)) event.preventDefault(); };
  private blur = () => { if (!this.paused) { this.setPaused(true); this.notify('Поездка приостановлена — окно потеряло фокус'); } };
  private visibility = () => { if (document.hidden) this.blur(); };
  private resize = () => { const w = this.container.clientWidth, h = this.container.clientHeight; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.quality === 'low' ? 1 : this.settings.quality === 'balanced' ? 1.5 : 2)); this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix(); };
  private tick = (now: number) => {
    if (this.disposed) return; this.frame = requestAnimationFrame(this.tick);
    if (this.suspended) { this.last = 0; return; }
    // Never negative: a timestamp out of order would make the body-sway smoothing diverge.
    const dt = this.last ? Math.max(0, Math.min((now - this.last) / 1000, .08)) : 0; this.last = now;
    if (!this.paused) {
      this.accumulator += dt;
      const throttle = Math.max(this.input.throttle, this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
      const brake = Math.max(this.input.brake, this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      this.pedalThrottle = throttle; this.pedalBrake = brake;
      if (throttle > .05 && now - this.hintAt > 4000) {
        // Gas without a drive gear or with the handbrake up looks like a dead pedal; say why.
        const hint = this.state.gear === 'P' || this.state.gear === 'N' ? `Селектор в ${this.state.gear}: удерживая тормоз, выберите D (или R)` : this.state.handbrake ? 'Ручник поднят — снимите его (пробел или кнопка «Ручник»)' : '';
        if (hint) { this.hintAt = now; this.notify(hint); }
      }
      const steer = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? -1 : this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : this.input.steer;
      while (this.accumulator >= 1 / 60) { this.fixedStep(throttle, brake, steer, now); this.accumulator -= 1 / 60; }
    }
    this.updateCar(dt); this.updateTraffic(); this.updateCamera(dt);
    this.render(now);
    this.frames++; if (now - this.fpsAt >= 1000) { this.fps = Math.round(this.frames * 1000 / (now - this.fpsAt)); this.frames = 0; this.fpsAt = now; }
    if (now - this.emitAt > 70) { this.emitAt = now; this.emit({ speed: Math.abs(this.state.speed) * 3.6, rpm: this.state.gear === 'P' || this.state.gear === 'N' ? 850 + this.pedalThrottle * 2200 : 850 + (Math.abs(this.state.speed) * 190) % 1800 + this.pedalThrottle * 700, gear: this.state.gear, belt: this.state.belt, handbrake: this.state.handbrake, signal: this.state.signal, steering: this.state.steer, distance: this.state.distance, fps: this.fps, lessonId: this.lesson.id, lessonStep: this.lessonStep, completed: this.complete, moving: !this.paused, speedLimit: activeZone(this.map, this.state)?.limit ?? null, collisions: this.collisions, violations: this.judge.violations.length === this.violationsSent ? this.judge.violations : [...this.judge.violations], signalAhead: this.signalAhead(), signs: this.signWatch.current().slice(0, 3).map(({ id, code, value }) => ({ id, code, value })), regulatorAhead: this.regulatorAhead(), tripTime: this.simTime, throttle: this.pedalThrottle, brake: this.pedalBrake, exam: this.exam ? { practice: this.exam.practice, selected: this.exam.selected, steps: this.exam.steps, stepIndex: this.exam.stepIndex, command: this.exam.command, finished: this.exam.finished, failReason: this.exam.failReason, progress: Object.fromEntries(this.exam.selected.map(id => [id, this.exam!.progress(id)])), route: this.exam instanceof CityExamRunner ? [this.exam.current[0], ...this.exam.route().map(e => e[1])] : [], target: this.exam instanceof CityExamRunner ? this.exam.target?.node ?? this.exam.target?.edge?.[1] ?? null : null } : null, mapKind: this.mapKind, pose: { x: this.state.x, z: this.state.z, heading: this.state.heading } }); this.violationsSent = this.judge.violations.length; }
  };
  /** One fixed 1/60 s step: signals, traffic, the learner's car, the judge and the exam share the same simulation time. */
  private fixedStep(throttle: number, brake: number, steer: number, now: number) {
    const lamps = lampsAt(this.simTime);
    const prev = { x: this.state.x, z: this.state.z, heading: this.state.heading };
    const exam = this.exam;
    // With the controller on duty the lights there are off and he alone decides who may go (PDD 6.15).
    const ruled = (a: Approach) => !!exam?.controlledByRegulator(a);
    const lampFor = (a: Approach): Lamp | null => ruled(a) || a.control === 'none' ? null : lamps[a.group];
    const forTraffic = (a: Approach): Lamp | null => { if (!ruled(a)) return lampFor(a); const phase = regulatorAt(this.simTime); return allowedManeuvers(phase.pose, sideOf(phase.facing, a.dir)).includes('straight') ? 'green' : 'red'; };
    const forced = this.traffic.step(1 / 60, lamps, this.state, forTraffic);
    const hit = stepVehicle(this.state, { throttle, brake, steer: clamp(steer * this.settings.sensitivity, -1, 1) }, 1 / 60, this.world.obstacles.concat(this.traffic.obstacles()), this.bounds());
    const counted = hit && now - this.collisionAt > 1500;
    if (counted) { this.collisions++; this.collisionAt = now; }
    const before = this.judge.violations.length;
    // A finished exam keeps its log frozen: nothing done afterwards may change the result being reviewed.
    if (!exam?.finished) this.judge.update(prev, this.state, this.simTime, lampFor, counted);
    if (exam) {
      this.judge.violations.slice(before).forEach(v => exam.attribute(v));
      for (const phrase of exam.update({ prev, state: this.state, time: this.simTime, dt: 1 / 60, traffic: this.traffic, forced, judge: this.judge })) { if (phrase !== exam.command) this.notify(phrase); this.onSay(phrase); }
    }
    const found = this.judge.violations.slice(before);
    if (found.length) { this.notify(`${found[found.length - 1].title}${found[found.length - 1].rule ? ` · ${found[found.length - 1].rule}` : ''}`); found.forEach(v => this.captureSnapshot(v.id)); }
    this.signWatch.update(this.examSignList.length ? this.staticSigns.concat(this.examSignList) : this.staticSigns, this.state, this.simTime);
    this.simTime += 1 / 60;
    if (this.exam) {
      const goal = this.exam.goal(); this.world.goal.visible = !!goal;
      if (goal) { this.world.goal.position.set(goal.x, .17 + this.ground(goal.x, goal.z), goal.z); this.world.goal.rotation.y = -(goal.heading ?? 0); }
    } else this.updateLesson();
    if (this.state.signal && this.state.signal !== 'hazard') { this.turnAmount += this.state.heading - this.lastHeading; const matched = this.state.signal === 'right' ? this.turnAmount > .5 : this.turnAmount < -.5; if (matched && Math.abs(this.state.steer) < .08) { this.state.signal = null; this.turnAmount = 0; } }
    this.lastHeading = this.state.heading;
  }
  /** Runs the simulation without waiting for frames (browser checks of whole routes); `control` sets inputs before each step. */
  fastForward(seconds: number, control?: () => void) {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      control?.();
      this.fixedStep(this.input.throttle, this.input.brake, this.input.steer, this.simTime * 1000);
    }
  }
  /** The controller as seen from the approach the car is driving up to: pose, side and what it permits. */
  private regulatorAhead() {
    if (!this.exam) return null;
    const ahead = approachAhead(this.map, this.state, 80); if (!ahead || !this.exam.controlledByRegulator(ahead.approach)) return null;
    const phase = regulatorAt(this.simTime), side = sideOf(phase.facing, ahead.approach.dir);
    return { pose: phase.pose, side, allowed: allowedManeuvers(phase.pose, side), distance: ahead.distance };
  }
  private signalAhead() { const ahead = approachAhead(this.map, this.state, 70, true); return ahead && !this.exam?.controlledByRegulator(ahead.approach) ? { lamp: lampsAt(this.simTime)[ahead.approach.group], distance: ahead.distance } : null; }
  private updateLesson() {
    const steps = this.lesson.steps.length;
    const next = this.lesson.next(this.lessonStep, this.state, { passedLegally: this.judge.passedLegally });
    if (next !== this.lessonStep) {
      if (next === steps) { this.complete = true; const errors = this.judge.violations.length; this.notify(errors ? `Урок пройден с ошибками: ${errors}. Разбор — в журнале поездки` : 'Урок пройден без ошибок! Можно продолжить свободную поездку'); }
      else if (next > this.lessonStep) this.notify(this.lesson.steps[next]);
      this.lessonStep = next;
    }
    this.world.goal.visible = this.lessonStep >= 2 && !this.complete;
  }
  private meshFor(car: TrafficCar) {
    let mesh = this.trafficMeshes.get(car.id);
    if (!mesh) { mesh = car.kind === 'tram' ? tramCar(this.world.scene, car.color) : trafficCar(this.world.scene, car.color); this.trafficMeshes.set(car.id, mesh); }
    return mesh;
  }
  private updateTraffic() {
    const alive = new Set<number>();
    for (const car of this.traffic.cars) { const p = carPosition(car), mesh = this.meshFor(car); mesh.position.set(p.x, this.ground(p.x, p.z), p.z); mesh.rotation.y = -p.heading; alive.add(car.id); }
    for (const [id, mesh] of this.trafficMeshes) if (!alive.has(id)) { disposeProp(mesh); this.trafficMeshes.delete(id); }
    const lamps = lampsAt(this.simTime);
    for (const head of this.world.signals) paintSignal(head, this.exam?.controlledByRegulator(head.approach) ? 'off' : lamps[head.group], this.simTime);
    if (this.regulator) { const phase = regulatorAt(this.simTime); this.regulator.setPose(phase.pose, phase.facing); }
    const people = this.exam?.pedestrians ?? [];
    while (this.pedestrianMeshes.length < people.length) this.pedestrianMeshes.push(pedestrianFigure(this.world.scene, ['#c0614c', '#4f78a0'][this.pedestrianMeshes.length % 2]));
    while (this.pedestrianMeshes.length > people.length) disposeProp(this.pedestrianMeshes.pop()!);
    people.forEach((p, i) => { const m = this.pedestrianMeshes[i]; m.position.set(p.x, this.ground(p.x, p.z) + (p.waiting ? 0 : Math.abs(Math.sin(this.simTime * 7 + i)) * .04), p.z); m.rotation.y = p.axis === 'z' ? (p.dir > 0 ? Math.PI : 0) : p.dir > 0 ? -Math.PI / 2 : Math.PI / 2; });
  }
  /** Renders a heading-up top view around the car into a small JPEG. */
  private captureSnapshot(id: number) {
    this.updateCar(0); this.updateTraffic();
    const cam = this.snapshotCamera, h = this.state.heading;
    cam.position.set(this.state.x + Math.sin(h) * 6, 90, this.state.z - Math.cos(h) * 6);
    cam.up.set(Math.sin(h), 0, -Math.cos(h)); cam.lookAt(this.state.x + Math.sin(h) * 6, 0, this.state.z - Math.cos(h) * 6); cam.updateProjectionMatrix();
    const target = this.snapshotTarget; target.texture.colorSpace = THREE.SRGBColorSpace;
    const fog = this.world.scene.fog; this.world.scene.fog = null;
    this.renderer.setRenderTarget(target); this.renderer.clear(); this.renderer.render(this.world.scene, cam); this.renderer.setRenderTarget(null);
    this.world.scene.fog = fog;
    const { width, height } = target, pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    ctx.putImageData(image, 0, 0);
    this.snapshots.set(id, canvas.toDataURL('image/jpeg', .82));
  }
private sunScene: THREE.Scene | null = null; private sun: THREE.DirectionalLight | undefined;
  private sunLight() {
    if (this.sunScene !== this.world.scene) { this.sunScene = this.world.scene; this.sun = this.world.scene.children.find((o): o is THREE.DirectionalLight => o instanceof THREE.DirectionalLight); if (this.sun && !this.sun.target.parent) this.world.scene.add(this.sun.target); }
    return this.sun;
  }
    /** Ground height under a point of the current map. */
  private ground = (x: number, z: number) => this.mapKind === 'city' ? this.city.height(x, z) : 0;
  private bounds(): WorldBounds { return this.mapKind === 'city' ? { minX: -CITY_EDGE, maxX: CITY_EDGE, minZ: -CITY_EDGE, maxZ: CITY_EDGE, ground: this.ground } : districtBounds; }
  private updateCar(dt: number) {
    const { car, shell, wheel, tires, frontTires } = this.world;
    car.position.set(this.state.x, this.ground(this.state.x, this.state.z), this.state.z);
    // Yaw first, then the nose follows the slope of the street.
    car.rotation.order = 'YXZ'; car.rotation.y = -this.state.heading; car.rotation.x = this.mapKind === 'city' ? Math.atan(gradeAt(this.ground, this.state.x, this.state.z, this.state.heading)) : 0;
    const factor = 1 - Math.exp(-5 * dt); const pitch = this.settings.motion ? this.state.acceleration * .008 : 0; const roll = this.settings.motion ? clamp(this.state.speed * this.state.speed * this.state.steer * .0008, -.035, .035) : 0;
    shell.rotation.x += (pitch - shell.rotation.x) * factor; shell.rotation.z += (roll - shell.rotation.z) * factor;
    wheel.rotation.z = -this.state.steer * 5; tires.forEach(t => t.rotation.x -= this.state.speed * dt / .35); frontTires.forEach(t => t.rotation.y = -this.state.steer * .4);
  }
  private updateCamera(dt: number) {
    const h = this.state.heading; const car = this.world.car;
    const desiredPan = this.look === 'left' ? .9 : this.look === 'right' ? -.9 : 0;
    this.pan += (desiredPan - this.pan) * (1 - Math.exp(-6 * dt));
    const position = this.cameraMode === 'cockpit' ? new THREE.Vector3(-.43, 1.46, .23) : new THREE.Vector3(0, 4.8, 9.3);
    // The cockpit pitches with the car on a hill; the chase camera only turns with it.
    const quaternion = this.cameraMode === 'cockpit' ? car.quaternion.clone() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h);
    position.applyQuaternion(quaternion).add(car.position);
    if (this.cameraMode === 'cockpit' && this.settings.motion) position.y += this.world.shell.rotation.x * .2;
    if (!this.cameraReady || this.cameraMode === 'cockpit') this.camera.position.copy(position); else this.camera.position.lerp(position, 1 - Math.exp(-7 * dt));
    const look = this.look === 'rear' && this.cameraMode === 'cockpit' ? new THREE.Vector3(-.25, 1.8, -1.5) : new THREE.Vector3(-.43 - Math.sin(this.pan) * 9, this.cameraMode === 'cockpit' ? 1.5 : .8, -12 * Math.cos(this.pan));
    this.camera.lookAt(look.applyQuaternion(quaternion).add(car.position)); this.cameraReady = true;
    // The sun's shadow box (±90 m) travels with the car, so the big city has shadows wherever you drive.
    const sun = this.sunLight();
    if (sun) { sun.target.position.copy(car.position); sun.position.set(car.position.x - 45, car.position.y + 75, car.position.z + 45); sun.target.updateMatrixWorld(); }
    // Show cabin dashboard/steering in first person; hide only its roof to avoid obstructing the driver's view.
  }
  private render(now: number) {
    const renderer = this.renderer; renderer.getSize(this.size); renderer.setScissorTest(false); renderer.setViewport(0, 0, this.size.x, this.size.y); renderer.setRenderTarget(null); renderer.clear(); renderer.render(this.world.scene, this.camera);
    if (!this.settings.mirrors) return;
    if (now - this.mirrorAt > (this.settings.quality === 'low' ? 150 : 85)) {
      this.mirrorAt = now;
      const q = this.world.car.quaternion; const pos = this.world.car.position;
      const localX = [-1.02, -.4, 1.02]; const targetX = [-5, -.4, 5];
      // The rear-view camera sits at the back of the roof so seats and headrests do not fill the mirror.
      const localZ = [-.3, 2.1, -.3], localY = [1.38, 1.5, 1.38];
      this.mirrorCameras.forEach((camera, i) => { camera.position.copy(new THREE.Vector3(localX[i], localY[i], localZ[i]).applyQuaternion(q).add(pos)); camera.lookAt(new THREE.Vector3(targetX[i], 1.4, 24).applyQuaternion(q).add(pos)); renderer.setRenderTarget(this.targets[i]); renderer.clear(); renderer.render(this.world.scene, camera); });
      renderer.setRenderTarget(null);
    }
    const parentRect = this.container.getBoundingClientRect();
    renderer.setScissorTest(true);
    this.mirrorElements.forEach((element, i) => {
      const rect = element.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
      const x = rect.left - parentRect.left, y = this.size.y - (rect.bottom - parentRect.top);
      renderer.setViewport(x, y, rect.width, rect.height); renderer.setScissor(x, y, rect.width, rect.height); renderer.clearDepth(); this.overlayQuad.material.map = this.targets[i].texture; renderer.render(this.overlayScene, this.overlayCamera);
    });
    renderer.setScissorTest(false); renderer.setViewport(0, 0, this.size.x, this.size.y);
  }
  dispose() { this.disposed = true; cancelAnimationFrame(this.frame); window.removeEventListener('resize', this.resize); window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility); disposeScene(this.world.scene); this.targets.forEach(t => t.dispose()); this.snapshotTarget.dispose(); this.overlayQuad.geometry.dispose(); this.overlayQuad.material.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}

/** Frees every geometry, material and texture of a scene that is being replaced. */
function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
  scene.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); } });
  geometries.forEach(g => g.dispose());
  mats.forEach(m => { if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose(); m.dispose(); });
}
