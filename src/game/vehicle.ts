export type Gear = 'P' | 'R' | 'N' | 'D';
export interface VehicleState { x: number; z: number; heading: number; speed: number; steer: number; acceleration: number; gear: Gear; handbrake: boolean; belt: boolean; signal: 'left' | 'right' | 'hazard' | null; distance: number; }
export interface DriveInput { throttle: number; brake: number; steer: number; }
export interface Obstacle { x: number; z: number; halfX: number; halfZ: number; }
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function initialVehicle(): VehicleState { return { x: 4, z: 108, heading: 0, speed: 0, steer: 0, acceleration: 0, gear: 'P', handbrake: true, belt: false, signal: null, distance: 0 }; }
export function selectGear(state: VehicleState, gear: Gear, brake: number): string | null {
  if (state.gear === gear) return null;
  if (Math.abs(state.speed) > 0.3 && (gear === 'P' || gear === 'R' || (gear === 'D' && state.speed < 0))) return 'Сначала полностью остановитесь';
  if ((state.gear === 'P' || gear === 'R' || gear === 'D') && brake < 0.25) return 'Для переключения удерживайте тормоз';
  state.gear = gear;
  return null;
}
// SAT: oriented car rectangle against an axis-aligned obstacle. Visual body roll does not affect this footprint.
export function overlapsCar(state: Pick<VehicleState, 'x' | 'z' | 'heading'>, box: Obstacle): boolean {
  const c = Math.cos(state.heading), s = Math.sin(state.heading);
  const dx = box.x - state.x, dz = box.z - state.z;
  const width = 0.94, length = 2.05;
  return Math.abs(dx) < box.halfX + Math.abs(c) * width + Math.abs(s) * length &&
    Math.abs(dz) < box.halfZ + Math.abs(s) * width + Math.abs(c) * length &&
    Math.abs(dx * c + dz * s) < width + box.halfX * Math.abs(c) + box.halfZ * Math.abs(s) &&
    Math.abs(dx * s - dz * c) < length + box.halfX * Math.abs(s) + box.halfZ * Math.abs(c);
}
/** Edges of the drivable world; beyond them the car stops as at a wall. */
export interface WorldBounds { minX: number; maxX: number; minZ: number; maxZ: number; }
export const districtBounds: WorldBounds = { minX: -145, maxX: 145, minZ: -145, maxZ: 149 };
export function stepVehicle(state: VehicleState, input: DriveInput, dt: number, obstacles: Obstacle[], bounds: WorldBounds = districtBounds): boolean {
  const previousSpeed = state.speed;
  const steeringTarget = clamp(input.steer, -1, 1);
  state.steer += (steeringTarget - state.steer) * (1 - Math.exp(-9 * dt));
  if (state.gear === 'P') state.speed = 0;
  else {
    const direction = state.gear === 'D' ? 1 : state.gear === 'R' ? -1 : 0;
    const gas = clamp(input.throttle, 0, 1), brake = clamp(input.brake, 0, 1);
    const creep = direction !== 0 && gas < 0.05 && brake < 0.01 && Math.abs(state.speed) < 1.2 ? 0.65 : 0;
    const drive = direction * (gas * (state.gear === 'R' ? 2.6 : 3.8) + creep);
    const drag = 0.1 + 0.012 * state.speed * state.speed;
    state.speed += drive * dt;
    const slowdown = (drag + brake * 7.5 + (state.handbrake ? 12 : 0)) * dt;
    state.speed = Math.sign(state.speed) * Math.max(0, Math.abs(state.speed) - slowdown);
    state.speed = clamp(state.speed, -5.5, 22);
  }
  // Up to ~34° at the wheels when slow: a turning circle of about 8 m, enough to turn back on a 16 m street.
  const wheelAngle = state.steer * (0.6 / (1 + Math.abs(state.speed) * 0.055));
  const newHeading = state.heading + state.speed / 2.65 * Math.tan(wheelAngle) * dt;
  const next = { x: state.x + Math.sin(newHeading) * state.speed * dt, z: state.z - Math.cos(newHeading) * state.speed * dt, heading: newHeading };
  const hit = next.x < bounds.minX || next.x > bounds.maxX || next.z < bounds.minZ || next.z > bounds.maxZ || obstacles.some(o => overlapsCar(next, o));
  if (hit) state.speed = 0;
  else { state.x = next.x; state.z = next.z; state.heading = newHeading; state.distance += Math.abs(state.speed) * dt; }
  state.acceleration = clamp((state.speed - previousSpeed) / dt, -10, 6);
  return hit && Math.abs(previousSpeed) > 0.5;
}
