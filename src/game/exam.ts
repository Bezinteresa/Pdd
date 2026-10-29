import { cityMap, forwardOf, inside, maneuverThrough, type Approach, type Point, type Rect } from './roads.ts';
import type { VehicleState } from './vehicle.ts';
import { allowedManeuvers, poseLabel, regulatorAt, sideLabel, sideOf, type Maneuver } from './regulator.ts';
import { laneFromApproach, type ForcedBrake, type TrafficLane, type TrafficSystem } from './traffic.ts';
import type { Pose, TripJudge, Violation } from './rules.ts';
import type { PlacedSign } from './signs.ts';

// Practical exam with an inspector: a fixed loop through the district with slots where situations are staged.
// Route: start → A (signal, straight) → B (unregulated, left) → west corner (left) → D (T-junction onto the main
// street, left) → A (right) → optional U-turn → finish. Each selected situation configures one or two slots.

export type SlotId = 'A1' | 'B' | 'D' | 'A2' | 'U';
export type Compass = 'N' | 'S' | 'E' | 'W';
/** Diagram in the learner's frame: the learner always enters from the bottom (S). */
export interface Schema {
  junction: 'cross' | 'T' | 'road';
  player: Maneuver;
  actors: { from: Compass; maneuver: Maneuver; kind: 'car' | 'tram' | 'pedestrian' }[];
  signs?: string[]; regulator?: boolean; light?: boolean;
  /** One road with two lanes each way; the learner moves to the left lane, a car comes up in it from behind. */
  laneChange?: boolean;
}
export interface Situation {
  id: string; title: string; topic: string; summary: string; slots: SlotId[]; ruleIds: string[];
  status: 'ready' | 'planned'; schema?: Schema;
}

