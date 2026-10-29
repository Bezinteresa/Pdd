import { projectOnPath, type Approach, type Point, type Rect, type RoadMap, type SpeedZone } from './roads.ts';
import type { PlacedSign } from './signs.ts';
import { makeLanePath, type TrafficLane } from './traffic.ts';

// The exam city: a grid of streets built from data. Geometry, the judge's road map, signs and AI lanes
// all come from the same graph, so a new situation type only needs a node of the right kind.
//
// Layout (x east, z south, 90 m blocks, 7×7 crossings from -270 to 270):
//   column x = 0      — avenue with traffic lights at every inner crossing;
//   row    z = -90    — main road (sign 2.1), side streets meet it with sign 2.4;
//   row    z = 90     — tram avenue, equal crossings, tram tracks in the middle;
//   row    z = 0      — wide street (U-turns), equal crossings left and right of the avenue;
//   other lines       — ordinary two-lane streets with equal crossings.
// Districts: the centre (lights, tram, main road), the Upper Town on a hill in the north-east (x 90…270,
// z -270…-180, 9 m up, streets climb to it), and the ring road at ±360 with 70 km/h, joined by six roads
// (lines -180, 0, 180) where the ring has priority.

export type StreetKind = 'street' | 'avenue' | 'main' | 'tram' | 'ring';
export type NodeKind = 'signal' | 'main' | 'tram' | 'equal' | 'ring' | 'bend' | 'round';
export interface CityNode {
  id: string; x: number; z: number; kind: NodeKind; links: string[]; area: Rect;
  /** Height of the crossing above the plain, metres. */
  y: number;
  /** Axis of the priority road through a 'main' or 'ring' crossing. */
  mainAxis?: 'x' | 'z';
}
export interface CityEdge {
  id: string; a: string; b: string; kind: StreetKind; axis: 'x' | 'z'; width: number; lane: number;
  /** Centre line from `a` to `b` when the street is curved (the ring road); straight streets have none. */
  path?: Point[];
}
export interface District { id: string; name: string; area: Rect; }
/** Unregulated pedestrian crossing in the middle of a street (signs 5.19.1/5.19.2). */
export interface Zebra { edge: [string, string]; rect: Rect; axis: 'x' | 'z'; at: Point; }
/** Car park by the start street: the learner leaves it onto the avenue (adjacent territory, PDD 8.3). */
export interface Parking { area: Rect; driveway: Rect; spawn: { x: number; z: number; heading: number }; exit: [string, string]; stalls: Point[]; }
export interface CityLayout {
  spacing: number;
  nodes: Record<string, CityNode>;
  edges: CityEdge[];
  map: RoadMap;
  signs: PlacedSign[];
  lots: Rect[];
  tracks: { offset: number; from: number; to: number }[];
  districts: District[];
  zebras: Zebra[];
  parking: Parking;
  /** Roundabout crossings: centre island radius and the ring lane radius. */
  roundabout: { node: string; island: number; lane: number };
  /** Raised ground the Upper Town stands on. */
  plateaus: (Rect & { y: number })[];
  /** Ground height at a point: streets climb linearly between crossings of different height. */
  height(x: number, z: number): number;
  /** The ring road's centre line, closed (the last point repeats the first). */
  ring: Point[];
  /** Approach by node and the neighbour it comes from. */
  approach(node: string, from: string): Approach | undefined;
  edgeBetween(a: string, b: string): CityEdge | undefined;
  /** Centre line of the street from `a` to `b`, in that direction. */
  path(a: string, b: string): Point[];
  /** Direction of travel leaving `a` towards `b`, and arriving at `b` from `a` (they differ on curved streets). */
  leaveDir(a: string, b: string): Point;
  arriveDir(a: string, b: string): Point;
  /** Point at fraction `t` of the street from `a` to `b`, `lateral` metres right of the centre line, and the direction there. */
  pointOn(edge: readonly [string, string], t: number, lateral: number): Point & { dir: Point };
}

