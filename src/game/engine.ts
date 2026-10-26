import * as THREE from 'three';
import { createWorld } from './world';
import { clamp, initialVehicle, selectGear, stepVehicle, type Gear, type DriveInput, type VehicleState } from './vehicle';
import { nextLessonStep } from './lesson';

export interface Telemetry { speed: number; rpm: number; gear: Gear; belt: boolean; handbrake: boolean; signal: VehicleState['signal']; steering: number; distance: number; fps: number; lessonStep: number; completed: boolean; moving: boolean; speedLimit: number | null; collisions: number; }
export type CameraMode = 'cockpit' | 'chase';
export type Look = 'forward' | 'left' | 'rear' | 'right';
export interface GameSettings { quality: 'low' | 'balanced' | 'high'; mirrors: boolean; motion: boolean; sensitivity: number; }
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
  private complete = false;
  private pan = 0;
  private lastHeading = 0;
  private turnAmount = 0;
  private mirrorElements: HTMLElement[] = [];
  private size = new THREE.Vector2();
  private settings: GameSettings = { quality: 'balanced', mirrors: true, motion: true, sensitivity: 1 };
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
  releaseInput() { this.keys.clear(); this.input.throttle = this.input.brake = this.input.steer = 0; }
  reset() { Object.assign(this.state, initialVehicle()); this.lessonStep = 0; this.complete = false; this.collisions = 0; this.cameraReady = false; this.look = 'forward'; this.notify('Автомобиль возвращён на старт'); }
  gear(gear: Gear) { const error = selectGear(this.state, gear, Math.max(this.input.brake, this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)); if (error) this.notify(error); }
  toggleBelt() { this.state.belt = !this.state.belt; }
  toggleHandbrake() { this.state.handbrake = !this.state.handbrake; }
  toggleSignal(signal: 'left' | 'right' | 'hazard') { this.state.signal = this.state.signal === signal ? null : signal; this.turnAmount = 0; }
  private keyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).matches('input,select,textarea')) return;
    const handled = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyB', 'KeyC', 'KeyQ', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];
    if (!handled.includes(event.code) || this.paused) return;
    event.preventDefault(); this.keys.add(event.code); if (event.repeat) return;
    if (event.code === 'Space') this.toggleHandbrake();
    if (event.code === 'KeyB') this.toggleBelt();
    if (event.code === 'KeyC') this.setCamera(this.cameraMode === 'cockpit' ? 'chase' : 'cockpit');
    if (event.code === 'KeyQ') this.toggleSignal('left'); if (event.code === 'KeyE') this.toggleSignal('right');
    const gears: Record<string, Gear> = { Digit1: 'P', Digit2: 'R', Digit3: 'N', Digit4: 'D' }; if (gears[event.code]) this.gear(gears[event.code]);
  };
  private keyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private blur = () => { if (!this.paused) { this.setPaused(true); this.notify('Поездка приостановлена — окно потеряло фокус'); } };
  private visibility = () => { if (document.hidden) this.blur(); };
  private resize = () => { const w = this.container.clientWidth, h = this.container.clientHeight; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.quality === 'low' ? 1 : this.settings.quality === 'balanced' ? 1.5 : 2)); this.renderer.setSize(w, h); this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix(); };
  private tick = (now: number) => {
    if (this.disposed) return; this.frame = requestAnimationFrame(this.tick);
    if (this.suspended) { this.last = 0; return; }
    const dt = this.last ? Math.min((now - this.last) / 1000, .08) : 0; this.last = now;
    if (!this.paused) {
      this.accumulator += dt;
      const throttle = Math.max(this.input.throttle, this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
      const brake = Math.max(this.input.brake, this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const steer = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? -1 : this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : this.input.steer;
      while (this.accumulator >= 1 / 60) {
        const hit = stepVehicle(this.state, { throttle, brake, steer: clamp(steer * this.settings.sensitivity, -1, 1) }, 1 / 60, this.world.obstacles);
        if (hit && now - this.collisionAt > 1500) { this.collisions++; this.collisionAt = now; this.notify('Столкновение. Снизьте скорость и проверьте габариты'); }
        this.accumulator -= 1 / 60;
      }
      this.updateLesson();
      if (this.state.signal && this.state.signal !== 'hazard') { this.turnAmount += this.state.heading - this.lastHeading; const matched = this.state.signal === 'right' ? this.turnAmount > .5 : this.turnAmount < -.5; if (matched && Math.abs(this.state.steer) < .08) { this.state.signal = null; this.turnAmount = 0; } }
    }
    this.lastHeading = this.state.heading;
    this.updateCar(dt); this.updateCamera(dt);
    this.render(now);
    this.frames++; if (now - this.fpsAt >= 1000) { this.fps = Math.round(this.frames * 1000 / (now - this.fpsAt)); this.frames = 0; this.fpsAt = now; }
    if (now - this.emitAt > 70) { this.emitAt = now; this.emit({ speed: Math.abs(this.state.speed) * 3.6, rpm: this.state.gear === 'P' || this.state.gear === 'N' ? 850 + this.input.throttle * 2200 : 850 + (Math.abs(this.state.speed) * 190) % 1800, gear: this.state.gear, belt: this.state.belt, handbrake: this.state.handbrake, signal: this.state.signal, steering: this.state.steer, distance: this.state.distance, fps: this.fps, lessonStep: this.lessonStep, completed: this.complete, moving: !this.paused, speedLimit: this.state.z < 57 && this.state.z > 20 && Math.abs(this.state.x) < 9 ? 30 : null, collisions: this.collisions }); }
  };
  private updateLesson() {
    const next = nextLessonStep(this.lessonStep, this.state);
    if (next !== this.lessonStep) {
      if (next === 3) this.notify('Остановитесь в зелёной зоне впереди');
      if (next === 4) this.notify('Зафиксируйте автомобиль: ручник и P');
      if (next === 5) { this.complete = true; this.notify('Урок пройден! Можно продолжить свободную поездку'); }
      this.lessonStep = next;
    }
    this.world.goal.visible = this.lessonStep >= 2 && !this.complete;
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
  dispose() { this.disposed = true; cancelAnimationFrame(this.frame); window.removeEventListener('resize', this.resize); window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility); const geometries = new Set<THREE.BufferGeometry>(); const mats = new Set<THREE.Material>(); this.world.scene.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m)); } }); geometries.forEach(g => g.dispose()); mats.forEach(m => { if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose(); m.dispose(); }); this.targets.forEach(t => t.dispose()); this.overlayQuad.geometry.dispose(); this.overlayQuad.material.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
