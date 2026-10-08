#!/usr/bin/env node
'use strict';

/**
 * SNS 공유용 대표 이미지(1200×630)를 만듭니다.
 *
 *   node tools/render-og.js
 *
 * 결과: public/assets/og-home.png · public/assets/og-app.png
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHROME = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'
);
const PORT = 9362;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site.json'), 'utf8'));
const apps = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'apps.json'), 'utf8')).filter((a) => !a.hidden);

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function page({ title, subtitle, chips, badge }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    font-family: -apple-system, "Apple SD Gothic Neo", "Segoe UI", system-ui, sans-serif;
    background: #FFD400; color: #0D0D0D;
    display: flex; flex-direction: column; justify-content: space-between; padding: 64px 72px;
    position: relative;
  }
  .glow { position: absolute; right: -120px; top: -120px; width: 520px; height: 520px; border-radius: 50%; background: rgba(255,255,255,.35); }
  .glow2 { position: absolute; left: -160px; bottom: -220px; width: 480px; height: 480px; border-radius: 50%; background: rgba(0,0,0,.06); }
  header { display: flex; align-items: center; gap: 18px; position: relative; }
  .mark { width: 72px; height: 72px; border-radius: 50%; background: #0D0D0D; color: #FFD400; display: grid; place-items: center; font: 700 46px/1 Georgia, "Times New Roman", serif; }
  .brand { font-size: 28px; font-weight: 800; letter-spacing: -0.01em; }
  main { position: relative; }
  h1 { font-size: 74px; line-height: 1.14; letter-spacing: -0.03em; max-width: 950px; }
  p.sub { margin-top: 18px; font-size: 30px; font-weight: 600; opacity: .78; }
  footer { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; position: relative; }
  .chip { background: rgba(0,0,0,.08); border: 2px solid rgba(0,0,0,.16); border-radius: 999px; padding: 10px 20px; font-size: 24px; font-weight: 700; }
  .badge { position: absolute; right: 72px; bottom: 64px; background: #0D0D0D; color: #FFD400; border-radius: 999px; padding: 14px 28px; font-size: 26px; font-weight: 800; }
</style></head><body>
  <div class="glow"></div><div class="glow2"></div>
  <header><span class="mark">R</span><span class="brand">${esc(site.name)}</span></header>
  <main><h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p></main>
  <footer>${(chips || []).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</footer>
  ${badge ? `<div class="badge">${esc(badge)}</div>` : ''}
</body></html>`;
}

async function waitHttp(url) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch { /* ignore */ }
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
}

(async () => {
  const appNames = apps.map((a) => a.name);
  const shots = [
    {
      file: path.join(ROOT, 'public', 'assets', 'og-home.png'),
      html: page({
        title: '설치 없이 바로 쓰는\n무료 온라인 도구',
        subtitle: site.tagline || '브라우저에서 바로 쓰는 웹앱 모음',
        chips: appNames.slice(0, 5),
        badge: `웹앱 ${apps.length}개 · 무료`,
      }),
    },
    {
      file: path.join(ROOT, 'public', 'assets', 'og-app.png'),
      html: page({
        title: '앱마다 사용법과\n주의사항까지 정리',
        subtitle: '설치·회원가입 없이, 데이터는 내 브라우저에만',
        chips: ['사용법 안내', '오프라인 동작', '무료', '회원가입 없음'],
        badge: site.name,
      }),
    },
  ];

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-og-'));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--hide-scrollbars',
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });

    for (const shot of shots) {
      await cdp.send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(shot.html)}` });
      await sleep(700);
      const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(shot.file, Buffer.from(png.data, 'base64'));
      console.log(`✓ ${path.relative(ROOT, shot.file)} (1200×630)`);
    }
  } finally {
    chrome.kill('SIGKILL');
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* cache */ }
  }
})().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