const SPACING = 90;
const LINES = [-270, -180, -90, 0, 90, 180, 270];
/** Grid lines that continue out to the ring road. */
const EXITS = [-180, 0, 180];
export const RING_LIMIT = 70;
/**
 * The ring road, clockwise from the north-west: junctions with the six roads out of the grid ('T', the ring runs straight
 * across them along `tan`) and bends between them — pulled in at the corners, pushed out in between — so it winds.
 */
type RingPoint = { x: number; z: number; tan?: 'x' | 'z'; sign?: 1 | -1 };
const RING_POINTS: RingPoint[] = [
  { x: -180, z: -350, tan: 'x', sign: 1 }, { x: -95, z: -382 }, { x: 0, z: -392, tan: 'x', sign: 1 }, { x: 95, z: -402 }, { x: 180, z: -370, tan: 'x', sign: 1 }, { x: 318, z: -322 },
  { x: 352, z: -180, tan: 'z', sign: 1 }, { x: 378, z: -92 }, { x: 388, z: 0, tan: 'z', sign: 1 }, { x: 382, z: 92 }, { x: 350, z: 180, tan: 'z', sign: 1 }, { x: 322, z: 322 },
  { x: 180, z: 358, tan: 'x', sign: -1 }, { x: 92, z: 382 }, { x: 0, z: 388, tan: 'x', sign: -1 }, { x: -92, z: 374 }, { x: -180, z: 348, tan: 'x', sign: -1 }, { x: -320, z: 318 },
  { x: -354, z: 180, tan: 'z', sign: -1 }, { x: -382, z: 92 }, { x: -392, z: 0, tan: 'z', sign: -1 }, { x: -378, z: -92 }, { x: -350, z: -180, tan: 'z', sign: -1 }, { x: -320, z: -320 },
];
/**
 * Spacing of the five collinear control points laid through each junction: the curve is exactly straight between the
 * middle three (±12 m, the junction box and its stop lines) and leaves the outer two along the same line, without a kink.
 */
const RING_STRAIGHT = 12;

/** Closed centripetal Catmull-Rom curve through the points, sampled about every `step` metres; marks where each input point lies. */
function smoothLoop(points: Point[], step: number) {
  const out: Point[] = [], marks: number[] = [], n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const knot = (a: Point, b: Point) => Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)) || 1e-6;
    const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    marks.push(out.length);
    const count = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step));
    for (let k = 0; k < count; k++) {
      const t = t1 + (t2 - t1) * k / count;
      const lerp = (a: Point, b: Point, ta: number, tb: number) => ({ x: (tb - t) / (tb - ta) * a.x + (t - ta) / (tb - ta) * b.x, z: (tb - t) / (tb - ta) * a.z + (t - ta) / (tb - ta) * b.z });
      const a1 = lerp(p0, p1, 0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, 0, t2), b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return { points: out, marks };
}
export const pathLength = (path: Point[]) => path.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) : 0, 0);
/** Point `distance` metres along a polyline (clamped to its ends) and the direction there. */
export function pointAlong(path: Point[], distance: number): Point & { dir: Point } {
  let left = Math.max(0, distance);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= length || i === path.length - 2) {
      const t = length ? Math.min(1, left / length) : 0, dir = length ? { x: (b.x - a.x) / length, z: (b.z - a.z) / length } : { x: 1, z: 0 };
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dir };
    }
    left -= length;
  }
  return { ...path[0], dir: { x: 1, z: 0 } };
}
/** The polyline shifted `lateral` metres to the right of its direction. */
export function offsetPath(path: Point[], lateral: number): Point[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x - (b.z - a.z) / l * lateral, z: p.z + (b.x - a.x) / l * lateral };
  });
}
const HILL = { minX: 90, maxX: 270, minZ: -270, maxZ: -180, y: 9 };
// 16 m roads have two lanes each way (4 m): `lane` is the centre of the right-hand one; the left one is at lane - 4.
const STREETS: Record<StreetKind, { width: number; lane: number }> = {
  street: { width: 12, lane: 3 }, avenue: { width: 16, lane: 6 }, main: { width: 16, lane: 6 }, tram: { width: 22, lane: 7 }, ring: { width: 16, lane: 6 },
};
/** The Upper Town crossing that is a roundabout (sign 4.3): a 30 m box, island of 5 m, one ring lane around it. */
const ROUND = { node: 'n180_-270', half: 15, island: 5, lane: 10 };
/** Mid-block zebras on quiet streets, away from the ramps. */
const ZEBRAS: [string, string][] = [['n-90_0', 'n-90_90'], ['n90_0', 'n90_90'], ['n-180_-180', 'n-90_-180'], ['n-270_90', 'n-270_180'], ['n180_90', 'n180_180']];
const columnKind = (x: number): StreetKind => x === 0 ? 'avenue' : 'street';
// The central cross street is wide enough to turn back in one go; U-turns are staged there.
const rowKind = (z: number): StreetKind => z === -90 ? 'main' : z === 90 ? 'tram' : z === 0 ? 'avenue' : 'street';
export const TRACK_OFFSET = 2;
/** Crosswalks at signalised crossings start 1 m beyond the junction box and are 3.5 m wide; the stop line follows. */
const CROSSWALK_GAP = 1, CROSSWALK_WIDTH = 3.5;
const nodeId = (x: number, z: number) => `n${x}_${z}`;
const unit = (from: Point, to: Point) => { const dx = to.x - from.x, dz = to.z - from.z, l = Math.hypot(dx, dz); return { x: dx / l, z: dz / l }; };
/** Right-hand side of travel direction d (x east, z south). */
export const rightOf = (d: Point) => ({ x: -d.z, z: d.x });
const onHill = (x: number, z: number) => x >= HILL.minX && x <= HILL.maxX && z >= HILL.minZ && z <= HILL.maxZ;

