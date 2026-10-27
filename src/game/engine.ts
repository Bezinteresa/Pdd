import * as THREE from 'three';
import { createWorld, disposeProp, paintSignal, pedestrianFigure, rails, regulatorFigure, roadSign, trafficCar, tramCar, type RegulatorFigure } from './world';
import { clamp, initialVehicle, selectGear, stepVehicle, type Gear, type DriveInput, type VehicleState } from './vehicle';
import { lessons, type Lesson } from './lesson';
import { activeZone, approachAhead, cityMap } from './roads';
import { lampsAt, type Lamp } from './signals';
import { TripJudge, type Violation } from './rules';
import { carPosition, crossStreetLanes, TrafficSystem, type TrafficCar } from './traffic';
import { ExamRunner, examSigns, practiceScenes, situations, stopLineD, tramTrack, type RouteStep, type SituationProgress } from './exam';
import { SignWatch, zoneSigns, type PlacedSign } from './signs';
import type { Maneuver, Pose as ControllerPose, Side } from './regulator';
import { allowedManeuvers, regulatorAt, sideOf } from './regulator';

export interface Telemetry { speed: number; rpm: number; gear: Gear; belt: boolean; handbrake: boolean; signal: VehicleState['signal']; steering: number; distance: number; fps: number; lessonId: string; lessonStep: number; completed: boolean; moving: boolean; speedLimit: number | null; collisions: number; violations: Violation[]; signalAhead: { lamp: Lamp; distance: number } | null; signs: Pick<PlacedSign, 'id' | 'code' | 'value'>[]; regulatorAhead: { pose: ControllerPose; side: Side; allowed: Maneuver[]; distance: number } | null; tripTime: number; throttle: number; brake: number; exam: ExamTelemetry | null; }
export interface ExamTelemetry { practice: string | null; selected: string[]; steps: RouteStep[]; stepIndex: number; command: string; finished: boolean; failReason: string | null; progress: Record<string, SituationProgress>; }
export type CameraMode = 'cockpit' | 'chase';
export type Look = 'forward' | 'left' | 'rear' | 'right';
export interface GameSettings { quality: 'low' | 'balanced' | 'high'; mirrors: boolean; motion: boolean; sensitivity: number; voice: boolean; examHints: boolean; }
export class DrivingEngine {
  readonly state = initialVehicle();
  readonly input: DriveInput = { throttle: 0, brake: 0, steer: 0 };
  private keys = new Set<string>();
  private world = createWorld();
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(66, 1, .08, 300);
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
  private judge = new TripJudge(cityMap);
  private traffic = new TrafficSystem(crossStreetLanes(cityMap));
  private trafficMeshes = new Map<number, THREE.Group>();
  private citySigns = zoneSigns(cityMap.speedZones);
  private examSignList: PlacedSign[] = [];
  private signWatch = new SignWatch();
  private exam: ExamRunner | null = null;
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
  private settings: GameSettings = { quality: 'balanced', mirrors: true, motion: true, sensitivity: 1, voice: true, examHints: false };
  paused = true;
  cameraMode: CameraMode = 'cockpit';
  look: Look = 'forward';
  constructor(private container: HTMLElement, private emit: (t: Telemetry) => void, private notify: (message: string) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
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
  reset(message = 'Автомобиль возвращён на старт') { this.endExam(); Object.assign(this.state, initialVehicle()); this.lessonStep = 0; this.complete = false; this.collisions = 0; this.cameraReady = false; this.look = 'forward'; this.simTime = 0; this.judge = new TripJudge(cityMap); this.traffic = new TrafficSystem(crossStreetLanes(cityMap)); this.violationsSent = -1; this.snapshots.clear(); this.signWatch.clear(); this.notify(message); }
  /** Starts the inspector exam with the chosen situations from the usual start position. */
  startExam(selected: string[]) {
    this.reset('Экзамен: слушайте команды инспектора');
    this.stage(new ExamRunner(selected));
  }
  /** One practice situation: the car stands just before the place, belted, in D with the handbrake off. */
  startPractice(id: string) {
    const scene = practiceScenes[id]; if (!scene) return;
    this.reset(`Практика: ${situations.find(s => s.id === id)?.title ?? ''}`);
    Object.assign(this.state, { x: scene.spawn.x, z: scene.spawn.z, heading: scene.spawn.heading, belt: true, gear: 'D', handbrake: false });
    this.lastHeading = scene.spawn.heading; this.cameraReady = false;
    this.stage(new ExamRunner([], id));
  }
  private stage(exam: ExamRunner) {
    const selected = exam.selected; this.exam = exam;
    const scene = this.world.scene;
    if (exam.tram) this.examProps.push(rails(scene, tramTrack.offset, tramTrack.start, tramTrack.end));
    this.examSignList = examSigns(selected);
    for (const sign of this.examSignList) this.examProps.push(roadSign(scene, sign.code, sign.at, sign.facing));
    if (exam.stopSign) { const [a, b] = stopLineD; const line = new THREE.Mesh(new THREE.BoxGeometry(b.x - a.x, .02, .4), new THREE.MeshBasicMaterial({ color: '#f2eddb' })); line.position.set((a.x + b.x) / 2, .15, a.z); scene.add(line); this.examProps.push(line); }
    if (exam.regulator) { this.regulator = regulatorFigure(scene); this.examProps.push(this.regulator.group); }
    this.world.goal.position.set(exam.finish.x, .17, exam.finish.z);
  }
  endExam() {
    this.examProps.forEach(disposeProp); this.examProps = []; this.regulator = null;
    this.pedestrianMeshes.forEach(disposeProp); this.pedestrianMeshes = [];
    this.exam = null; this.examSignList = []; this.world.goal.position.set(this.lesson.goal.x, .17, this.lesson.goal.z);
  }
  setLesson(id: string) { const lesson = lessons.find(l => l.id === id); if (!lesson) return; this.lesson = lesson; this.world.goal.position.set(lesson.goal.x, .17, lesson.goal.z); this.reset(`Занятие: ${lesson.title}`); }
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
    if (now - this.emitAt > 70) { this.emitAt = now; this.emit({ speed: Math.abs(this.state.speed) * 3.6, rpm: this.state.gear === 'P' || this.state.gear === 'N' ? 850 + this.pedalThrottle * 2200 : 850 + (Math.abs(this.state.speed) * 190) % 1800 + this.pedalThrottle * 700, gear: this.state.gear, belt: this.state.belt, handbrake: this.state.handbrake, signal: this.state.signal, steering: this.state.steer, distance: this.state.distance, fps: this.fps, lessonId: this.lesson.id, lessonStep: this.lessonStep, completed: this.complete, moving: !this.paused, speedLimit: activeZone(cityMap, this.state)?.limit ?? null, collisions: this.collisions, violations: this.judge.violations.length === this.violationsSent ? this.judge.violations : [...this.judge.violations], signalAhead: this.signalAhead(), signs: this.signWatch.current().slice(0, 3).map(({ id, code, value }) => ({ id, code, value })), regulatorAhead: this.regulatorAhead(), tripTime: this.simTime, throttle: this.pedalThrottle, brake: this.pedalBrake, exam: this.exam ? { practice: this.exam.practice, selected: this.exam.selected, steps: this.exam.steps, stepIndex: this.exam.stepIndex, command: this.exam.step.command, finished: this.exam.finished, failReason: this.exam.failReason, progress: Object.fromEntries(this.exam.selected.map(id => [id, this.exam!.progress(id)])) } : null }); this.violationsSent = this.judge.violations.length; }
  };
  /** One fixed 1/60 s step: signals, traffic, the learner's car, the judge and the exam share the same simulation time. */
  private fixedStep(throttle: number, brake: number, steer: number, now: number) {
    const lamps = lampsAt(this.simTime);
    const prev = { x: this.state.x, z: this.state.z, heading: this.state.heading };
    const exam = this.exam;
    // With the controller on duty the lights are off and he alone decides who may go (PDD 6.15).
    const regulated = exam?.regulator ? (a: { dir: { x: number; z: number } }): Lamp => { const phase = regulatorAt(this.simTime); return allowedManeuvers(phase.pose, sideOf(phase.facing, a.dir)).includes('straight') ? 'green' : 'red'; } : undefined;
    const forced = this.traffic.step(1 / 60, lamps, this.state, regulated);
    const hit = stepVehicle(this.state, { throttle, brake, steer: clamp(steer * this.settings.sensitivity, -1, 1) }, 1 / 60, this.world.obstacles.concat(this.traffic.obstacles()));
    const counted = hit && now - this.collisionAt > 1500;
    if (counted) { this.collisions++; this.collisionAt = now; }
    const before = this.judge.violations.length;
    // A finished exam keeps its log frozen: nothing done afterwards may change the result being reviewed.
    if (!exam?.finished) this.judge.update(prev, this.state, this.simTime, exam?.regulator ? { ns: 'green', ew: 'green' } : lamps, counted);
    if (exam) {
      this.judge.violations.slice(before).forEach(v => exam.attribute(v));
      for (const phrase of exam.update({ prev, state: this.state, time: this.simTime, dt: 1 / 60, traffic: this.traffic, forced, judge: this.judge })) { if (phrase !== exam.step.command) this.notify(phrase); this.onSay(phrase); }
    }
    const found = this.judge.violations.slice(before);
    if (found.length) { this.notify(`${found[found.length - 1].title}${found[found.length - 1].rule ? ` · ${found[found.length - 1].rule}` : ''}`); found.forEach(v => this.captureSnapshot(v.id)); }
    this.signWatch.update(this.examSignList.length ? this.citySigns.concat(this.examSignList) : this.citySigns, this.state, this.simTime);
    this.simTime += 1 / 60;
    if (this.exam) this.world.goal.visible = this.exam.step.kind === 'finish' && !this.exam.finished; else this.updateLesson();
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
    if (!this.exam?.regulator) return null;
    const ahead = approachAhead(cityMap, this.state, 80); if (!ahead || ahead.approach.intersection !== 'central') return null;
    const phase = regulatorAt(this.simTime), side = sideOf(phase.facing, ahead.approach.dir);
    return { pose: phase.pose, side, allowed: allowedManeuvers(phase.pose, side), distance: ahead.distance };
  }
  private signalAhead() { const ahead = this.exam?.regulator ? null : approachAhead(cityMap, this.state); return ahead ? { lamp: lampsAt(this.simTime)[ahead.approach.group], distance: ahead.distance } : null; }
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
    for (const car of this.traffic.cars) { const p = carPosition(car), mesh = this.meshFor(car); mesh.position.set(p.x, 0, p.z); mesh.rotation.y = -p.heading; alive.add(car.id); }
    for (const [id, mesh] of this.trafficMeshes) if (!alive.has(id)) { disposeProp(mesh); this.trafficMeshes.delete(id); }
    const lamps = lampsAt(this.simTime), dark = !!this.exam?.regulator;
    for (const head of this.world.signals) paintSignal(head, dark ? 'off' : lamps[head.group], this.simTime);
    if (this.regulator) { const phase = regulatorAt(this.simTime); this.regulator.setPose(phase.pose, phase.facing); }
    const people = this.exam?.pedestrians ?? [];
    while (this.pedestrianMeshes.length < people.length) this.pedestrianMeshes.push(pedestrianFigure(this.world.scene, ['#c0614c', '#4f78a0'][this.pedestrianMeshes.length % 2]));
    while (this.pedestrianMeshes.length > people.length) disposeProp(this.pedestrianMeshes.pop()!);
    people.forEach((p, i) => { const m = this.pedestrianMeshes[i]; m.position.set(p.x, p.waiting ? 0 : Math.abs(Math.sin(this.simTime * 7 + i)) * .04, p.z); m.rotation.y = p.dir > 0 ? -Math.PI / 2 : Math.PI / 2; });
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
  private updateCar(dt: number) {
    const { car, shell, wheel, tires, frontTires } = this.world;
    car.position.set(this.state.x, 0, this.state.z); car.rotation.y = -this.state.heading;
    const factor = 1 - Math.exp(-5 * dt); const pitch = this.settings.motion ? this.state.acceleration * .008 : 0; const roll = this.settings.motion ? clamp(this.state.speed * this.state.speed * this.state.steer * .0008, -.035, .035) : 0;
    shell.rotation.x += (pitch - shell.rotation.x) * factor; shell.rotation.z += (roll - shell.rotation.z) * factor;
    wheel.rotation.z = -this.state.steer * 5; tires.forEach(t => t.rotation.x -= this.state.speed * dt / .35); frontTires.forEach(t => t.rotation.y = -this.state.steer * .4);
  }
  private updateCamera(dt: number) {
    const h = this.state.heading; const car = this.world.car;
    const desiredPan = this.look === 'left' ? .9 : this.look === 'right' ? -.9 : 0;
    this.pan += (desiredPan - this.pan) * (1 - Math.exp(-6 * dt));
    const position = this.cameraMode === 'cockpit' ? new THREE.Vector3(-.43, 1.46, .23) : new THREE.Vector3(0, 4.8, 9.3);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h);
    position.applyQuaternion(quaternion).add(car.position);
    if (this.cameraMode === 'cockpit' && this.settings.motion) position.y += this.world.shell.rotation.x * .2;
    if (!this.cameraReady || this.cameraMode === 'cockpit') this.camera.position.copy(position); else this.camera.position.lerp(position, 1 - Math.exp(-7 * dt));
    const look = this.look === 'rear' && this.cameraMode === 'cockpit' ? new THREE.Vector3(-.25, 1.8, -1.5) : new THREE.Vector3(-.43 - Math.sin(this.pan) * 9, this.cameraMode === 'cockpit' ? 1.5 : .8, -12 * Math.cos(this.pan));
    this.camera.lookAt(look.applyQuaternion(quaternion).add(car.position)); this.cameraReady = true;
    // Show cabin dashboard/steering in first person; hide only its roof to avoid obstructing the driver's view.
  }
  private render(now: number) {
    const renderer = this.renderer; renderer.getSize(this.size); renderer.setScissorTest(false); renderer.setViewport(0, 0, this.size.x, this.size.y); renderer.setRenderTarget(null); renderer.clear(); renderer.render(this.world.scene, this.camera);
    if (!this.settings.mirrors) return;
    if (now - this.mirrorAt > (this.settings.quality === 'low' ? 150 : 85)) {
      this.mirrorAt = now;
      const q = this.world.car.quaternion; const pos = this.world.car.position;
      const localX = [-1.02, -.4, 1.02]; const targetX = [-5, -.4, 5];
      this.mirrorCameras.forEach((camera, i) => { camera.position.copy(new THREE.Vector3(localX[i], 1.38, -.3).applyQuaternion(q).add(pos)); camera.lookAt(new THREE.Vector3(targetX[i], 1.4, 24).applyQuaternion(q).add(pos)); renderer.setRenderTarget(this.targets[i]); renderer.clear(); renderer.render(this.world.scene, camera); });
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
  dispose() { this.disposed = true; cancelAnimationFrame(this.frame); window.removeEventListener('resize', this.resize); window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility); const geometries = new Set<THREE.BufferGeometry>(); const mats = new Set<THREE.Material>(); this.world.scene.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); } }); geometries.forEach(g => g.dispose()); mats.forEach(m => { if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose(); m.dispose(); }); this.targets.forEach(t => t.dispose()); this.snapshotTarget.dispose(); this.overlayQuad.geometry.dispose(); this.overlayQuad.material.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
