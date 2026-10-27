import { approachAhead, distanceToStopLine, forwardOf, inside, maneuverThrough, onRoad, segmentsCross, speedLimitAt, type Approach, type Point, type RoadMap } from './roads.ts';
import { lampLabel, permits, type Lamp, type Lamps } from './signals.ts';
import type { VehicleState } from './vehicle.ts';

export type ViolationCode = 'belt' | 'speed' | 'red-light' | 'yellow-light' | 'turn-signal' | 'off-road' | 'collision' | 'yield' | 'stop-sign' | 'pedestrian' | 'regulator' | 'route' | 'u-turn';
export interface Violation { id: number; code: ViolationCode; time: number; x: number; z: number; title: string; detail: string; rule: string | null; ruleIds: string[]; situation?: string; }
export type TripEventKind = 'start' | 'stop' | 'stop-line' | 'enter-intersection' | 'exit-intersection' | 'signal' | 'collision';
export interface TripEvent { time: number; kind: TripEventKind; x: number; z: number; info?: string; }
export type Pose = Pick<VehicleState, 'x' | 'z' | 'heading'>;

// PDD references follow the Russian Traffic Rules; re-check wording against the current edition before release.
const catalog: Record<ViolationCode, { title: string; rule: string | null; ruleIds: string[] }> = {
  belt: { title: 'Движение без ремня безопасности', rule: 'ПДД 2.1.2', ruleIds: ['2.1.2'] },
  speed: { title: 'Превышение скорости', rule: 'ПДД 10.1, 10.2', ruleIds: ['10.2'] },
  'red-light': { title: 'Проезд на запрещающий сигнал', rule: 'ПДД 6.2, 6.13', ruleIds: ['6.2', '6.13'] },
  'yellow-light': { title: 'Проезд на жёлтый, когда можно было остановиться', rule: 'ПДД 6.2, 6.14', ruleIds: ['6.2', '6.14'] },
  'turn-signal': { title: 'Манёвр без указателя поворота', rule: 'ПДД 8.1, 8.2', ruleIds: ['8.1', '8.2'] },
  'off-road': { title: 'Выезд за пределы проезжей части', rule: 'ПДД 9.9', ruleIds: ['9.9'] },
  collision: { title: 'Столкновение', rule: 'ПДД 9.10, 10.1', ruleIds: [] },
  yield: { title: 'Не уступил дорогу', rule: 'ПДД 1.2, 13.9', ruleIds: ['1.2', '13.9'] },
  'stop-sign': { title: 'Проезд знака «STOP» без остановки', rule: 'ПДД, знак 2.5', ruleIds: ['sign-2.5'] },
  pedestrian: { title: 'Не уступил дорогу пешеходу', rule: 'ПДД 13.1', ruleIds: ['13.1'] },
  regulator: { title: 'Манёвр, запрещённый регулировщиком', rule: 'ПДД 6.10, 6.13', ruleIds: ['6.10', '6.13'] },
  route: { title: 'Не выполнено задание инспектора', rule: null, ruleIds: [] },
  'u-turn': { title: 'Разворот не из крайнего левого положения', rule: 'ПДД 8.5', ruleIds: ['8.5'] },
};

const HALF_WIDTH = .94, HALF_LENGTH = 2.05;
/** Comfortable deceleration used to decide whether stopping on yellow was possible without emergency braking. */
export const COMFORT_DECEL = 4;
const SPEED_TOLERANCE = 2, SPEED_HOLD = 1, SIGNAL_MEMORY = 6;

export function frontPoints(p: Pose): Point[] {
  const f = forwardOf(p.heading), r = { x: -f.z, z: f.x };
  const c = { x: p.x + f.x * HALF_LENGTH, z: p.z + f.z * HALF_LENGTH };
  return [c, { x: c.x + r.x * HALF_WIDTH, z: c.z + r.z * HALF_WIDTH }, { x: c.x - r.x * HALF_WIDTH, z: c.z - r.z * HALF_WIDTH }];
}

/**
 * Trip judge: turns fixed-step vehicle states into events and violations.
 * Every check is episode-based so one mistake is recorded once, not every frame.
 */
export class TripJudge {
  readonly violations: Violation[] = [];
  readonly events: TripEvent[] = [];
  /** Approaches whose stop line the car crossed forward without a violation. */
  readonly passedLegally = new Set<string>();
  private nextId = 1;
  private beltFlagged = false;
  private overSince: number | null = null;
  private speedFlagged = false;
  private offRoadFlagged = false;
  private moving = false;
  private armed = new Map<string, boolean>();
  private yellowCanStop = new Map<string, boolean>();
  private previousLamps = new Map<string, Lamp | null>();
  private signalSeen = { left: -Infinity, right: -Infinity };
  private inIntersection = new Map<string, { heading: number; at: Point; left: boolean; right: boolean }>();

  private map: RoadMap;
  constructor(map: RoadMap) { this.map = map; for (const a of map.approaches) this.armed.set(a.id, true); }

  private add(code: ViolationCode, time: number, at: Point, detail: string) { return this.record(code, time, at, detail); }
  /** Records a violation found by another checker (the exam), sharing ids and the trip log. */
  record(code: ViolationCode, time: number, at: Point, detail: string, override: Partial<Pick<Violation, 'title' | 'rule' | 'ruleIds' | 'situation'>> = {}) {
    const v: Violation = { id: this.nextId++, code, time, x: at.x, z: at.z, detail, ...catalog[code], ...override };
    this.violations.push(v); return v;
  }
  private event(kind: TripEventKind, time: number, at: Point, info?: string) { this.events.push({ kind, time, x: at.x, z: at.z, info }); }

