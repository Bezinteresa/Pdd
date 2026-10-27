import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyManeuver, compatible, ExamRunner, randomSelection, readySituations, situationOutcome } from '../src/game/exam.ts';
import { allowedManeuvers, sideOf } from '../src/game/regulator.ts';
import { TripJudge } from '../src/game/rules.ts';
import { cityMap, maneuverThrough } from '../src/game/roads.ts';
import { crossStreetLanes, TrafficSystem } from '../src/game/traffic.ts';
import { initialVehicle, type VehicleState } from '../src/game/vehicle.ts';
import { ruleTexts } from '../src/game/pddText.ts';

const car = (patch: Partial<VehicleState>) => Object.assign(initialVehicle(), { gear: 'D', handbrake: false, belt: true }, patch);
function setup(selected: string[], stepSlot?: string) {
  const exam = new ExamRunner(selected), judge = new TripJudge(cityMap), traffic = new TrafficSystem(crossStreetLanes(cityMap), {});
  if (stepSlot) exam.stepIndex = exam.steps.findIndex(s => s.slot === stepSlot || s.kind === stepSlot);
  return { exam, judge, traffic };
}
/** Feeds the runner a straight drive at constant speed; heading 0 = north, π = south. */
function drive(ctx: ReturnType<typeof setup>, v: VehicleState, seconds: number, t0 = 0) {
  for (let i = 0; i < seconds * 60; i++) {
    const prev = { x: v.x, z: v.z, heading: v.heading };
    v.x += Math.sin(v.heading) * v.speed / 60; v.z -= Math.cos(v.heading) * v.speed / 60;
    ctx.exam.update({ prev, state: v, time: t0 + i / 60, dt: 1 / 60, traffic: ctx.traffic, forced: [], judge: ctx.judge });
  }
  return t0 + seconds;
}
const codes = (judge: TripJudge) => judge.violations.map(v => v.code);

test('situation catalogue: slots never clash, random picks 3–4 ready situations, every rule id has text', () => {
  assert.ok(!compatible(['a1-signal', 'a-regulator']));
  assert.ok(!compatible(['b-tram', 'b-oncoming']));
  assert.ok(compatible(['a-regulator', 'b-tram', 'd-stop', 'u-turn']));
  for (let i = 0; i < 50; i++) { const pick = randomSelection(); assert.ok(pick.length >= 3 && pick.length <= 4 && compatible(pick)); }
  for (const s of readySituations) for (const id of s.ruleIds) assert.ok(ruleTexts[id], `${s.id}: ${id}`);
});

test('controller signals follow PDD 6.10 for each side', () => {
  const north = { x: 0, z: -1 }, south = { x: 0, z: 1 }, east = { x: 1, z: 0 }, west = { x: -1, z: 0 };
  // Arms to the sides, facing north: northbound traffic sees his back, east/westbound traffic his sides.
  assert.deepEqual(allowedManeuvers('sides', sideOf(north, north)), []);
  assert.deepEqual(allowedManeuvers('sides', sideOf(north, east)), ['straight', 'right']);
  // Right arm forward, facing south: from his left (traffic heading west) every direction, from the chest only right.
  assert.equal(sideOf(south, west), 'left');
  assert.deepEqual(allowedManeuvers('rightForward', sideOf(south, west)), ['straight', 'right', 'left', 'uturn']);
  assert.deepEqual(allowedManeuvers('rightForward', sideOf(south, north)), ['right']);
  assert.deepEqual(allowedManeuvers('rightForward', sideOf(south, east)), []);
  assert.deepEqual(allowedManeuvers('up', 'left'), []);
});

test('manoeuvres are classified from entry and exit headings', () => {
  assert.equal(classifyManeuver(0, .2), 'straight');
  assert.equal(classifyManeuver(0, Math.PI / 2), 'right');
  assert.equal(classifyManeuver(Math.PI / 2, 0), 'left');
  assert.equal(classifyManeuver(0, Math.PI), 'uturn');
});

test('a tight right turn that leaves the box before it finishes turning still counts as right', () => {
  const box = { x: 0, z: 0, halfX: 9, halfZ: 9 };
  assert.equal(maneuverThrough(box, Math.PI / 2, { x: -5.9, z: 9.2 }), 'right');
  assert.equal(maneuverThrough(box, 0, { x: 4.5, z: -9.2 }), 'straight');
  assert.equal(maneuverThrough(box, 0, { x: -9.2, z: -5 }), 'left');
  assert.equal(maneuverThrough(box, 0, { x: -4.5, z: 9.2 }), 'uturn');
});

