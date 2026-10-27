import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCity, cityLanes } from '../src/game/city.ts';
import { CityExamRunner } from '../src/game/cityExam.ts';
import { TripJudge } from '../src/game/rules.ts';
import { TrafficSystem } from '../src/game/traffic.ts';
import { initialVehicle, type VehicleState } from '../src/game/vehicle.ts';

const city = buildCity();
function setup(selected: string[]) {
  return { exam: new CityExamRunner(city, selected), judge: new TripJudge(city.map), traffic: new TrafficSystem(cityLanes(city), {}) };
}
/** Moves the car through the given points at 6 m/s, heading along the segment, feeding the exam each 1/60 s. */
function driveThrough(ctx: ReturnType<typeof setup>, points: [number, number][], t0 = 0) {
  const v: VehicleState = Object.assign(initialVehicle(), { x: points[0][0], z: points[0][1], gear: 'D', handbrake: false, belt: true, speed: 6 });
  let t = t0;
  for (let i = 1; i < points.length; i++) {
    const [x1, z1] = points[i], dx = x1 - v.x, dz = z1 - v.z, steps = Math.ceil(Math.hypot(dx, dz) / (6 / 60));
    v.heading = Math.atan2(dx, -dz);
    const sx = dx / steps, sz = dz / steps;
    for (let k = 0; k < steps; k++) {
      const prev = { x: v.x, z: v.z, heading: v.heading };
      v.x += sx; v.z += sz; t += 1 / 60;
      ctx.exam.update({ prev, state: v, time: t, dt: 1 / 60, traffic: ctx.traffic, forced: [], judge: ctx.judge });
    }
  }
  return v;
}
const codes = (ctx: ReturnType<typeof setup>) => ctx.judge.violations.map(v => v.code);

test('city exam: the plan places the chosen situations and the first command points the way', () => {
  const ctx = setup(['a1-signal', 'b-tram', 'd-stop', 'a2-pedestrian', 'u-turn']);
  assert.equal(ctx.exam.plan.length, 5);
  assert.equal(ctx.exam.steps.length, 6);
  assert.deepEqual(ctx.exam.current, ['n0_180', 'n0_90']);
  driveThrough(ctx, [[4, 135], [4, 125]]);
  assert.match(ctx.exam.command, /^Через \d+ метров на перекрёстке — прямо\.$/);
});

test('city exam: a wrong turn is an error and the route is rebuilt; the exam goes on', () => {
  const ctx = setup(['a1-signal']);
  const target = ctx.exam.target!;
  assert.equal(target.node, 'n0_0', 'the signal crossing after the first one');
  // At the first junction (n0_90) the route goes straight on; the learner turns right instead.
  driveThrough(ctx, [[4, 135], [4, 101], [5, 99], [10, 97], [30, 97]]);
  assert.deepEqual(codes(ctx), ['route']);
  assert.equal(ctx.exam.finished, false);
  assert.deepEqual(ctx.exam.current, ['n0_90', 'n90_90']);
  assert.equal(ctx.exam.target, target, 'still heading for the same situation');
  const path = ctx.exam.route();
  assert.deepEqual(path[0], ['n0_90', 'n90_90']);
  assert.deepEqual(path[path.length - 1], ['n0_90', 'n0_0']);
});

test('city exam: a wide right turn that clips the far side of the box still counts as right', () => {
  const ctx = setup(['a2-pedestrian']);
  const t = ctx.exam.target!;
  assert.equal(t.maneuver, 'right');
  const node = city.nodes[t.node!], from = city.nodes[t.inFrom!];
  assert.equal(from.x, node.x, 'approach from the south along the avenue');
  // Drive up the avenue (straight through the crossings before it), then turn right late:
  // the car crosses the far edge of the junction box before heading east.
  const half = node.area.halfZ;
  driveThrough(ctx, [[4, 135], [4, node.z + 20], [4, node.z - half + 1], [6, node.z - half - 1], [9, node.z - half + 2], [12, node.z - 4], [30, node.z - 4]]);
  assert.ok(!codes(ctx).includes('route'), codes(ctx).join());
  assert.equal(ctx.exam.progress('a2-pedestrian'), 'done');
});

test('city exam: after the last situation the learner is sent to a finish zone and stopping there ends the exam', () => {
  const ctx = setup(['a1-signal']);
  driveThrough(ctx, [[4, 135], [4, 60], [4, -40]]);
  assert.equal(ctx.exam.progress('a1-signal'), 'done');
  const goal = ctx.exam.goal()!;
  assert.ok(goal);
  const v = driveThrough(ctx, [[4, -40], [goal.x, goal.z]], 50);
  v.speed = 0;
  for (let i = 0; i < 90; i++) ctx.exam.update({ prev: v, state: v, time: 80 + i / 60, dt: 1 / 60, traffic: ctx.traffic, forced: [], judge: ctx.judge });
  assert.equal(ctx.exam.finished, true);
  assert.deepEqual(codes(ctx), []);
});
