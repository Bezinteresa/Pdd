import type { Approach, Point, Rect, RoadMap, SpeedZone } from './roads.ts';
import type { PlacedSign } from './signs.ts';
import type { TrafficLane } from './traffic.ts';

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
export type NodeKind = 'signal' | 'main' | 'tram' | 'equal' | 'ring' | 'bend';
export interface CityNode {
  id: string; x: number; z: number; kind: NodeKind; links: string[]; area: Rect;
  /** Height of the crossing above the plain, metres. */
  y: number;
  /** Axis of the priority road through a 'main' or 'ring' crossing. */
  mainAxis?: 'x' | 'z';
}
export interface CityEdge { id: string; a: string; b: string; kind: StreetKind; axis: 'x' | 'z'; width: number; lane: number; }
export interface District { id: string; name: string; area: Rect; }
export interface CityLayout {
  spacing: number;
  nodes: Record<string, CityNode>;
  edges: CityEdge[];
  map: RoadMap;
  signs: PlacedSign[];
  lots: Rect[];
  tracks: { offset: number; from: number; to: number }[];
  districts: District[];
  /** Raised ground the Upper Town stands on. */
  plateaus: (Rect & { y: number })[];
  /** Ground height at a point: streets climb linearly between crossings of different height. */
  height(x: number, z: number): number;
  /** Approach by node and the neighbour it comes from. */
  approach(node: string, from: string): Approach | undefined;
  edgeBetween(a: string, b: string): CityEdge | undefined;
}

