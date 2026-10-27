import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignWatch, signsAhead, zoneSigns, type PlacedSign } from '../src/game/signs.ts';
import { cityMap } from '../src/game/roads.ts';
import { examSigns } from '../src/game/exam.ts';

// A sign at the right edge of the northbound lane, facing southwards towards approaching cars.
const forNorthbound: PlacedSign = { id: 'n', code: '2.4', at: { x: 10.5, z: 0 }, facing: { x: 0, z: 1 } };

test('a sign is seen only ahead, in range, on the driver\'s road and facing the driver', () => {
  const seen = (pose: { x: number; z: number; heading: number }) => signsAhead([forNorthbound], pose).map(s => s.sign.id);
  assert.deepEqual(seen({ x: 4.5, z: 30, heading: 0 }), ['n']);
  assert.deepEqual(seen({ x: 4.5, z: 70, heading: 0 }), [], 'beyond range');
  assert.deepEqual(seen({ x: 4.5, z: -5, heading: 0 }), [], 'already passed');
  assert.deepEqual(seen({ x: -4.5, z: -30, heading: Math.PI }), [], 'oncoming traffic sees its back');
  assert.deepEqual(seen({ x: 40, z: 4.5, heading: -Math.PI / 2 }), [], 'crossing traffic');
  assert.deepEqual(seen({ x: 70, z: 30, heading: 0 }), [], 'parallel street');
});

test('the HUD keeps a sign while it is ahead and for six seconds after passing it', () => {
  const watch = new SignWatch(6), pose = { x: 4.5, z: 30, heading: 0 };
  watch.update([forNorthbound], pose, 0);
  assert.deepEqual(watch.current().map(s => s.id), ['n']);
  pose.z = -5; watch.update([forNorthbound], pose, 3);
  assert.deepEqual(watch.current().map(s => s.id), ['n']);
  watch.update([forNorthbound], pose, 7);
  assert.deepEqual(watch.current().map(s => s.id), []);
});

test('sign data: the 30 zone plate faces its traffic; staged situations add their signs', () => {
  const [plate] = zoneSigns(cityMap.speedZones);
  assert.equal(plate.code, '3.24'); assert.equal(plate.value, 30);
  assert.deepEqual(signsAhead([plate], { x: 4.5, z: 90, heading: 0 }).map(s => s.sign.code), ['3.24']);
  assert.deepEqual(examSigns(['d-stop', 'b-tram']).map(s => s.code), ['2.5', '1.5']);
  assert.deepEqual(examSigns(['d-yield']).map(s => s.code), ['2.4']);
  // Each staged sign addresses the learner on that situation's approach.
  assert.equal(signsAhead(examSigns(['d-yield']), { x: -74, z: -50, heading: Math.PI }).length, 1);
  assert.equal(signsAhead(examSigns(['b-tram']), { x: 4.5, z: -10, heading: 0 }).length, 1);
  assert.equal(signsAhead(examSigns(['a2-pedestrian']), { x: -4.5, z: 2, heading: Math.PI }).length, 1);
});
