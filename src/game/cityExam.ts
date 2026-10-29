import { edgeLength, rightOf, TRACK_OFFSET, type CityLayout, type CityNode } from './city.ts';
import { edgeKey, entryOf, exitFor, planExam, practicePlacement, shortestPath, turnAt, type DirEdge, type Placement } from './cityRoute.ts';
import { maneuverLabel, pedestrianConflict, situations, STOP_SPEED, STOP_ZONE, type ExamFrame, type ExamSession, type Pedestrian, type RouteStep, type SituationProgress, type StagedProps } from './exam.ts';
import { allowedManeuvers, poseLabel, regulatorAt, sideLabel, sideOf, type Maneuver } from './regulator.ts';
import { distanceToStopLine, forwardOf, inside, type Approach, type Point, type Rect } from './roads.ts';
import type { Violation } from './rules.ts';
import type { PlacedSign } from './signs.ts';
import { carPosition, FORCED_DECEL, type TrafficCar, type TrafficLane, type TrafficSystem } from './traffic.ts';

// The inspector exam in the city: five staged situations placed on the graph, a route through them,
// turn-by-turn commands by distance, and a new route (with a recorded error) when the learner goes elsewhere.

const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const unit = (from: Point, to: Point) => { const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const titleOf = (id: string) => situations.find(s => s.id === id)?.title ?? id;
const turnWord: Record<Maneuver, string> = { left: 'налево', right: 'направо', straight: 'прямо', uturn: 'на разворот' };
/** Exits of a four-way roundabout counted from the entry, driving anticlockwise. */
const exitWord: Record<Maneuver, string> = { right: 'первый', straight: 'второй', left: 'третий', uturn: 'четвёртый' };
/** The car on the roundabout keeps this speed, m/s. */
const RING_SPEED = 6;
/** Within this distance of its place a situation counts as started; commands become «через N метров». */
const SITUATION_RADIUS = 90, COMMAND_RANGE = 140;
export const CITY_START: DirEdge = ['n0_180', 'n0_90'];

export class CityExamRunner implements ExamSession {
  readonly selected: string[];
  /** Situation id when practising one situation in the city: the run ends right after it. */
  readonly practice: string | null;
  readonly plan: Placement[];
  readonly steps: RouteStep[];
  stepIndex = 0;
  finished = false;
  failReason: string | null = null;
  pedestrians: Pedestrian[] = [];
  command = 'Экзамен начался. Пристегнитесь и начинайте движение прямо.';
  /** The street the learner drives on, as a directed edge. */
  current: DirEdge;
  private city: CityLayout;
  private started = false;
  private path: DirEdge[] = [];
  private inNode: { id: string; heading: number; time: number } | null = null;
  private leaving: { id: string; heading: number; time: number } | null = null;
  private said = '';
  private state = new Map<string, 'active' | 'done'>();
  private spawned = new Set<string>();
  private yielded = new Set<number>();
  private stoppedAtLine = false;
  private stopChecked = false;
  private pedestrianFlagged = false;
  private uTurnStarted = false;
  private uTurnAligned = false;
  private finishEdge: DirEdge | null = null;
  private finishHold = 0;
  private startEdge: DirEdge;
  private lane: { want: 'left' | 'right'; held: number; checked: boolean; car: TrafficCar | null } | null = null;
  private circling: { theta: number; speed: number; travelled: number; entry: number; flagged: boolean } | null = null;
  private wrongWay = 0;
  private wrongFlagged = false;

  constructor(city: CityLayout, selected: string[], start: DirEdge = CITY_START, practice: string | null = null) {
    this.city = city;
    this.practice = practice;
    const single = practice ? practicePlacement(city, practice) : null;
    this.plan = practice ? (single ? [single] : []) : planExam(city, selected, start);
    if (single) start = entryOf(single);
    this.selected = this.plan.map(p => p.situation);
    this.steps = [...this.plan.map(p => ({ kind: p.kind === 'uturn' ? 'uturn' as const : 'node' as const, command: titleOf(p.situation) })),
      practice ? { kind: 'end' as const, command: 'Ситуация пройдена. Разберём, как получилось.' } : { kind: 'finish' as const, command: 'Остановка у правого края' }];
    const first = this.plan[0];
    if (first?.kind === 'start') {
      // The exam begins in the car park: the first task is already under way.
      start = first.edge!; this.state.set(first.situation, 'active');
      this.command = practice ? 'Выезжайте с парковки направо.' : 'Экзамен начался. Пристегнитесь и выезжайте с парковки направо.';
    } else if (practice) this.command = 'Начинайте движение.';
    this.startEdge = start;
    this.current = start;
    this.reroute();
  }

  /** Where the car stands at the start: in the car park, or in the right lane of the start street. */
  spawn(): Point & { heading: number } {
    if (this.plan[0]?.kind === 'start') return { ...this.city.parking.spawn };
    const edge = this.startEdge, a = this.city.nodes[edge[0]], b = this.city.nodes[edge[1]];
    return { ...this.lanePoint(edge, this.practice ? .12 : .5), heading: Math.atan2(b.x - a.x, -(b.z - a.z)) };
  }
  actors() {
    const c = this.circling; if (!c) return [];
    const n = this.city.nodes[this.city.roundabout.node], r = this.city.roundabout.lane;
    return [{ id: 'round-car', x: n.x + Math.cos(c.theta) * r, z: n.z + Math.sin(c.theta) * r, heading: c.theta, color: '#7fb7e6' }];
  }
  obstacles(): Rect[] { return this.actors().map(a => ({ x: a.x, z: a.z, halfX: 1.7, halfZ: 1.7 })); }

  get target(): Placement | null { return this.plan[this.stepIndex] ?? null; }
  /** Lane centre point on a directed edge at fraction t, in the right-hand lane. */
  lanePoint(edge: DirEdge, t: number, lateral?: number): Point {
    const a = this.city.nodes[edge[0]], b = this.city.nodes[edge[1]], d = unit(a, b), r = rightOf(d);
    const lane = lateral ?? this.city.edgeBetween(edge[0], edge[1])!.lane;
    return { x: a.x + (b.x - a.x) * t + r.x * lane, z: a.z + (b.z - a.z) * t + r.z * lane };
  }
  goal() {
    if (!this.finishEdge || this.finished) return null;
    const a = this.city.nodes[this.finishEdge[0]], b = this.city.nodes[this.finishEdge[1]];
    return { ...this.lanePoint(this.finishEdge, .5), heading: Math.atan2(b.x - a.x, -(b.z - a.z)) };
  }
  /** The route ahead as directed edges, for the city schema. */
  route(): DirEdge[] { return this.path; }

  progress(id: string): SituationProgress { const s = this.state.get(id); return s === 'done' ? 'done' : s === 'active' ? 'active' : 'pending'; }
  currentSituation(): string | undefined { const t = this.target; return t && this.state.get(t.situation) === 'active' ? t.situation : undefined; }
  attribute(v: Violation) { v.situation ??= this.currentSituation(); }

  props(): StagedProps {
    const signs: PlacedSign[] = [], stopLines: [Point, Point][] = [];
    let regulator: Point | null = null;
    for (const p of this.plan) {
      if (p.situation === 'd-stop') {
        const approach = this.city.approach(p.node!, p.inFrom!)!;
        const old = this.city.signs.find(s => s.id === `${approach.id}-priority`);
        if (old) signs.push({ ...old, code: '2.5' });
        stopLines.push(approach.stopLine);
      }
      if (p.situation === 'a-regulator') regulator = this.city.nodes[p.node!];
    }
    return { signs, stopLines, rails: [], regulator };
  }
  controlledByRegulator(approach: Approach) {
    const p = this.plan.find(q => q.situation === 'a-regulator');
    return !!p && approach.intersection === p.node;
  }

  private reroute() {
    const target = this.target;
    const goal: DirEdge | null = target ? entryOf(target) : this.finishEdge;
    this.path = goal ? shortestPath(this.city, this.current, goal) ?? [this.current] : [this.current];
  }

  update(frame: ExamFrame): string[] {
    const say: string[] = [];
    if (this.finished) return say;
    const { state } = frame;
    if (!this.started) { if (Math.abs(state.speed) > .5) { this.started = true; } else { this.speak(say, 'start', this.command); return say; } }
    this.trackNodes(frame, say);
    if (this.finished) return say;
    this.markActive(state);
    this.stage(frame);
    this.judgeYield(frame);
    this.judgeStopSign(frame);
    this.updatePedestrians(frame);
    this.judgeUTurn(frame, say);
    this.judgeZebra(frame, say);
    this.judgeLaneChange(frame, say);
    this.judgeAdjacent(frame, say);
    this.updateCircling(frame);
    this.judgeRoundabout(frame);
    if (this.finished) return say;
    this.updateCommand(state, say);
    this.checkFinish(frame, say);
    return say;
  }

  private speak(say: string[], key: string, text: string) { this.command = text; if (key !== this.said) { this.said = key; say.push(text); } }

  private nodeAt(p: Point): CityNode | undefined { return Object.values(this.city.nodes).find(n => inside(n.area, p)); }
  /** Neighbour of `node` lying in direction `d` from it. */
  private neighbourToward(node: CityNode, d: Point) {
    let best: string | undefined, bestDot = .7;
    for (const w of node.links) { const k = dot(unit(node, this.city.nodes[w]), d); if (k > bestDot) { bestDot = k; best = w; } }
    return best;
  }

  /**
   * Which street the car leaves a junction by is decided only once it is clearly inside one (4 m past the
   * junction box and within that street): a wide turn may clip the box edge of another street first.
   */
  private trackNodes(frame: ExamFrame, say: string[]) {
    const { state, time } = frame, node = this.nodeAt(state);
    if (node) {
      if (this.leaving?.id === node.id) { this.inNode = this.leaving; this.leaving = null; }
      else if (!this.inNode) this.inNode = { id: node.id, heading: state.heading, time };
      return;
    }
    if (this.inNode) { this.leaving = this.inNode; this.inNode = null; }
    if (!this.leaving) return;
    const entered = this.city.nodes[this.leaving.id];
    let out: string | undefined;
    for (const w of entered.links) {
      const o = unit(entered, this.city.nodes[w]), rel = { x: state.x - entered.x, z: state.z - entered.z };
      const along = dot(rel, o), across = Math.abs(rel.x * o.z - rel.z * o.x);
      const half = o.x !== 0 ? entered.area.halfX : entered.area.halfZ, width = this.city.edgeBetween(entered.id, w)!.width;
      if (along > half + 4 && across < width / 2 + 1.5) out = w;
    }
    // Far from the junction and in no street (off the road): fall back to the side it was left by.
    if (!out && Math.hypot(state.x - entered.x, state.z - entered.z) > 30) {
      const dx = (state.x - entered.x) / entered.area.halfX, dz = (state.z - entered.z) / entered.area.halfZ;
      out = this.neighbourToward(entered, Math.abs(dx) > Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) });
    }
    if (!out) return;
    const entry = this.leaving; this.leaving = null;
    // The street driven in on is known; the heading at the box edge is not reliable for drivers who start turning early.
    const from = this.current[1] === entered.id ? this.current[0] : this.neighbourToward(entered, { x: -forwardOf(entry.heading).x, z: -forwardOf(entry.heading).z }) ?? this.current[0];
    const actual: DirEdge = [entered.id, out], target = this.target;
    const maneuver = turnAt(this.city, from, entered.id, out);
    if (target?.kind === 'node' && target.node === entered.id && edgeKey(this.current) === edgeKey(entryOf(target))) {
      // The staged junction: judge it, then the situation is over whatever happened.
      if (maneuver !== target.maneuver) frame.judge.record('route', time, state, `Задание: ${maneuverLabel[target.maneuver!]}, выполнено: ${maneuverLabel[maneuver]}.`, { situation: target.situation });
      if (target.situation === 'a-regulator') this.judgeRegulator(frame, entry, maneuver, target);
      this.complete(target.situation, say);
    } else if (target?.kind === 'edge' && edgeKey(this.current) === edgeKey(target.edge!)) {
      // Reached the end of the street without doing the task there.
      frame.judge.record('route', time, state, target.situation === 'lane-change' ? 'Перестроение не выполнено до конца улицы.' : 'Задание на этой улице не выполнено.', { situation: target.situation });
      this.complete(target.situation, say);
    } else if (target?.kind === 'uturn' && edgeKey(this.current) === edgeKey(entryOf(target))) {
      frame.judge.record('route', time, state, 'Разворот не выполнен — вы доехали до перекрёстка.', { situation: target.situation });
      this.complete(target.situation, say);
    } else {
      const expected = this.path[1];
      if (expected && edgeKey(expected) !== edgeKey(actual)) frame.judge.record('route', time, state, `Задание было: ${turnWord[turnAt(this.city, from, entered.id, expected[1])]}, вы поехали ${turnWord[maneuver]}. Маршрут перестроен.`, { situation: this.currentSituation() });
    }
    this.current = actual;
    this.reroute();
  }

  private complete(id: string, say: string[]) {
    this.state.set(id, 'done');
    this.stepIndex++;
    this.stoppedAtLine = false; this.stopChecked = false; this.pedestrianFlagged = false; this.uTurnStarted = false; this.uTurnAligned = false;
    this.lane = null; this.wrongFlagged = false;
    if (this.practice) { this.finished = true; this.command = 'Ситуация пройдена. Разберём, как получилось.'; say.push(this.command); return; }
    if (!this.target && !this.finishEdge) this.chooseFinish();
  }

  private chooseFinish() {
    // Stop in the middle of the next block straight ahead (or to the right at the edge of the city).
    const [u, v] = this.current;
    const next = exitFor(this.city, u, v, 'straight') ?? exitFor(this.city, u, v, 'right') ?? exitFor(this.city, u, v, 'left');
    this.finishEdge = next ? [v, next] : this.current;
  }

  private markActive(state: Point) {
    const t = this.target; if (!t || this.state.has(t.situation)) return;
    const entry = entryOf(t), node = this.city.nodes[entry[1]];
    if (edgeKey(this.current) === edgeKey(entry) && (t.kind !== 'node' || Math.hypot(node.x - state.x, node.z - state.z) < SITUATION_RADIUS)) this.state.set(t.situation, 'active');
  }

  private updateCommand(state: VehiclePose, say: string[]) {
    const t = this.target;
    if (!t && this.finishEdge && edgeKey(this.current) === edgeKey(this.finishEdge)) { this.speak(say, 'finish', 'Остановитесь у правого края в зелёной зоне.'); return; }
    if (t?.kind === 'uturn' && edgeKey(this.current) === edgeKey(t.edge!)) { this.speak(say, `uturn-${t.situation}`, 'Развернитесь в удобном месте, где это разрешено.'); return; }
    if (t?.kind === 'start' && this.state.get(t.situation) === 'active') { this.speak(say, 'start', this.command); return; }
    if (t?.situation === 'lane-change' && this.lane) { this.speak(say, `lane-${this.lane.want}`, this.lane.want === 'left' ? 'Перестройтесь в левую полосу.' : 'Перестройтесь в правую полосу.'); return; }
    // First junction on the route where the learner has to do something: a turn, or the staged junction itself.
    let distance = Math.hypot(this.city.nodes[this.current[1]].x - state.x, this.city.nodes[this.current[1]].z - state.z);
    for (let i = 0; i < this.path.length; i++) {
      const [u, v] = this.path[i], next = this.path[i + 1];
      const staged = t?.kind === 'node' && i === this.path.length - 1 && v === t.node;
      const maneuver = staged ? t!.maneuver! : next ? turnAt(this.city, u, v, next[1]) : 'straight';
      // A bend of the ring road with no other way is not a command.
      const round = this.city.nodes[v].kind === 'round';
      if ((maneuver !== 'straight' && this.city.nodes[v].links.length > 2) || staged || round) {
        if (distance > COMMAND_RANGE) break;
        const near = distance < 30, metres = Math.max(20, Math.round(distance / 10) * 10);
        const text = round ? (near ? `На кольце — ${exitWord[maneuver]} съезд.` : `Через ${metres} метров круговое движение, ${exitWord[maneuver]} съезд.`) : maneuver === 'straight' ? (near ? 'На перекрёстке — прямо.' : `Через ${metres} метров на перекрёстке — прямо.`) : near ? `Поверните ${turnWord[maneuver]}.` : `Через ${metres} метров поверните ${turnWord[maneuver]}.`;
        this.speak(say, `${v}-${maneuver}-${near ? 'near' : 'far'}`, text);
        return;
      }
      if (next) distance += edgeLength(this.city, next[0], next[1]);
    }
    this.speak(say, `straight-${edgeKey(this.current)}`, 'Двигайтесь прямо до следующего указания.');
  }

  private checkFinish(frame: ExamFrame, say: string[]) {
    const goal = this.goal(); if (!goal || this.target) return;
    const d = unit(this.city.nodes[this.finishEdge![0]], this.city.nodes[this.finishEdge![1]]), r = rightOf(d);
    const rel = { x: frame.state.x - goal.x, z: frame.state.z - goal.z };
    const inZone = Math.abs(dot(rel, d)) < 4 && Math.abs(dot(rel, r)) < 1.8;
    this.finishHold = inZone && Math.abs(frame.state.speed) < .1 ? this.finishHold + frame.dt : 0;
    if (this.finishHold > 1) { this.finished = true; this.command = 'Экзамен окончен.'; say.push('Экзамен окончен. Поставьте автомобиль на ручник, разберём ошибки.'); }
  }

  /** Puts the staged participant on its way so it reaches the junction about when the learner does. */
  private stage(frame: ExamFrame) {
    const t = this.target, { state, traffic } = frame;
    if (!t || t.kind !== 'node' || this.spawned.has(t.situation) || Math.abs(state.speed) < 1) return;
    if (edgeKey(this.current) !== edgeKey(entryOf(t))) return;
    const node = this.city.nodes[t.node!], d = unit(this.city.nodes[t.inFrom!], node), r = rightOf(d);
    const toNode = Math.hypot(node.x - state.x, node.z - state.z);
    if (toNode > 70) return;
    this.spawned.add(t.situation);
    const eta = Math.max(0, toNode - 8) / Math.max(Math.abs(state.speed), 5);
    const streetLane = (dir: Point) => this.city.edgeBetween(node.id, this.neighbourToward(node, { x: -dir.x, z: -dir.z })!)?.lane ?? 3;
    const vehicle = (travel: Point, lateral: number, v0: number, extra: { kind?: 'tram'; halfLength?: number; color: string }) => stageVehicle(traffic, node, travel, lateral, eta, v0, extra, t.situation);
    if (t.situation === 'b-right-hand') vehicle({ x: -r.x, z: -r.z }, streetLane({ x: -r.x, z: -r.z }), 9, { color: '#b5654f' });
    if (t.situation === 'b-oncoming') vehicle({ x: -d.x, z: -d.z }, streetLane({ x: -d.x, z: -d.z }), 9, { color: '#5f7f9a' });
    if (t.situation === 'b-tram') vehicle(r, TRACK_OFFSET, 8, { kind: 'tram', halfLength: 7.5, color: '#d24d3c' });
    if (t.situation === 'd-yield' || t.situation === 'd-stop') {
      const wait = eta + (t.situation === 'd-stop' ? 3 : 1);
      for (const lane of new Set(traffic.cars.map(c => c.lane).filter(l => l.id === 'main-e' || l.id === 'main-w'))) {
        const along = lane.axis === 'x' ? node.x : node.z, half = lane.axis === 'x' ? node.area.halfX : node.area.halfZ;
        const s = along * lane.sign - half - wait * 11 - 2;
        if (traffic.cars.every(c => c.lane !== lane || Math.abs(c.s - s) > 14)) traffic.spawn(lane, s, { color: lane.id === 'main-e' ? '#9a7fa6' : '#7a8f6a' });
      }
    }
    if (t.situation === 'a2-pedestrian') {
      const o = unit(node, this.city.nodes[t.outTo!]), edge = this.city.edgeBetween(node.id, t.outTo!)!;
      const half = o.x !== 0 ? node.area.halfX : node.area.halfZ, c = { x: node.x + o.x * (half + 2.75), z: node.z + o.z * (half + 2.75) };
      const axis = o.x !== 0 ? 'z' : 'x', mid = axis === 'x' ? c.x : c.z, w = edge.width / 2 - .5;
      const at = (v: number) => axis === 'x' ? { x: v, z: c.z } : { x: c.x, z: v };
      this.pedestrians = [{ ...at(mid + w * .8), dir: -1, speed: 1.25, waiting: false, axis, min: mid - w, max: mid + w }, { ...at(mid - w), dir: 1, speed: 1, waiting: false, axis, min: mid - w, max: mid + w }];
    }
  }

  private judgeYield(frame: ExamFrame) {
    for (const { car } of frame.forced) {
      if (this.yielded.has(car.id)) continue;
      this.yielded.add(car.id);
      const s = this.currentSituation();
      const rule = s === 'b-right-hand' ? { rule: 'ПДД 13.11', ruleIds: ['13.11', '1.2'], detail: 'Автомобиль справа на равнозначном перекрёстке был вынужден тормозить.' }
        : s === 'b-oncoming' ? { rule: 'ПДД 13.12', ruleIds: ['13.12', '1.2'], detail: 'При повороте налево встречный автомобиль был вынужден тормозить.' }
        : s === 'b-tram' || car.kind === 'tram' ? { rule: 'ПДД 13.11', ruleIds: ['13.11', '1.2'], detail: 'Трамвай, имеющий преимущество, был вынужден тормозить.' }
        : s === 'd-stop' ? { rule: 'ПДД 13.9, знак 2.5', ruleIds: ['sign-2.5', '13.9', '1.2'], detail: 'Автомобиль на главной дороге был вынужден тормозить.' }
        : s === 'adjacent' ? { rule: 'ПДД 8.3', ruleIds: ['8.3', '1.2'], detail: 'Выезжая с парковки, вы вынудили тормозить автомобиль на дороге.' }
        : s === 'lane-change' ? { rule: 'ПДД 8.4', ruleIds: ['8.4', '1.2'], detail: 'Перестраиваясь, вы вынудили тормозить автомобиль, ехавший попутно.' }
        : s === 'd-yield' ? { rule: 'ПДД 13.9, знак 2.4', ruleIds: ['sign-2.4', '13.9', '1.2'], detail: 'Автомобиль на главной дороге был вынужден тормозить.' }
        : ['main', 'ring'].includes(this.nodeAt(frame.state)?.kind ?? '') ? { rule: 'ПДД 13.9, знак 2.4', ruleIds: ['sign-2.4', '13.9', '1.2'], detail: 'Выезжая со второстепенной дороги, вы вынудили тормозить автомобиль на главной.' }
        : this.nodeAt(frame.state)?.kind === 'signal' ? { rule: 'ПДД 13.4', ruleIds: ['13.4', '1.2'], detail: 'На регулируемом перекрёстке встречный или поперечный транспорт был вынужден тормозить: при повороте налево на зелёный уступите встречным.' }
        : { rule: 'ПДД 1.2', ruleIds: ['1.2'], detail: 'Другой участник движения был вынужден резко тормозить из-за вашего манёвра.' };
      frame.judge.record('yield', frame.time, frame.state, rule.detail, { rule: rule.rule, ruleIds: rule.ruleIds, situation: s });
    }
  }

  private judgeStopSign(frame: ExamFrame) {
    const t = this.target;
    if (t?.situation !== 'd-stop' || this.stopChecked || edgeKey(this.current) !== edgeKey(entryOf(t))) return;
    const approach = this.city.approach(t.node!, t.inFrom!)!, { state, prev } = frame;
    if (dot(forwardOf(state.heading), approach.dir) < .7) return;
    const front = (p: { x: number; z: number; heading: number }) => ({ x: p.x + forwardOf(p.heading).x * 2.05, z: p.z + forwardOf(p.heading).z * 2.05 });
    const now = distanceToStopLine(approach, front(state)), before = distanceToStopLine(approach, front(prev));
    if (now > STOP_ZONE) this.stoppedAtLine = false;
    else if (now >= 0 && Math.abs(state.speed) < STOP_SPEED) this.stoppedAtLine = true;
    if (before >= 0 && now < 0) {
      this.stopChecked = true;
      if (!this.stoppedAtLine) frame.judge.record('stop-sign', frame.time, state, 'Перед стоп-линией нужна полная остановка у самой линии, даже если на главной дороге никого нет.', { situation: 'd-stop' });
    }
  }

  private judgeRegulator(frame: ExamFrame, entry: { heading: number; time: number }, maneuver: Maneuver, t: Placement) {
    const dir = unit(this.city.nodes[t.inFrom!], this.city.nodes[t.node!]);
    const allowedAt = (time: number) => { const phase = regulatorAt(time), side = sideOf(phase.facing, dir); return { phase, side, ok: allowedManeuvers(phase.pose, side).includes(maneuver) }; };
    const now = allowedAt(entry.time), before = allowedAt(entry.time - 2);
    if (now.ok || before.ok) return;
    frame.judge.record('regulator', frame.time, frame.state, `Регулировщик: ${poseLabel[now.phase.pose]}, вы подъехали ${sideLabel[now.side]}. Манёвр «${maneuverLabel[maneuver]}» был запрещён.`, { situation: 'a-regulator' });
  }

  private updatePedestrians(frame: ExamFrame) {
    if (!this.pedestrians.length) return;
    const { state, dt } = frame;
    for (const p of this.pedestrians) {
      const along = p.axis === 'z' ? 'z' : 'x', across = along === 'x' ? 'z' : 'x';
      p.waiting = Math.abs(p[along] + p.dir * 1.2 - state[along]) < 1.6 && Math.abs(p[across] - state[across]) < 2.6;
      if (!p.waiting) p[along] += p.dir * p.speed * dt;
      // In the city a pedestrian crosses once and leaves the crossing at the far curb.
      if (p[along] > p.max! || p[along] < p.min!) p.speed = 0;
      const onCrossing = state[along] > p.min! - 1 && state[along] < p.max! + 1;
      if ((p.situation ?? 'a2-pedestrian') === 'a2-pedestrian' && onCrossing && !this.pedestrianFlagged && pedestrianConflict(p, state)) {
        this.pedestrianFlagged = true;
        frame.judge.record('pedestrian', frame.time, state, 'Пешеход переходил проезжую часть, на которую вы поворачивали.', { situation: 'a2-pedestrian' });
      }
    }
    this.pedestrians = this.pedestrians.filter(p => p.speed > 0);
  }

  private judgeUTurn(frame: ExamFrame, say: string[]) {
    const t = this.target;
    if (t?.kind !== 'uturn' || edgeKey(this.current) !== edgeKey(t.edge!) || this.inNode) return;
    const { state, time, judge } = frame, a = this.city.nodes[t.edge![0]], b = this.city.nodes[t.edge![1]];
    const d = unit(a, b), heading = Math.atan2(d.x, -d.z), deviation = Math.abs(wrap(state.heading - heading));
    // Count the start only after the car has settled along the street (it may still be finishing the turn into it).
    if (deviation < .15) this.uTurnAligned = true;
    if (!this.uTurnStarted && this.uTurnAligned && deviation > .3) {
      this.uTurnStarted = true;
      if (!judge.signalRecently('left', time)) judge.record('turn-signal', time, state, 'Перед разворотом не был включён левый указатель поворота.', { situation: 'u-turn' });
      const lateral = dot({ x: state.x - a.x, z: state.z - a.z }, rightOf(d)), lane = this.city.edgeBetween(a.id, b.id)!.lane;
      if (lateral > lane * .75) judge.record('u-turn', time, state, 'Разворот начат от правого края при достаточной ширине проезжей части.', { situation: 'u-turn' });
    }
    if (this.uTurnStarted && deviation > Math.PI - .5) {
      this.current = [b.id, a.id];
      this.complete(t.situation, say);
      this.reroute();
    }
  }
  private zebraOf(t: Placement) { return this.city.zebras.find(z => edgeKey(z.edge) === edgeKey(t.edge!) || edgeKey([z.edge[1], z.edge[0]]) === edgeKey(t.edge!))!; }

  /** PDD 14.1: a pedestrian steps onto the zebra as the learner comes; driving over it while they cross is an error. */
  private judgeZebra(frame: ExamFrame, say: string[]) {
    const t = this.target;
    if (t?.situation !== 'crosswalk' || t.kind !== 'edge' || edgeKey(this.current) !== edgeKey(t.edge!) || this.inNode) return;
    const { state } = frame, zebra = this.zebraOf(t), a = this.city.nodes[t.edge![0]], b = this.city.nodes[t.edge![1]], d = unit(a, b), r = rightOf(d);
    const half = this.city.edgeBetween(a.id, b.id)!.width / 2;
    const past = dot({ x: state.x - zebra.at.x, z: state.z - zebra.at.z }, d);
    if (!this.spawned.has('crosswalk') && past > -45 && past < -18 && Math.abs(state.speed) > 1) {
      this.spawned.add('crosswalk');
      // From the far kerb towards the learner's lane: they are on the carriageway and coming when the learner arrives.
      const walk = zebra.axis === 'x' ? 'z' : 'x', centre = zebra.at[walk], side = -Math.sign(r[walk]) as 1 | -1, reach = half + 1.2;
      const at = (v: number) => walk === 'x' ? { x: v, z: zebra.at.z } : { x: zebra.at.x, z: v };
      this.pedestrians = [...this.pedestrians, { ...at(centre + side * reach), dir: (-side) as 1 | -1, speed: 1.3, waiting: false, axis: walk, min: centre - reach, max: centre + reach, situation: 'crosswalk' }];
    }
    if (past > 6) { this.complete(t.situation, say); return; }
    if (Math.abs(past) > 4 || Math.abs(state.speed) < .3 || this.pedestrianFlagged) return;
    for (const p of this.pedestrians) {
      if (p.situation !== 'crosswalk') continue;
      const walk = p.axis === 'z' ? 'z' : 'x', offset = p[walk] - state[walk], approaching = offset * p.dir < 0;
      const onCarriageway = Math.abs(p[walk] - zebra.at[walk]) < half + .3;
      if (onCarriageway && (Math.abs(offset) < 1.6 || (approaching && Math.abs(offset) < half + 1))) {
        this.pedestrianFlagged = true;
        frame.judge.record('pedestrian', frame.time, state, 'Пешеход переходил дорогу по нерегулируемому переходу, а вы проехали, не уступив ему.', { rule: 'ПДД 14.1', ruleIds: ['14.1'], situation: 'crosswalk' });
      }
    }
  }

  /** PDD 8.1, 8.4: a lane change on command — signal first, and let the car coming up in that lane pass. */
  private judgeLaneChange(frame: ExamFrame, say: string[]) {
    const t = this.target;
    if (t?.situation !== 'lane-change' || t.kind !== 'edge' || edgeKey(this.current) !== edgeKey(t.edge!) || this.inNode) return;
    const { state, time, judge, traffic } = frame, a = this.city.nodes[t.edge![0]], b = this.city.nodes[t.edge![1]], d = unit(a, b), r = rightOf(d);
    const rel = { x: state.x - a.x, z: state.z - a.z }, lateral = dot(rel, r), into = dot(rel, d);
    if (!this.lane) {
      if (into < 12 || Math.abs(state.speed) < 1) return;
      const want = lateral > 4 ? 'left' as const : 'right' as const;
      this.lane = { want, held: 0, checked: false, car: null };
      // A faster car comes up from behind in the lane the learner has to move into.
      const axis = d.x !== 0 ? 'x' : 'z', sign = (Math.sign(d.x) || Math.sign(d.z)) as 1 | -1, laneOffset = want === 'left' ? 2 : 6;
      const offset = axis === 'x' ? a.z + r.z * laneOffset : a.x + r.x * laneOffset, s = state[axis] * sign;
      const approaches = this.city.map.approaches.filter(p => p.dir.x === d.x && p.dir.z === d.z && Math.abs((axis === 'x' ? p.stopLine[0].z : p.stopLine[0].x) - offset) < 8);
      const lane: TrafficLane = { id: 'stage-lane-change', axis, sign, offset, start: s - 40, end: s + 220, loop: false, approaches };
      this.lane.car = traffic.spawn(lane, s - 28, { v0: 15, speed: 15, color: '#f4a7b9' });
    }
    const inTarget = this.lane.want === 'left' ? lateral < 4 : lateral > 4;
    if (inTarget && !this.lane.checked) {
      this.lane.checked = true;
      if (!judge.signalRecently(this.lane.want, time)) judge.record('turn-signal', time, state, 'Перед перестроением не был включён указатель поворота.', { situation: 'lane-change' });
      const car = this.lane.car;
      if (car && traffic.cars.includes(car)) {
        const p = carPosition(car), gap = dot({ x: state.x - p.x, z: state.z - p.z }, d) - 2.05 - car.halfLength;
        if (gap > -6 && gap < car.speed + 4) judge.record('yield', time, state, 'Перестраиваясь, вы не уступили автомобилю, который ехал попутно по той полосе.', { rule: 'ПДД 8.4', ruleIds: ['8.4', '1.2'], situation: 'lane-change' });
      }
    }
    this.lane.held = inTarget ? this.lane.held + frame.dt : 0;
    if (this.lane.held > 1.5) this.complete(t.situation, say);
  }

  /** PDD 8.3: leaving the car park, give way to the pedestrian on the pavement and to the cars on the avenue. */
  private judgeAdjacent(frame: ExamFrame, say: string[]) {
    const t = this.target;
    if (t?.kind !== 'start' || this.state.get(t.situation) !== 'active') return;
    const { state, traffic } = frame, P = this.city.parking;
    if (!this.spawned.has('adjacent') && Math.abs(state.speed) > .3) {
      this.spawned.add('adjacent');
      const lane = traffic.cars.find(c => c.lane.id === 'avenue-n')?.lane;
      const s = -(P.driveway.z + 38);
      if (lane && traffic.cars.every(c => c.lane !== lane || Math.abs(c.s - s) > 14)) traffic.spawn(lane, s, { speed: 9, color: '#c3a6e6' });
      const kerb = P.driveway.x - P.driveway.halfX + 1.3;
      this.pedestrians = [...this.pedestrians, { x: kerb, z: P.driveway.z + 13, dir: -1, speed: 1.2, waiting: false, axis: 'z', min: P.driveway.z - 14, max: P.driveway.z + 14, situation: 'adjacent' }];
    }
    for (const p of this.pedestrians) {
      if (p.situation !== 'adjacent' || this.pedestrianFlagged || !pedestrianConflict(p, state)) continue;
      this.pedestrianFlagged = true;
      frame.judge.record('pedestrian', frame.time, state, 'Выезжая с парковки, вы не уступили пешеходу на тротуаре.', { rule: 'ПДД 8.3', ruleIds: ['8.3'], situation: 'adjacent' });
    }
    const exit = this.city.nodes[P.exit[1]], from = this.city.nodes[P.exit[0]], d = unit(from, exit), heading = Math.atan2(d.x, -d.z);
    const onStreet = Math.abs(state.x - from.x) < 8, past = dot({ x: state.x - P.driveway.x, z: state.z - P.driveway.z }, d);
    if (onStreet && past > 10 && Math.abs(wrap(state.heading - heading)) < .4) this.complete(t.situation, say);
    else if (onStreet && past < -14 && Math.abs(wrap(state.heading - heading)) > 2.6) {
      frame.judge.record('route', frame.time, state, 'Задание: выехать направо, выполнено: налево.', { situation: 'adjacent' });
      this.complete(t.situation, say);
    }
  }

  /** The car already on the roundabout: it arrives at the learner's entry about when they do and brakes for them. */
  private updateCircling(frame: ExamFrame) {
    const t = this.target, { state, dt } = frame, R = this.city.roundabout, node = this.city.nodes[R.node];
    if (t?.situation === 'roundabout' && t.kind === 'node' && !this.spawned.has('round-car') && edgeKey(this.current) === edgeKey(entryOf(t)) && Math.abs(state.speed) > 1) {
      const toNode = Math.hypot(node.x - state.x, node.z - state.z);
      if (toNode < 75) {
        this.spawned.add('round-car');
        const d = unit(this.city.nodes[t.inFrom!], node), entry = Math.atan2(-d.z, -d.x);
        const eta = Math.max(0, toNode - 15) / Math.max(Math.abs(state.speed), 5);
        this.circling = { theta: entry + eta * RING_SPEED / R.lane + .15, speed: RING_SPEED, travelled: 0, entry, flagged: false };
      }
    }
    const c = this.circling; if (!c) return;
    const rel = { x: state.x - node.x, z: state.z - node.z }, dist = Math.hypot(rel.x, rel.z), thetaL = Math.atan2(rel.z, rel.x);
    let gap = Infinity;
    if (Math.abs(dist - R.lane) < 4) { const ahead = ((c.theta - thetaL) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); if (ahead < Math.PI) gap = ahead * R.lane - 4.2; }
    const desired = 2 + c.speed * 1.2;
    const accel = 1.6 * (1 - (c.speed / RING_SPEED) ** 4 - (gap === Infinity ? 0 : (desired / Math.max(gap, .1)) ** 2));
    // Braking hard for a learner who has just come in at their entry: they did not give way (PDD 13.11(1)).
    if (accel < -FORCED_DECEL && c.speed > 1 && !c.flagged && Math.abs(wrap(thetaL - c.entry)) < .8) {
      c.flagged = true;
      frame.judge.record('yield', frame.time, state, 'Въезжая на круговое движение, вы не уступили автомобилю, который уже ехал по кругу.', { rule: 'ПДД 13.11(1)', ruleIds: ['13.11(1)', '1.2'], situation: this.currentSituation() ?? 'roundabout' });
    }
    c.speed = Math.max(0, c.speed + Math.max(-9, accel) * dt);
    const step = c.speed * dt / R.lane; c.theta -= step; c.travelled += step;
    if (c.travelled > 2.2 * Math.PI) this.circling = null;
  }

  /** Sign 4.3: round the island anticlockwise (seen from above), keeping it on the left. */
  private judgeRoundabout(frame: ExamFrame) {
    const { state } = frame, node = this.nodeAt(state);
    if (node?.kind !== 'round' || Math.abs(state.speed) < 1) { this.wrongWay = 0; return; }
    const rel = { x: state.x - node.x, z: state.z - node.z }, f = forwardOf(state.heading), dist = Math.hypot(rel.x, rel.z);
    if (dist < this.city.roundabout.island + 1) return;
    const turning = rel.x * f.z - rel.z * f.x;
    this.wrongWay = turning > .45 * dist ? this.wrongWay + frame.dt : 0;
    if (this.wrongWay > .6 && !this.wrongFlagged) {
      this.wrongFlagged = true;
      frame.judge.record('route', frame.time, state, 'По кольцу нужно двигаться против часовой стрелки, оставляя островок слева.', { title: 'Движение по кругу в обратном направлении', rule: 'Знак 4.3', ruleIds: ['sign-4.3'], situation: this.currentSituation() });
    }
  }

}
type VehiclePose = { x: number; z: number; heading: number };

/** One-shot vehicle that drives `travel` through `node`, in the lane `lateral` metres right of the centre line. */
function stageVehicle(traffic: TrafficSystem, node: CityNode, travel: Point, lateral: number, eta: number, v0: number, extra: { kind?: 'tram'; halfLength?: number; color: string }, id: string) {
  const axis = travel.x !== 0 ? 'x' : 'z', sign = (Math.sign(travel.x) || Math.sign(travel.z)) as 1 | -1, r = rightOf(travel);
  const offset = axis === 'x' ? node.z + r.z * lateral : node.x + r.x * lateral;
  const along = axis === 'x' ? node.x : node.z, half = axis === 'x' ? node.area.halfX : node.area.halfZ, halfLength = extra.halfLength ?? 2;
  const s0 = along * sign - half - eta * v0 - halfLength;
  const lane: TrafficLane = { id: `stage-${id}`, axis, sign, offset, start: s0 - 5, end: along * sign + 160, loop: false };
  traffic.spawn(lane, s0, { v0, speed: v0, kind: extra.kind ?? 'car', halfLength, color: extra.color });
}
