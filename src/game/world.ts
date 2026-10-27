import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Obstacle } from './vehicle';
import { cityMap, type Approach, type RoadMap } from './roads';
import type { Lamp, SignalGroup } from './signals';
import type { Pose } from './regulator';
import type { Point } from './roads';

export interface SignalHead { group: SignalGroup; approach: Approach; red: THREE.MeshBasicMaterial; yellow: THREE.MeshBasicMaterial; green: THREE.MeshBasicMaterial; }
export interface World { scene: THREE.Scene; obstacles: Obstacle[]; car: THREE.Group; shell: THREE.Group; wheel: THREE.Group; tires: THREE.Group[]; frontTires: THREE.Group[]; goal: THREE.Group; signals: SignalHead[]; }
const materials = new Map<string, THREE.MeshStandardMaterial>();
function material(color: string) { if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9 })); return materials.get(color)!; }
export function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color)); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function textTexture(text: string, bg: string, fg: string, width = 512, height = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height); ctx.fillStyle = fg; ctx.font = `700 ${Math.min(height * 0.46, width / Math.max(text.length, 1) * 1.4)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, width / 2, height / 2); return new THREE.CanvasTexture(canvas);
}
function board(parent: THREE.Object3D, text: string, x: number, y: number, z: number, width: number, height: number, bg: string, fg: string) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: textTexture(text, bg, fg), side: THREE.DoubleSide })); m.position.set(x, y, z); parent.add(m); return m;
}
export function tree(scene: THREE.Scene, x: number, z: number, size = 1) {
  box(scene, .35 * size, 2.2 * size, .35 * size, x, 1.1 * size, z, '#866d50');
  const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.65 * size, 0), material('#638977')); foliage.scale.y = 1.45; foliage.position.set(x, 3.1 * size, z); foliage.castShadow = true; scene.add(foliage);
}
function cone(scene: THREE.Scene, x: number, z: number) {
  box(scene, .7, .09, .7, x, .05, z, '#394340');
  const c = new THREE.Mesh(new THREE.ConeGeometry(.26, .8, 8), material('#e69253')); c.position.set(x, .48, z); scene.add(c);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(.13, .19, .17, 8), material('#f6f2e8')); stripe.position.set(x, .48, z); scene.add(stripe);
}
function speedSign(scene: THREE.Scene, x: number, z: number, value: string) {
  box(scene, .09, 2.7, .09, x, 1.35, z, '#8b9690');
  const circle = (r: number, color: string, depth: number) => { const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); mesh.position.set(x, 2.55, z + depth); scene.add(mesh); };
  circle(.7, '#b84033', 0); circle(.56, '#fffdf4', .005);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(.92, .66), new THREE.MeshBasicMaterial({ map: textTexture(value, '#fffdf4', '#24332e'), side: THREE.DoubleSide })); label.position.set(x, 2.55, z + .01); scene.add(label);
}
function parkedCar(scene: THREE.Scene, x: number, z: number, color: string, obstacles: Obstacle[]) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  box(g, 1.8, .65, 3.8, 0, .7, 0, color); box(g, 1.55, .65, 1.9, 0, 1.28, .05, '#546d70');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, .22, .5, .62, sx * .86, .35, sz * 1.2, '#263431');
  obstacles.push({ x, z, halfX: .95, halfZ: 2 });
}
type LampSlot = { approach: Approach; x: number; z: number; rotation: number };

/** Sky, fog and lights shared by every map. */
export function newScene(fogFar = 240) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#c7d9d3'); scene.fog = new THREE.Fog('#c7d9d3', 75, fogFar);
  scene.add(new THREE.HemisphereLight('#f0f8f7', '#7f8974', 2.6));
  const sun = new THREE.DirectionalLight('#fff1d5', 3.1); sun.position.set(-45, 75, 45); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -90; sun.shadow.camera.right = 90; sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90; sun.shadow.camera.far = 180; sun.shadow.bias = -.001; scene.add(sun);
  return scene;
}
/** Crosswalk stripes and stop lines of signalised approaches, from the map data the judge uses. */
export function markings(scene: THREE.Scene, map: RoadMap) {
  for (const c of map.crosswalks) {
    const alongX = c.halfX > c.halfZ, half = alongX ? c.halfX : c.halfZ;
    for (let t = -half + 1; t < half; t += 2) box(scene, alongX ? 1.1 : c.halfX * 2, .025, alongX ? c.halfZ * 2 : 1.1, alongX ? c.x + t : c.x, .16, alongX ? c.z : c.z + t, '#f2eddb');
  }
  for (const a of map.approaches) if (a.control !== 'none') { const [p, q] = a.stopLine; box(scene, Math.max(Math.abs(q.x - p.x), .4), .02, Math.max(Math.abs(q.z - p.z), .4), (p.x + q.x) / 2, .15, (p.z + q.z) / 2, '#f2eddb'); }
}
/** Poles and housings of the traffic lights; the lamps themselves are added after batching. */
export function signalPoles(scene: THREE.Scene, map: RoadMap, obstacles: Obstacle[]): LampSlot[] {
  const slots: LampSlot[] = [];
  for (const a of map.approaches) for (const h of a.heads) {
    // Heads face oncoming traffic of their approach.
    const rotation = Math.atan2(-a.dir.x, -a.dir.z);
    box(scene, .13, 3.9, .13, h.x, 1.95, h.z, '#63756d');
    const housing = box(scene, .52, 1.5, .45, h.x, 3.5, h.z, '#2c3d34'); housing.rotation.y = rotation;
    slots.push({ approach: a, x: h.x, z: h.z, rotation });
    obstacles.push({ x: h.x, z: h.z, halfX: .12, halfZ: .12 });
  }
  return slots;
}
/** Four houses with windows on a lot (centre, width, depth); each house is an obstacle. Returns the colour counter. */
export function houses(scene: THREE.Scene, lot: { x: number; z: number; w: number; d: number }, obstacles: Obstacle[], seed: number) {
  const colors = ['#d9d4bb', '#c9c7ae', '#e5d9c5', '#c8cbb9'];
  let count = seed;
  box(scene, lot.w, .25, lot.d, lot.x, .05, lot.z, '#b8bea9');
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    const x = lot.x + dx * lot.w * .23, z = lot.z + dz * lot.d * .23, w = lot.w * .38, d = lot.d * .37, h = 7 + (count * 7 % 11); count++;
    box(scene, w, h, d, x, h / 2 + .25, z, colors[count % colors.length]); box(scene, w + .35, .45, d + .35, x, h + .4, z, '#798879');
    for (let y = 2.7; y < h; y += 2.8) for (let wx = -w / 2 + 2; wx < w / 2 - .5; wx += 3.3) { box(scene, 1.5, 1.3, .06, x + wx, y, z + d / 2 + .04, '#698782'); box(scene, 1.5, 1.3, .06, x + wx, y, z - d / 2 - .04, '#698782'); }
    obstacles.push({ x, z, halfX: w / 2, halfZ: d / 2 });
  }
  return count;
}
/** Merges static primitives by material, then adds the lamps, the goal zone and the learner's car. */
export function finishWorld(scene: THREE.Scene, obstacles: Obstacle[], slots: LampSlot[], goalAt: Point): World {
  // Batch static primitives by material so windows and trees do not each cost a draw call.
  scene.updateMatrixWorld(true);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const staticMeshes: THREE.Mesh[] = [];
  scene.traverse(object => { if (object instanceof THREE.Mesh && !Array.isArray(object.material)) staticMeshes.push(object); });
  for (const mesh of staticMeshes) { if (Array.isArray(mesh.material)) continue; const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld); const batch = batches.get(mesh.material) ?? []; batch.push(geometry); batches.set(mesh.material, batch); mesh.removeFromParent(); mesh.geometry.dispose(); }
  for (const [mat, geometries] of batches) { const merged = mergeGeometries(geometries, false); if (merged) { const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); } geometries.forEach(g => g.dispose()); }
  // Lamps are added after batching: each head owns materials that change with the signal phase.
  const signals: SignalHead[] = [];
  const lampGeometry = new THREE.CircleGeometry(.17, 16);
  for (const slot of slots) {
    const head: SignalHead = { group: slot.approach.group, approach: slot.approach, red: new THREE.MeshBasicMaterial({ color: '#4a3a36' }), yellow: new THREE.MeshBasicMaterial({ color: '#4a4636' }), green: new THREE.MeshBasicMaterial({ color: '#36463a' }) };
    const face = new THREE.Group(); face.position.set(slot.x, 0, slot.z); face.rotation.y = slot.rotation; scene.add(face);
    [head.red, head.yellow, head.green].forEach((m, i) => { const l = new THREE.Mesh(lampGeometry, m); l.position.set(0, 3.97 - i * .47, .235); face.add(l); });
    signals.push(head);
  }
  const goal = new THREE.Group(); goal.position.set(goalAt.x, .17, goalAt.z); goal.visible = false; scene.add(goal);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 7), new THREE.MeshBasicMaterial({ color: '#b3df9a', transparent: true, opacity: .32, side: THREE.DoubleSide })); mark.rotation.x = -Math.PI / 2; goal.add(mark);
  for (const x of [-1.9, 1.9]) box(goal, .12, .025, 7, x, .02, 0, '#bdeaa4');
  for (const z of [-3.5, 3.5]) box(goal, 3.8, .025, .12, 0, .02, z, '#bdeaa4');
  const car = new THREE.Group(), shell = new THREE.Group(); car.add(shell); scene.add(car);
  box(shell, 1.82, .45, 4.05, 0, .62, 0, '#d9e7d8'); box(shell, 1.78, .23, 1.3, 0, .95, -1.3, '#d9e7d8');
  box(shell, 1.8, .22, .8, 0, .95, 1.5, '#d9e7d8');
  box(shell, 1.58, .12, 2.05, 0, 1.79, .15, '#d9e7d8');
  for (const x of [-.78, .78]) for (const z of [-.87, 1.1]) { const post = box(shell, .075, .72, .1, x, 1.42, z, '#c3d1c0'); post.rotation.x = z < 0 ? -.22 : .18; }
  for (const x of [-.78, .78]) { box(shell, .1, .42, 1.9, x, 1.02, .1, '#d1dfcf'); box(shell, .1, .65, .12, x, 1.4, .2, '#9eb7a6'); }
  box(shell, 1.65, .23, .55, 0, 1.03, -.76, '#283c36'); box(shell, .12, .12, .24, -.47, 1.02, -.6, '#283c36');
  for (const x of [-.43, .43]) { box(shell, .6, .5, .6, x, .95, .32, '#4f6357'); box(shell, .6, .67, .14, x, 1.25, .65, '#4f6357'); }
  for (const x of [-.56, .56]) { box(shell, .4, .13, .06, x, .79, -2.055, '#fff2c4'); box(shell, .4, .13, .06, x, .78, 2.055, '#c06c55'); }
  const wheel = new THREE.Group(); wheel.position.set(-.45, 1.06, -.5); wheel.rotation.x = -.38; shell.add(wheel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.22, .025, 8, 28), material('#1e302a')); wheel.add(ring);
  box(wheel, .4, .025, .025, 0, 0, 0, '#637368'); box(wheel, .025, .2, .025, 0, -.1, 0, '#637368');
  const tires: THREE.Group[] = [], frontTires: THREE.Group[] = [];
  for (const x of [-.92, .92]) for (const z of [-1.28, 1.28]) {
    const pivot = new THREE.Group(); pivot.position.set(x, .38, z); car.add(pivot);
    const tire = new THREE.Group(); pivot.add(tire);
    const rubber = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .22, 16), material('#29352e')); rubber.rotation.z = Math.PI / 2; tire.add(rubber);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .235, 12), material('#a6b4a6')); hub.rotation.z = Math.PI / 2; tire.add(hub);
    tires.push(tire); if (z < 0) frontTires.push(pivot);
  }
  return { scene, obstacles, car, shell, wheel, tires, frontTires, goal, signals };
}

/** The training district: driving school ground, the signalised crossing and the loop used by lessons and practice. */
export function createWorld(): World {
  const scene = newScene();
  const obstacles: Obstacle[] = [];
  box(scene, 700, .3, 700, 0, -.25, 0, '#9bad91');
  const road = (x: number, z: number, w: number, d: number) => { box(scene, w + 3, .18, d + 3, x, -.05, z, '#c0c5b5'); box(scene, w, .12, d, x, .06, z, '#596760'); };
  road(0, 10, 18, 276); road(0, 0, 254, 18); road(-70, -40, 16, 106); road(70, -40, 16, 106); road(0, -85, 156, 16);
  road(0, 105, 126, 58);
  for (let z = -125; z < 145; z += 9) if (Math.abs(z) > 14 && (z < 74 || z > 137)) box(scene, .16, .015, 4.2, 0, .14, z, '#e8dfbe');
  for (let x = -121; x < 125; x += 9) if (Math.abs(x) > 14 && Math.abs(Math.abs(x) - 70) > 12) box(scene, 4.2, .015, .16, x, .14, 0, '#e8dfbe');
  for (let z = -75; z < 0; z += 9) for (const x of [-70, 70]) box(scene, .15, .015, 4, x, .14, z, '#ece4ca');
  for (let x = -60; x <= 60; x += 9) if (Math.abs(x) > 12) box(scene, 4.2, .015, .15, x, .14, -85, '#ece4ca');
  // Crosswalks, stop lines and signal poles come from the same map data the judge uses.
  markings(scene, cityMap);
  const lampSlots = signalPoles(scene, cityMap, obstacles);
  for (let i = 0; i < 6; i++) { const x = -48 + i * 5; box(scene, .1, .02, 8, x, .14, 106, '#e5e3d1'); }
  box(scene, 25, .02, .1, -35.5, .14, 102, '#e5e3d1');
  parkedCar(scene, -45.5, 106, '#c4b77c', obstacles); parkedCar(scene, -35.5, 106, '#71939b', obstacles); parkedCar(scene, -25.5, 106, '#e6d9bc', obstacles);
  for (let z = 90; z <= 125; z += 7) { cone(scene, 20, z); cone(scene, 36, z); }
  for (let z = 87; z <= 125; z += 9.5) cone(scene, 28 + Math.sin(z) * 3.5, z);
  for (const x of [-58, 58]) for (let z = 85; z <= 128; z += 12) { tree(scene, x, z, 1.1); obstacles.push({ x, z, halfX: .4, halfZ: .4 }); }
  const blocks = [ [-39, -40, 42, 52], [39, -40, 42, 52], [-105, -40, 32, 50], [105, -40, 32, 50], [-39, 40, 42, 45], [39, 40, 42, 45] ];
  let count = 0;
  for (const [x, z, w, d] of blocks) count = houses(scene, { x, z, w, d }, obstacles, count);
  for (let z = -120; z <= 60; z += 19) for (const x of [-13, 13]) tree(scene, x, z, .8);
  for (const x of [-10, 10]) { box(scene, .16, 5.5, .16, x, 2.75, 78, '#687e73'); box(scene, 3, .15, .25, x - Math.sign(x) * 1.3, 5.5, 78, '#687e73'); }
  box(scene, .2, 4.8, .2, -8, 2.4, 91, '#617367'); box(scene, .2, 4.8, .2, 8, 2.4, 91, '#617367');
  board(scene, 'АВТОШКОЛА', 0, 4.7, 91, 16, 1.8, '#244a3e', '#f2eddc');
  for (const zone of cityMap.speedZones) speedSign(scene, zone.signAt.x, zone.signAt.z, String(zone.limit));
  return finishWorld(scene, obstacles, lampSlots, { x: 4, z: 69 });
}

const lampColors = { red: ['#ff5a45', '#4a3a36'], yellow: ['#ffd04a', '#4a4636'], green: ['#8dff7a', '#36463a'] } as const;
/** Lights the 3D lamps from the logical state; flashing green blinks at 1 Hz like a real signal. */
export function paintSignal(head: SignalHead, lamp: Lamp | 'off', time: number) {
  const on = { red: lamp === 'red' || lamp === 'redYellow', yellow: lamp === 'yellow' || lamp === 'redYellow', green: lamp === 'green' || (lamp === 'greenFlash' && time % 1 < .5) };
  for (const key of ['red', 'yellow', 'green'] as const) head[key].color.set(lampColors[key][on[key] ? 0 : 1]);
}
/** AI car body; its group origin sits on the ground at the car centre, nose towards -z. */
export function trafficCar(scene: THREE.Scene, color: string) {
  const g = new THREE.Group(); scene.add(g);
  box(g, 1.8, .65, 3.9, 0, .7, 0, color); box(g, 1.55, .6, 1.9, 0, 1.3, .2, '#4f6669');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, .22, .55, .64, sx * .86, .35, sz * 1.25, '#263431');
  for (const x of [-.55, .55]) { box(g, .38, .12, .05, x, .8, -1.96, '#fff2c4'); box(g, .38, .12, .05, x, .8, 1.96, '#c06c55'); }
  return g;
}

/** Tram body (15 m): the group origin is the vehicle centre, nose towards -z. */
export function tramCar(scene: THREE.Scene, color: string) {
  const g = new THREE.Group(); scene.add(g);
  box(g, 2.5, 2.5, 15, 0, 1.75, 0, color); box(g, 2.52, .9, 15.02, 0, 2.1, 0, '#3c4f55'); box(g, 2.3, .25, 14.6, 0, 3.12, 0, '#e9e1cf');
  box(g, .1, 1.2, .1, 0, 3.8, 0, '#2a3530'); box(g, 1.4, .06, .3, 0, 4.4, 0, '#2a3530');
  for (const x of [-.7, .7]) box(g, .35, .14, .05, x, 1.1, -7.52, '#fff2c4');
  return g;
}
/** Two rails along x at the given z, from x0 to x1. */
export function rails(scene: THREE.Scene, z: number, x0: number, x1: number) {
  const g = new THREE.Group(); scene.add(g);
  for (const dz of [-.76, .76]) box(g, x1 - x0, .06, .08, (x0 + x1) / 2, .17, z + dz, '#8c948d');
  for (let x = x0 + 1; x < x1; x += 2.5) box(g, .25, .02, 1.9, x, .15, z, '#4b5650');
  return g;
}
/** A person from boxes; arms hang from shoulder pivots so poses are explicit rotations. */
function person(scene: THREE.Scene, body: string, accent: string) {
  const g = new THREE.Group(); scene.add(g);
  for (const x of [-.11, .11]) box(g, .14, .85, .16, x, .43, 0, '#2c3646');
  box(g, .46, .62, .26, 0, 1.17, 0, body); box(g, .48, .22, .28, 0, 1.18, 0, accent);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 10), material('#e2b892')); head.position.set(0, 1.66, 0); g.add(head);
  const arm = (x: number) => { const pivot = new THREE.Group(); pivot.position.set(x, 1.44, 0); g.add(pivot); box(pivot, .11, .6, .12, 0, -.3, 0, body); box(pivot, .12, .12, .13, 0, -.62, 0, '#f4f4ef'); return pivot; };
  return { group: g, left: arm(-.29), right: arm(.29) };
}
export function pedestrianFigure(scene: THREE.Scene, color: string) { return person(scene, color, color).group; }
export interface RegulatorFigure { group: THREE.Group; setPose(pose: Pose, facing: Point): void; }
/** Traffic controller: dark uniform, light-green vest, white cap and baton; local forward is -z like the cars. */
export function regulatorFigure(scene: THREE.Scene): RegulatorFigure {
  const { group, left, right } = person(scene, '#2f3f5c', '#c9f24d');
  box(group, .3, .08, .3, 0, 1.82, 0, '#f4f4ef'); box(group, .32, .03, .34, 0, 1.78, -.04, '#1f2a3d');
  const baton = new THREE.Group(); baton.position.set(0, -.68, 0); right.add(baton);
  for (let i = 0; i < 4; i++) box(baton, .05, .1, .05, 0, -i * .1, 0, i % 2 ? '#1d2120' : '#f4f4ef');
  box(group, .7, .05, .7, 0, .03, 0, '#d9d4bb');
  return {
    group,
    setPose(pose, facing) {
      group.rotation.y = -Math.atan2(facing.x, -facing.z);
      left.rotation.set(0, 0, 0); right.rotation.set(0, 0, 0);
      if (pose === 'sides') { left.rotation.z = -Math.PI / 2; right.rotation.z = Math.PI / 2; }
      if (pose === 'rightForward') right.rotation.x = -Math.PI / 2;
      if (pose === 'up') right.rotation.z = Math.PI;
    },
  };
}
function signTexture(code: string) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  if (code === '2.5') {
    ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124); } ctx.closePath();
    ctx.fillStyle = '#c8302a'; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 74px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('STOP', 128, 132);
  } else if (code === '1.5') {
    // Warning triangle with a tram silhouette.
    ctx.beginPath(); ctx.moveTo(128, 12); ctx.lineTo(248, 232); ctx.lineTo(8, 232); ctx.closePath(); ctx.fillStyle = '#c8302a'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(128, 52); ctx.lineTo(214, 210); ctx.lineTo(42, 210); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = '#1d2120'; ctx.fillRect(86, 120, 84, 62); ctx.fillStyle = '#fff'; ctx.fillRect(94, 130, 30, 20); ctx.fillRect(132, 130, 30, 20); ctx.fillStyle = '#1d2120'; ctx.fillRect(126, 104, 4, 16); ctx.fillRect(108, 102, 40, 4);
  } else if (code === '5.19.1') {
    ctx.fillStyle = '#1f5fbf'; ctx.fillRect(4, 4, 248, 248); ctx.beginPath(); ctx.moveTo(128, 30); ctx.lineTo(230, 222); ctx.lineTo(26, 222); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = '#1d2120'; ctx.beginPath(); ctx.arc(138, 100, 14, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 12; ctx.strokeStyle = '#1d2120'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(134, 120); ctx.lineTo(122, 160); ctx.lineTo(102, 196); ctx.moveTo(122, 160); ctx.lineTo(146, 196); ctx.moveTo(130, 132); ctx.lineTo(104, 150); ctx.moveTo(130, 132); ctx.lineTo(156, 148); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(8, 20); ctx.lineTo(248, 20); ctx.lineTo(128, 236); ctx.closePath(); ctx.fillStyle = '#c8302a'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(48, 44); ctx.lineTo(208, 44); ctx.lineTo(128, 188); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
/** Sign on a post; `facing` is the direction its face points (towards the drivers it addresses). */
export function roadSign(scene: THREE.Scene, code: string, at: Point, facing: Point) {
  const g = new THREE.Group(); g.position.set(at.x, 0, at.z); g.rotation.y = Math.atan2(facing.x, facing.z); scene.add(g);
  box(g, .09, 2.6, .09, 0, 1.3, 0, '#8b9690');
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: signTexture(code), transparent: true, side: THREE.DoubleSide })); face.position.set(0, 2.55, .06); g.add(face);
  return g;
}
/** Removes a prop group and frees what it owns; shared materials from the cache stay. */
export function disposeProp(object: THREE.Object3D) {
  object.removeFromParent();
  object.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const m = o.material as THREE.Material & { map?: THREE.Texture | null }; if (![...materials.values()].includes(m as THREE.MeshStandardMaterial)) { m.map?.dispose(); m.dispose(); } } });
}
