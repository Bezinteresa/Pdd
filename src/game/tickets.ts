// Exam tickets: question model, theory exam rules and saved progress. Pure logic, no UI.
export interface TicketQuestion {
  id: string; ticket: number; number: number; question: string; answers: string[]; correct: number;
  image: string | null; points: string[]; signs: string[]; marks: string[]; topic: string;
}

/**
 * Theory exam parameters (categories A, B, M): 20 questions in four blocks of five, 20 minutes; each mistake adds
 * five questions of the same block and five minutes; two mistakes in one block, more than two in total, or a mistake
 * among the added questions fails. Kept as configuration to re-check against the regulation in force before release.
 */
export const EXAM_RULES = { questions: 20, blockSize: 5, minutes: 20, extraPerMistake: 5, extraMinutes: 5, maxMistakes: 2 };

export const blockOf = (number: number) => Math.ceil(number / EXAM_RULES.blockSize);
export const byTicket = (all: TicketQuestion[], ticket: number) => all.filter(q => q.ticket === ticket).sort((a, b) => a.number - b.number);
export const byTopic = (all: TicketQuestion[], topic: string) => all.filter(q => q.topic === topic);
export function topics(all: TicketQuestion[]) {
  const counts = new Map<string, number>();
  for (const q of all) counts.set(q.topic, (counts.get(q.topic) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

/** Short fingerprint of what a question says; a changed question loses its old result. */
export function fingerprint(q: Pick<TicketQuestion, 'question' | 'answers' | 'correct'>) {
  let h = 2166136261;
  for (const ch of q.question + '|' + q.answers.join('|') + '|' + q.correct) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export type ExamStatus = 'running' | 'passed' | 'failed';
export interface ExamEntry { question: TicketQuestion; extra: boolean; block: number; picked: number | null; }

export class TicketExam {
  readonly entries: ExamEntry[];
  status: ExamStatus = 'running';
  failReason: string | null = null;
  timeLimit: number;
  private all: TicketQuestion[];
  private random: () => number;

  constructor(all: TicketQuestion[], ticket: number, random: () => number = Math.random) {
    this.all = all; this.random = random;
    this.entries = byTicket(all, ticket).map(question => ({ question, extra: false, block: blockOf(question.number), picked: null }));
    this.timeLimit = EXAM_RULES.minutes * 60;
  }

  get mistakes() { return this.entries.filter(e => e.picked !== null && e.picked !== e.question.correct); }
  get answered() { return this.entries.filter(e => e.picked !== null).length; }

  /** Records an answer and applies the exam rules. Returns whether it was correct. */
  answer(index: number, picked: number): boolean {
    const entry = this.entries[index];
    if (this.status !== 'running' || !entry || entry.picked !== null) return false;
    entry.picked = picked;
    const ok = picked === entry.question.correct;
    if (!ok) {
      const base = this.entries.filter(e => !e.extra && e.picked !== null && e.picked !== e.question.correct);
      const sameBlock = base.filter(e => e.block === entry.block).length;
      if (entry.extra) this.fail('Ошибка в дополнительных вопросах.');
      else if (sameBlock > 1) this.fail(`Две ошибки в одном блоке (вопросы ${(entry.block - 1) * 5 + 1}–${entry.block * 5}).`);
      else if (base.length > EXAM_RULES.maxMistakes) this.fail(`Больше ${EXAM_RULES.maxMistakes} ошибок.`);
      else this.addExtra(entry);
    }
    if (this.status === 'running' && this.entries.every(e => e.picked !== null)) this.status = 'passed';
    return ok;
  }

  /** Time ran out. */
  expire() { if (this.status === 'running') this.fail('Время вышло.'); }

  private fail(reason: string) { this.status = 'failed'; this.failReason = reason; }

  /** Five questions of the same block from other tickets, not yet in this exam. */
  private addExtra(entry: ExamEntry) {
    const used = new Set(this.entries.map(e => e.question.id));
    const pool = this.all.filter(q => blockOf(q.number) === entry.block && q.ticket !== entry.question.ticket && !used.has(q.id));
    for (let i = 0; i < EXAM_RULES.extraPerMistake && pool.length; i++) {
      const [q] = pool.splice(Math.floor(this.random() * pool.length), 1);
      this.entries.push({ question: q, extra: true, block: entry.block, picked: null });
    }
    this.timeLimit += EXAM_RULES.extraMinutes * 60;
  }
}

/** Saved results per question with its fingerprint, favourites and exam counters. */
export interface TicketProgress { results: Record<string, { ok: boolean; fp: string }>; favorites: string[]; examsTaken: number; examsPassed: number; }
export const emptyProgress = (): TicketProgress => ({ results: {}, favorites: [], examsTaken: 0, examsPassed: 0 });

export function record(progress: TicketProgress, q: TicketQuestion, ok: boolean) { progress.results[q.id] = { ok, fp: fingerprint(q) }; }
/** Result of a question, or null when never answered or answered in an older wording. */
export function resultOf(progress: TicketProgress, q: TicketQuestion): boolean | null {
  const r = progress.results[q.id];
  return r && r.fp === fingerprint(q) ? r.ok : null;
}
export const mistakesOf = (progress: TicketProgress, all: TicketQuestion[]) => all.filter(q => resultOf(progress, q) === false);

/** Questions that cite a PDD point (or its sub-points), sign or marking. */
export function citing(all: TicketQuestion[], ref: { point?: string; sign?: string; mark?: string }) {
  const under = (id: string, base: string) => id === base || id.startsWith(base + '.') || id.startsWith(base + '(');
  return all.filter(q => (ref.point && q.points.some(p => under(p, ref.point!))) || (ref.sign && q.signs.some(s => under(s, ref.sign!))) || (ref.mark && q.marks.some(m => under(m, ref.mark!))));
}