const SPACING = 90;
const LINES = [-270, -180, -90, 0, 90, 180, 270];
export const RING = 360;
/** Grid lines that continue out to the ring road. */
const EXITS = [-180, 0, 180];
const RING_STOPS = [-360, -270, -180, -90, 0, 90, 180, 270, 360];
export const RING_LIMIT = 70;
const HILL = { minX: 90, maxX: 270, minZ: -270, maxZ: -180, y: 9 };
const STREETS: Record<StreetKind, { width: number; lane: number }> = {
  street: { width: 12, lane: 3 }, avenue: { width: 16, lane: 4 }, main: { width: 16, lane: 4 }, tram: { width: 22, lane: 7 }, ring: { width: 16, lane: 4 },
};
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
  if (Math.abs(x) === RING || Math.abs(z) === RING) return (EXITS.includes(x) || EXITS.includes(z)) && Math.abs(x) !== Math.abs(z) ? 'ring' : 'bend';
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
    nodes[nodeId(x, z)] = { id: nodeId(x, z), x, z, kind, links: [], area: { x, z, halfX: cw / 2, halfZ: rw / 2 }, y: onHill(x, z) ? HILL.y : 0,
      mainAxis: kind === 'main' ? 'x' : kind === 'ring' ? (Math.abs(x) === RING ? 'z' : 'x') : undefined };
  };
  for (const x of LINES) for (const z of LINES) addNode(x, z, STREETS[columnKind(x)].width, STREETS[rowKind(z)].width);
  for (const v of RING_STOPS) for (const side of [-RING, RING]) {
    // Ring crossings are as wide as the ring one way and the joining road the other.
    const joining = (line: number) => EXITS.includes(line) ? STREETS[line === 0 ? 'avenue' : 'street'].width : STREETS.ring.width;
    if (!nodes[nodeId(side, v)]) addNode(side, v, STREETS.ring.width, Math.abs(v) === RING ? STREETS.ring.width : joining(v));
    if (!nodes[nodeId(v, side)]) addNode(v, side, Math.abs(v) === RING ? STREETS.ring.width : joining(v), STREETS.ring.width);
  }
  const edges: CityEdge[] = [];
  const link = (a: CityNode, b: CityNode, kind: StreetKind, axis: 'x' | 'z') => {
    edges.push({ id: `${a.id}-${b.id}`, a: a.id, b: b.id, kind, axis, ...STREETS[kind] });
    a.links.push(b.id); b.links.push(a.id);
  };
  const at = (x: number, z: number) => nodes[nodeId(x, z)];
  for (const z of LINES) for (let i = 0; i < LINES.length - 1; i++) link(at(LINES[i], z), at(LINES[i + 1], z), rowKind(z), 'x');
  for (const x of LINES) for (let i = 0; i < LINES.length - 1; i++) link(at(x, LINES[i]), at(x, LINES[i + 1]), columnKind(x), 'z');
  for (const line of EXITS) {
    const kind = line === 0 ? 'avenue' : 'street';
    link(at(-RING, line), at(-270, line), kind, 'x'); link(at(270, line), at(RING, line), kind, 'x');
    link(at(line, -RING), at(line, -270), kind, 'z'); link(at(line, 270), at(line, RING), kind, 'z');
  }
  for (const side of [-RING, RING]) for (let i = 0; i < RING_STOPS.length - 1; i++) {
    link(at(RING_STOPS[i], side), at(RING_STOPS[i + 1], side), 'ring', 'x');
    link(at(side, RING_STOPS[i]), at(side, RING_STOPS[i + 1]), 'ring', 'z');
  }
  const edgeBetween = (a: string, b: string) => edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  const approaches: Approach[] = [], crosswalks: Rect[] = [], signs: PlacedSign[] = [], speedZones: SpeedZone[] = [];
  for (const node of Object.values(nodes)) {
    for (const from of node.links) {
      const edge = edgeBetween(node.id, from)!, dir = unit(nodes[from], node), right = rightOf(dir);
      const half = dir.x !== 0 ? node.area.halfX : node.area.halfZ;
      const signal = node.kind === 'signal';
      const back = half + (signal ? CROSSWALK_GAP + CROSSWALK_WIDTH + 1 : 1.5);
      const at = (along: number, side: number) => ({ x: node.x - dir.x * along + right.x * side, z: node.z - dir.z * along + right.z * side });
      const sideOf = (n: CityNode) => n.z < node.z ? 'n' : n.z > node.z ? 's' : n.x < node.x ? 'w' : 'e';
      const id = `${node.id}-${sideOf(nodes[from])}`;
      approaches.push({
        id, name: id, intersection: node.id, group: dir.x !== 0 ? 'ew' : 'ns', dir,
        stopLine: [at(back, .5), at(back, edge.width / 2 - .5)],
        heads: signal ? [at(half + .8, edge.width / 2 + 1.3)] : [], control: signal ? 'signal' : 'none',
      });
      const facing = { x: -dir.x, z: -dir.z }, curb = edge.width / 2 + 1.6;
      // Priority signs: 2.1 on the main road and the ring, 2.4 on the roads that join them.
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

  // Ring road: 70 km/h on every stretch in both directions; sign 3.24 after each junction, as its zone ends at the next one.
  for (const e of edges.filter(e => e.kind === 'ring')) {
    const a = nodes[e.a], b = nodes[e.b];
    for (const [from, to] of [[a, b], [b, a]]) {
      const dir = unit(from, to), right = rightOf(dir);
      const area = e.axis === 'x' ? { x: (a.x + b.x) / 2, z: a.z, halfX: SPACING / 2, halfZ: e.width / 2 } : { x: a.x, z: (a.z + b.z) / 2, halfX: e.width / 2, halfZ: SPACING / 2 };
      const half = dir.x !== 0 ? from.area.halfX : from.area.halfZ;
      const signAt = { x: from.x + dir.x * (half + 6) + right.x * (e.width / 2 + 1.6), z: from.z + dir.z * (half + 6) + right.z * (e.width / 2 + 1.6) };
      const zone: SpeedZone = { id: `ring-${from.id}-${to.id}`, area, dir, limit: RING_LIMIT, signAt };
      speedZones.push(zone);
      if (from.kind === 'ring') signs.push({ id: `zone-${zone.id}`, code: '3.24', value: RING_LIMIT, at: signAt, facing: { x: -dir.x, z: -dir.z } });
    }
  }

  const roads: Rect[] = edges.map(e => {
    const a = nodes[e.a], b = nodes[e.b];
    return e.axis === 'x' ? { x: (a.x + b.x) / 2, z: a.z, halfX: Math.abs(b.x - a.x) / 2 + e.width / 2, halfZ: e.width / 2 } : { x: a.x, z: (a.z + b.z) / 2, halfX: e.width / 2, halfZ: Math.abs(b.z - a.z) / 2 + e.width / 2 };
  });
  const map: RoadMap = { roads, intersections: Object.values(nodes).map(n => ({ id: n.id, area: n.area })), approaches, crosswalks, speedZones, defaultLimit: 60 };

  // Building lots: cells between the grid lines (plus a frame outside the ring), kept clear of the streets around them.
  const bounds = [-440, -360, ...LINES, 360, 440];
  const roadAcross = (p: Point, axis: 'x' | 'z') => roads.find(r => (axis === 'x' ? r.halfX : r.halfZ) < 20 && Math.abs(p.x - r.x) <= r.halfX && Math.abs(p.z - r.z) <= r.halfZ);
  const margin = (p: Point, axis: 'x' | 'z') => { const r = roadAcross(p, axis); return r ? (axis === 'x' ? r.halfX : r.halfZ) + 4 : 3; };
  const lots: Rect[] = [];
  for (let i = 0; i < bounds.length - 1; i++) for (let j = 0; j < bounds.length - 1; j++) {
    const xa = bounds[i], xb = bounds[i + 1], za = bounds[j], zb = bounds[j + 1], mx = (xa + xb) / 2, mz = (za + zb) / 2;
    const x0 = xa + margin({ x: xa, z: mz }, 'x'), x1 = xb - margin({ x: xb, z: mz }, 'x');
    const z0 = za + margin({ x: mx, z: za }, 'z'), z1 = zb - margin({ x: mx, z: zb }, 'z');
    lots.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, halfX: (x1 - x0) / 2, halfZ: (z1 - z0) / 2 });
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
    { id: 'ring', name: 'Окружная', area: { x: 0, z: 0, halfX: RING + 8, halfZ: RING + 8 } },
  ];
  return {
    spacing: SPACING, nodes, edges, map, signs, lots, districts, plateaus, height,
    tracks: [{ offset: 90 + TRACK_OFFSET, from: -275, to: 275 }, { offset: 90 - TRACK_OFFSET, from: -275, to: 275 }],
    approach: (node, from) => {
      const n = nodes[node], f = nodes[from]; if (!n || !f) return undefined;
      const side = f.z < n.z ? 'n' : f.z > n.z ? 's' : f.x < n.x ? 'w' : 'e';
      return approaches.find(a => a.id === `${node}-${side}`);
    },
    edgeBetween,
  };
}

