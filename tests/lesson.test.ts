import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLessonStep } from '../src/game/lesson.ts';
import { initialVehicle } from '../src/game/vehicle.ts';
test('intro lesson requires belt, drive setup, travel, a stopped car in the zone, and secure parking', () => {
  const v = initialVehicle();
  assert.equal(nextLessonStep(0, v), 0); v.belt = true;
  assert.equal(nextLessonStep(0, v), 1); assert.equal(nextLessonStep(1, v), 1);
  v.gear = 'D'; v.handbrake = false; assert.equal(nextLessonStep(1, v), 2);
  assert.equal(nextLessonStep(2, v), 2); v.distance = 39; v.z = 69; v.speed = 1;
  assert.equal(nextLessonStep(2, v), 3); assert.equal(nextLessonStep(3, v), 3);
  v.speed = 0; assert.equal(nextLessonStep(3, v), 4);
  v.gear = 'P'; assert.equal(nextLessonStep(4, v), 4);
  v.handbrake = true; assert.equal(nextLessonStep(4, v), 5);
});
test('parking outside target or removing the belt cannot complete the lesson', () => {
  const v = initialVehicle(); v.belt = true; v.z = 80;
  assert.equal(nextLessonStep(4, v), 3);
  v.z = 69; v.speed = .5; assert.equal(nextLessonStep(4, v), 3);
  v.speed = 0; v.belt = false; assert.equal(nextLessonStep(4, v), 0);
});