export const situations: Situation[] = [
  { id: 'a1-signal', title: 'Регулируемый перекрёсток: прямо', topic: 'Светофор', slots: ['A1'], ruleIds: ['6.2', '6.13', '6.14'], status: 'ready',
    summary: 'Проезд перекрёстка прямо по сигналам светофора: остановка перед стоп-линией на запрещающий, правило жёлтого сигнала.',
    schema: { junction: 'cross', player: 'straight', light: true, actors: [{ from: 'E', maneuver: 'straight', kind: 'car' }] } },
  { id: 'a-regulator', title: 'Регулировщик', topic: 'Регулировщик', slots: ['A1', 'A2'], ruleIds: ['6.10', '6.13', '6.14'], status: 'ready',
    summary: 'Центральный перекрёсток регулирует сотрудник: проезд прямо и поворот направо по его сигналам, светофор отключён.',
    schema: { junction: 'cross', player: 'straight', regulator: true, actors: [] } },
  { id: 'b-right-hand', title: 'Равнозначный перекрёсток: помеха справа', topic: 'Равнозначный перекрёсток', slots: ['B'], ruleIds: ['13.11', '1.2'], status: 'ready',
    summary: 'Знаков приоритета нет. Поворачивая налево, уступите автомобилю, приближающемуся справа.',
    schema: { junction: 'cross', player: 'left', actors: [{ from: 'E', maneuver: 'straight', kind: 'car' }] } },
  { id: 'b-oncoming', title: 'Поворот налево: встречный транспорт', topic: 'Поворот налево', slots: ['B'], ruleIds: ['13.12', '1.2'], status: 'ready',
    summary: 'При повороте налево на равнозначном перекрёстке уступите встречному автомобилю, движущемуся прямо.',
    schema: { junction: 'cross', player: 'left', actors: [{ from: 'N', maneuver: 'straight', kind: 'car' }] } },
  { id: 'b-tram', title: 'Трамвай на равнозначном перекрёстке', topic: 'Трамвай', slots: ['B'], ruleIds: ['13.11', '1.2'], status: 'ready',
    summary: 'Трамвай приближается слева. На равнозначном перекрёстке он имеет преимущество независимо от направления движения.',
    schema: { junction: 'cross', player: 'left', actors: [{ from: 'W', maneuver: 'straight', kind: 'tram' }] } },
  { id: 'd-yield', title: 'Знак «Уступите дорогу»', topic: 'Главная и второстепенная', slots: ['D'], ruleIds: ['sign-2.4', '13.9', '1.2'], status: 'ready',
    summary: 'Выезд со второстепенной дороги на главную с поворотом налево: уступите транспорту с обеих сторон.',
    schema: { junction: 'T', player: 'left', signs: ['2.4'], actors: [{ from: 'W', maneuver: 'straight', kind: 'car' }, { from: 'E', maneuver: 'straight', kind: 'car' }] } },
  { id: 'd-stop', title: 'Знак «Движение без остановки запрещено»', topic: 'Главная и второстепенная', slots: ['D'], ruleIds: ['sign-2.5', '13.9', '1.2'], status: 'ready',
    summary: 'Полная остановка перед стоп-линией, затем выезд на главную, уступив дорогу.',
    schema: { junction: 'T', player: 'left', signs: ['2.5'], actors: [{ from: 'W', maneuver: 'straight', kind: 'car' }] } },
  { id: 'a2-pedestrian', title: 'Поворот направо: пешеходы', topic: 'Пешеходы', slots: ['A2'], ruleIds: ['13.1'], status: 'ready',
    summary: 'Поворачивая направо на зелёный, уступите пешеходам, переходящим дорогу, на которую вы поворачиваете.',
    schema: { junction: 'cross', player: 'right', light: true, actors: [{ from: 'E', maneuver: 'straight', kind: 'pedestrian' }] } },
  { id: 'u-turn', title: 'Разворот вне перекрёстка', topic: 'Разворот', slots: ['U'], ruleIds: ['8.1', '8.5', '8.8', '8.11'], status: 'ready',
    summary: 'Разворот по команде инспектора: указатель, крайнее левое положение, без выезда за проезжую часть.',
    schema: { junction: 'road', player: 'uturn', actors: [] } },
  // Situations staged only in the city (practice runs there too): they need the zebras, the car park, the roundabout, two lanes.
  { id: 'crosswalk', title: 'Нерегулируемый пешеходный переход', topic: 'Пешеходы', slots: [], ruleIds: ['14.1'], status: 'ready',
    summary: 'Пешеход вступил на «зебру» без светофора. Уступите ему дорогу: остановитесь и дождитесь, пока он перейдёт.',
    schema: { junction: 'road', player: 'straight', actors: [{ from: 'E', maneuver: 'straight', kind: 'pedestrian' }] } },
  { id: 'adjacent', title: 'Выезд с прилегающей территории', topic: 'Манёвры', slots: [], ruleIds: ['8.3'], status: 'ready',
    summary: 'Экзамен начинается на парковке. Выезжая на дорогу, уступите машинам на ней и пешеходу на тротуаре.' },
  { id: 'roundabout', title: 'Круговое движение', topic: 'Перекрёстки', slots: [], ruleIds: ['13.11(1)', 'sign-4.3'], status: 'ready',
    summary: 'Кольцо со знаком 4.3: уступите тем, кто уже едет по кругу, двигайтесь против часовой стрелки и уйдите в нужный съезд.' },
  { id: 'lane-change', title: 'Перестроение', topic: 'Манёвры', slots: [], ruleIds: ['8.1', '8.4'], status: 'ready',
    summary: 'По команде инспектора перестройтесь в соседнюю полосу: поворотник заранее и пропустить попутную машину в той полосе.',
    schema: { junction: 'road', player: 'straight', laneChange: true, actors: [{ from: 'S', maneuver: 'straight', kind: 'car' }] } },
  // Topics frequent in the exam tickets that need new road elements; listed so the catalogue shows what comes next.
  { id: 'green-left-oncoming', title: 'Налево на зелёный: встречные', topic: 'Светофор', slots: [], ruleIds: ['13.4'], status: 'planned', summary: 'Поворот налево на регулируемом перекрёстке с пропуском встречных.' },
  { id: 'arrow-section', title: 'Дополнительная секция светофора', topic: 'Светофор', slots: [], ruleIds: [], status: 'planned', summary: 'Движение по стрелке при красном сигнале, п. 13.5.' },
  { id: 'flashing-yellow', title: 'Мигающий жёлтый, светофор не работает', topic: 'Светофор', slots: [], ruleIds: [], status: 'planned', summary: 'Перекрёсток становится нерегулируемым, п. 13.3.' },
  { id: 'main-road-turns', title: 'Главная дорога меняет направление', topic: 'Главная и второстепенная', slots: [], ruleIds: [], status: 'planned', summary: 'Знак 2.1 с табличкой 8.13, п. 13.10.' },

  { id: 'regulator-tram', title: 'Трамвай и регулировщик', topic: 'Трамвай', slots: [], ruleIds: [], status: 'planned', summary: 'Разные разрешения трамваю и безрельсовым ТС, п. 6.10, 13.6.' },
  { id: 'tram-left-turn', title: 'Налево с трамвайных путей', topic: 'Трамвай', slots: [], ruleIds: [], status: 'planned', summary: 'Поворот налево с путей попутного направления, п. 8.5.' },

  { id: 'railway', title: 'Железнодорожный переезд', topic: 'Переезды', slots: [], ruleIds: [], status: 'planned', summary: 'Раздел 15 ПДД, знаки 1.1–1.4.' },
  { id: 'overtaking', title: 'Обгон и встречная полоса', topic: 'Обгон', slots: [], ruleIds: [], status: 'planned', summary: 'Раздел 11, разметка 1.1, знак 3.20.' },
  { id: 'stopping', title: 'Остановка и стоянка', topic: 'Остановка и стоянка', slots: [], ruleIds: [], status: 'planned', summary: 'Раздел 12, знаки 3.27–3.30.' },
  { id: 'lanes', title: 'Направления по полосам', topic: 'Манёвры', slots: [], ruleIds: [], status: 'planned', summary: 'Знаки 5.15.1, 5.15.2, п. 8.5.' },

  { id: 'one-way', title: 'Одностороннее движение, въезд запрещён', topic: 'Знаки', slots: [], ruleIds: [], status: 'planned', summary: 'Знаки 3.1, 5.5–5.7.' },
  { id: 'no-turn', title: 'Запрет поворота и разворота', topic: 'Знаки', slots: [], ruleIds: [], status: 'planned', summary: 'Знаки 3.18.1, 3.18.2, 3.19.' },
  { id: 'residential', title: 'Жилая зона', topic: 'Знаки', slots: [], ruleIds: [], status: 'planned', summary: 'Знак 5.21, раздел 17.' },
];
export const readySituations = situations.filter(s => s.status === 'ready');
const byId = (id: string) => situations.find(s => s.id === id);

