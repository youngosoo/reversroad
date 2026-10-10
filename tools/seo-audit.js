#!/usr/bin/env node
'use strict';

/**
 * Google 검색엔진 최적화(SEO) 기본 가이드 기준 자체 점검.
 *
 *   node tools/seo-audit.js                 # 배포 사이트 점검
 *   node tools/seo-audit.js --base http://localhost:3111
 *   node tools/seo-audit.js --base dist     # 정적 빌드 결과(dist)를 로컬 파일로 점검
 *
 * 점검 항목 (Google SEO 기본 가이드)
 *   - 크롤링: robots.txt · 사이트맵 · 표준 주소(canonical) · 중복 페이지
 *   - 구성: 설명 URL · 탐색경로(breadcrumb) · 내부 링크
 *   - 유용한 콘텐츠: 제목·H1·본문 분량·구조(제목 단계)
 *   - 표시: 제목 링크 길이·고유성, 메타 설명 길이·고유성
 *   - 이미지: 설명 대체 텍스트(alt)
 *   - 링크 텍스트: "여기를 클릭" 같은 무의미한 앵커
 */

const fs = require('fs');
const path = require('path');

const BASE = (() => {
  const i = process.argv.indexOf('--base');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1].replace(/\/+$/, '');
  return 'https://www.reversroad.com';
})();
const FROM_FILES = !/^https?:/.test(BASE);
const ORIGIN = FROM_FILES ? '' : BASE;

const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
const decode = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (html) => decode(strip(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

async function load(url) {
  if (FROM_FILES) {
    const file = path.join(BASE, url.replace(/^\//, ''), url.endsWith('/') || url === '/' ? 'index.html' : '');
    const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  }
  const res = await fetch(ORIGIN + url, { headers: { 'user-agent': 'myhome-seo-audit' } });
  return res.ok ? res.text() : null;
}

async function sitemapUrls() {
  const xml = await load('/sitemap.xml');
  if (!xml) return [];
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
    const loc = m[1].trim();
    return loc.startsWith(ORIGIN) ? loc.slice(ORIGIN.length) || '/' : loc;
  }).filter((u) => u.startsWith('/'));
}

const problems = [];
const notes = [];
const note = (level, url, msg) => (level === 'warn' ? problems : notes).push(`${url}  ${msg}`);

function analyse(url, html, seen) {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1] || '';
  const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i) || [])[1] || '';
  const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i) || [])[1] || '';
  const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => text(m[1]));
  const h2 = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].length;
  const lang = (html.match(/<html[^>]*\slang="([^"]*)"/i) || [])[1] || '';
  const body = text(html.replace(/<header[\s\S]*?<\/header>/i, ' ').replace(/<footer[\s\S]*?<\/footer>/i, ' '));
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((tag) => !/\salt=/.test(tag));
  const generic = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => text(m[1]))
    .filter((t) => /^(여기|여기를 클릭|클릭|더 보기|자세히|바로가기|link|click here|more|read more)$/i.test(t));
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  const brokenLd = jsonLd.filter((m) => { try { JSON.parse(m[1]); return false; } catch { return true; } });
  const nofollow = /rel="nofollow"/i.test(html);

  if (robots.includes('noindex')) note('note', url, 'noindex 페이지(의도된 경우 무시)');
  if (!title) note('warn', url, '제목(<title>) 없음');
  else {
    if (title.length > 60) note('warn', url, `제목이 깁니다(${title.length}자): ${title.slice(0, 40)}…`);
    if (title.length < 15) note('warn', url, `제목이 짧습니다(${title.length}자)`);
    if (seen.titles.has(title)) note('warn', url, `제목 중복: ${title}`);
    seen.titles.add(title);
  }
  if (!desc) note('warn', url, '메타 설명 없음');
  else {
    if (desc.length < 60) note('warn', url, `메타 설명이 짧습니다(${desc.length}자)`);
    if (desc.length > 200) note('warn', url, `메타 설명이 깁니다(${desc.length}자)`);
    if (seen.descs.has(desc)) note('warn', url, '메타 설명 중복');
    seen.descs.add(desc);
  }
  if (!canonical) note('warn', url, 'canonical 없음');
  if (!lang) note('warn', url, 'html lang 없음');
  if (h1.length !== 1) note('warn', url, `H1 이 ${h1.length}개 (1개여야 함)`);
  if (h1.some((t) => t.length > 90)) note('note', url, 'H1 이 깁니다');
  if (!noindex_ok(robots) && body.length < 300) note('warn', url, `본문이 너무 짧습니다(${body.length}자)`);
  if (noAlt.length) note('warn', url, `alt 없는 이미지 ${noAlt.length}개`);
  if (generic.length) note('warn', url, `무의미한 링크 텍스트: ${[...new Set(generic)].join(', ')}`);
  if (brokenLd.length) note('warn', url, '구조화 데이터(JSON-LD) JSON 오류');
  if (!/breadcrumb/i.test(html)) note('note', url, '탐색경로(Breadcrumb) 구조화 데이터 없음');
  return { title, desc, canonical, h1: h1[0] || '', words: body.length, h2, imgs: imgs.length, ld: jsonLd.length, nofollow, jsonLdBlocks: jsonLd.length };
}

