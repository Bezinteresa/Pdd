import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityMap, validateMap, type RoadMap } from '../src/game/roads.ts';
import { cycleLength, defaultPlan, lampAt, lampsAt, permits, type Lamps } from '../src/game/signals.ts';
import { TripJudge } from '../src/game/rules.ts';
import { initialVehicle, type VehicleState } from '../src/game/vehicle.ts';
import { nextCrossingStep } from '../src/game/lesson.ts';

const red: Lamps = { ns: 'red', ew: 'green' }, green: Lamps = { ns: 'green', ew: 'red' }, yellow: Lamps = { ns: 'yellow', ew: 'red' };
function car(patch: Partial<VehicleState>): VehicleState { return Object.assign(initialVehicle(), { gear: 'D', handbrake: false, belt: true }, patch); }
/** Drives straight north at constant speed, feeding the judge the lamps returned by `lamps(t)`. */
function driveNorth(judge: TripJudge, v: VehicleState, seconds: number, lamps: (t: number) => Lamps, t0 = 0) {
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    const prev = { x: v.x, z: v.z, heading: v.heading };
    v.z -= Math.cos(v.heading) * v.speed * dt; v.x += Math.sin(v.heading) * v.speed * dt;
    judge.update(prev, v, t0 + i * dt, lamps(t0 + i * dt));
  }
  return t0 + seconds;
}
const codes = (judge: TripJudge) => judge.violations.map(v => v.code);

test('signal groups never permit movement at the same time and follow the Russian phase order', () => {
  const order: string[] = [];
  for (let t = 0; t < cycleLength(defaultPlan); t += .05) {
    const lamps = lampsAt(t);
    assert.ok(!(permits(lamps.ns) && permits(lamps.ew)), `conflict at ${t}`);
    if (order[order.length - 1] !== lamps.ns) order.push(lamps.ns);
  }
  assert.deepEqual(order, ['red', 'redYellow', 'green', 'greenFlash', 'yellow', 'red']);
  assert.equal(lampAt('ew', 0), 'green'); assert.equal(lampAt('ns', 0), 'red');
});

test('city map data is consistent and broken bindings are reported', () => {
  assert.deepEqual(validateMap(cityMap), []);
  const broken: RoadMap = structuredClone(cityMap);
  broken.approaches[0].intersection = 'missing';
  broken.approaches[1].stopLine = [{ x: -8.5, z: 20 }, { x: -.5, z: 20 }];
  const errors = validateMap(broken);
  assert.ok(errors.some(e => e.includes('missing')));
  assert.ok(errors.some(e => e.includes('central-s') && e.includes('за перекрёстком')));
});

test('crossing the stop line on red is one violation, even after backing up and crossing again', () => {
  const judge = new TripJudge(cityMap), v = car({ x: 4.5, z: 26, speed: 4 });
  let t = driveNorth(judge, v, 1, () => red);
  assert.deepEqual(codes(judge), ['red-light']);
  v.speed = -2; t = driveNorth(judge, v, 1, () => red, t);
  v.speed = 2; driveNorth(judge, v, 1.5, () => red, t);
  assert.deepEqual(codes(judge), ['red-light']);
  assert.ok(!judge.passedLegally.has('central-n'));
});

test('stopping before the line on red and leaving on green is legal', () => {
  const judge = new TripJudge(cityMap), v = car({ x: 4.5, z: 30, speed: 3 });
  let t = driveNorth(judge, v, 2, () => red);
  v.speed = 0; t = driveNorth(judge, v, 3, () => red, t);
  v.speed = 5; driveNorth(judge, v, 3, () => green, t);
  assert.deepEqual(codes(judge), []);
  assert.ok(judge.passedLegally.has('central-n'));
});