/** Situations can share the exam only if they do not claim the same slot. */
export function compatible(ids: string[]) {
  const used = new Set<SlotId>();
  for (const id of ids) for (const slot of byId(id)?.slots ?? []) { if (used.has(slot)) return false; used.add(slot); }
  return true;
}
export function randomSelection(random: () => number = Math.random, count = 3 + Math.floor(random() * 2)) {
  const pool = [...readySituations].sort(() => random() - .5), chosen: string[] = [];
  for (const s of pool) if (chosen.length < count && compatible([...chosen, s.id])) chosen.push(s.id);
  return chosen;
}

export type NodeId = 'A' | 'B' | 'CW' | 'D' | 'CE' | 'E';
const area = (id: string) => cityMap.intersections.find(i => i.id === id)!.area;
export const nodes: Record<NodeId, Rect> = { A: area('central'), B: area('north'), CW: area('corner-w'), D: area('junction-w'), CE: area('corner-e'), E: area('junction-e') };

export interface RouteStep { kind: 'start' | 'node' | 'uturn' | 'finish' | 'end'; node?: NodeId; maneuver?: Maneuver; slot?: SlotId; command: string; }
export const uTurnZone: Rect = { x: 0, z: 52, halfX: 9, halfZ: 20 };
export const stopLineD: [Point, Point] = [{ x: -77.5, z: -10.5 }, { x: -70.5, z: -10.5 }];
export function finishZone(selected: string[]): Point { return selected.includes('u-turn') ? { x: 4.5, z: 34 } : { x: -4.5, z: 45 }; }

/** Signs a set of situations puts on the map; the 3D scene and the HUD both read this list. */
export function examSigns(selected: string[]): PlacedSign[] {
  const signs: PlacedSign[] = [];
  if (selected.includes('d-yield') || selected.includes('d-stop')) signs.push({ id: 'd-priority', code: selected.includes('d-stop') ? '2.5' : '2.4', at: { x: -79.6, z: -13 }, facing: { x: 0, z: -1 } });
  if (selected.includes('b-tram')) signs.push({ id: 'b-tram-warning', code: '1.5', at: { x: 10.6, z: -48 }, facing: { x: 0, z: 1 } });
  if (selected.includes('a2-pedestrian')) signs.push({ id: 'a2-crossing', code: '5.19.1', at: { x: -10.6, z: 13.4 }, facing: { x: 0, z: -1 } });
  return signs;
}

export function buildRoute(selected: string[]): RouteStep[] {
  const regulator = selected.includes('a-regulator');
  const steps: RouteStep[] = [
    { kind: 'start', command: 'Экзамен начался. Пристегнитесь, начинайте движение и двигайтесь прямо.' },
    { kind: 'node', node: 'A', maneuver: 'straight', slot: 'A1', command: regulator ? 'На перекрёстке работает регулировщик. Двигайтесь прямо.' : 'На перекрёстке со светофором двигайтесь прямо.' },
    { kind: 'node', node: 'B', maneuver: 'left', slot: 'B', command: 'На следующем перекрёстке поверните налево.' },
    { kind: 'node', node: 'CW', maneuver: 'left', command: 'В конце улицы поверните налево.' },
    { kind: 'node', node: 'D', maneuver: 'left', slot: 'D', command: 'На перекрёстке с главной дорогой поверните налево.' },
    { kind: 'node', node: 'A', maneuver: 'right', slot: 'A2', command: 'На перекрёстке поверните направо.' },
  ];
  if (selected.includes('u-turn')) steps.push({ kind: 'uturn', slot: 'U', command: 'Развернитесь в удобном месте, где это разрешено.' });
  steps.push({ kind: 'finish', command: 'Остановитесь в правой полосе в зелёной зоне.' });
  return steps;
}

