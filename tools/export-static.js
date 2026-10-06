#!/usr/bin/env node
'use strict';

/**
 * 공개 사이트를 정적 파일로 내보냅니다 (Cloudflare Pages 등에 올리기 위한 빌드).
 *
 *   node tools/export-static.js                       # 사이트 설정의 도메인을 기준으로
 *   node tools/export-static.js --base https://x.pages.dev
 *   node tools/export-static.js --out dist
 *
 * 관리자·로그인 화면은 개인용이므로 내보내지 않습니다. 앱을 추가·수정한 뒤 다시 실행하세요.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const manifest = require('../src/manifest');
const siteStore = require('../src/site');
const build = require('../src/build');
const { injectAppAds } = require('../src/miniapp-ads');
const secrets = require('../src/secrets');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const APPS_DIR = path.join(ROOT, 'apps');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT = path.resolve(ROOT, arg('out', 'dist'));
// 정적 사이트에서 관리자 화면은 이 PC(로컬 서버)에서 씁니다.
const SITE_ADMIN_FALLBACK = process.env.ADMIN_URL || 'http://localhost:3000/admin.html';

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function writeFile(rel, contents) {
  const target = path.join(OUT, rel);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, contents, 'utf8');
  return target;
}

async function copyFile(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.copyFile(from, to);
  return to;
}

async function copyDir(from, to, { skip = [] } = {}) {
  await fsp.mkdir(to, { recursive: true });
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest, { skip });
    else await fsp.copyFile(src, dest);
  }
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * 앱 파일은 그대로 배포되지만, 검색엔진과 광고 심사가 보기에는 설명이 없습니다.
 * 그래서 배포본에만 canonical(→ /app/<id> 상세 페이지)·설명·뷰포트 태그를 넣어 줍니다.
 * 광고 코드는 넣지 않습니다 — 도구 화면은 내용이 적어 "내용 없는 페이지에 광고" 위험이 있습니다.
 */
function injectAppHead(html, { app, site }) {
  const desc = (app.desc || `${app.name} — ${site.name}에서 제공하는 웹앱`).slice(0, 300);
  const canonical = `${site.domain}/app/${app.id}`;
  const tags = [
    `<link rel="canonical" href="${xmlEscape(canonical)}" />`,
    `<meta name="description" content="${xmlEscape(desc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${xmlEscape(site.name)}" />`,
    `<meta property="og:title" content="${xmlEscape(app.name)}" />`,
    `<meta property="og:description" content="${xmlEscape(desc)}" />`,
    `<meta property="og:url" content="${xmlEscape(canonical)}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ];
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    tags.unshift('<meta name="viewport" content="width=device-width, initial-scale=1" />');
  }
  if (/<head[^>]*>/i.test(html) && !/<\/head>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${tags.join('\n')}`);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${tags.join('\n')}\n</head>`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}\n<head>\n${tags.join('\n')}\n</head>`);
  }
  return `<head>\n${tags.join('\n')}\n</head>\n${html}`;
}

/** Cloudflare Pages 헤더 규칙 */const HEADERS = `# 보안 헤더
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), camera=(), microphone=()
  Strict-Transport-Security: max-age=31536000

# 정적 자산: 주소에 내용 해시(?v=)가 붙으므로 길게 캐시해도 안전합니다.
/assets/*
  Cache-Control: public, max-age=86400

# 앱 파일은 자주 바뀌므로 짧게 캐시
/apps/*
  Cache-Control: public, max-age=600

# 문서는 짧게 캐시 (업데이트 반영)
/*.html
  Cache-Control: public, max-age=0, must-revalidate
`;