test('yellow: violation when a comfortable stop was possible, allowed when it was not', () => {
  const far = new TripJudge(cityMap), a = car({ x: 4.5, z: 44, speed: 8 });
  let t = driveNorth(far, a, .5, () => green);
  driveNorth(far, a, 3, () => yellow, t);
  assert.deepEqual(codes(far), ['yellow-light']);

  const close = new TripJudge(cityMap), b = car({ x: 4.5, z: 27, speed: 8 });
  t = driveNorth(close, b, .5, () => green);
  driveNorth(close, b, 2, () => yellow, t);
  assert.deepEqual(codes(close), []);
});

test('speed is judged against the posted zone with a hold time and one record per episode', () => {
  const judge = new TripJudge(cityMap), v = car({ x: 4.5, z: 56, speed: 31.5 / 3.6 });
  let t = driveNorth(judge, v, 1.5, () => green);
  assert.deepEqual(codes(judge), []);
  v.z = 56; v.speed = 40 / 3.6; t = driveNorth(judge, v, .6, () => green, t);
  assert.deepEqual(codes(judge), []);
  t = driveNorth(judge, v, 1, () => green, t);
  assert.deepEqual(codes(judge), ['speed']);
  v.speed = 28 / 3.6; t = driveNorth(judge, v, .2, () => green, t);
  v.speed = 40 / 3.6; driveNorth(judge, v, 1.2, () => green, t);
  assert.deepEqual(codes(judge), ['speed', 'speed']);
});

test('turns at the intersection need the matching signal before entry', () => {
  const path = (signal: VehicleState['signal']) => {
    const judge = new TripJudge(cityMap), lamps: Lamps = { ns: 'green', ew: 'green' };
    const poses = [{ x: 4.5, z: 11, heading: 0 }, { x: 4.5, z: 7, heading: 0 }, { x: 6, z: 5, heading: .8 }, { x: 8, z: 4.6, heading: 1.4 }, { x: 10.5, z: 4.5, heading: Math.PI / 2 }];
    let prev = poses[0];
    poses.forEach((pose, i) => { const v = car({ ...pose, speed: 4, signal: i < 3 ? signal : null }); judge.update(prev, v, i * .5, lamps); prev = pose; });
    return codes(judge);
  };
  assert.deepEqual(path(null), ['turn-signal']);
  assert.deepEqual(path('left'), ['turn-signal']);
  assert.deepEqual(path('right'), []);
});

test('belt, leaving the road and collisions are recorded once per episode', () => {
  const judge = new TripJudge(cityMap), v = car({ x: 4.5, z: 60, speed: 2, belt: false });
  driveNorth(judge, v, 1, () => green);
  assert.deepEqual(codes(judge), ['belt']);
  const off = car({ x: 12, z: 60, speed: 2, belt: false });
  judge.update(off, off, 2, green); judge.update(off, off, 2.1, green);
  judge.update(v, v, 3, green, true);
  assert.deepEqual(codes(judge), ['belt', 'off-road', 'collision']);
});

test('signal lesson advances only after a legal stop-line pass, straight crossing and parking', () => {
  const v = car({ belt: true, gear: 'P', handbrake: true }), legal = new Set<string>();
  assert.equal(nextCrossingStep(0, v, { passedLegally: legal }), 1);
  v.gear = 'D'; v.handbrake = false; assert.equal(nextCrossingStep(1, v, { passedLegally: legal }), 2);
  v.z = 10; assert.equal(nextCrossingStep(2, v, { passedLegally: legal }), 2);
  legal.add('central-n'); assert.equal(nextCrossingStep(2, v, { passedLegally: legal }), 3);
  v.z = -20; assert.equal(nextCrossingStep(3, v, { passedLegally: legal }), 4);
  v.x = 4.5; v.z = -45; v.speed = 0; assert.equal(nextCrossingStep(4, v, { passedLegally: legal }), 5);
  v.gear = 'P'; v.handbrake = true; assert.equal(nextCrossingStep(5, v, { passedLegally: legal }), 6);
});