/**
 * Practice by situation: the car appears just before the staged place, gets one command and the run ends
 * right after the situation. The hint is shown before the learner gets there (training, not the exam).
 */
export interface PracticeScene { spawn: { x: number; z: number; heading: number }; step: RouteStep; hint: string; }
const north = 0, south = Math.PI, east = Math.PI / 2;
export const practiceScenes: Record<string, PracticeScene> = {
  'a1-signal': { spawn: { x: 4.5, z: 62, heading: north }, step: { kind: 'node', node: 'A', maneuver: 'straight', slot: 'A1', command: 'На перекрёстке со светофором двигайтесь прямо.' }, hint: 'На красный и жёлтый остановитесь перед стоп-линией. На жёлтый можно продолжить, только если плавно остановиться уже не получается.' },
  'a2-pedestrian': { spawn: { x: -62, z: 4.5, heading: east }, step: { kind: 'node', node: 'A', maneuver: 'right', slot: 'A2', command: 'На перекрёстке поверните направо.' }, hint: 'Включите правый поворотник. Поворачивая, пропустите пешеходов на переходе, куда вы въезжаете.' },
  'b-right-hand': { spawn: { x: 4.5, z: -28, heading: north }, step: { kind: 'node', node: 'B', maneuver: 'left', slot: 'B', command: 'На перекрёстке поверните налево.' }, hint: 'Знаков нет — перекрёсток равнозначный. Уступите автомобилю, который приближается справа.' },
  'b-oncoming': { spawn: { x: 4.5, z: -28, heading: north }, step: { kind: 'node', node: 'B', maneuver: 'left', slot: 'B', command: 'На перекрёстке поверните налево.' }, hint: 'Поворачивая налево, пропустите встречный автомобиль, который едет прямо.' },
  'b-tram': { spawn: { x: 4.5, z: -28, heading: north }, step: { kind: 'node', node: 'B', maneuver: 'left', slot: 'B', command: 'На перекрёстке поверните налево.' }, hint: 'Слева идёт трамвай. На равнозначном перекрёстке он проезжает первым, с какой бы стороны ни ехал.' },
  'd-yield': { spawn: { x: -74, z: -60, heading: south }, step: { kind: 'node', node: 'D', maneuver: 'left', slot: 'D', command: 'Выезжайте на главную дорогу налево.' }, hint: 'Знак «Уступите дорогу»: пропустите машины на главной с обеих сторон, потом поворачивайте.' },
  'd-stop': { spawn: { x: -74, z: -60, heading: south }, step: { kind: 'node', node: 'D', maneuver: 'left', slot: 'D', command: 'Выезжайте на главную дорогу налево.' }, hint: 'Знак «STOP»: полностью остановитесь передом у стоп-линии, даже если дорога пуста, затем уступите главной.' },
  'a-regulator': { spawn: { x: 4.5, z: 62, heading: north }, step: { kind: 'node', node: 'A', maneuver: 'straight', slot: 'A1', command: 'На перекрёстке работает регулировщик. Двигайтесь прямо.' }, hint: 'Вы подъезжаете к регулировщику. Если он стоит к вам боком с вытянутыми руками — можно прямо и направо. Грудью или спиной — стойте.' },
  'u-turn': { spawn: { x: -4.5, z: 24, heading: south }, step: { kind: 'uturn', slot: 'U', command: 'Развернитесь в удобном месте, где это разрешено.' }, hint: 'Включите левый поворотник, прижмитесь к середине дороги и разворачивайтесь, не задевая бордюр.' },
};
/** Order of the practice list: from the simplest and most frequent topics in the tickets to the hardest. */
export const practiceOrder = ['a1-signal', 'a2-pedestrian', 'crosswalk', 'adjacent', 'b-right-hand', 'b-oncoming', 'd-yield', 'd-stop', 'lane-change', 'roundabout', 'b-tram', 'a-regulator', 'u-turn'];
/** Hints for the situations practised in the city. */
const cityHints: Record<string, string> = {
  crosswalk: 'Впереди «зебра» без светофора. Если пешеход переходит или уже ступил на дорогу — тормозите и пропустите его.',
  adjacent: 'Вы на парковке. Пропустите пешехода на тротуаре и машины на проспекте, только потом выезжайте направо.',
  roundabout: 'Знак 4.3: на кольце главные те, кто уже едет по кругу. Уступите им, двигайтесь против часовой стрелки, третий съезд — налево.',
  'lane-change': 'Сначала поворотник, потом посмотрите в зеркало: пропустите машину, которая едет по соседней полосе, и плавно перестройтесь.',
};
/** The hint shown before a practice run, wherever it is staged. */
export const practiceHint = (id: string) => practiceScenes[id]?.hint ?? cityHints[id] ?? '';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export function classifyManeuver(entryHeading: number, exitHeading: number): Maneuver {
  const turn = wrap(exitHeading - entryHeading);
  if (Math.abs(turn) < .6) return 'straight';
  if (Math.abs(turn) > 2.4) return 'uturn';
  return turn > 0 ? 'right' : 'left';
}
export const maneuverLabel: Record<Maneuver, string> = { straight: 'прямо', right: 'направо', left: 'налево', uturn: 'разворот' };