/** Length of the street between two neighbouring crossings, metres. */
export const edgeLength = (city: CityLayout, a: string, b: string) => Math.hypot(city.nodes[a].x - city.nodes[b].x, city.nodes[a].z - city.nodes[b].z);

/** Looping AI lanes: both directions of the main road, the signal avenue and each side of the ring, with every stop line they meet. */
export function cityLanes(city: CityLayout): TrafficLane[] {
  const along = (axis: 'x' | 'z', sign: 1 | -1, line: number, lane: number, id: string, start: number, end: number): TrafficLane => {
    const offset = line + (axis === 'x' ? sign * lane : -sign * lane);
    const dir = axis === 'x' ? { x: sign, z: 0 } : { x: 0, z: sign };
    const approaches = city.map.approaches.filter(a => a.dir.x === dir.x && a.dir.z === dir.z && Math.abs((axis === 'x' ? a.stopLine[0].z : a.stopLine[0].x) - line) < lane + 4);
    return { id, axis, sign, offset, start, end, loop: true, approaches };
  };
  const lanes = [along('x', 1, -90, 4, 'main-e', -280, 280), along('x', -1, -90, 4, 'main-w', -280, 280), along('z', -1, 0, 4, 'avenue-n', -350, 350), along('z', 1, 0, 4, 'avenue-s', -350, 350)];
  // Ring cars wrap at the corners: each side is its own loop, ending just short of the corner crossing.
  for (const side of [-RING, RING]) {
    const tag = side < 0 ? 'w' : 'e', row = side < 0 ? 'n' : 's';
    lanes.push(along('z', 1, side, 4, `ring-${tag}-s`, -348, 348), along('z', -1, side, 4, `ring-${tag}-n`, -348, 348));
    lanes.push(along('x', 1, side, 4, `ring-${row}-e`, -348, 348), along('x', -1, side, 4, `ring-${row}-w`, -348, 348));
  }
  return lanes;
}
// Sparse enough that a learner on a side street finds a gap to join or cross within a few seconds.
export const cityTrafficLayout: Record<string, number[]> = {
  'main-e': [-230, -100, 30, 160], 'main-w': [-200, -70, 60, 190], 'avenue-n': [-300, -140, -10, 120, 260], 'avenue-s': [-260, -100, 30, 170, 300],
  'ring-w-s': [-250, 0, 250], 'ring-w-n': [-150, 100, 330], 'ring-e-s': [-300, -50, 200], 'ring-e-n': [-200, 60, 300],
  'ring-n-e': [-280, -20, 240], 'ring-n-w': [-180, 90, 320], 'ring-s-e': [-230, 40, 290], 'ring-s-w': [-320, -60, 180],
};