  /** Whether the given turn signal was on within the last `window` seconds. */
  signalRecently(side: 'left' | 'right', time: number, window = SIGNAL_MEMORY) { return this.signalSeen[side] >= time - window; }

  /** Advance one fixed step. Returns violations recorded during this step. */
  /**
   * `lamps` gives the signal for each approach: either the shared signal groups, or a function that returns
   * the lamp per approach and null where no signal applies (unregulated approach, controller on duty).
   */
  update(prev: Pose, state: VehicleState, time: number, lamps: Lamps | ((approach: Approach) => Lamp | null), collided = false): Violation[] {
    const lampOf = typeof lamps === 'function' ? lamps : (a: Approach) => a.control === 'none' ? null : lamps[a.group];
    const before = this.violations.length;
    const speed = Math.abs(state.speed);

    if (!this.moving && speed > .5) { this.moving = true; this.event('start', time, state); }
    if (this.moving && speed < .05) { this.moving = false; this.event('stop', time, state); }

    // Belt: once per unbuckled episode.
    if (state.belt) this.beltFlagged = false;
    else if (speed > .5 && !this.beltFlagged) { this.beltFlagged = true; this.add('belt', time, state, 'Пристегнитесь до начала движения. Ремень обязателен для водителя и пассажиров.'); }

    // Speed: sustained excess above the active limit; the episode ends once back under the limit.
    const limit = speedLimitAt(this.map, state), kmh = speed * 3.6;
    if (kmh > limit + SPEED_TOLERANCE) {
      this.overSince ??= time;
      if (!this.speedFlagged && time - this.overSince >= SPEED_HOLD) { this.speedFlagged = true; this.add('speed', time, state, `Скорость ${Math.round(kmh)} км/ч при ограничении ${limit} км/ч.`); }
    } else if (kmh <= limit) { this.overSince = null; this.speedFlagged = false; }

    // Yellow onset: remember whether a comfortable stop was still possible for each approach.
    for (const approach of this.map.approaches) {
      const lamp = lampOf(approach);
      if (lamp === 'yellow' && this.previousLamps.get(approach.id) !== 'yellow') {
        const distance = Math.min(...frontPoints(state).map(p => distanceToStopLine(approach, p)));
        const ahead = approachAhead(this.map, state, 150)?.approach.id === approach.id;
        this.yellowCanStop.set(approach.id, ahead && distance > speed * speed / (2 * COMFORT_DECEL) + .5);
      }
      if (lamp !== 'yellow') this.yellowCanStop.delete(approach.id);
      this.previousLamps.set(approach.id, lamp);
    }

    // Stop lines: swept front points against each line, forward direction only.
    const from = frontPoints(prev), to = frontPoints(state), f = forwardOf(state.heading);
    for (const approach of this.map.approaches) {
      const lamp = lampOf(approach);
      if (!lamp) continue;
      const behind = Math.max(...to.map(p => distanceToStopLine(approach, p)));
      if (behind > 6) this.armed.set(approach.id, true);
      if (!this.armed.get(approach.id)) continue;
      const movingForward = state.speed > 0 && approach.dir.x * f.x + approach.dir.z * f.z > .3;
      if (!movingForward || !from.some((p, i) => segmentsCross(p, to[i], approach.stopLine[0], approach.stopLine[1]))) continue;
      this.armed.set(approach.id, false);
      this.event('stop-line', time, state, `${approach.id}: ${lamp}`);
      if (lamp === 'red' || lamp === 'redYellow') this.add('red-light', time, state, `Стоп-линия пересечена на ${lampLabel[lamp]} сигнал. Остановитесь перед стоп-линией и дождитесь зелёного.`);
      else if (lamp === 'yellow' && this.yellowCanStop.get(approach.id)) this.add('yellow-light', time, state, 'Жёлтый включился, когда до стоп-линии было достаточно места для плавной остановки. Продолжать движение можно, только если остановиться без экстренного торможения нельзя.');
      else if (permits(lamp) || lamp === 'yellow') this.passedLegally.add(approach.id);
    }

    // Turn signals: remember when each was last on; hazard lights do not indicate a turn.
    if (state.signal === 'left' || state.signal === 'right') {
      if (this.signalSeen[state.signal] < time - 1 / 30) this.event('signal', time, state, state.signal);
      this.signalSeen[state.signal] = time;
    }
    for (const crossing of this.map.intersections) {
      const isInside = inside(crossing.area, state), entry = this.inIntersection.get(crossing.id);
      if (isInside && !entry) { this.inIntersection.set(crossing.id, { heading: state.heading, at: { x: state.x, z: state.z }, left: this.signalSeen.left >= time - SIGNAL_MEMORY, right: this.signalSeen.right >= time - SIGNAL_MEMORY }); this.event('enter-intersection', time, state, crossing.id); }
      if (!isInside && entry) {
        this.inIntersection.delete(crossing.id); this.event('exit-intersection', time, state, crossing.id);
        const turn = maneuverThrough(crossing.area, entry.heading, state, entry.at);
        const side = turn === 'right' || turn === 'left' ? turn : null;
        if (side && !entry[side]) this.add('turn-signal', time, state, `${side === 'right' ? 'Правый' : 'Левый'} поворот выполнен без заблаговременно включённого указателя.`);
      }
    }

    // Leaving the carriageway: the car centre outside every road rectangle.
    if (onRoad(this.map, state, .3)) this.offRoadFlagged = false;
    else if (!this.offRoadFlagged) { this.offRoadFlagged = true; this.add('off-road', time, state, 'Автомобиль выехал на обочину, газон или тротуар.'); }

    if (collided) { this.event('collision', time, state); this.add('collision', time, state, 'Держите дистанцию и боковой интервал, снижайте скорость заранее.'); }

    return this.violations.slice(before);
  }
}
