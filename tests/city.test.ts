import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCity, cityLanes } from '../src/game/city.ts';
import { onRoad, validateMap } from '../src/game/roads.ts';
import { signsAhead } from '../src/game/signs.ts';
import { entryOf, exitOf, planExam, shortestPath, turnAt } from '../src/game/cityRoute.ts';
import { readySituations } from '../src/game/exam.ts';

const city = buildCity();

test('city graph: 5×5 connected grid with the planned crossing kinds', () => {
  const nodes = Object.values(city.nodes);
  assert.equal(nodes.length, 25);
  assert.equal(city.edges.length, 40);
  const seen = new Set([nodes[0].id]), queue = [nodes[0].id];
  while (queue.length) for (const next of city.nodes[queue.shift()!].links) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  assert.equal(seen.size, 25);
  const kinds = (k: string) => nodes.filter(n => n.kind === k).map(n => n.id).sort();
  assert.deepEqual(kinds('signal'), ['n0_-90', 'n0_0', 'n0_90']);
  assert.deepEqual(kinds('main'), ['n-90_-90', 'n90_-90']);
  assert.deepEqual(kinds('tram'), ['n-90_90', 'n90_90']);
});

test('city road map passes the map checks; stop lines and signs sit on or beside the road', () => {
  assert.deepEqual(validateMap(city.map), []);
  for (const a of city.map.approaches) assert.ok(a.stopLine.every(p => onRoad(city.map, p)), a.id);
  assert.equal(city.map.approaches.filter(a => a.control === 'signal').length, 12);
  assert.equal(city.map.crosswalks.length, 12);
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
  assert.equal(byId['main-e'].offset, -86);
  assert.equal(byId['avenue-n'].offset, 4);
  assert.deepEqual(byId['avenue-n'].approaches!.filter(a => a.control === 'signal').map(a => a.intersection).sort(), ['n0_-90', 'n0_0', 'n0_90']);
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