// One-shot lanes for staged participants.
const westAtB: TrafficLane = { id: 'b-west', axis: 'x', sign: -1, offset: -89, start: -78, end: 78, loop: false };
const southFromB = laneFromApproach('b-south', cityMap.approaches.find(a => a.id === 'central-s')!, -128, 70, false);
export const tramTrack: TrafficLane = { id: 'tram', axis: 'x', sign: 1, offset: -82, start: -78, end: 78, loop: false };

export type SituationProgress = 'pending' | 'active' | 'done';
export type SituationOutcome = 'passed' | 'failed' | 'interrupted' | 'not-reached';
/** What the debrief says about a situation: an empty error list alone does not mean it was driven. */
export function situationOutcome(progress: SituationProgress, errors: number): SituationOutcome {
  if (progress === 'done') return errors ? 'failed' : 'passed';
  return progress === 'active' ? 'interrupted' : 'not-reached';
}

/** A pedestrian shuttling along a crosswalk: it walks along x or z between `min` and `max`. */
export interface Pedestrian { x: number; z: number; dir: 1 | -1; speed: number; waiting: boolean; axis?: 'x' | 'z'; min?: number; max?: number; situation?: string; }

/**
 * Whether a moving car on the crossing fails to yield to this pedestrian: the pedestrian is in front of the car or still
 * walking towards its lane. One who has already passed the car and walks away is not a conflict.
 */
export function pedestrianConflict(p: Pedestrian, car: { x: number; z: number; speed: number }) {
  if (Math.abs(car.speed) <= .3) return false;
  const along = p.axis === 'z' ? 'z' : 'x', across = along === 'x' ? 'z' : 'x';
  if (Math.abs(car[across] - p[across]) > 3) return false;
  const offset = p[along] - car[along], approaching = offset * p.dir < 0;
  return Math.abs(offset) < (approaching ? 3.3 : 1.3);
}

/** What a running exam puts on the map besides the road: signs, stop lines, tracks and the controller. */
export interface StagedProps { signs: PlacedSign[]; stopLines: [Point, Point][]; rails: TrafficLane[]; regulator: Point | null; }
/** The exam or practice run as the engine and the UI see it, whatever the map. */
export interface ExamSession {
  readonly selected: string[];
  readonly practice: string | null;
  readonly steps: RouteStep[];
  readonly stepIndex: number;
  readonly finished: boolean;
  readonly failReason: string | null;
  readonly pedestrians: Pedestrian[];
  /** Staged vehicles that are not on straight lanes (the car on the roundabout), drawn and collided with by the engine. */
  actors?(): { id: string; x: number; z: number; heading: number; color: string }[];
  obstacles?(): Rect[];
  /** What the inspector says now. */
  readonly command: string;
  progress(id: string): SituationProgress;
  attribute(v: Violation): void;
  props(): StagedProps;
  /** Approaches the controller rules instead of the lights. */
  controlledByRegulator(approach: Approach): boolean;
  /** Where to stop at the end, once that is the task. */
  goal(): (Point & { heading?: number }) | null;
  update(frame: ExamFrame): string[];
}
const CROSSWALK_Z = 15, CROSSWALK_HALF = 8.5;
const FRONT_OFFSET = 2.05;
/** Game tolerances for sign 2.5, not legal distances: how close to the line the front must stand, and what counts as stopped. */
export const STOP_ZONE = 3, STOP_SPEED = .1;

export interface ExamFrame { prev: Pose; state: VehicleState; time: number; dt: number; traffic: TrafficSystem; forced: ForcedBrake[]; judge: TripJudge; }

