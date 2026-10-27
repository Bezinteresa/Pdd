import type { Approach, Point, Rect, RoadMap } from './roads.ts';
import type { PlacedSign } from './signs.ts';
import type { TrafficLane } from './traffic.ts';

// The exam city: a grid of streets built from data. Geometry, the judge's road map, signs and AI lanes
// all come from the same graph, so a new situation type only needs a node of the right kind.
//
// Layout (x east, z south, 90 m blocks):
//   column x = 0      — avenue with traffic lights at every inner crossing;
//   row    z = -90    — main road (sign 2.1), side streets meet it with sign 2.4;
//   row    z = 90     — tram avenue, equal crossings, tram tracks in the middle;
//   row    z = 0      — wide street (U-turns), equal crossings left and right of the avenue;
//   other lines       — ordinary two-lane streets with equal crossings.

export type StreetKind = 'street' | 'avenue' | 'main' | 'tram';
export type NodeKind = 'signal' | 'main' | 'tram' | 'equal';
export interface CityNode { id: string; x: number; z: number; kind: NodeKind; links: string[]; area: Rect; }
export interface CityEdge { id: string; a: string; b: string; kind: StreetKind; axis: 'x' | 'z'; width: number; lane: number; }
export interface CityLayout {
  spacing: number;
  nodes: Record<string, CityNode>;
  edges: CityEdge[];
  map: RoadMap;
  signs: PlacedSign[];
  lots: Rect[];
  tracks: { offset: number; from: number; to: number }[];
  /** Approach by node and the neighbour it comes from. */
  approach(node: string, from: string): Approach | undefined;
  edgeBetween(a: string, b: string): CityEdge | undefined;
}

const SPACING = 90;
const LINES = [-180, -90, 0, 90, 180];
const STREETS: Record<StreetKind, { width: number; lane: number }> = {
  street: { width: 12, lane: 3 }, avenue: { width: 16, lane: 4 }, main: { width: 16, lane: 4 }, tram: { width: 22, lane: 7 },
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

function nodeKind(x: number, z: number): NodeKind {
  const inner = Math.abs(x) < 180 && Math.abs(z) < 180;
  if (x === 0 && inner) return 'signal';
  if (z === -90 && inner) return 'main';
  if (z === 90 && inner) return 'tram';
  return 'equal';
}

export function buildCity(): CityLayout {
  const nodes: Record<string, CityNode> = {};
  for (const x of LINES) for (const z of LINES) {
    const cw = STREETS[columnKind(x)].width, rw = STREETS[rowKind(z)].width;
    nodes[nodeId(x, z)] = { id: nodeId(x, z), x, z, kind: nodeKind(x, z), links: [], area: { x, z, halfX: cw / 2, halfZ: rw / 2 } };
  }
  const edges: CityEdge[] = [];
  const link = (a: CityNode, b: CityNode, kind: StreetKind, axis: 'x' | 'z') => {
    edges.push({ id: `${a.id}-${b.id}`, a: a.id, b: b.id, kind, axis, ...STREETS[kind] });
    a.links.push(b.id); b.links.push(a.id);
  };
  for (const z of LINES) for (let i = 0; i < LINES.length - 1; i++) link(nodes[nodeId(LINES[i], z)], nodes[nodeId(LINES[i + 1], z)], rowKind(z), 'x');
  for (const x of LINES) for (let i = 0; i < LINES.length - 1; i++) link(nodes[nodeId(x, LINES[i])], nodes[nodeId(x, LINES[i + 1])], columnKind(x), 'z');
  const edgeBetween = (a: string, b: string) => edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  const approaches: Approach[] = [], crosswalks: Rect[] = [], signs: PlacedSign[] = [];
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
      // Priority signs: 2.1 on the main road, 2.4 on the side streets that join it.
      if (node.kind === 'main') signs.push({ id: `${id}-priority`, code: dir.x !== 0 ? '2.1' : '2.4', at: at(half + 3, curb), facing });
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

  const roads: Rect[] = edges.map(e => {
    const a = nodes[e.a], b = nodes[e.b];
    return e.axis === 'x' ? { x: (a.x + b.x) / 2, z: a.z, halfX: Math.abs(b.x - a.x) / 2 + e.width / 2, halfZ: e.width / 2 } : { x: a.x, z: (a.z + b.z) / 2, halfX: e.width / 2, halfZ: Math.abs(b.z - a.z) / 2 + e.width / 2 };
  });

  // Building lots between streets, plus a ring of lots outside the border streets so the city does not end in a field.
  const bounds = [-235, ...LINES, 235];
  const widthAt = (v: number, kind: (v: number) => StreetKind) => LINES.includes(v) ? STREETS[kind(v)].width / 2 + 4 : 0;
  const lots: Rect[] = [];
  for (let i = 0; i < bounds.length - 1; i++) for (let j = 0; j < bounds.length - 1; j++) {
    const x0 = bounds[i] + widthAt(bounds[i], columnKind), x1 = bounds[i + 1] - widthAt(bounds[i + 1], columnKind);
    const z0 = bounds[j] + widthAt(bounds[j], rowKind), z1 = bounds[j + 1] - widthAt(bounds[j + 1], rowKind);
    lots.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, halfX: (x1 - x0) / 2, halfZ: (z1 - z0) / 2 });
  }

  const map: RoadMap = { roads, intersections: Object.values(nodes).map(n => ({ id: n.id, area: n.area })), approaches, crosswalks, speedZones: [], defaultLimit: 60 };
  return {
    spacing: SPACING, nodes, edges, map, signs, lots,
    tracks: [{ offset: 90 + TRACK_OFFSET, from: -185, to: 185 }, { offset: 90 - TRACK_OFFSET, from: -185, to: 185 }],
    approach: (node, from) => {
      const n = nodes[node], f = nodes[from]; if (!n || !f) return undefined;
      const side = f.z < n.z ? 'n' : f.z > n.z ? 's' : f.x < n.x ? 'w' : 'e';
      return approaches.find(a => a.id === `${node}-${side}`);
    },
    edgeBetween,
  };
}

/** Looping AI lanes: both directions of the main road and of the signal avenue, with every stop line they meet. */
export function cityLanes(city: CityLayout): TrafficLane[] {
  const along = (axis: 'x' | 'z', sign: 1 | -1, line: number, lane: number, id: string): TrafficLane => {
    const offset = line + (axis === 'x' ? sign * lane : -sign * lane);
    const dir = axis === 'x' ? { x: sign, z: 0 } : { x: 0, z: sign };
    const approaches = city.map.approaches.filter(a => a.dir.x === dir.x && a.dir.z === dir.z && Math.abs((axis === 'x' ? a.stopLine[0].z : a.stopLine[0].x) - line) < lane + 4);
    return { id, axis, sign, offset, start: -190, end: 190, loop: true, approaches };
  };
  return [along('x', 1, -90, 4, 'main-e'), along('x', -1, -90, 4, 'main-w'), along('z', -1, 0, 4, 'avenue-n'), along('z', 1, 0, 4, 'avenue-s')];
}
// Sparse enough that a learner on a side street finds a gap to join or cross within a few seconds.
export const cityTrafficLayout: Record<string, number[]> = { 'main-e': [-150, -20, 110], 'main-w': [-120, 10, 140], 'avenue-n': [-140, -10, 120], 'avenue-s': [-170, -40, 90] };
