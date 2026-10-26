import type { SignalGroup } from './signals.ts';

// Road layout as data: the 3D world, the HUD, traffic and the judge all read the same description.
// Coordinates: metres, x to the east, z to the south; heading 0 drives towards -z (north).
export interface Rect { x: number; z: number; halfX: number; halfZ: number; }
export interface Point { x: number; z: number; }
export interface Approach {
  id: string; name: string; intersection: string; group: SignalGroup;
  /** Unit vector of travel towards the intersection. */
  dir: Point;
  /** Stop line endpoints; the line spans the lanes of this approach only. */
  stopLine: [Point, Point];
  /** Traffic light heads facing this approach. */
  heads: Point[];
}
export interface Intersection { id: string; area: Rect; }
export interface SpeedZone { id: string; area: Rect; dir: Point; limit: number; signAt: Point; }
export interface RoadMap { roads: Rect[]; intersections: Intersection[]; approaches: Approach[]; crosswalks: Rect[]; speedZones: SpeedZone[]; defaultLimit: number; }

const rect = (x: number, z: number, width: number, depth: number): Rect => ({ x, z, halfX: width / 2, halfZ: depth / 2 });

export const cityMap: RoadMap = {
  roads: [rect(0, 10, 18, 276), rect(0, 0, 254, 18), rect(-70, -40, 16, 106), rect(70, -40, 16, 106), rect(0, -85, 156, 16), rect(0, 105, 126, 58)],
  intersections: [{ id: 'central', area: rect(0, 0, 18, 18) }],
  approaches: [
    { id: 'central-n', name: 'с юга', intersection: 'central', group: 'ns', dir: { x: 0, z: -1 }, stopLine: [{ x: .5, z: 20 }, { x: 8.5, z: 20 }], heads: [{ x: 10.3, z: 17 }, { x: -10.3, z: 17 }] },
    { id: 'central-s', name: 'с севера', intersection: 'central', group: 'ns', dir: { x: 0, z: 1 }, stopLine: [{ x: -8.5, z: -20 }, { x: -.5, z: -20 }], heads: [{ x: -10.3, z: -17 }, { x: 10.3, z: -17 }] },
    { id: 'central-e', name: 'с запада', intersection: 'central', group: 'ew', dir: { x: 1, z: 0 }, stopLine: [{ x: -20, z: .5 }, { x: -20, z: 8.5 }], heads: [{ x: -17, z: 10.3 }, { x: -17, z: -10.3 }] },
    { id: 'central-w', name: 'с востока', intersection: 'central', group: 'ew', dir: { x: -1, z: 0 }, stopLine: [{ x: 20, z: -8.5 }, { x: 20, z: -.5 }], heads: [{ x: 17, z: -10.3 }, { x: 17, z: 10.3 }] },
  ],
  crosswalks: [rect(0, 15, 16, 3.5), rect(0, -15, 16, 3.5), rect(15, 0, 3.5, 16), rect(-15, 0, 3.5, 16)],
  // Sign 3.24 at the end of the training-ground drive; the restriction ends at the intersection.
  speedZones: [{ id: 'school-30', area: { x: 4.5, z: 38.5, halfX: 4.5, halfZ: 18.5 }, dir: { x: 0, z: -1 }, limit: 30, signAt: { x: 10.5, z: 57 } }],
  // Settlement speed limit, PDD 10.2.
  defaultLimit: 60,
};

export const inside = (r: Rect, p: Point, margin = 0) => Math.abs(p.x - r.x) <= r.halfX + margin && Math.abs(p.z - r.z) <= r.halfZ + margin;
export const forwardOf = (heading: number): Point => ({ x: Math.sin(heading), z: -Math.cos(heading) });
const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;

export function onRoad(map: RoadMap, p: Point, margin = 0) { return map.roads.some(r => inside(r, p, margin)); }

/** Posted zone that applies to a car at this position heading this way, if any. */
export function activeZone(map: RoadMap, pose: Point & { heading: number }): SpeedZone | null {
  const f = forwardOf(pose.heading);
  return map.speedZones.find(zone => inside(zone.area, pose) && dot(zone.dir, f) > .5) ?? null;
}
export function speedLimitAt(map: RoadMap, pose: Point & { heading: number }) { return activeZone(map, pose)?.limit ?? map.defaultLimit; }

/** Signed distance along the approach direction from p to the stop line (positive: line still ahead). */
export function distanceToStopLine(approach: Approach, p: Point) {
  const [a] = approach.stopLine; return dot(approach.dir, { x: a.x - p.x, z: a.z - p.z });
}
/** Lateral offset of p inside the approach's stop-line span (0 = within the lanes). */
function lateralOutside(approach: Approach, p: Point) {
  const [a, b] = approach.stopLine; const along = { x: b.x - a.x, z: b.z - a.z }; const length = Math.hypot(along.x, along.z);
  const t = dot(along, { x: p.x - a.x, z: p.z - a.z }) / length;
  return t < 0 ? -t : t > length ? t - length : 0;
}

/** The approach the car is driving up to, used for the HUD hint. */
export function approachAhead(map: RoadMap, pose: Point & { heading: number }, range = 70): { approach: Approach; distance: number } | null {
  const f = forwardOf(pose.heading);
  const front = { x: pose.x + f.x * 2.05, z: pose.z + f.z * 2.05 };
  let best: { approach: Approach; distance: number } | null = null;
  for (const approach of map.approaches) {
    if (dot(approach.dir, f) < .7 || lateralOutside(approach, front) > 1) continue;
    const distance = distanceToStopLine(approach, front);
    if (distance < -1 || distance > range) continue;
    if (!best || distance < best.distance) best = { approach, distance };
  }
  return best;
}

/** 2D segment intersection, used for line crossing between two fixed steps. */
export function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point) {
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 <= 0) || (d1 < 0 && d2 >= 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Detects broken references and impossible bindings in map data. */
export function validateMap(map: RoadMap): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const approach of map.approaches) {
    if (ids.has(approach.id)) errors.push(`${approach.id}: повторяющийся идентификатор`); ids.add(approach.id);
    const crossing = map.intersections.find(i => i.id === approach.intersection);
    if (!crossing) { errors.push(`${approach.id}: нет перекрёстка ${approach.intersection}`); continue; }
    if (Math.abs(Math.hypot(approach.dir.x, approach.dir.z) - 1) > 1e-6) errors.push(`${approach.id}: направление не единичное`);
    for (const p of approach.stopLine) {
      if (!onRoad(map, p)) errors.push(`${approach.id}: стоп-линия вне проезжей части`);
      if (inside(crossing.area, p)) errors.push(`${approach.id}: стоп-линия внутри перекрёстка`);
    }
    // Seen from the intersection centre, the stop line must lie behind the direction of travel.
    if (distanceToStopLine(approach, crossing.area) >= 0) errors.push(`${approach.id}: стоп-линия за перекрёстком`);
    if (approach.heads.length === 0) errors.push(`${approach.id}: нет светофора`);
  }
  for (const zone of map.speedZones) if (!onRoad(map, zone.area)) errors.push(`${zone.id}: зона вне дороги`);
  return errors;
}
