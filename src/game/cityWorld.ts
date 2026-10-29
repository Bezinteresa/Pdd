import { TRACK_OFFSET, type CityLayout } from './city';
import { box, finishWorld, houses, island, markings, newScene, parkedCar, rails, roadSign, signalPoles, tree, type World } from './world';
import type { Obstacle } from './vehicle';

/**
 * The exam city in 3D, built from the same layout the judge, the traffic and the route planner use.
 * `hiddenSigns` lists signs an exam replaces (for example 2.4 swapped for 2.5); they are staged separately.
 * Everything is laid out flat; `finishWorld` then lifts it onto the city's ground height (the Upper Town hill).
 */
export function createCityWorld(city: CityLayout, hiddenSigns: Set<string> = new Set()): World {
  const scene = newScene(300);
  const obstacles: Obstacle[] = [];
  box(scene, 1000, .3, 1000, 0, -.25, 0, '#9bad91');
  // The hill: a grassy terrace the Upper Town stands on; its streets and lots are lifted onto it.
  for (const p of city.plateaus) box(scene, p.halfX * 2, p.y, p.halfZ * 2, p.x, p.y / 2 - .1, p.z, '#9bad91').userData.terrain = 'none';
  // Road surfaces: one slab per crossing and per street between crossings, so a climbing street is one straight ramp.
  // 'base' keeps the slab bottom on the plain and lifts its top, which makes the ramp a solid embankment.
  const surface = (w: number, d: number, x: number, z: number) => {
    box(scene, w + 3, .18, d + 3, x, -.05, z, '#c0c5b5').userData.terrain = 'base';
    box(scene, w, .12, d, x, .06, z, '#596760').userData.terrain = 'base';
  };
  for (const n of Object.values(city.nodes)) surface(n.area.halfX * 2, n.area.halfZ * 2, n.x, n.z);
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    if (e.axis === 'x') { const x0 = Math.min(a.x, b.x) + (a.x < b.x ? a.area.halfX : b.area.halfX), x1 = Math.max(a.x, b.x) - (a.x < b.x ? b.area.halfX : a.area.halfX); surface(x1 - x0, e.width, (x0 + x1) / 2, a.z); }
    else { const z0 = Math.min(a.z, b.z) + (a.z < b.z ? a.area.halfZ : b.area.halfZ), z1 = Math.max(a.z, b.z) - (a.z < b.z ? b.area.halfZ : a.area.halfZ); surface(e.width, z1 - z0, a.x, (z0 + z1) / 2); }
  }

  // The car park by the start street: asphalt, a driveway to the avenue, bays with parked cars.
  const P = city.parking;
  surface(P.area.halfX * 2, P.area.halfZ * 2, P.area.x, P.area.z); surface(P.driveway.halfX * 2, P.driveway.halfZ * 2, P.driveway.x, P.driveway.z);
  for (let x = P.area.x - P.area.halfX + 6; x < P.area.x + P.area.halfX - 2; x += 8) for (const z of [P.area.z - P.area.halfZ + 3, P.area.z + P.area.halfZ - 3]) box(scene, .12, .015, 5, x - 4, .13, z, '#f2eddb');
  P.stalls.forEach((s, i) => parkedCar(scene, s.x, s.z, ['#ffd166', '#7fb7e6', '#f4a7b9', '#8fd3a8', '#c3a6e6'][i % 5], obstacles));
  // Roundabout: the island in the middle of its junction box is a kerb the car cannot cross.
  const round = city.nodes[city.roundabout.node];
  island(scene, round.x, round.z, city.roundabout.island);
  const inner = city.roundabout.island * .72;
  obstacles.push({ x: round.x, z: round.z, halfX: inner, halfZ: inner });

  // Centre lines between junctions; the tram avenue gets tracks instead.
  for (const e of city.edges) {
    const a = city.nodes[e.a], b = city.nodes[e.b], len = Math.abs(e.axis === 'x' ? b.x - a.x : b.z - a.z);
    const from = (e.axis === 'x' ? Math.min(a.x, b.x) : Math.min(a.z, b.z)), line = e.axis === 'x' ? a.z : a.x;
    const clear = (e.axis === 'x' ? a.area.halfX : a.area.halfZ) + 7;
    if (e.kind === 'tram') continue;
    // The ring is a two-way road with a solid centre line, like the main road.
    const solid = e.kind === 'main' || e.kind === 'ring';
    if (!solid) for (let t = clear; t < len - clear; t += 9) {
      const v = from + t + 2.1;
      if (e.axis === 'x') box(scene, 4.2, .015, .16, v, .14, line, '#e8dfbe'); else box(scene, .16, .015, 4.2, line, .14, v, '#e8dfbe');
    }
    // 16 m roads have two lanes each way: dashed lines between them.
    if (e.width === 16) for (const side of [-4, 4]) for (let t = clear; t < len - clear; t += 9) {
      const v = from + t + 2.1;
      if (e.axis === 'x') box(scene, 4.2, .015, .13, v, .14, line + side, '#e8dfbe'); else box(scene, .13, .015, 4.2, line + side, .14, v, '#e8dfbe');
    }
    // A solid line where the main road meets junctions keeps it readable as the main road.
    if (solid) {
      const length = len - 2 * clear + 4, mid = from + len / 2;
      if (e.axis === 'x') box(scene, length, .015, .14, mid, .145, line, '#f2eddb'); else box(scene, .14, .015, length, line, .145, mid, '#f2eddb');
    }
  }
  for (const t of city.tracks) rails(scene, t.offset, t.from, t.to);
  const trackLength = city.tracks[0].to - city.tracks[0].from;
  box(scene, trackLength, .02, .3, 0, .14, 90 - TRACK_OFFSET - 2.2, '#e8dfbe'); box(scene, trackLength, .02, .3, 0, .14, 90 + TRACK_OFFSET + 2.2, '#e8dfbe');

  markings(scene, city.map);
  const lampSlots = signalPoles(scene, city.map, obstacles);
  for (const s of city.signs) if (!hiddenSigns.has(s.id)) roadSign(scene, s.code, s.at, s.facing, s.value, true);

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
  return finishWorld(scene, obstacles, lampSlots, { x: 4, z: 135 }, city.height);
}
