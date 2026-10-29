import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCity, cityLanes } from '../src/game/city.ts';
import { onRoad, speedLimitAt, validateMap } from '../src/game/roads.ts';
import { signsAhead } from '../src/game/signs.ts';
import { entryOf, exitOf, planExam, shortestPath, turnAt } from '../src/game/cityRoute.ts';
import { readySituations } from '../src/game/exam.ts';

const city = buildCity();

test('city graph: 7×7 grid and the ring road, connected, with the planned crossing kinds', () => {
  const nodes = Object.values(city.nodes);
  assert.equal(nodes.length, 49 + 12);
  assert.equal(city.edges.length, 84 + 12 + 12);
  const seen = new Set([nodes[0].id]), queue = [nodes[0].id];
  while (queue.length) for (const next of city.nodes[queue.shift()!].links) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  assert.equal(seen.size, 61);
  const kinds = (k: string) => nodes.filter(n => n.kind === k).map(n => n.id).sort();
  assert.deepEqual(kinds('signal'), ['n0_-180', 'n0_-90', 'n0_0', 'n0_180', 'n0_90']);
  assert.deepEqual(kinds('main'), ['n-180_-90', 'n-90_-90', 'n180_-90', 'n90_-90']);
  assert.deepEqual(kinds('tram'), ['n-180_90', 'n-90_90', 'n180_90', 'n90_90']);
  assert.equal(kinds('ring').length, 12);
});

test('city road map passes the map checks; stop lines and signs sit on or beside the road', () => {
  assert.deepEqual(validateMap(city.map), []);
  for (const a of city.map.approaches) assert.ok(a.stopLine.every(p => onRoad(city.map, p)), a.id);
  assert.equal(city.map.approaches.filter(a => a.control === 'signal').length, 20);
  assert.equal(city.map.crosswalks.length, 20 + city.zebras.length);
});

test('priority signs address the right drivers', () => {
  // A driver coming south down the side street to the main road sees 2.4; a driver on the main road sees 2.1.
  const side = signsAhead(city.signs, { x: 90 - 3, z: -140, heading: Math.PI }).map(s => s.sign.code);
  const main = signsAhead(city.signs, { x: 50, z: -90 + 4, heading: Math.PI / 2 }).map(s => s.sign.code);
  assert.ok(side.includes('2.4') && !side.includes('2.1'));
  assert.ok(main.includes('2.1') && !main.includes('2.4'));
});

test('AI lanes run in the right-hand lane and know the signals they pass', () => {
  const lanes = cityLanes(city);
  const byId = Object.fromEntries(lanes.map(l => [l.id, l]));
  assert.equal(byId['main-e'].offset, -84);
  assert.equal(byId['avenue-n'].offset, 6);
  assert.deepEqual(byId['avenue-n'].approaches!.filter(a => a.control === 'signal').map(a => a.intersection).sort(), ['n0_-180', 'n0_-90', 'n0_0', 'n0_180', 'n0_90']);
  assert.deepEqual(byId['main-e'].approaches!.filter(a => a.control === 'signal').map(a => a.intersection), ['n0_-90']);
});


test('route: turns, shortest paths without U-turns at junctions', () => {
  assert.equal(turnAt(city, 'n0_90', 'n0_0', 'n0_-90'), 'straight');
  assert.equal(turnAt(city, 'n0_90', 'n0_0', 'n90_0'), 'right');
  assert.equal(turnAt(city, 'n0_90', 'n0_0', 'n-90_0'), 'left');
  const path = shortestPath(city, ['n0_180', 'n0_90'], ['n0_90', 'n0_180'])!;
  assert.ok(path.length >= 4, 'turning back takes a loop around a block');
  for (let i = 1; i < path.length; i++) { assert.equal(path[i][0], path[i - 1][1]); assert.notEqual(path[i][1], path[i - 1][0]); }
});

test('route: any five ready situations get their own places and a connected order', () => {
  const ids = readySituations.map(s => s.id);
  for (let k = 0; k < 30; k++) {
    const pick = [...ids].sort(() => Math.random() - .5).slice(0, 5);
    const plan = planExam(city, pick, ['n0_180', 'n0_90']);
    assert.equal(plan.length, 5, pick.join());
    assert.deepEqual(plan.map(p => p.situation).sort(), [...pick].sort());
    const nodes = plan.filter(p => p.node).map(p => p.node);
    assert.equal(new Set(nodes).size, nodes.length);
    let at = ['n0_180', 'n0_90'] as const as readonly [string, string];
    for (const p of plan) { assert.ok(shortestPath(city, at, entryOf(p)), p.situation); at = exitOf(p); }
  }
});

test('ring road: priority for the ring, 70 km/h after each junction', () => {
  // Southbound on the east side of the ring, just before the junction with the avenue z = 0 at x 388.
  const onRing = signsAhead(city.signs, { x: 388 - 6, z: -10, heading: Math.PI }).map(s => s.sign.code);
  assert.ok(onRing.includes('3.24'), onRing.join());
  const joining = signsAhead(city.signs, { x: 340, z: 6, heading: Math.PI / 2 }).map(s => s.sign.code);
  assert.ok(joining.includes('2.4'), joining.join());
  assert.equal(speedLimitAt(city.map, { x: 382, z: 40, heading: Math.PI }), 70);
  assert.equal(speedLimitAt(city.map, { x: 320, z: 6, heading: Math.PI / 2 }), 60);
});

test('ring road winds smoothly: closed loop, no sharp kinks, straight and square through every junction', () => {
  const r = city.ring;
  assert.deepEqual(r[0], r[r.length - 1]);
  let worst = 0;
  for (let i = 1; i < r.length - 1; i++) {
    const a = Math.atan2(r[i].z - r[i - 1].z, r[i].x - r[i - 1].x), b = Math.atan2(r[i + 1].z - r[i].z, r[i + 1].x - r[i].x);
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
  }
  assert.ok(worst < .12, `max turn per 2 m step ${worst}`);
  for (const n of Object.values(city.nodes).filter(n => n.kind === 'ring')) {
    for (const w of n.links) {
      const d = city.leaveDir(n.id, w);
      assert.ok(Math.abs(d.x) > .999 || Math.abs(d.z) > .999, `${n.id}→${w} leaves square`);
    }
    assert.equal(n.links.length, 3, n.id);
  }
  // Ring cars go all the way round: one closed lane each way.
  const ringLanes = cityLanes(city).filter(l => l.path);
  assert.equal(ringLanes.length, 2);
  assert.ok(ringLanes.every(l => l.loop && l.path!.length > 2000));
});

test('Upper Town: raised crossings, streets climb in a straight line, the plain stays flat', () => {
  assert.equal(city.height(180, -225), 9);
  assert.equal(city.height(0, 0), 0);
  // Street from the main road (z -90) up to the hill crossing at z -180.
  const lo = city.height(180, -96), mid = city.height(180, -135), hi = city.height(180, -174);
  assert.equal(lo, 0); assert.equal(hi, 9);
  assert.ok(Math.abs(mid - 4.5) < .3, String(mid));
  // Lots beside the climbing street stay on the plain; every lot avoids the roads.
  for (const lot of city.lots) assert.ok(!onRoad(city.map, lot, -1), `${lot.x},${lot.z}`);
});
