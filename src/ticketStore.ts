// Ticket and rules data (loaded on demand, ~0.7 MB) and saved ticket progress shared by the tabs.
import { reactive, watch } from 'vue';
import { emptyProgress, type TicketProgress, type TicketQuestion } from './game/tickets';

export interface RulePoint { id: string; text: string; }
export interface RuleSection { id: string; title: string; intro: string; points: RulePoint[]; }
export interface SignGroup { id: string; title: string; signs: { code: string; name: string }[]; }
export interface PddData { tickets: TicketQuestion[]; source: string; sections: RuleSection[]; edition: string; rulesSource: string; signGroups: SignGroup[]; points: Map<string, RulePoint & { section: string }>; signs: Map<string, string>; }

/** Questions to open on arrival: those citing a PDD point, sign or marking (from a trip error or the rules tab). */
export interface TicketFocus { label: string; point?: string; sign?: string; mark?: string; }

let loading: Promise<PddData> | null = null;
export function loadPdd(): Promise<PddData> {
  loading ??= Promise.all([import('./data/tickets.json'), import('./data/pdd.json'), import('./data/signs.json')]).then(([t, r, s]) => {
    const points = new Map<string, RulePoint & { section: string }>();
    for (const section of r.default.sections) for (const p of section.points) points.set(p.id, { ...p, section: section.id });
    const signs = new Map<string, string>();
    for (const g of s.default.groups) for (const sign of g.signs) signs.set(sign.code, sign.name);
    return { tickets: t.default.questions as TicketQuestion[], source: t.default.source, sections: r.default.sections, edition: r.default.edition, rulesSource: r.default.source, signGroups: s.default.groups, points, signs };
  }).catch(error => { loading = null; throw error; });
  return loading;
}

/** Point text by id; a sub-point missing from the book falls back to its parent («8.1(1)» → «8.1»). */
export function findPoint(data: PddData, id: string) {
  let key = id;
  while (key) {
    const hit = data.points.get(key);
    if (hit) return hit;
    const cut = Math.max(key.lastIndexOf('.'), key.lastIndexOf('('));
    key = cut > 1 ? key.slice(0, cut) : '';
  }
  return null;
}

const KEY = 'pdd-tickets-v1', VERSION = 1;
function read(): TicketProgress {
  try { const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (saved?.version === VERSION) return { ...emptyProgress(), ...saved.progress }; } catch { /* storage unavailable */ }
  return emptyProgress();
}
export const ticketProgress = reactive(read());
watch(ticketProgress, value => { try { localStorage.setItem(KEY, JSON.stringify({ version: VERSION, progress: value })); } catch { /* storage unavailable */ } }, { deep: true });

export const imageUrl = (file: string) => `${import.meta.env.BASE_URL}tickets/${file}`;