function nodeKind(x: number, z: number): NodeKind {
  if (nodeId(x, z) === ROUND.node) return 'round';
  const inner = Math.abs(x) < 270 && Math.abs(z) < 270;
  if (x === 0 && inner) return 'signal';
  if (z === -90 && inner) return 'main';
  if (z === 90 && inner) return 'tram';
  return 'equal';
}

export function buildCity(): CityLayout {
  const nodes: Record<string, CityNode> = {};
  const addNode = (x: number, z: number, cw: number, rw: number) => {
    const kind = nodeKind(x, z);
    if (kind === 'round') cw = rw = ROUND.half * 2;
    nodes[nodeId(x, z)] = { id: nodeId(x, z), x, z, kind, links: [], area: { x, z, halfX: cw / 2, halfZ: rw / 2 }, y: onHill(x, z) ? HILL.y : 0,
      mainAxis: kind === 'main' ? 'x' : undefined };
  };
  for (const x of LINES) for (const z of LINES) addNode(x, z, STREETS[columnKind(x)].width, STREETS[rowKind(z)].width);
  // Ring junctions: as wide as the ring one way and the joining road the other; the ring is the main road there.
  const ringT = RING_POINTS.filter(p => p.tan);
  for (const t of ringT) {
    const joining = STREETS[(t.tan === 'x' ? t.x : t.z) === 0 ? 'avenue' : 'street'].width;
    const [cw, rw] = t.tan === 'x' ? [joining, STREETS.ring.width] : [STREETS.ring.width, joining];
    nodes[nodeId(t.x, t.z)] = { id: nodeId(t.x, t.z), x: t.x, z: t.z, kind: 'ring', links: [], area: { x: t.x, z: t.z, halfX: cw / 2, halfZ: rw / 2 }, y: 0, mainAxis: t.tan };
  }
  const edges: CityEdge[] = [];
  const link = (a: CityNode, b: CityNode, kind: StreetKind, axis: 'x' | 'z') => {
    edges.push({ id: `${a.id}-${b.id}`, a: a.id, b: b.id, kind, axis, ...STREETS[kind] });
    a.links.push(b.id); b.links.push(a.id);
  };
  const at = (x: number, z: number) => nodes[nodeId(x, z)];
  for (const z of LINES) for (let i = 0; i < LINES.length - 1; i++) link(at(LINES[i], z), at(LINES[i + 1], z), rowKind(z), 'x');
  for (const x of LINES) for (let i = 0; i < LINES.length - 1; i++) link(at(x, LINES[i]), at(x, LINES[i + 1]), columnKind(x), 'z');
  // Roads out of the grid run straight to the ring junction on their line.
  for (const t of ringT) {
    const line = t.tan === 'x' ? t.x : t.z, kind = line === 0 ? 'avenue' : 'street';
    const inner = t.tan === 'x' ? at(line, Math.sign(t.z) * 270) : at(Math.sign(t.x) * 270, line), outer = nodes[nodeId(t.x, t.z)];
    if (t.tan === 'x') { if (t.z < 0) link(outer, inner, kind, 'z'); else link(inner, outer, kind, 'z'); }
    else if (t.x < 0) link(outer, inner, kind, 'x'); else link(inner, outer, kind, 'x');
  }
  // The ring: a smooth loop through the junctions (each with a straight run either side) and the bends.
  const controls: Point[] = [];
  for (const p of RING_POINTS) {
    if (!p.tan) { controls.push(p); continue; }
    const d = p.tan === 'x' ? { x: p.sign!, z: 0 } : { x: 0, z: p.sign! };
    for (const k of [-2, -1, 0, 1, 2]) controls.push({ x: p.x + d.x * RING_STRAIGHT * k, z: p.z + d.z * RING_STRAIGHT * k });
  }
  const loop = smoothLoop(controls, 2);
  // The spline ripples where the tight control spacing at a junction meets the long bends: relax the curve there,
  // keeping the straight runs through the junctions fixed.
  const fixed = loop.points.map(p => ringT.some(t => Math.hypot(p.x - t.x, p.z - t.z) <= RING_STRAIGHT + 1));
  for (let pass = 0; pass < 40; pass++) {
    const prev = loop.points.map(p => ({ ...p })), n = prev.length;
    for (let i = 0; i < n; i++) if (!fixed[i]) {
      const a = prev[(i - 1 + n) % n], b = prev[(i + 1) % n];
      loop.points[i] = { x: (a.x + 2 * prev[i].x + b.x) / 4, z: (a.z + 2 * prev[i].z + b.z) / 4 };
    }
  }
  const ring = [...loop.points, loop.points[0]];
  // Index of each junction in the sampled loop (its control point is the middle of the five).
  let c = 0; const junctionAt: number[] = [];
  for (const p of RING_POINTS) { if (p.tan) { junctionAt.push(loop.marks[c + 2]); c += 5; } else c += 1; }
  ringT.forEach((t, i) => {
    const next = ringT[(i + 1) % ringT.length];
    // The last stretch closes the loop: from the last junction round past the loop's start to the first junction.
    const path = i + 1 < ringT.length ? ring.slice(junctionAt[i], junctionAt[i + 1] + 1) : [...loop.points.slice(junctionAt[i]), ...loop.points.slice(0, junctionAt[0] + 1)];
    link(nodes[nodeId(t.x, t.z)], nodes[nodeId(next.x, next.z)], 'ring', t.tan!);
    edges[edges.length - 1].path = path;
  });
  const edgeBetween = (a: string, b: string) => edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  const pathOf = (a: string, b: string): Point[] => { const e = edgeBetween(a, b)!; return e.path ? (e.a === a ? e.path : [...e.path].reverse()) : [nodes[a], nodes[b]]; };
  // Snap to the axis when the curve is already square to it (it is at every junction), so x/z tests stay exact.
  const dirOf = (p: Point, q: Point) => { const d = unit(p, q); return Math.abs(d.x) > .995 ? { x: Math.sign(d.x), z: 0 } : Math.abs(d.z) > .995 ? { x: 0, z: Math.sign(d.z) } : d; };
  const leaveDir = (a: string, b: string) => { const path = pathOf(a, b); return dirOf(path[0], path[1]); };
  const arriveDir = (a: string, b: string) => { const path = pathOf(a, b); return dirOf(path[path.length - 2], path[path.length - 1]); };
  /** The side a road comes into a junction from, by its direction of travel there. */
  const sideFor = (dir: Point) => dir.z > .5 ? 'n' : dir.z < -.5 ? 's' : dir.x > .5 ? 'w' : 'e';

  const approaches: Approach[] = [], crosswalks: Rect[] = [], signs: PlacedSign[] = [], speedZones: SpeedZone[] = [];
  for (const node of Object.values(nodes)) {
    for (const from of node.links) {
      const edge = edgeBetween(node.id, from)!, dir = arriveDir(from, node.id), right = rightOf(dir);
      const half = dir.x !== 0 ? node.area.halfX : node.area.halfZ;
      const signal = node.kind === 'signal';
      const back = half + (signal ? CROSSWALK_GAP + CROSSWALK_WIDTH + 1 : 1.5);
      const at = (along: number, side: number) => ({ x: node.x - dir.x * along + right.x * side, z: node.z - dir.z * along + right.z * side });
      const id = `${node.id}-${sideFor(dir)}`;
      approaches.push({
        id, name: id, intersection: node.id, group: dir.x !== 0 ? 'ew' : 'ns', dir,
        stopLine: [at(back, .5), at(back, edge.width / 2 - .5)],
        heads: signal ? [at(half + .8, edge.width / 2 + 1.3)] : [], control: signal ? 'signal' : 'none',
      });
      const facing = { x: -dir.x, z: -dir.z }, curb = edge.width / 2 + 1.6;
      // Priority signs: 2.1 on the main road and the ring, 2.4 on the roads that join them.
      if (node.kind === 'round') signs.push({ id: `${id}-round`, code: '4.3', at: at(half + 3, curb), facing });
      if (node.kind === 'main' || node.kind === 'ring') signs.push({ id: `${id}-priority`, code: (dir.x !== 0) === (node.mainAxis === 'x') ? '2.1' : '2.4', at: at(half + 3, curb), facing });
      // Tram crossing warning on the streets that cross the tram avenue.
      if (node.kind === 'tram' && dir.z !== 0) signs.push({ id: `${id}-tram`, code: '1.5', at: at(40, curb), facing });
      if (signal) signs.push({ id: `${id}-crossing`, code: '5.19.1', at: at(half + CROSSWALK_GAP + CROSSWALK_WIDTH + .3, curb), facing });
    }
    if (node.kind === 'signal') for (const to of node.links) {
      const dir = unit(node, nodes[to]), edge = edgeBetween(node.id, to)!, half = dir.x !== 0 ? node.area.halfX : node.area.halfZ;
      const c = { x: node.x + dir.x * (half + CROSSWALK_GAP + CROSSWALK_WIDTH / 2), z: node.z + dir.z * (half + CROSSWALK_GAP + CROSSWALK_WIDTH / 2) };
      crosswalks.push(dir.x !== 0 ? { x: c.x, z: c.z, halfX: CROSSWALK_WIDTH / 2, halfZ: edge.width / 2 } : { x: c.x, z: c.z, halfX: edge.width / 2, halfZ: CROSSWALK_WIDTH / 2 });
    }
  }

  // Ring road: 70 km/h along its whole length both ways; sign 3.24 after each junction, as its zone ends at the next one.
  speedZones.push({ id: 'ring', path: ring, half: STREETS.ring.width / 2 + 1, limit: RING_LIMIT, signAt: ring[0] });
  for (const e of edges.filter(e => e.path)) for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) {
    const p = pointAlong(pathOf(a, b), 14), right = rightOf(p.dir), side = e.width / 2 + 1.6;
    signs.push({ id: `zone-ring-${a}-${b}`, code: '3.24', value: RING_LIMIT, at: { x: p.x + right.x * side, z: p.z + right.z * side }, facing: { x: -p.dir.x, z: -p.dir.z } });
  }

  // Zebras: stripes across the street mid-block, 5.19.1 on the right of each direction just before them.
  const zebras: Zebra[] = ZEBRAS.map(([a, b]) => {
    const e = edgeBetween(a, b)!, na = nodes[a], nb = nodes[b], at = { x: (na.x + nb.x) / 2, z: (na.z + nb.z) / 2 };
    const rect = e.axis === 'x' ? { x: at.x, z: at.z, halfX: CROSSWALK_WIDTH / 2, halfZ: e.width / 2 } : { x: at.x, z: at.z, halfX: e.width / 2, halfZ: CROSSWALK_WIDTH / 2 };
    for (const [from, to] of [[na, nb], [nb, na]]) {
      const dir = unit(from, to), right = rightOf(dir), back = CROSSWALK_WIDTH / 2 + .6, side = e.width / 2 + 1.6;
      signs.push({ id: `zebra-${from.id}-${to.id}`, code: '5.19.1', at: { x: at.x - dir.x * back + right.x * side, z: at.z - dir.z * back + right.z * side }, facing: { x: -dir.x, z: -dir.z } });
    }
    crosswalks.push(rect);
    return { edge: [a, b], rect, axis: e.axis, at };
  });
  // Car park east of the avenue between the crossings at z 180 and 90; the driveway meets the northbound lanes.
  const parking: Parking = {
    area: { x: 34, z: 135, halfX: 16, halfZ: 14 }, driveway: { x: 13, z: 135, halfX: 5.5, halfZ: 3.5 },
    spawn: { x: 30, z: 132.5, heading: -Math.PI / 2 }, exit: ['n0_180', 'n0_90'],
    stalls: [{ x: 26, z: 125 }, { x: 34, z: 125 }, { x: 42, z: 125 }, { x: 42, z: 145 }, { x: 26, z: 145 }],
  };

  const roads: Rect[] = edges.filter(e => !e.path).map(e => {
    const a = nodes[e.a], b = nodes[e.b];
    return e.axis === 'x' ? { x: (a.x + b.x) / 2, z: a.z, halfX: Math.abs(b.x - a.x) / 2 + e.width / 2, halfZ: e.width / 2 } : { x: a.x, z: (a.z + b.z) / 2, halfX: e.width / 2, halfZ: Math.abs(b.z - a.z) / 2 + e.width / 2 };
  });
  roads.push(parking.area, parking.driveway);
  const map: RoadMap = { roads, strips: [{ path: ring, half: STREETS.ring.width / 2 }], intersections: Object.values(nodes).map(n => ({ id: n.id, area: n.area })), approaches, crosswalks, speedZones, defaultLimit: 60 };

  // Building lots: cells between the grid lines (plus a frame outside the ring), kept clear of the streets around them.
  const bounds = [-450, -360, ...LINES, 360, 450];
  const roadAcross = (p: Point, axis: 'x' | 'z') => roads.find(r => (axis === 'x' ? r.halfX : r.halfZ) < 20 && Math.abs(p.x - r.x) <= r.halfX && Math.abs(p.z - r.z) <= r.halfZ);
  const margin = (p: Point, axis: 'x' | 'z') => { const r = roadAcross(p, axis); return r ? (axis === 'x' ? r.halfX : r.halfZ) + 4 : 3; };
  const lots: Rect[] = [];
  const ringClearance = STREETS.ring.width / 2 + 5.5;
  const clearOfRing = (r: { x0: number; x1: number; z0: number; z1: number }) => {
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (projectOnPath(ring, { x: r.x0 + (r.x1 - r.x0) * i / 4, z: r.z0 + (r.z1 - r.z0) * j / 4 }).distance < ringClearance) return false;
    return true;
  };
  for (let i = 0; i < bounds.length - 1; i++) for (let j = 0; j < bounds.length - 1; j++) {
    const xa = bounds[i], xb = bounds[i + 1], za = bounds[j], zb = bounds[j + 1], mx = (xa + xb) / 2, mz = (za + zb) / 2;
    const x0 = xa + margin({ x: xa, z: mz }, 'x'), x1 = xb - margin({ x: xb, z: mz }, 'x');
    const z0 = za + margin({ x: mx, z: za }, 'z'), z1 = zb - margin({ x: mx, z: zb }, 'z');
    let lot = { x0, x1, z0, z1 };
    // Trim corners that would overlap a wide junction (the roundabout) or the car park: cut the side that loses less.
    for (const r of [...Object.values(nodes).map(n => ({ ...n.area, halfX: n.area.halfX + 4, halfZ: n.area.halfZ + 4 })), { ...parking.area, halfX: parking.area.halfX + 3, halfZ: parking.area.halfZ + 3 }]) {
      const ox = Math.min(lot.x1, r.x + r.halfX) - Math.max(lot.x0, r.x - r.halfX), oz = Math.min(lot.z1, r.z + r.halfZ) - Math.max(lot.z0, r.z - r.halfZ);
      if (ox <= 0 || oz <= 0) continue;
      if (ox * (lot.z1 - lot.z0) < oz * (lot.x1 - lot.x0)) { if (r.x < (lot.x0 + lot.x1) / 2) lot = { ...lot, x0: r.x + r.halfX }; else lot = { ...lot, x1: r.x - r.halfX }; }
      else { if (r.z < (lot.z0 + lot.z1) / 2) lot = { ...lot, z0: r.z + r.halfZ }; else lot = { ...lot, z1: r.z - r.halfZ }; }
    }
    // The winding ring cuts through the outer cells: such a lot is split 3×3 and keeps the parts clear of the ring.
    const parts = clearOfRing(lot) ? [lot] : [0, 1, 2].flatMap(i => [0, 1, 2].map(j => ({ x0: lot.x0 + (lot.x1 - lot.x0) * i / 3, x1: lot.x0 + (lot.x1 - lot.x0) * (i + 1) / 3, z0: lot.z0 + (lot.z1 - lot.z0) * j / 3, z1: lot.z0 + (lot.z1 - lot.z0) * (j + 1) / 3 }))).filter(clearOfRing);
    for (const q of parts) if (q.x1 - q.x0 > 4 && q.z1 - q.z0 > 4) lots.push({ x: (q.x0 + q.x1) / 2, z: (q.z0 + q.z1) / 2, halfX: (q.x1 - q.x0) / 2, halfZ: (q.z1 - q.z0) / 2 });
  }

  const plateaus = [{ x: (HILL.minX + HILL.maxX) / 2, z: (HILL.minZ + HILL.maxZ) / 2, halfX: (HILL.maxX - HILL.minX) / 2 + 6, halfZ: (HILL.maxZ - HILL.minZ) / 2 + 6, y: HILL.y }];
  // Streets touching a raised crossing climb between the edges of the two crossings.
  const slopes = edges.filter(e => nodes[e.a].y !== nodes[e.b].y || nodes[e.a].y > 0).map(e => {
    const a = nodes[e.a], b = nodes[e.b], k = e.axis;
    const [lo, hi] = a[k] < b[k] ? [a, b] : [b, a];
    const start = lo[k] + (k === 'x' ? lo.area.halfX : lo.area.halfZ), end = hi[k] - (k === 'x' ? hi.area.halfX : hi.area.halfZ);
    const line = k === 'x' ? a.z : a.x;
    return { axis: k, line, half: e.width / 2 + 2.5, start, end, y0: lo.y, y1: hi.y };
  });
  const height = (x: number, z: number) => {
    for (const s of slopes) {
      const along = s.axis === 'x' ? x : z, across = s.axis === 'x' ? z : x;
      if (Math.abs(across - s.line) <= s.half && along >= s.start - .01 && along <= s.end + .01) return s.y0 + (s.y1 - s.y0) * (along - s.start) / (s.end - s.start);
    }
    for (const p of plateaus) if (Math.abs(x - p.x) <= p.halfX && Math.abs(z - p.z) <= p.halfZ) return p.y;
    return 0;
  };

  const districts: District[] = [
    { id: 'centre', name: 'Центр', area: { x: 0, z: 0, halfX: 275, halfZ: 275 } },
    { id: 'upper', name: 'Верхний город', area: plateaus[0] },
    { id: 'ring', name: 'Окружная', area: { x: 0, z: 0, halfX: Math.max(...ring.map(p => Math.abs(p.x))) + 8, halfZ: Math.max(...ring.map(p => Math.abs(p.z))) + 8 } },
  ];
  return {
    spacing: SPACING, nodes, edges, map, signs, lots, districts, plateaus, height, zebras, parking,
    roundabout: { node: ROUND.node, island: ROUND.island, lane: ROUND.lane },
    tracks: [{ offset: 90 + TRACK_OFFSET, from: -275, to: 275 }, { offset: 90 - TRACK_OFFSET, from: -275, to: 275 }],
    ring,
    approach: (node, from) => {
      if (!nodes[node] || !nodes[from] || !edgeBetween(node, from)) return undefined;
      return approaches.find(a => a.id === `${node}-${sideFor(arriveDir(from, node))}`);
    },
    edgeBetween, path: pathOf, leaveDir, arriveDir,
    pointOn: (edge, t, lateral) => {
      const path = pathOf(edge[0], edge[1]), p = pointAlong(path, pathLength(path) * t), r = rightOf(p.dir);
      return { x: p.x + r.x * lateral, z: p.z + r.z * lateral, dir: p.dir };
    },
  };
}

