'use strict';
// public/assets/logo.svg 를 headless Chrome 으로 렌더링해 logo.png(512×512)를 만듭니다.
// 파비콘·og:image 처럼 폰트 환경과 무관하게 같은 그림이 필요한 곳에 씁니다.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'
);
const PORT = 9339;
const SVG = process.argv[2] || '/Users/macmini/GensparkCode/myhome/public/assets/logo.svg';
const OUT = process.argv[3] || '/Users/macmini/GensparkCode/myhome/public/assets/logo.png';
const SIZE = Number(process.argv[4] || 512);
const WHITE_BG = process.argv[5] !== 'transparent';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myhome-logo-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url) {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* ignore */ }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:${WHITE_BG ? '#ffffff' : 'transparent'};}
    svg{display:block;width:${SIZE}px;height:${SIZE}px}
  </style></head><body>${svg}</body></html>`;

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--force-color-profile=srgb',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitHttp(`http://127.0.0.1:${PORT}/json/version`);
    const list = await waitHttp(`http://127.0.0.1:${PORT}/json/list`);
    const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` });
    await sleep(600);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      omitBackground: !WHITE_BG,
    });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    console.log(`wrote ${OUT} (${SIZE}px, ${WHITE_BG ? 'white background' : 'transparent'})`);
  } finally {
    chrome.kill('SIGKILL');
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* cache */ }
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