export class ExamRunner implements ExamSession {
  readonly steps: RouteStep[];
  readonly regulator: boolean;
  readonly stopSign: boolean;
  readonly tram: boolean;
  readonly finish: Point;
  stepIndex = 0;
  finished = false;
  failReason: string | null = null;
  pedestrians: Pedestrian[] = [];
  private announced = false;
  private inside = new Map<NodeId, { heading: number; time: number }>();
  private spawned = new Set<string>();
  private yieldedCars = new Set<number>();
  private stoppedAtLine = false;
  private stopChecked = false;
  private pedestrianFlagged = false;
  private uTurn: { started: boolean } = { started: false };
  private finishHold = 0;
  private slots = new Map<SlotId, 'active' | 'done'>();

  readonly selected: string[];
  /** Situation id when running a single practice situation instead of the full exam. */
  readonly practice: string | null;
  constructor(selected: string[], practice: string | null = null) {
    this.selected = practice ? [practice] : selected;
    this.practice = practice;
    const scene = practice ? practiceScenes[practice] : null;
    this.steps = scene ? [scene.step, { kind: 'end', command: 'Ситуация пройдена. Разберём, как получилось.' }] : buildRoute(selected);
    if (scene?.step.slot) this.slots.set(scene.step.slot, 'active');
    selected = this.selected;
    this.regulator = selected.includes('a-regulator');
    this.stopSign = selected.includes('d-stop');
    this.tram = selected.includes('b-tram');
    this.finish = finishZone(selected);
  }

  get step() { return this.steps[Math.min(this.stepIndex, this.steps.length - 1)]; }
  get command() { return this.step.command; }
  props(): StagedProps {
    return { signs: examSigns(this.selected), stopLines: this.stopSign ? [stopLineD] : [], rails: this.tram ? [tramTrack] : [], regulator: this.regulator ? { x: 0, z: 0 } : null };
  }
  controlledByRegulator(approach: Approach) { return this.regulator && approach.intersection === 'central'; }
  goal() { return this.step.kind === 'finish' && !this.finished ? this.finish : null; }
  /** Selected situation staged at the current step, used to attribute violations in the debrief. */
  currentSituation(): string | undefined {
    const slot = this.step.slot; if (!slot) return undefined;
    return this.selected.find(id => byId(id)?.slots.includes(slot));
  }
  attribute(v: Violation) { v.situation ??= this.currentSituation(); }

  private advance(say: string[]) {
    const left = this.step.slot; if (left) this.slots.set(left, 'done');
    this.stepIndex++; this.announced = false;
    if (this.step.kind === 'end') this.finished = true;
    const entered = this.step.slot; if (entered && !this.slots.has(entered)) this.slots.set(entered, 'active');
    this.announce(say);
  }
  /** Progress of a selected situation, derived from the route steps of every slot it occupies. */
  progress(id: string): SituationProgress {
    // A practice run stages one slot of the situation; finishing it is the whole task.
    if (this.practice) return this.finished && !this.failReason ? 'done' : 'active';
    const slots = byId(id)?.slots ?? [];
    if (slots.length && slots.every(slot => this.slots.get(slot) === 'done')) return 'done';
    return slots.some(slot => this.slots.has(slot)) ? 'active' : 'pending';
  }
  private announce(say: string[]) { if (!this.announced && (!this.finished || this.step.kind === 'end')) { this.announced = true; say.push(this.step.command); } }
  private fail(frame: ExamFrame, detail: string, say: string[]) {
    frame.judge.record('route', frame.time, frame.state, detail, { situation: this.currentSituation() });
    this.finished = true; this.failReason = detail; say.push(this.practice ? 'Вы поехали не туда — ситуация не выполнена.' : 'Вы отклонились от маршрута. Экзамен прекращён.');
  }

  /** One fixed step. Returns phrases the inspector says. */
  update(frame: ExamFrame): string[] {
    const say: string[] = [];
    if (this.finished) return say;
    const { state } = frame;
    if (this.step.kind === 'start') { this.announce(say); if (Math.abs(state.speed) > .5) this.advance(say); return say; }
    this.announce(say);
    this.trackNodes(frame, say);
    if (this.finished) return say;
    this.stage(frame);
    this.judgeYield(frame);
    this.judgeStopSign(frame);
    this.updatePedestrians(frame);
    if (this.step.kind === 'uturn') this.judgeUTurn(frame, say);
    if (this.step.kind === 'finish') {
      const inZone = Math.abs(state.x - this.finish.x) < 1.6 && Math.abs(state.z - this.finish.z) < 3.6;
      this.finishHold = inZone && Math.abs(state.speed) < .1 ? this.finishHold + frame.dt : 0;
      if (this.finishHold > 1) { this.finished = true; say.push('Экзамен окончен. Поставьте автомобиль на ручник, разберём ошибки.'); }
    }
    return say;
  }

