import type { Point } from './roads.ts';

// Traffic controller (регулировщик), PDD 6.10. The pose and facing come from a fixed schedule of
// simulation time; permissions depend on which side of the controller the vehicle approaches from.
export type Pose = 'sides' | 'rightForward' | 'up';
export type Side = 'chest' | 'back' | 'left' | 'right';
export type Maneuver = 'straight' | 'right' | 'left' | 'uturn';
export interface RegulatorPhase { pose: Pose; facing: Point; duration: number; }

const EAST = { x: 1, z: 0 }, NORTH = { x: 0, z: -1 }, SOUTH = { x: 0, z: 1 };
export const regulatorSchedule: RegulatorPhase[] = [
  { pose: 'sides', facing: NORTH, duration: 14 },
  { pose: 'up', facing: NORTH, duration: 3 },
  { pose: 'sides', facing: EAST, duration: 14 },
  { pose: 'up', facing: EAST, duration: 3 },
  { pose: 'rightForward', facing: SOUTH, duration: 12 },
  { pose: 'up', facing: SOUTH, duration: 3 },
];
const cycle = regulatorSchedule.reduce((sum, p) => sum + p.duration, 0);

export function regulatorAt(t: number): RegulatorPhase {
  let local = ((t % cycle) + cycle) % cycle;
  for (const phase of regulatorSchedule) { if (local < phase.duration) return phase; local -= phase.duration; }
  return regulatorSchedule[0];
}

/** Side of the controller that a vehicle travelling in direction `dir` approaches from. */
export function sideOf(facing: Point, dir: Point): Side {
  const from = { x: -dir.x, z: -dir.z };
  const front = facing.x * from.x + facing.z * from.z;
  if (front > .7) return 'chest';
  if (front < -.7) return 'back';
  // The controller's right hand points to (-facing.z, facing.x) in this coordinate system (x east, z south).
  return -facing.z * from.x + facing.x * from.z > 0 ? 'right' : 'left';
}

/** Manoeuvres PDD 6.10 permits a non-rail vehicle from this side. */
export function allowedManeuvers(pose: Pose, side: Side): Maneuver[] {
  if (pose === 'sides') return side === 'left' || side === 'right' ? ['straight', 'right'] : [];
  if (pose === 'rightForward') return side === 'left' ? ['straight', 'right', 'left', 'uturn'] : side === 'chest' ? ['right'] : [];
  return [];
}

export const poseLabel: Record<Pose, string> = { sides: 'руки вытянуты в стороны', rightForward: 'правая рука вытянута вперёд', up: 'рука поднята вверх' };
export const sideLabel: Record<Side, string> = { chest: 'со стороны груди', back: 'со стороны спины', left: 'со стороны левого бока', right: 'со стороны правого бока' };
