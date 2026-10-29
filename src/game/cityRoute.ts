import type { CityLayout } from './city.ts';
import type { Maneuver } from './regulator.ts';

// Route planning on the city graph. A position on the route is a directed edge [from, to]: driving along the
// street from node `from` towards node `to`. Turning back at a junction is not planned (U-turns are a situation).
export type DirEdge = readonly [string, string];
export const edgeKey = (e: DirEdge) => `${e[0]}>${e[1]}`;

/** Manoeuvre at node v when arriving from u and leaving towards w. */
export function turnAt(city: CityLayout, u: string, v: string, w: string): Maneuver {
  if (u === w) return 'uturn';
  // Directions at the junction itself: a curved street (the ring) may arrive at an angle to the line between the crossings.
  const d1 = city.arriveDir(u, v), d2 = city.leaveDir(v, w);
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

/**
 * Where a situation is staged: through a node with a fixed manoeuvre, a U-turn on a street, something met while
 * driving along a street ('edge': a zebra, a lane change), or the very start of the exam ('start': leaving the car park).
 */
export interface Placement { situation: string; kind: 'node' | 'uturn' | 'edge' | 'start'; node?: string; inFrom?: string; maneuver?: Maneuver; outTo?: string; edge?: DirEdge; }
/** The directed edge the learner must be on to meet the placement. */
export const entryOf = (p: Placement): DirEdge => p.kind === 'node' ? [p.inFrom!, p.node!] : p.edge!;
/** The directed edge the learner is on right after the placement. */
export const exitOf = (p: Placement): DirEdge => p.kind === 'node' ? [p.node!, p.outTo!] : p.kind === 'uturn' ? [p.edge![1], p.edge![0]] : p.edge!;

export function candidates(city: CityLayout, situation: string): Placement[] {
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
    case 'roundabout': return through('round', 'left');
    case 'crosswalk': return city.zebras.flatMap(z => [[z.edge[0], z.edge[1]], [z.edge[1], z.edge[0]]] as DirEdge[]).map(edge => ({ situation, kind: 'edge' as const, edge }));
    // Two lanes each way and no climb: the avenue and the ring.
    case 'lane-change': return city.edges.filter(e => e.kind === 'avenue' && city.nodes[e.a].y === city.nodes[e.b].y && city.nodes[e.a].links.length > 2 && city.nodes[e.b].links.length > 2)
      .flatMap(e => [[e.a, e.b], [e.b, e.a]] as DirEdge[]).map(edge => ({ situation, kind: 'edge' as const, edge }));
    case 'u-turn': return city.edges.filter(e => !e.path && e.axis === 'x' && city.nodes[e.a].z === 0 && city.nodes[e.b].z === 0).flatMap(e => [[e.a, e.b], [e.b, e.a]] as DirEdge[]).map(edge => ({ situation, kind: 'uturn' as const, edge }));
    default: return [];
  }
}

/** Orders the situations greedily (nearest next) and gives each its own node or street. */
export function planExam(city: CityLayout, selected: string[], start: DirEdge): Placement[] {
  const plan: Placement[] = [], usedNodes = new Set<string>(), usedEdges = new Set<string>();
  let current = start, remaining = [...selected];
  // Leaving the car park is how the exam begins; the rest is planned from the street it joins.
  if (remaining.includes('adjacent')) { plan.push({ situation: 'adjacent', kind: 'start', edge: city.parking.exit }); current = city.parking.exit; usedEdges.add(edgeKey(current)); remaining = remaining.filter(id => id !== 'adjacent'); }
  while (remaining.length) {
    let best: { p: Placement; cost: number } | null = null;
    for (const id of remaining) for (const p of candidates(city, id)) {
      if (p.node && usedNodes.has(p.node)) continue;
      if (p.edge && (usedEdges.has(edgeKey(p.edge)) || usedEdges.has(edgeKey([p.edge[1], p.edge[0]])))) continue;
      // The staged place must not be the street the learner is already on, so there is time to prepare.
      if ((p.kind === 'uturn' || p.kind === 'edge') && edgeKey(p.edge!) === edgeKey(current)) continue;
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

/** A single situation for practice: a place on flat ground reached along an ordinary street (or the car park). */
export function practicePlacement(city: CityLayout, situation: string): Placement | null {
  if (situation === 'adjacent') return { situation, kind: 'start', edge: city.parking.exit };
  const all = candidates(city, situation);
  const flat = all.filter(p => { const [u, v] = entryOf(p); return city.nodes[u].y === city.nodes[v].y && city.nodes[u].kind !== 'bend'; });
  return flat[0] ?? all[0] ?? null;
}
