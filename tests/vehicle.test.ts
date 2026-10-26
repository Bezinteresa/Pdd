import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialVehicle, selectGear, stepVehicle, overlapsCar } from '../src/game/vehicle.ts';
test('P holds the car and a shift out of P needs the brake', () => {
  const v = initialVehicle();
  stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, 1 / 60, []);
  assert.equal(v.speed, 0);
  assert.ok(selectGear(v, 'D', 0)); assert.equal(v.gear, 'P');
  assert.equal(selectGear(v, 'D', 1), null); assert.equal(v.gear, 'D');
});
test('R and P cannot be selected while driving forward', () => {
  const v = initialVehicle(); v.gear = 'D'; v.speed = 5;
  assert.ok(selectGear(v, 'R', 1)); assert.ok(selectGear(v, 'P', 1)); assert.equal(v.gear, 'D');
});
test('braking reaches a stop without reversing; R drives backwards', () => {
  const v = initialVehicle(); v.gear = 'D'; v.handbrake = false; v.speed = 10;
  for (let i = 0; i < 180; i++) stepVehicle(v, { throttle: 0, brake: 1, steer: 0 }, 1 / 60, []);
  assert.equal(v.speed, 0);
  const stoppedZ = v.z;
  assert.equal(selectGear(v, 'R', 1), null);
  for (let i = 0; i < 60; i++) stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, 1 / 60, []);
  assert.ok(v.speed < 0); assert.ok(v.z > stoppedZ);
});
test('one second of held input is consistent at different fixed substeps', () => {
  const simulate = (hz: number) => { const v = initialVehicle(); v.gear = 'D'; v.handbrake = false; for (let i = 0; i < hz * 5; i++) stepVehicle(v, { throttle: 0.7, brake: 0, steer: 0.2 }, 1 / hz, []); return v; };
  const a = simulate(60), b = simulate(120);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.3);
});
test('car footprint checks width, length and rotation; obstacle blocks motion', () => {
  assert.equal(overlapsCar({ x: 0, z: 0, heading: 0 }, { x: 0, z: 2, halfX: 0.5, halfZ: 0.5 }), true);
  assert.equal(overlapsCar({ x: 0, z: 0, heading: 0 }, { x: 2, z: 0, halfX: 0.3, halfZ: 0.3 }), false);
  assert.equal(overlapsCar({ x: 0, z: 0, heading: Math.PI / 2 }, { x: 2, z: 0, halfX: 0.3, halfZ: 0.3 }), true);
  const v = initialVehicle(); v.gear = 'D'; v.handbrake = false;
  for (let i = 0; i < 300; i++) stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, 1 / 60, [{ x: 4, z: 95, halfX: 3, halfZ: 0.5 }]);
  assert.ok(v.z > 97.5);
});