test('turning the wrong way ends the exam with a route error', () => {
  const ctx = setup(['b-right-hand', 'd-yield', 'u-turn']), v = car({ x: 4.5, z: 30, speed: 8 });
  let t = drive(ctx, v, .2);
  assert.equal(ctx.exam.step.kind, 'node');
  t = drive(ctx, v, 6, t);
  assert.equal(ctx.exam.step.node, 'B');
  v.z = -80; v.heading = 0; t = drive(ctx, v, .3, t);
  v.heading = Math.PI / 2; drive(ctx, v, 2, t);
  assert.equal(ctx.exam.finished, true);
  assert.deepEqual(codes(ctx.judge), ['route']);
});

test('sign 2.5: rolling through is a violation, a full stop is not', () => {
  const rolling = setup(['d-stop'], 'D'), a = car({ x: -74, z: -30, heading: Math.PI, speed: 4 });
  drive(rolling, a, 6);
  assert.deepEqual(codes(rolling.judge), ['stop-sign']);

  const careful = setup(['d-stop'], 'D'), b = car({ x: -74, z: -30, heading: Math.PI, speed: 4 });
  let t = drive(careful, b, 4.1);
  b.speed = 0; t = drive(careful, b, 1, t);
  b.speed = 3; drive(careful, b, 3, t);
  assert.deepEqual(codes(careful.judge), []);
});

test('U-turn without the left signal from the right edge records both errors and still counts as done', () => {
  const ctx = setup(['u-turn'], 'uturn'), v = car({ x: -7, z: 45, heading: Math.PI, speed: 3 });
  for (const heading of [Math.PI, Math.PI - .5, Math.PI / 2, .3, 0]) { v.heading = heading; drive(ctx, v, .2); }
  assert.deepEqual(codes(ctx.judge), ['turn-signal', 'u-turn']);
  assert.equal(ctx.exam.step.kind, 'finish');
});

test('a priority vehicle forced to brake is a yield violation tied to the staged situation', () => {
  const ctx = setup(['b-right-hand'], 'B'), v = car({ x: 4.5, z: -82, speed: 3 });
  const other = ctx.traffic.spawn(ctx.traffic.cars[0]?.lane ?? crossStreetLanes(cityMap)[1], 0);
  ctx.exam.update({ prev: v, state: v, time: 1, dt: 1 / 60, traffic: ctx.traffic, forced: [{ car: other, decel: 4 }], judge: ctx.judge });
  ctx.exam.update({ prev: v, state: v, time: 1.1, dt: 1 / 60, traffic: ctx.traffic, forced: [{ car: other, decel: 4 }], judge: ctx.judge });
  assert.deepEqual(codes(ctx.judge), ['yield']);
  assert.equal(ctx.judge.violations[0].situation, 'b-right-hand');
  assert.deepEqual(ctx.judge.violations[0].ruleIds, ['13.11', '1.2']);
});

test('traffic reports hard braking caused by the learner crossing its lane, not by following', () => {
  const traffic = new TrafficSystem(crossStreetLanes(cityMap), { east: [-40], west: [] });
  const crossing = { x: -20, z: 4.5, heading: 0, speed: 0 };
  let forced = 0;
  for (let i = 0; i < 300; i++) forced += traffic.step(1 / 60, { ns: 'red', ew: 'green' }, crossing).length;
  assert.ok(forced > 0);
  const follow = new TrafficSystem(crossStreetLanes(cityMap), { east: [-40], west: [] });
  let followed = 0;
  for (let i = 0; i < 300; i++) followed += follow.step(1 / 60, { ns: 'red', ew: 'green' }, { x: -20, z: 4.5, heading: Math.PI / 2, speed: 0 }).length;
  assert.equal(followed, 0);
});

