import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { byTicket, emptyProgress, fingerprint, mistakesOf, record, resultOf, TicketExam, topics, type TicketQuestion } from '../src/game/tickets.ts';

const data = JSON.parse(readFileSync(new URL('../src/data/tickets.json', import.meta.url), 'utf8')) as { questions: TicketQuestion[] };
const all = data.questions;
const rules = JSON.parse(readFileSync(new URL('../src/data/pdd.json', import.meta.url), 'utf8')) as { sections: { id: string; points: { id: string; text: string }[] }[] };

test('ticket data: 40 tickets × 20 questions, every answer set and key consistent, images present', () => {
  assert.equal(all.length, 800);
  for (let t = 1; t <= 40; t++) assert.deepEqual(byTicket(all, t).map(q => q.number), Array.from({ length: 20 }, (_, i) => i + 1));
  for (const q of all) {
    assert.ok(q.question.length > 5, q.id);
    assert.ok(q.answers.length >= 2 && q.answers.length <= 5, q.id);
    assert.ok(q.correct >= 0 && q.correct < q.answers.length, q.id);
    assert.ok(q.answers.every(a => a.length > 0), q.id);
    if (q.image) assert.ok(existsSync(new URL(`../public/tickets/${q.image}`, import.meta.url)), q.image);
  }
  assert.ok(topics(all).length >= 15);
});

test('rules data: 26 sections, points in order, referenced points mostly resolve', () => {
  assert.equal(rules.sections.length, 26);
  const ids = new Set(rules.sections.flatMap(s => s.points.map(p => p.id)));
  for (const id of ['1.2', '2.1.2', '6.2', '6.10', '8.1', '13.11', '14.1']) assert.ok(ids.has(id), id);
  const refs = all.flatMap(q => q.points);
  const resolved = refs.filter(r => ids.has(r)).length;
  assert.ok(resolved / refs.length > .9, `${resolved}/${refs.length}`);
});

test('sign catalog names every sign cited in the tickets', () => {
  const signs = JSON.parse(readFileSync(new URL('../src/data/signs.json', import.meta.url), 'utf8')) as { groups: { signs: { code: string }[] }[] };
  const codes = new Set(signs.groups.flatMap(g => g.signs.map(s => s.code)));
  assert.deepEqual([...new Set(all.flatMap(q => q.signs))].filter(c => !codes.has(c)), []);
});

const ticket1 = byTicket(all, 1);
const right = (exam: TicketExam, i: number) => exam.answer(i, exam.entries[i].question.correct);
const wrong = (exam: TicketExam, i: number) => exam.answer(i, (exam.entries[i].question.correct + 1) % exam.entries[i].question.answers.length);

test('exam: all correct passes in 20 questions', () => {
  const exam = new TicketExam(all, 1);
  for (let i = 0; i < 20; i++) right(exam, i);
  assert.equal(exam.status, 'passed');
  assert.equal(exam.entries.length, 20);
});

test('exam: one mistake adds five questions of the same block and five minutes; answering them passes', () => {
  const exam = new TicketExam(all, 1, () => .3);
  wrong(exam, 0);
  assert.equal(exam.entries.length, 25);
  assert.equal(exam.timeLimit, 25 * 60);
  assert.ok(exam.entries.slice(20).every(e => e.extra && e.block === 1 && e.question.ticket !== 1 && e.question.number <= 5));
  for (let i = 1; i < 25; i++) right(exam, i);
  assert.equal(exam.status, 'passed');
});

test('exam: two mistakes in one block, three mistakes, or a mistake in the extra questions fail', () => {
  const sameBlock = new TicketExam(all, 1); wrong(sameBlock, 0); wrong(sameBlock, 1);
  assert.equal(sameBlock.status, 'failed');
  const three = new TicketExam(all, 1); wrong(three, 0); wrong(three, 5); wrong(three, 10);
  assert.equal(three.status, 'failed');
  const extra = new TicketExam(all, 1); wrong(extra, 0); for (let i = 1; i < 20; i++) right(extra, i); wrong(extra, 20);
  assert.equal(extra.status, 'failed');
  const twoBlocks = new TicketExam(all, 1); wrong(twoBlocks, 0); wrong(twoBlocks, 5);
  assert.equal(twoBlocks.status, 'running');
  assert.equal(twoBlocks.entries.length, 30);
  const late = new TicketExam(all, 1); late.expire();
  assert.equal(late.status, 'failed');
});

test('progress: results survive unless the question changes; mistakes list follows the latest answer', () => {
  const p = emptyProgress(), q = ticket1[0];
  record(p, q, false);
  assert.equal(resultOf(p, q), false);
  assert.deepEqual(mistakesOf(p, all).map(x => x.id), [q.id]);
  record(p, q, true);
  assert.deepEqual(mistakesOf(p, all), []);
  const changed = { ...q, question: q.question + ' (новая редакция)' };
  assert.notEqual(fingerprint(changed), fingerprint(q));
  assert.equal(resultOf(p, changed), null);
});
