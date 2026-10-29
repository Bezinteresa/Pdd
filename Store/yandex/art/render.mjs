// Renders keyart.html into the store images with headless Chrome (DevTools protocol, no npm packages).
// Run from anywhere: node Store/yandex/art/render.mjs  → PNG files next to listing.md.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), out = path.resolve(here, '..');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const jobs = [['icon', 512, 512, 'icon_512x512.png'], ['maskable', 512, 512, 'icon_maskable_512x512.png'], ['cover', 800, 470, 'cover_800x470_ru.png'], ['showcase', 1560, 520, 'showcase_1560x520_ru.png']];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); fs.createReadStream(path.join(here, 'keyart.html')).pipe(res); }).listen(4301);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'keyart-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=4302', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let targets = []; for (let i = 0; i < 50 && !targets.some(t => t.type === 'page'); i++) { try { targets = await (await fetch('http://127.0.0.1:4302/json')).json(); } catch {} await sleep(200); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map(); ws.onmessage = m => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); };
const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
for (const [mode, width, height, file] of jobs) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://localhost:4301/?mode=${mode}` }); await sleep(700);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
  fs.writeFileSync(path.join(out, file), Buffer.from(shot.data, 'base64')); console.log('saved', file);
}
ws.close(); chrome.kill(); server.close(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