(async () => {
  const baseArg = arg('base');
  const siteRaw = await siteStore.readSite();
  const fallbackBase = baseArg || siteRaw.domain;
  if (!fallbackBase) {
    console.error('✗ 내보낼 도메인이 없습니다. 사이트 설정에 도메인을 넣거나 --base 를 지정하세요.');
    process.exit(1);
  }
  const site = siteStore.publicSite({ ...siteRaw, domain: fallbackBase.replace(/\/+$/, '') });
  // 관리자 링크는 사이트 설정의 adminUrl 을 그대로 씁니다 (로컬 서버·터널 주소 등).
  // 정적 사이트에는 /admin.html 이 없으므로, 상대 경로면 /apps/ 목록으로 보냅니다.
  if (!site.adminUrl || site.adminUrl.startsWith('/')) {
    site.adminUrl = SITE_ADMIN_FALLBACK;
  }

  const apps = await manifest.readApps();

  await fsp.rm(OUT, { recursive: true, force: true });
  await fsp.mkdir(OUT, { recursive: true });

  // 1~3) 페이지·검색엔진 파일 렌더링 (Worker 와 같은 함수를 씁니다)
  const rendered = build.renderSite({ site, apps });
  const written = [];
  for (const [rel, contents] of Object.entries(rendered)) {
    written.push(await writeFile(rel, contents));
  }
  written.push(await writeFile('_headers', build.HEADERS));

  // 관리자·로그인 화면도 함께 올립니다 (Worker 가 인증을 걸고 내려보냅니다)
  await copyFile(path.join(PUBLIC_DIR, 'admin.html'), path.join(OUT, 'admin.html'));
  await copyFile(path.join(PUBLIC_DIR, 'login.html'), path.join(OUT, 'login.html'));

  // 그 밖의 public/ 최상위 파일(검색엔진 소유 확인 파일 등)도 그대로 올립니다.
  // 예: naver-site-verification, google-site-verification, BingSiteAuth.xml
  for (const entry of await fsp.readdir(PUBLIC_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) continue; // assets/ 는 따로 복사
    if (['admin.html', 'login.html'].includes(entry.name)) continue;
    await copyFile(path.join(PUBLIC_DIR, entry.name), path.join(OUT, entry.name));
  }

  // 4) 정적 자산과 앱 파일 복사 (관리자·로그인 화면은 제외)
  await copyDir(path.join(PUBLIC_DIR, 'assets'), path.join(OUT, 'assets'));
  await copyDir(APPS_DIR, path.join(OUT, 'apps'), { skip: ['index.html'] });
  // 앱 폴더 안의 index.html 은 위에서 제외했으므로 다시 복사하며 메타 태그를 주입합니다
  for (const app of apps) {
    const from = path.join(APPS_DIR, app.id);
    if (!fs.existsSync(from)) continue;
    const dest = path.join(OUT, 'apps', app.id);
    await copyDir(from, dest);
    const entry = path.join(dest, 'index.html');
    if (fs.existsSync(entry)) {
      const raw = await fsp.readFile(entry, 'utf8');
      const cleaned = secrets.cleanHtml(raw);
      if (cleaned.findings.length || cleaned.removed.length) {
        console.warn(`  ⚠ ${app.id}: 비밀값 ${cleaned.findings.length}건 제거${cleaned.removed.length ? ` + 설정 블록 ${cleaned.removed.length}개` : ''}`);
      }
      const withSeo = injectAppHead(cleaned.html, { app, site });
      await fsp.writeFile(entry, injectAppAds(withSeo, {
        client: site.adsense?.client,
        slot: site.adsense?.slotDisplay || site.adsense?.slotInline,
      }), 'utf8');
    }
    // 앱 안의 다른 html 파일에도 광고를 넣습니다
    for (const file of await fsp.readdir(dest, { withFileTypes: true })) {
      if (!file.isFile() || !/\.html?$/i.test(file.name) || file.name === 'index.html') continue;
      const target = path.join(dest, file.name);
      const html = secrets.cleanHtml(await fsp.readFile(target, 'utf8')).html;
      await fsp.writeFile(target, injectAppAds(html, {
        client: site.adsense?.client,
        slot: site.adsense?.slotDisplay || site.adsense?.slotInline,
      }), 'utf8');
    }
    // 사용설명서(.md)도 정적 배포본에 함께 넣어 둡니다 (상세 페이지의 내려받기 링크)
    if (app.manual) {
      const manualPath = path.join(dest, 'manual.md');
      await fsp.writeFile(manualPath, app.manual, 'utf8');
      written.push(manualPath);
    }
  }

  const size = await dirSize(OUT);
  log(`✓ 정적 빌드 완료: ${path.relative(ROOT, OUT)}/`);
  log(`  도메인(기준): ${site.domain}`);
  log(`  페이지 ${written.length}개 · 앱 ${apps.length}개 · 전체 ${(size / 1024 / 1024).toFixed(2)}MB`);
  log(`  다음: npx wrangler pages deploy ${path.relative(ROOT, OUT)} --project-name=reversroad`);
})().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});

async function dirSize(dir) {
  let total = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(target);
    else total += (await fsp.stat(target)).size;
  }
  return total;
}