  private trackNodes(frame: ExamFrame, say: string[]) {
    const { state, time } = frame;
    for (const id of Object.keys(nodes) as NodeId[]) {
      const isInside = inside(nodes[id], state), entry = this.inside.get(id);
      if (isInside && !entry) this.inside.set(id, { heading: state.heading, time });
      if (isInside || !entry) continue;
      this.inside.delete(id);
      const maneuver = maneuverThrough(nodes[id], entry.heading, state), step = this.step;
      if (step.kind !== 'node' || step.node !== id) { this.fail(frame, 'Перекрёсток проехан не по заданному маршруту.', say); return; }
      if (maneuver !== step.maneuver) { this.fail(frame, `Задание: ${maneuverLabel[step.maneuver!]}, выполнено: ${maneuverLabel[maneuver]}.`, say); return; }
      if (id === 'A' && this.regulator) this.judgeRegulator(frame, entry, maneuver);
      this.advance(say);
    }
  }

  /** PDD 6.10: the manoeuvre must be permitted by the pose shown when the car entered the intersection (6.14 grace of 2 s). */
  private judgeRegulator(frame: ExamFrame, entry: { heading: number; time: number }, maneuver: Maneuver) {
    const dir = forwardOf(entry.heading);
    const allowedAt = (t: number) => { const phase = regulatorAt(t); return { phase, side: sideOf(phase.facing, dir), ok: allowedManeuvers(phase.pose, sideOf(phase.facing, dir)).includes(maneuver) }; };
    const now = allowedAt(entry.time), before = allowedAt(entry.time - 2);
    if (now.ok || before.ok) return;
    frame.judge.record('regulator', frame.time, frame.state, `Регулировщик: ${poseLabel[now.phase.pose]}, вы подъехали ${sideLabel[now.side]}. Манёвр «${maneuverLabel[maneuver]}» был запрещён.`, { situation: 'a-regulator' });
  }

  /** Brings the staged participant to the conflict point at about the same time as the learner. */
  private stage(frame: ExamFrame) {
    const { state, traffic } = frame, speed = Math.max(Math.abs(state.speed), 5), slot = this.step.slot;
    const once = (key: string, fn: () => void) => { if (!this.spawned.has(key)) { this.spawned.add(key); fn(); } };
    const moving = Math.abs(state.speed) > 1;
    if (slot === 'B' && state.z < -30 && moving) {
      const eta = Math.max(0, state.z + 77) / speed;
      if (this.selected.includes('b-right-hand')) once('b', () => traffic.spawn(westAtB, Math.max(-76, -9 - eta * 9 - 2), { v0: 9, color: '#b5654f' }));
      if (this.selected.includes('b-oncoming')) once('b', () => traffic.spawn(southFromB, Math.max(-126, -93 - eta * 9 - 2), { v0: 9, color: '#5f7f9a' }));
      if (this.selected.includes('b-tram')) once('b', () => traffic.spawn(tramTrack, Math.max(-70, -9 - eta * 8 - 7.5), { v0: 8, kind: 'tram', halfLength: 7.5, color: '#d24d3c' }));
    }
    if (slot === 'D' && state.z > -50 && state.x < -60 && moving && (this.selected.includes('d-yield') || this.selected.includes('d-stop'))) {
      const eta = Math.max(0, -10.5 - state.z) / speed + (this.stopSign ? 3 : 1);
      const lane = (id: string) => traffic.cars.find(c => c.lane.id === id)?.lane;
      once('d', () => {
        const west = lane('west'), east = lane('east');
        const free = (l: TrafficLane, s: number) => traffic.cars.every(c => c.lane !== l || Math.abs(c.s - s) > 14);
        if (west) { const s = 62 - eta * 11 - 2; if (free(west, s)) traffic.spawn(west, s, { color: '#7a8f6a' }); }
        if (east) { const s = Math.max(-124, -78 - (eta + 2) * 11 - 2); if (free(east, s)) traffic.spawn(east, s, { color: '#9a7fa6' }); }
      });
    }
    if (slot === 'A2' && this.selected.includes('a2-pedestrian') && state.x > -60 && state.z < 9 && moving) {
      once('peds', () => { this.pedestrians = [{ x: 7, z: CROSSWALK_Z - .5, dir: -1, speed: 1.25, waiting: false }, { x: -8.5, z: CROSSWALK_Z + .6, dir: 1, speed: 1, waiting: false }]; });
    }
  }

