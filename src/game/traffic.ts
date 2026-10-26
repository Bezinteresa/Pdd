import { distanceToStopLine, forwardOf, type Approach, type RoadMap } from './roads.ts';
import { permits, type Lamp, type Lamps } from './signals.ts';
import type { Obstacle, VehicleState } from './vehicle.ts';
import { COMFORT_DECEL } from './rules.ts';

// Scripted vehicles on straight lanes. Position s grows along the travel direction.
// Looping lanes wrap at the street ends; one-shot lanes (exam actors) drop the vehicle once it has left.
export interface TrafficLane { id: string; approach?: Approach; axis: 'x' | 'z'; sign: 1 | -1; offset: number; start: number; end: number; loop: boolean; }
export type VehicleKind = 'car' | 'tram';
export interface TrafficCar { id: number; lane: TrafficLane; s: number; speed: number; color: string; kind: VehicleKind; halfLength: number; v0: number; }
export type PlayerPose = Pick<VehicleState, 'x' | 'z' | 'heading' | 'speed'>;
/** A priority vehicle had to brake hard because of the learner: the core of "не уступил дорогу". */
export interface ForcedBrake { car: TrafficCar; decel: number; }

const HALF_WIDTH = .95;
// Intelligent Driver Model parameters: desired speed, time gap, jam distance, acceleration, comfortable braking.
const V0 = 11, T = 1.2, S0 = 2, A = 1.6, B = 2.5;
/** Braking harder than this because of the learner counts as being forced to change speed (PDD 1.2 «Уступить дорогу»). */
export const FORCED_DECEL = 1.5;

export function laneFromApproach(id: string, approach: Approach, start: number, end: number, loop = true): TrafficLane {
  const axis = approach.dir.x !== 0 ? 'x' : 'z', sign = (approach.dir.x || approach.dir.z) as 1 | -1;
  const [a, b] = approach.stopLine; const offset = axis === 'x' ? (a.z + b.z) / 2 : (a.x + b.x) / 2;
  return { id, approach, axis, sign, offset, start, end, loop };
}
export function crossStreetLanes(map: RoadMap) {
  const find = (id: string) => map.approaches.find(a => a.id === id)!;
  return [laneFromApproach('east', find('central-e'), -125, 125), laneFromApproach('west', find('central-w'), -125, 125)];
}
export function carPosition(car: TrafficCar) {
  const along = car.s * car.lane.sign;
  return car.lane.axis === 'x' ? { x: along, z: car.lane.offset, heading: car.lane.sign > 0 ? Math.PI / 2 : -Math.PI / 2 } : { x: car.lane.offset, z: along, heading: car.lane.sign > 0 ? Math.PI : 0 };
}
export function carObstacle(car: TrafficCar): Obstacle {
  const p = carPosition(car); return car.lane.axis === 'x' ? { x: p.x, z: p.z, halfX: car.halfLength, halfZ: HALF_WIDTH } : { x: p.x, z: p.z, halfX: HALF_WIDTH, halfZ: car.halfLength };
}

function idm(speed: number, v0: number, gap: number, leaderSpeed: number) {
  const desired = S0 + Math.max(0, speed * T + speed * (speed - leaderSpeed) / (2 * Math.sqrt(A * B)));
  return A * (1 - (speed / v0) ** 4 - (desired / Math.max(gap, .1)) ** 2);
}

export class TrafficSystem {
  cars: TrafficCar[] = [];
  private nextId = 1;
  constructor(lanes: TrafficLane[], layout: Record<string, number[]> = { east: [-100, -55, 45], west: [-95, -40, 60] }) {
    const colors = ['#b5654f', '#5f7f9a', '#d8c27a', '#7a8f6a', '#9a7fa6', '#e0dccf'];
    for (const lane of lanes) for (const s of layout[lane.id] ?? []) this.spawn(lane, s, { color: colors[this.nextId % colors.length], speed: V0 * .8 });
  }

