import { TRACK_OFFSET, type CityLayout } from './city';
import { box, finishWorld, houses, markings, newScene, rails, roadSign, signalPoles, tree, type World } from './world';
import type { Obstacle } from './vehicle';

/**
 * The exam city in 3D, built from the same layout the judge, the traffic and the route planner use.
 * `hiddenSigns` lists signs an exam replaces (for example 2.4 swapped for 2.5); they are staged separately.
 */
export function createCityWorld(city: CityLayout, hiddenSigns: Set<string> = new Set()): World {
  const scene = newScene(300);
  const obstacles: Obstacle[] = [];
  box(scene, 900, .3, 900, 0, -.25, 0, '#9bad91');
  for (const r of city.map.roads) { box(scene, r.halfX * 2 + 3, .18, r.halfZ * 2 + 3, r.x, -.05, r.z, '#c0c5b5'); box(scene, r.halfX * 2, .12, r.halfZ * 2, r.x, .06, r.z, '#596760'); }

  // Centre lines between junctions; the tram avenue gets tracks instead.
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b], len = Math.abs(e.axis === 'x' ? b.x - a.x : b.z - a.z);
    const from = (e.axis === 'x' ? Math.min(a.x, b.x) : Math.min(a.z, b.z)), line = e.axis === 'x' ? a.z : a.x;
    const clear = (e.axis === 'x' ? a.area.halfX : a.area.halfZ) + 7;
    if (e.kind === 'tram') continue;
    for (let t = clear; t < len - clear; t += 9) {
      const v = from + t + 2.1;
      if (e.axis === 'x') box(scene, 4.2, .015, .16, v, .14, line, '#e8dfbe'); else box(scene, .16, .015, 4.2, line, .14, v, '#e8dfbe');
    }
    // A solid line where the main road meets junctions keeps it readable as the main road.
    if (e.kind === 'main') box(scene, len - 2 * clear + 4, .015, .14, from + len / 2, .145, line, '#f2eddb');
  }
  for (const t of city.tracks) rails(scene, t.offset, t.from, t.to);
  box(scene, 370, .02, .3, 0, .14, 90 - TRACK_OFFSET - 2.2, '#e8dfbe'); box(scene, 370, .02, .3, 0, .14, 90 + TRACK_OFFSET + 2.2, '#e8dfbe');

  markings(scene, city.map);
  const lampSlots = signalPoles(scene, city.map, obstacles);
  for (const s of city.signs) if (!hiddenSigns.has(s.id)) roadSign(scene, s.code, s.at, s.facing);

  let count = 0;
  for (const lot of city.lots) {
    const w = lot.halfX * 2, d = lot.halfZ * 2;
    if (w < 14 || d < 14) continue;
    count = houses(scene, { x: lot.x, z: lot.z, w, d }, obstacles, count);
    // A tree at each lot corner, inside the curb line.
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      const x = lot.x + dx * (lot.halfX - 1.5), z = lot.z + dz * (lot.halfZ - 1.5);
      tree(scene, x, z, .8); obstacles.push({ x, z, halfX: .35, halfZ: .35 });
    }
  }
  return finishWorld(scene, obstacles, lampSlots, { x: 4, z: 135 });
}
