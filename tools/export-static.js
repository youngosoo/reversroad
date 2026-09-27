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
const seo = require('../src/seo');
const pages = require('../src/views/pages');
const { GUIDES, findGuide } = require('../src/content/guides');
const categories = require('../src/categories');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const APPS_DIR = path.join(ROOT, 'apps');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT = path.resolve(ROOT, arg('out', 'dist'));

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function writeFile(rel, contents) {
  const target = path.join(OUT, rel);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, contents, 'utf8');
  return target;
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

# 정적 자산은 오래 캐시
/assets/*
  Cache-Control: public, max-age=604800, immutable

# 앱 파일은 오래 캐시
/apps/*
  Cache-Control: public, max-age=604800

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
  site.hideAdmin = true; // 정적 사이트에는 관리자 화면이 없습니다

  const apps = await manifest.readApps();

  await fsp.rm(OUT, { recursive: true, force: true });
  await fsp.mkdir(OUT, { recursive: true });

  // 1) 페이지
  const written = [];
  written.push(await writeFile('index.html', pages.homePage({ site, apps, guides: GUIDES })));
  written.push(await writeFile('apps/index.html', pages.appsPage({ site, apps })));
  for (const app of apps) {
    written.push(await writeFile(path.join('app', app.id, 'index.html'), pages.appDetailPage({ site, app, apps })));
  }
  written.push(await writeFile('guide/index.html', pages.guideIndexPage({ site, apps, guides: GUIDES })));
  for (const guide of GUIDES) {
    written.push(await writeFile(path.join('guide', guide.slug, 'index.html'), pages.guideDetailPage({ site, guide, apps })));
  }
  written.push(await writeFile('categories/index.html', pages.categoriesPage({ site, apps })));
  const usedCategories = new Set(apps.map((a) => a.category).filter(Boolean));
  for (const category of categories.listCategories()) {
    if (!usedCategories.has(category.slug)) continue; // 앱이 없는 분야는 빈 페이지가 되므로 만들지 않습니다
    written.push(await writeFile(path.join('category', category.slug, 'index.html'), pages.categoryPage({ site, apps, category })));
  }
  written.push(await writeFile('about/index.html', pages.aboutPage({ site, apps, guides: GUIDES })));
  written.push(await writeFile('contact/index.html', pages.contactPage({ site })));
  written.push(await writeFile('privacy/index.html', pages.policyPage({ site, doc: pages.privacyPolicy(site) })));
  written.push(await writeFile('terms/index.html', pages.policyPage({ site, doc: pages.termsOfService(site) })));
  written.push(await writeFile('disclaimer/index.html', pages.policyPage({ site, doc: pages.disclaimer(site) })));
  written.push(await writeFile('404.html', pages.notFoundPage({ site })));

  // 2) 검색엔진·광고용 파일
  written.push(await writeFile('robots.txt', seo.robots({ site })));
  written.push(await writeFile('sitemap.xml', seo.sitemap({ site, apps })));
  const ads = seo.adsTxt({ site });
  if (ads) written.push(await writeFile('ads.txt', ads));

  // 3) Cloudflare 설정 파일
  written.push(await writeFile('_headers', HEADERS));

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
      const html = await fsp.readFile(entry, 'utf8');
      await fsp.writeFile(entry, injectAppHead(html, { app, site }), 'utf8');
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
