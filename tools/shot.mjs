// Chụp trang bằng Chrome headless qua DevTools Protocol, gom console/exception/lỗi mạng, chờ thời gian THẬT.
// node cdp.mjs <url> <out.png> [giây=8] [W=1920] [H=1080]   (env EVAL="js" chạy thêm một biểu thức cuối cùng; CHROME_FLAGS="--flag ..." thêm cờ Chrome)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [url, out, secs = '8', W = '1920', H = '1080'] = process.argv.slice(2);
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--hide-scrollbars', `--window-size=${W},${H}`, `--remote-debugging-port=${port}`,
   `--user-data-dir=/tmp/cdp-${port}`, '--no-first-run', ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ') : []), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === 'page');
if (!page) { console.error('không mở được Chrome'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const fmt = (a) => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type);
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ${m.params.args.map(fmt).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; logs.push(`[exception] ${d.exception?.description || d.text} @${d.url || ''}:${d.lineNumber}`); }
  if (m.method === 'Log.entryAdded') logs.push(`[${m.params.entry.source}:${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
};
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: false, screenWidth: +W, screenHeight: +H });
await send('Page.navigate', { url });
await sleep(+secs * 1000);
// Thao tác chuột: DRAG="x0,y0,x1,y1[,ms]" kéo (nhiều bước); CLICK="x,y" bấm. Toạ độ CSS px của cửa sổ.
const mouse = (type, x, y, button = 'left', buttons = 1) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
if (process.env.CLICK) { const [x, y] = process.env.CLICK.split(',').map(Number); await mouse('mouseMoved', x, y, 'none', 0); await mouse('mousePressed', x, y); await sleep(60); await mouse('mouseReleased', x, y); }
if (process.env.DRAG) {
  const [x0, y0, x1, y1, ms = 600] = process.env.DRAG.split(',').map(Number);
  await mouse('mouseMoved', x0, y0, 'none', 0); await mouse('mousePressed', x0, y0);
  const n = 24;
  for (let i = 1; i <= n; i++) { await mouse('mouseMoved', x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n); await sleep(ms / n); }
  if (!process.env.HOLD) await mouse('mouseReleased', x1, y1);
}
if (process.env.AFTER) await sleep(+process.env.AFTER * 1000);
if (process.env.EVAL) {
  try { const r = await send('Runtime.evaluate', { expression: process.env.EVAL, returnByValue: true, awaitPromise: true }); logs.push('[eval] ' + JSON.stringify(r.result.value ?? r.result.description)); }
  catch (e) { logs.push('[eval-error] ' + e.message); }
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(logs.length ? logs.join('\n') : '(console trống)');
ws.close(); chrome.kill();
