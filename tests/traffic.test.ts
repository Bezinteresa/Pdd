import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cityMap } from '../src/game/roads.ts';
import { carObstacle, crossStreetLanes, TrafficSystem } from '../src/game/traffic.ts';
import type { Lamps } from '../src/game/signals.ts';

const parked = { x: 4.5, z: 108, heading: 0, speed: 0 };
const run = (traffic: TrafficSystem, seconds: number, lamps: Lamps, player = parked) => { for (let i = 0; i < seconds * 60; i++) traffic.step(1 / 60, lamps, player); };
const overlap = (a: ReturnType<typeof carObstacle>, b: ReturnType<typeof carObstacle>) => Math.abs(a.x - b.x) < a.halfX + b.halfX && Math.abs(a.z - b.z) < a.halfZ + b.halfZ;

test('cross-street cars queue before their stop lines on red without overlapping', () => {
  const traffic = new TrafficSystem(crossStreetLanes(cityMap));
  run(traffic, 30, { ns: 'green', ew: 'red' });
  for (const car of traffic.cars) {
    const front = car.s + 2;
    if (car.s < 0) assert.ok(front <= -20 + .1, `car ${car.id} front at ${front}`);
  }
  const queued = traffic.cars.filter(c => c.s < 0 && c.s > -60);
  assert.ok(queued.length >= 2 && queued.every(c => c.speed < .1));
  const boxes = traffic.obstacles();
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => assert.ok(!overlap(a, b))));
});

test('queued cars leave on green', () => {
  const traffic = new TrafficSystem(crossStreetLanes(cityMap));
  run(traffic, 30, { ns: 'green', ew: 'red' });
  const leader = traffic.cars.filter(c => c.lane.id === 'east').sort((a, b) => b.s - a.s).find(c => c.s < -20)!;
  run(traffic, 8, { ns: 'red', ew: 'green' });
  assert.ok(leader.s > 0 || leader.s < -100, 'leader crossed the intersection');
});

test('a car stops behind the learner standing in its lane', () => {
  const traffic = new TrafficSystem(crossStreetLanes(cityMap), { east: [-60], west: [] });
  const player = { x: 4.5, z: 4.5, heading: 0, speed: 0 };
  run(traffic, 20, { ns: 'red', ew: 'green' }, player);
  const [car] = traffic.cars;
  assert.ok(car.speed < .1 && car.s + 2 < 4.5 - .94 && car.s > -20);
});
