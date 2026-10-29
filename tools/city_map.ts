// Draws the exam city as an SVG schema from the same layout the game builds: `node --experimental-strip-types tools/city_map.ts out.svg`.
import { writeFileSync } from 'node:fs';
import { buildCity } from '../src/game/city.ts';

const city = buildCity(), S = 1.4, PAD = 40, HALF = 450;
const X = (x: number) => ((x + HALF) * S + PAD).toFixed(1), Y = (z: number) => ((z + HALF) * S + PAD).toFixed(1);
const size = (HALF * 2) * S + PAD * 2;
const colors: Record<string, string> = { street: '#9aa3ad', avenue: '#7c8794', main: '#e2b84a', tram: '#c98b78', ring: '#5b8fd1' };
const out: string[] = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + 170}" font-family="Arial, sans-serif">`);
out.push(`<rect width="100%" height="100%" fill="#f4f0e6"/>`);
out.push(`<rect x="${PAD}" y="${PAD}" width="${HALF * 2 * S}" height="${HALF * 2 * S}" rx="18" fill="#cfe3b8"/>`);
// Districts and the hill.
for (const p of city.plateaus) out.push(`<rect x="${X(p.x - p.halfX)}" y="${Y(p.z - p.halfZ)}" width="${p.halfX * 2 * S}" height="${p.halfZ * 2 * S}" rx="10" fill="#a9cf8e" stroke="#7fae63" stroke-width="3" stroke-dasharray="10 6"/>`);
// Building lots.
for (const l of city.lots) out.push(`<rect x="${X(l.x - l.halfX)}" y="${Y(l.z - l.halfZ)}" width="${(l.halfX * 2 * S).toFixed(1)}" height="${(l.halfZ * 2 * S).toFixed(1)}" rx="4" fill="#f2d9c4" opacity=".75"/>`);
// Streets.
for (const e of city.edges) {
  const a = city.nodes[e.a], b = city.nodes[e.b], ramp = a.y !== b.y;
  if (e.path) { out.push(`<polyline points="${e.path.map(p => `${X(p.x)},${Y(p.z)}`).join(' ')}" fill="none" stroke="${colors[e.kind]}" stroke-width="${(e.width * S).toFixed(1)}" stroke-linejoin="round"/>`); continue; }
  out.push(`<line x1="${X(a.x)}" y1="${Y(a.z)}" x2="${X(b.x)}" y2="${Y(b.z)}" stroke="${colors[e.kind]}" stroke-width="${(e.width * S).toFixed(1)}" stroke-linecap="square"/>`);
  if (ramp) out.push(`<line x1="${X(a.x)}" y1="${Y(a.z)}" x2="${X(b.x)}" y2="${Y(b.z)}" stroke="#fff" stroke-width="3" stroke-dasharray="4 8" opacity=".9"/>`);
}
for (const t of city.tracks) out.push(`<line x1="${X(t.from)}" y1="${Y(t.offset)}" x2="${X(t.to)}" y2="${Y(t.offset)}" stroke="#6b5148" stroke-width="1.6"/>`);
// Crossings.
for (const n of Object.values(city.nodes)) {
  if (n.kind === 'round') {
    out.push(`<circle cx="${X(n.x)}" cy="${Y(n.z)}" r="${(city.roundabout.lane + 6) * S}" fill="#7c8794"/><circle cx="${X(n.x)}" cy="${Y(n.z)}" r="${city.roundabout.island * S}" fill="#7fae63" stroke="#fff" stroke-width="2"/>`);
  } else if (n.kind === 'signal') out.push(`<circle cx="${X(n.x)}" cy="${Y(n.z)}" r="9" fill="#2f8f4a" stroke="#fff" stroke-width="2.5"/>`);
}
// Zebras and the car park.
for (const z of city.zebras) out.push(`<rect x="${X(z.rect.x - z.rect.halfX)}" y="${Y(z.rect.z - z.rect.halfZ)}" width="${z.rect.halfX * 2 * S}" height="${z.rect.halfZ * 2 * S}" fill="#fff" stroke="#333" stroke-width="1.2"/>`);
const P = city.parking;
for (const r of [P.area, P.driveway]) out.push(`<rect x="${X(r.x - r.halfX)}" y="${Y(r.z - r.halfZ)}" width="${r.halfX * 2 * S}" height="${r.halfZ * 2 * S}" fill="#8a96a3" rx="3"/>`);
out.push(`<text x="${X(P.area.x)}" y="${+Y(P.area.z) + 6}" text-anchor="middle" font-size="18" font-weight="700" fill="#fff">P</text>`);
// Start of the exam.
out.push(`<path d="M${X(6)} ${Y(150)} l-9 18 h18 z" fill="#d0662f"/><text x="${+X(6) + 14}" y="${+Y(160) + 4}" font-size="15" font-weight="700" fill="#d0662f">Старт</text>`);
// Labels.
const label = (x: number, z: number, text: string, size = 17, color = '#2e3a4f') => out.push(`<text x="${X(x)}" y="${Y(z)}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${color}" paint-order="stroke" stroke="#f4f0e6" stroke-width="4">${text}</text>`);
label(180, -205, 'ВЕРХНИЙ ГОРОД', 26, '#3d6b2e');
label(180, -188, 'холм +9 м', 18, '#3d6b2e');
label(-135, -40, 'ЦЕНТР', 32);
label(0, -432, 'ОКРУЖНАЯ · 70 км/ч', 24, '#2f5f9c');
label(-135, -100, 'главная дорога (2.1)', 19, '#8a6a12');
label(-225, 80, 'трамвайный проспект', 19, '#8a4a3a');
label(45, -140, 'проспект', 19, '#465260');
label(45, -124, 'со светофорами', 19, '#465260');
label(238, -300, 'кольцо 4.3', 20, '#3d6b2e');
// Legend.
const ly = size + 20;
const legend: [string, string][] = [['#e2b84a', 'Главная дорога'], ['#5b8fd1', 'Окружная, 70 км/ч'], ['#c98b78', 'Трамвайный проспект'], ['#7c8794', 'Широкая улица, 2+2 полосы'], ['#9aa3ad', 'Улица']];
legend.forEach(([c, t], i) => { const x = PAD + (i % 3) * 430, y = ly + Math.floor(i / 3) * 34; out.push(`<rect x="${x}" y="${y}" width="34" height="16" rx="3" fill="${c}"/><text x="${x + 44}" y="${y + 14}" font-size="19" fill="#2e3a4f">${t}</text>`); });
const ly2 = ly + 70;
out.push(`<circle cx="${PAD + 10}" cy="${ly2 + 6}" r="8" fill="#2f8f4a" stroke="#fff" stroke-width="2"/><text x="${PAD + 26}" y="${ly2 + 11}" font-size="19" fill="#2e3a4f">Светофор</text>`);
out.push(`<rect x="${PAD + 140}" y="${ly2}" width="12" height="14" fill="#fff" stroke="#333"/><text x="${PAD + 160}" y="${ly2 + 11}" font-size="19" fill="#2e3a4f">«Зебра» без светофора</text>`);
out.push(`<line x1="${PAD + 430}" y1="${ly2 + 7}" x2="${PAD + 470}" y2="${ly2 + 7}" stroke="#9aa3ad" stroke-width="10"/><line x1="${PAD + 430}" y1="${ly2 + 7}" x2="${PAD + 470}" y2="${ly2 + 7}" stroke="#fff" stroke-width="3" stroke-dasharray="4 8"/><text x="${PAD + 480}" y="${ly2 + 11}" font-size="19" fill="#2e3a4f">Подъём на холм</text>`);
out.push(`<rect x="${PAD + 680}" y="${ly2}" width="18" height="14" fill="#8a96a3"/><text x="${PAD + 706}" y="${ly2 + 11}" font-size="19" fill="#2e3a4f">Парковка (выезд на экзамене)</text>`);
out.push(`<text x="${PAD}" y="${ly2 + 48}" font-size="16" fill="#6b6457">Город 7×7 перекрёстков, кварталы 90 м; извилистая окружная вокруг. Север сверху. Схема построена из данных игры (src/game/city.ts).</text>`);
out.push('</svg>');
writeFileSync(process.argv[2] ?? 'city-map.svg', out.join('\n'));
console.log('written', process.argv[2]);