  private judgeYield(frame: ExamFrame) {
    for (const { car } of frame.forced) {
      if (this.yieldedCars.has(car.id)) continue;
      this.yieldedCars.add(car.id);
      const situation = this.currentSituation();
      const rule = situation === 'b-right-hand' ? { rule: 'ПДД 13.11', ruleIds: ['13.11', '1.2'], detail: 'Автомобиль справа на равнозначном перекрёстке был вынужден тормозить.' }
        : situation === 'b-oncoming' ? { rule: 'ПДД 13.12', ruleIds: ['13.12', '1.2'], detail: 'При повороте налево встречный автомобиль был вынужден тормозить.' }
        : situation === 'b-tram' || car.kind === 'tram' ? { rule: 'ПДД 13.11', ruleIds: ['13.11', '1.2'], detail: 'Трамвай, имеющий преимущество, был вынужден тормозить.' }
        : situation === 'd-stop' ? { rule: 'ПДД 13.9, знак 2.5', ruleIds: ['sign-2.5', '13.9', '1.2'], detail: 'Автомобиль на главной дороге был вынужден тормозить.' }
        : situation === 'd-yield' || this.step.slot === 'D' ? { rule: 'ПДД 13.9, знак 2.4', ruleIds: ['sign-2.4', '13.9', '1.2'], detail: 'Автомобиль на главной дороге был вынужден тормозить.' }
        : { rule: 'ПДД 1.2', ruleIds: ['1.2'], detail: 'Другой участник движения был вынужден резко тормозить из-за вашего манёвра.' };
      frame.judge.record('yield', frame.time, frame.state, rule.detail, { rule: rule.rule, ruleIds: rule.ruleIds, situation });
    }
  }

  /**
   * Sign 2.5: the car must stand still with its front just before the stop line, then cross it.
   * A stop further back (in a queue) or after the line does not count; backing away cancels an earlier stop.
   */
  private judgeStopSign(frame: ExamFrame) {
    if (!this.stopSign || this.stopChecked || this.step.slot !== 'D') return;
    const { state, prev } = frame;
    const [a, b] = stopLineD;
    if (state.x < a.x - 1 || state.x > b.x + 1 || Math.cos(state.heading) > -.7) return;
    const toLine = (p: Pose) => a.z - (p.z - Math.cos(p.heading) * FRONT_OFFSET);
    const now = toLine(state), before = toLine(prev);
    if (now > STOP_ZONE) this.stoppedAtLine = false;
    else if (now >= 0 && Math.abs(state.speed) < STOP_SPEED) this.stoppedAtLine = true;
    if (before >= 0 && now < 0) {
      this.stopChecked = true;
      if (!this.stoppedAtLine) frame.judge.record('stop-sign', frame.time, state, 'Перед стоп-линией нужна полная остановка у самой линии, даже если на главной дороге никого нет.', { situation: 'd-stop' });
    }
  }

  private updatePedestrians(frame: ExamFrame) {
    if (!this.pedestrians.length) return;
    const { state, dt } = frame;
    const carOnCrossing = Math.abs(state.z - CROSSWALK_Z) < 3.2 && Math.abs(state.x) < CROSSWALK_HALF + .5;
    for (const p of this.pedestrians) {
      // Pedestrians stop rather than walk into the car standing on their path.
      p.waiting = Math.abs(p.x + p.dir * 1.2 - state.x) < 1.6 && Math.abs(p.z - state.z) < 2.6;
      if (!p.waiting) p.x += p.dir * p.speed * dt;
      // A pedestrian crosses once and leaves the crossing at the far curb.
      if (Math.abs(p.x) > CROSSWALK_HALF) p.speed = 0;
      if (carOnCrossing && !this.pedestrianFlagged && pedestrianConflict(p, state)) {
        this.pedestrianFlagged = true;
        frame.judge.record('pedestrian', frame.time, state, 'Пешеход переходил проезжую часть, на которую вы поворачивали.', { situation: 'a2-pedestrian' });
      }
    }
    this.pedestrians = this.pedestrians.filter(p => p.speed > 0);
  }

  private judgeUTurn(frame: ExamFrame, say: string[]) {
    const { state, time, judge } = frame;
    if (!inside(uTurnZone, state)) {
      if (state.z > uTurnZone.z + uTurnZone.halfZ + 2) this.fail(frame, 'Разворот не выполнен.', say);
      return;
    }
    const fromSouthbound = wrap(state.heading - Math.PI);
    if (!this.uTurn.started && Math.abs(fromSouthbound) > .3) {
      this.uTurn.started = true;
      if (!judge.signalRecently('left', time)) judge.record('turn-signal', time, state, 'Перед разворотом не был включён левый указатель поворота.', { situation: 'u-turn' });
      if (state.x < -5.5) judge.record('u-turn', time, state, 'Разворот начат от правого края при достаточной ширине проезжей части.', { situation: 'u-turn' });
    }
    if (this.uTurn.started && Math.abs(wrap(state.heading)) < .5) this.advance(say);
  }
}
