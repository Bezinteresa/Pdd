import { distanceToStopLine, type Approach, type RoadMap } from './roads.ts';
import { permits, type Lamps } from './signals.ts';
import type { Obstacle, VehicleState } from './vehicle.ts';
import { COMFORT_DECEL } from './rules.ts';

// Scripted cars on straight lanes. Position s grows along the travel direction; lanes loop at the street ends.
export interface TrafficLane { id: string; approach: Approach; axis: 'x' | 'z'; sign: 1 | -1; offset: number; start: number; end: number; }
export interface TrafficCar { id: number; lane: TrafficLane; s: number; speed: number; color: string; }

const HALF_LENGTH = 2, HALF_WIDTH = .95;
// Intelligent Driver Model parameters: desired speed, time gap, jam distance, acceleration, comfortable braking.
const V0 = 11, T = 1.2, S0 = 2, A = 1.6, B = 2.5;

export function laneFromApproach(id: string, approach: Approach, start: number, end: number): TrafficLane {
  const axis = approach.dir.x !== 0 ? 'x' : 'z', sign = (approach.dir.x || approach.dir.z) as 1 | -1;
  const [a, b] = approach.stopLine; const offset = axis === 'x' ? (a.z + b.z) / 2 : (a.x + b.x) / 2;
  return { id, approach, axis, sign, offset, start, end };
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
  const p = carPosition(car); return car.lane.axis === 'x' ? { x: p.x, z: p.z, halfX: HALF_LENGTH, halfZ: HALF_WIDTH } : { x: p.x, z: p.z, halfX: HALF_WIDTH, halfZ: HALF_LENGTH };
}

function idm(speed: number, gap: number, leaderSpeed: number) {
  const desired = S0 + Math.max(0, speed * T + speed * (speed - leaderSpeed) / (2 * Math.sqrt(A * B)));
  return A * (1 - (speed / V0) ** 4 - (desired / Math.max(gap, .1)) ** 2);
}

export class TrafficSystem {
  cars: TrafficCar[] = [];
  constructor(lanes: TrafficLane[], layout: Record<string, number[]> = { east: [-100, -55, 45], west: [-95, -40, 60] }) {
    const colors = ['#b5654f', '#5f7f9a', '#d8c27a', '#7a8f6a', '#9a7fa6', '#e0dccf'];
    let id = 1;
    for (const lane of lanes) for (const s of layout[lane.id] ?? []) this.cars.push({ id, lane, s, speed: V0 * .8, color: colors[id++ % colors.length] });
  }

  /** Free gap from the car's front to the next thing it must not hit, with that thing's speed. */
  private constraint(car: TrafficCar, lamps: Lamps, player: Pick<VehicleState, 'x' | 'z' | 'heading' | 'speed'>): [number, number] {
    const lane = car.lane, length = lane.end - lane.start, front = car.s + HALF_LENGTH;
    let gap = Infinity, leaderSpeed = 0;
    for (const other of this.cars) {
      if (other === car || other.lane !== lane) continue;
      const d = (((other.s - car.s) % length) + length) % length - 2 * HALF_LENGTH;
      if (d < gap) { gap = d; leaderSpeed = other.speed; }
    }
    // Signal: hold before the stop line unless already committed (past it, or too close to stop comfortably on yellow).
    const toLine = distanceToStopLine(lane.approach, carPosition(car)) - HALF_LENGTH - .5;
    const lamp = lamps[lane.approach.group];
    const mustStop = !permits(lamp) && toLine > -.5 && !(lamp === 'yellow' && toLine < car.speed * car.speed / (2 * COMFORT_DECEL));
    if (mustStop && toLine < gap) { gap = Math.max(toLine, 0); leaderSpeed = 0; }
    // Player: anything overlapping the lane band ahead is treated as a stopped obstacle.
    const along = (lane.axis === 'x' ? player.x : player.z) * lane.sign, lateral = lane.axis === 'x' ? player.z : player.x;
    const c = Math.abs(Math.cos(player.heading)), s = Math.abs(Math.sin(player.heading));
    const extentAlong = lane.axis === 'x' ? s * 2.05 + c * .94 : c * 2.05 + s * .94;
    const extentSide = lane.axis === 'x' ? c * 2.05 + s * .94 : s * 2.05 + c * .94;
    if (Math.abs(lateral - lane.offset) < HALF_WIDTH + extentSide + .4) {
      const d = along - extentAlong - front;
      if (d > -HALF_LENGTH && d < gap) { gap = Math.max(d, 0); leaderSpeed = 0; }
    }
    return [gap, leaderSpeed];
  }

  step(dt: number, lamps: Lamps, player: Pick<VehicleState, 'x' | 'z' | 'heading' | 'speed'>) {
    const accelerations = this.cars.map(car => { const [gap, leaderSpeed] = this.constraint(car, lamps, player); return gap === Infinity ? A * (1 - (car.speed / V0) ** 4) : idm(car.speed, gap, leaderSpeed); });
    this.cars.forEach((car, i) => {
      car.speed = Math.max(0, car.speed + Math.max(-9, accelerations[i]) * dt);
      car.s += car.speed * dt;
      if (car.s > car.lane.end) car.s -= car.lane.end - car.lane.start;
    });
  }
  obstacles(): Obstacle[] { return this.cars.map(carObstacle); }
}