function noindex_ok(robots) { return robots.includes('index'); }

(async () => {
  console.log(`SEO 점검: ${FROM_FILES ? `정적 파일 ${BASE}` : BASE}\n`);
  const urls = await sitemapUrls();
  if (!urls.length) {
    console.error('사이트맵에서 URL 을 찾지 못했습니다');
    process.exit(1);
  }
  const seen = { titles: new Set(), descs: new Set() };
  const rows = [];
  for (const url of urls) {
    const html = await load(url);
    if (!html) { problems.push(`${url}  페이지를 불러오지 못했습니다(404?)`); continue; }
    const info = analyse(url, html, seen);
    rows.push({ url, ...info });
  }

  // robots.txt · 사이트맵 기본 요건
  const robots = await load('/robots.txt');
  if (!robots) problems.push('/robots.txt  없음');
  else {
    if (!/Sitemap:\s*https?:\/\//i.test(robots)) problems.push('/robots.txt  Sitemap 줄 없음');
    if (/Disallow:\s*\/assets\//i.test(robots)) problems.push('/robots.txt  CSS·JS(/assets/) 를 막고 있음');
    if (/Disallow:\s*\/\s*$/m.test(robots)) problems.push('/robots.txt  전체 차단(Disallow: /)');
  }
  const dupCanon = new Map();
  for (const r of rows) if (r.canonical) dupCanon.set(r.canonical, (dupCanon.get(r.canonical) || 0) + 1);

  console.log('─'.repeat(100));
  console.log('URL'.padEnd(44), '제목', '설명', 'H1', 'H2', '본문', '이미지', 'LD');
  for (const r of rows) {
    console.log(
      r.url.padEnd(44),
      String(r.title.length).padStart(3),
      String(r.desc.length).padStart(4),
      String(r.h1 ? 1 : 0).padStart(3),
      String(r.h2).padStart(3),
      String(r.words).padStart(5),
      String(r.imgs).padStart(5),
      String(r.ld).padStart(3)
    );
  }
  console.log('─'.repeat(100));
  console.log(`페이지 ${rows.length}개 · 제목 평균 ${Math.round(rows.reduce((a, r) => a + r.title.length, 0) / rows.length)}자 · 설명 평균 ${Math.round(rows.reduce((a, r) => a + r.desc.length, 0) / rows.length)}자 · 고유 제목 ${seen.titles.size}개 · 고유 설명 ${seen.descs.size}개`);

  if (problems.length) {
    console.log(`\n⚠ 고칠 것 ${problems.length}건`);
    for (const p of problems.slice(0, 60)) console.log('  -', p);
    if (problems.length > 60) console.log(`  … 외 ${problems.length - 60}건`);
  } else {
    console.log('\n✅ 기본 점검에서 걸린 항목이 없습니다');
  }
  if (notes.length) {
    console.log(`\n참고(문제 아님) ${notes.length}건`);
    for (const n of [...new Set(notes)].slice(0, 15)) console.log('  ·', n);
  }
  process.exit(problems.length ? 1 : 0);
})();
