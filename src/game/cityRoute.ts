import type { CityLayout } from './city.ts';
import type { Maneuver } from './regulator.ts';

// Route planning on the city graph. A position on the route is a directed edge [from, to]: driving along the
// street from node `from` towards node `to`. Turning back at a junction is not planned (U-turns are a situation).
export type DirEdge = readonly [string, string];
export const edgeKey = (e: DirEdge) => `${e[0]}>${e[1]}`;

/** Manoeuvre at node v when arriving from u and leaving towards w. */
export function turnAt(city: CityLayout, u: string, v: string, w: string): Maneuver {
  const a = city.nodes[u], b = city.nodes[v], c = city.nodes[w];
  if (u === w) return 'uturn';
  const d1 = { x: Math.sign(b.x - a.x), z: Math.sign(b.z - a.z) }, d2 = { x: Math.sign(c.x - b.x), z: Math.sign(c.z - b.z) };
  if (d1.x * d2.x + d1.z * d2.z > .5) return 'straight';
  return d1.x * d2.z - d1.z * d2.x > 0 ? 'right' : 'left';
}
/** Neighbour of `node` reached by `maneuver` when arriving from `from`, if the street exists. */
export function exitFor(city: CityLayout, from: string, node: string, maneuver: Maneuver): string | undefined {
  return city.nodes[node].links.find(w => w !== from && turnAt(city, from, node, w) === maneuver);
}

/** Shortest chain of directed edges from `from` to `to` (both included); no turning back at junctions. */
export function shortestPath(city: CityLayout, from: DirEdge, to: DirEdge): DirEdge[] | null {
  const goal = edgeKey(to), dist = new Map<string, number>([[edgeKey(from), 0]]), back = new Map<string, DirEdge>();
  const open: { edge: DirEdge; cost: number }[] = [{ edge: from, cost: 0 }];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const { edge, cost } = open.shift()!;
    if (edgeKey(edge) === goal) {
      const path: DirEdge[] = [edge];
      for (let k = edgeKey(edge); back.has(k);) { const p = back.get(k)!; path.unshift(p); k = edgeKey(p); }
      return path;
    }
    if (cost > (dist.get(edgeKey(edge)) ?? Infinity)) continue;
    const [u, v] = edge;
    for (const w of city.nodes[v].links) {
      if (w === u) continue;
      const next: DirEdge = [v, w], k = edgeKey(next), c = cost + 1;
      if (c < (dist.get(k) ?? Infinity)) { dist.set(k, c); back.set(k, edge); open.push({ edge: next, cost: c }); }
    }
  }
  return null;
}

/** Where a situation is staged: through a node with a fixed manoeuvre, or a U-turn on a street. */
export interface Placement { situation: string; kind: 'node' | 'uturn'; node?: string; inFrom?: string; maneuver?: Maneuver; outTo?: string; edge?: DirEdge; }
/** The directed edge the learner must be on to meet the placement. */
export const entryOf = (p: Placement): DirEdge => p.kind === 'node' ? [p.inFrom!, p.node!] : p.edge!;
/** The directed edge the learner is on right after the placement. */
export const exitOf = (p: Placement): DirEdge => p.kind === 'node' ? [p.node!, p.outTo!] : [p.edge![1], p.edge![0]];

function candidates(city: CityLayout, situation: string): Placement[] {
  const nodes = Object.values(city.nodes);
  const through = (kind: string, maneuver: Maneuver, filter: (from: string, node: string) => boolean = () => true) => nodes
    .filter(n => n.kind === kind && n.links.length === 4)
    .flatMap(n => n.links.filter(from => filter(from, n.id)).map(from => ({ situation, kind: 'node' as const, node: n.id, inFrom: from, maneuver, outTo: exitFor(city, from, n.id, maneuver) })))
    .filter(p => p.outTo);
  // Side streets cross the main road and the tram avenue from the north or the south.
  const fromSide = (from: string, node: string) => city.nodes[from].x === city.nodes[node].x;
  const plainEqual = (from: string, node: string) => city.nodes[node].z === 0 && fromSide(from, node);
  switch (situation) {
    case 'a1-signal': case 'a-regulator': return through('signal', 'straight');
    case 'a2-pedestrian': return through('signal', 'right');
    case 'b-right-hand': case 'b-oncoming': return through('equal', 'left', plainEqual);
    case 'b-tram': return through('tram', 'left', fromSide);
    case 'd-yield': case 'd-stop': return through('main', 'left', fromSide);
    case 'u-turn': return city.edges.filter(e => e.axis === 'x' && city.nodes[e.a].z === 0).flatMap(e => [[e.a, e.b], [e.b, e.a]] as DirEdge[]).map(edge => ({ situation, kind: 'uturn' as const, edge }));
    default: return [];
  }
}

/** Orders the situations greedily (nearest next) and gives each its own node or street. */
export function planExam(city: CityLayout, selected: string[], start: DirEdge): Placement[] {
  const plan: Placement[] = [], usedNodes = new Set<string>(), usedEdges = new Set<string>();
  let current = start, remaining = [...selected];
  while (remaining.length) {
    let best: { p: Placement; cost: number } | null = null;
    for (const id of remaining) for (const p of candidates(city, id)) {
      if (p.node && usedNodes.has(p.node)) continue;
      if (p.edge && (usedEdges.has(edgeKey(p.edge)) || usedEdges.has(edgeKey([p.edge[1], p.edge[0]])))) continue;
      // The staged place must not be the street the learner is already on, so there is time to prepare.
      if (p.kind === 'uturn' && edgeKey(p.edge!) === edgeKey(current)) continue;
      const path = shortestPath(city, current, entryOf(p));
      if (!path) continue;
      const cost = path.length + (p.kind === 'node' && path.length < 2 ? 3 : 0);
      if (!best || cost < best.cost) best = { p, cost };
    }
    if (!best) break;
    plan.push(best.p);
    if (best.p.node) usedNodes.add(best.p.node);
    if (best.p.edge) usedEdges.add(edgeKey(best.p.edge));
    remaining = remaining.filter(id => id !== best!.p.situation);
    current = exitOf(best.p);
  }
  return plan;
}