  spawn(lane: TrafficLane, s: number, options: Partial<Pick<TrafficCar, 'color' | 'kind' | 'halfLength' | 'v0' | 'speed'>> = {}) {
    const car: TrafficCar = { id: this.nextId++, lane, s, speed: options.speed ?? options.v0 ?? V0, color: options.color ?? '#b5654f', kind: options.kind ?? 'car', halfLength: options.halfLength ?? 2, v0: options.v0 ?? V0 };
    this.cars.push(car); return car;
  }

  /** Free gap from the car's front to the next thing it must not hit, that thing's speed, and whether it is the learner. */
  private constraint(car: TrafficCar, signal: (approach: Approach) => Lamp, player: PlayerPose): [number, number, boolean] {
    const lane = car.lane, length = lane.end - lane.start, front = car.s + car.halfLength;
    let gap = Infinity, leaderSpeed = 0, byPlayer = false;
    for (const other of this.cars) {
      if (other === car || other.lane !== lane) continue;
      const raw = other.s - car.s, ahead = lane.loop ? ((raw % length) + length) % length : raw;
      if (ahead <= 0) continue;
      const d = ahead - car.halfLength - other.halfLength;
      if (d < gap) { gap = d; leaderSpeed = other.speed; }
    }
    // Signal: hold before the stop line unless already committed (past it, or too close to stop comfortably on yellow).
    if (lane.approach) {
      const toLine = distanceToStopLine(lane.approach, carPosition(car)) - car.halfLength - .5;
      const lamp = signal(lane.approach);
      const mustStop = !permits(lamp) && toLine > -.5 && !(lamp === 'yellow' && toLine < car.speed * car.speed / (2 * COMFORT_DECEL));
      if (mustStop && toLine < gap) { gap = Math.max(toLine, 0); leaderSpeed = 0; }
    }
    // Learner: anything overlapping the lane band ahead is treated as a stopped obstacle.
    const along = (lane.axis === 'x' ? player.x : player.z) * lane.sign, lateral = lane.axis === 'x' ? player.z : player.x;
    const c = Math.abs(Math.cos(player.heading)), s = Math.abs(Math.sin(player.heading));
    const extentAlong = lane.axis === 'x' ? s * 2.05 + c * .94 : c * 2.05 + s * .94;
    const extentSide = lane.axis === 'x' ? c * 2.05 + s * .94 : s * 2.05 + c * .94;
    if (Math.abs(lateral - lane.offset) < HALF_WIDTH + extentSide + .4) {
      const d = along - extentAlong - front;
      if (d > -car.halfLength && d < gap) { gap = Math.max(d, 0); leaderSpeed = 0; byPlayer = true; }
    }
    return [gap, leaderSpeed, byPlayer];
  }

  /** Advances all vehicles; returns hard braking forced by the learner crossing or entering a lane. */
  step(dt: number, lamps: Lamps, player: PlayerPose, signal: (approach: Approach) => Lamp = a => lamps[a.group]): ForcedBrake[] {
    const forced: ForcedBrake[] = [];
    const f = forwardOf(player.heading);
    const results = this.cars.map(car => {
      const [gap, leaderSpeed, byPlayer] = this.constraint(car, signal, player);
      const accel = gap === Infinity ? A * (1 - (car.speed / car.v0) ** 4) : idm(car.speed, car.v0, gap, leaderSpeed);
      return { accel, byPlayer };
    });
    this.cars.forEach((car, i) => {
      const { accel, byPlayer } = results[i];
      // Following the learner in the same lane is ordinary traffic, not a priority conflict.
      const laneDir = car.lane.axis === 'x' ? { x: car.lane.sign, z: 0 } : { x: 0, z: car.lane.sign };
      if (byPlayer && accel < -FORCED_DECEL && car.speed > 1 && f.x * laneDir.x + f.z * laneDir.z < .7) forced.push({ car, decel: -accel });
      car.speed = Math.max(0, car.speed + Math.max(-9, accel) * dt);
      car.s += car.speed * dt;
      if (car.lane.loop && car.s > car.lane.end) car.s -= car.lane.end - car.lane.start;
    });
    this.cars = this.cars.filter(car => car.lane.loop || car.s - car.halfLength < car.lane.end);
    return forced;
  }
  obstacles(): Obstacle[] { return this.cars.map(carObstacle); }
}