// Sign 2.5 at junction D: the learner drives south (heading π) in the lane x = -74; the stop line is at z = -10.5.
const LINE_Z = -10.5;
const frontToLine = (v: VehicleState) => LINE_Z - (v.z + 2.05);
function stopCtx() { return { ctx: setup(['d-stop'], 'D'), v: car({ x: -74, z: -30, heading: Math.PI, speed: 0 }), t: 0 }; }
/** Moves south (or north for negative speed) until the front is `target` metres before the line, with step `dt`. */
function moveTo(run: ReturnType<typeof stopCtx>, target: number, speed: number, dt = 1 / 60) {
  run.v.speed = speed;
  for (let i = 0; i < 6000 && (speed > 0 ? frontToLine(run.v) > target : frontToLine(run.v) < target); i++) {
    const prev = { x: run.v.x, z: run.v.z, heading: run.v.heading };
    run.v.z += run.v.speed * dt; run.t += dt;
    run.ctx.exam.update({ prev, state: run.v, time: run.t, dt, traffic: run.ctx.traffic, forced: [], judge: run.ctx.judge });
  }
}
function standStill(run: ReturnType<typeof stopCtx>, seconds: number, dt = 1 / 60) {
  run.v.speed = 0;
  for (let i = 0; i < seconds / dt; i++) { run.t += dt; run.ctx.exam.update({ prev: run.v, state: run.v, time: run.t, dt, traffic: run.ctx.traffic, forced: [], judge: run.ctx.judge }); }
}
const stopCodes = (run: ReturnType<typeof stopCtx>) => codes(run.ctx.judge).filter(c => c === 'stop-sign');

test('STOP: driving through without stopping is one violation', () => {
  const run = stopCtx(); moveTo(run, 6, 4); moveTo(run, -6, 4);
  assert.deepEqual(stopCodes(run), ['stop-sign']);
});
test('STOP: an early stop 7.45 m back does not replace the stop at the line', () => {
  const run = stopCtx(); moveTo(run, 7.45, 4); standStill(run, 1); moveTo(run, -3, 3);
  assert.deepEqual(stopCodes(run), ['stop-sign']);
});
test('STOP: standing still with the front at the line is accepted', () => {
  const run = stopCtx(); moveTo(run, .8, 4); standStill(run, 1); moveTo(run, -6, 3);
  assert.deepEqual(stopCodes(run), []);
});
test('STOP: stopping only after crossing the line is a violation', () => {
  const run = stopCtx(); moveTo(run, -1, 3); standStill(run, 1); moveTo(run, -6, 3);
  assert.deepEqual(stopCodes(run), ['stop-sign']);
});
test('STOP: slow rolling over the line is not a stop', () => {
  const run = stopCtx(); moveTo(run, 2, 4); moveTo(run, -3, .5);
  assert.deepEqual(stopCodes(run), ['stop-sign']);
});
test('STOP: backing away cancels the stop; stopping again at the line on the second approach counts', () => {
  const backedOff = stopCtx(); moveTo(backedOff, 1, 4); standStill(backedOff, 1); moveTo(backedOff, 6, -2); moveTo(backedOff, -3, 3);
  assert.deepEqual(stopCodes(backedOff), ['stop-sign']);
  const again = stopCtx(); moveTo(again, 1, 4); standStill(again, 1); moveTo(again, 6, -2); moveTo(again, .5, 2); standStill(again, 1); moveTo(again, -3, 3);
  assert.deepEqual(stopCodes(again), []);
});
test('STOP: the verdict does not depend on the simulation step', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const ok = stopCtx(); moveTo(ok, .8, 4, dt); standStill(ok, 1, dt); moveTo(ok, -6, 3, dt);
    const bad = stopCtx(); moveTo(bad, -6, 4, dt);
    assert.deepEqual([stopCodes(ok), stopCodes(bad)], [[], ['stop-sign']], `dt=${dt}`);
  }
});

test('debrief outcome: unreached situations are not marked as passed', () => {
  const ctx = setup(['b-tram', 'd-stop', 'u-turn']), v = car({ x: 4.5, z: 30, speed: 8 });
  let t = drive(ctx, v, 6.2);
  v.z = -80; v.heading = 0; t = drive(ctx, v, .3, t);
  v.heading = Math.PI / 2; drive(ctx, v, 2, t);
  assert.equal(ctx.exam.finished, true);
  assert.deepEqual(['b-tram', 'd-stop', 'u-turn'].map(id => situationOutcome(ctx.exam.progress(id), 0)), ['interrupted', 'not-reached', 'not-reached']);
  assert.equal(situationOutcome('done', 0), 'passed');
  assert.equal(situationOutcome('done', 2), 'failed');
});

test('a two-slot situation stays unfinished after its first slot (partially driven controller)', () => {
  const ctx = setup(['a-regulator']), v = car({ x: 4.5, z: 30, speed: 8 });
  drive(ctx, v, .2);
  assert.equal(ctx.exam.progress('a-regulator'), 'active');
  drive(ctx, v, 6, .2);
  assert.equal(ctx.exam.step.node, 'B');
  assert.equal(ctx.exam.progress('a-regulator'), 'active');
  assert.equal(situationOutcome(ctx.exam.progress('a-regulator'), 0), 'interrupted');
});