/** Length of the street between two neighbouring crossings, metres. */
export const edgeLength = (city: CityLayout, a: string, b: string) => pathLength(city.path(a, b));

/** Looping AI lanes: both directions of the main road, the signal avenue and each side of the ring, with every stop line they meet. */
export function cityLanes(city: CityLayout): TrafficLane[] {
  // Through traffic keeps to the right-hand of the two lanes.
  const LANE = STREETS.avenue.lane;
  const along = (axis: 'x' | 'z', sign: 1 | -1, line: number, lane: number, id: string, start: number, end: number): TrafficLane => {
    const offset = line + (axis === 'x' ? sign * lane : -sign * lane);
    const dir = axis === 'x' ? { x: sign, z: 0 } : { x: 0, z: sign };
    const approaches = city.map.approaches.filter(a => a.dir.x === dir.x && a.dir.z === dir.z && Math.abs((axis === 'x' ? a.stopLine[0].z : a.stopLine[0].x) - line) < lane + 4);
    return { id, axis, sign, offset, start, end, loop: true, approaches };
  };
  const lanes = [along('x', 1, -90, LANE, 'main-e', -280, 280), along('x', -1, -90, LANE, 'main-w', -280, 280), along('z', -1, 0, LANE, 'avenue-n', -350, 350), along('z', 1, 0, LANE, 'avenue-s', -350, 350)];
  // The ring: one closed lane each way along the curve, so cars go all the way round.
  for (const [id, path] of [['ring-cw', city.ring], ['ring-ccw', [...city.ring].reverse()]] as const) {
    const lanePath = makeLanePath(offsetPath(path, LANE));
    lanes.push({ id, axis: 'x', sign: 1, offset: 0, start: 0, end: lanePath.length, loop: true, path: lanePath });
  }
  return lanes;
}
// Sparse enough that a learner on a side street finds a gap to join or cross within a few seconds.
export const cityTrafficLayout: Record<string, number[]> = {
  'main-e': [-230, -100, 30, 160], 'main-w': [-200, -70, 60, 190], 'avenue-n': [-300, -140, -10, 120, 260], 'avenue-s': [-260, -100, 30, 170, 300],
  'ring-cw': [0, 290, 580, 870, 1160, 1450, 1740, 2030], 'ring-ccw': [140, 430, 720, 1010, 1300, 1590, 1880, 2170],
};
