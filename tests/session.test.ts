import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canResume, escapeAction } from '../src/game/session.ts';

const none = { help: false, settings: false, examPicker: false, debrief: false };

test('the trip cannot resume while any dialog is open', () => {
  assert.equal(canResume(none), true);
  for (const name of ['help', 'settings', 'examPicker', 'debrief'] as const) assert.equal(canResume({ ...none, [name]: true }), false, name);
});

test('Esc closes the exam picker and other dialogs without resuming; the debrief ignores it', () => {
  assert.deepEqual(escapeAction({ ...none, examPicker: true }), { close: ['examPicker'], togglePause: false });
  assert.deepEqual(escapeAction({ ...none, help: true, settings: true }), { close: ['help', 'settings'], togglePause: false });
  assert.deepEqual(escapeAction({ ...none, debrief: true }), { close: [], togglePause: false });
  assert.deepEqual(escapeAction({ ...none, debrief: true, examPicker: true }), { close: [], togglePause: false });
  assert.deepEqual(escapeAction(none), { close: [], togglePause: true });
});
