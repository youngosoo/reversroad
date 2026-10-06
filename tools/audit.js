#!/usr/bin/env node
'use strict';

/**
 * 애드센스 심사 관점에서 정적 빌드를 자동 점검합니다.
 *
 *   node tools/audit.js            # dist/ 를 점검 (먼저 npm run build:static)
 *
 * 확인 항목
 *  - 모든 페이지: title·description 길이, canonical, h1 개수, AdSense 코드, 본문 분량
 *  - 내부 링크가 모두 실제 파일로 연결되는지 (깨진 링크)
 *  - 필수 파일(robots.txt, sitemap.xml, ads.txt)과 sitemap URL 이 실제 페이지와 일치하는지
 *  - 금지·위험 표현, 플레이스홀더(예: example.com) 잔존 여부
 *  - 앱 파일: 외부 의존, 위험 키워드
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, process.argv[2] || 'dist');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site.json'), 'utf8'));
const APPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'apps.json'), 'utf8'));

const problems = [];
const notes = [];
function bad(msg) { problems.push(msg); }
function warn(msg) { notes.push(msg); }

function rel(p) { return path.relative(DIST, p); }

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, out);
    else out.push(target);
  }
  return out;
}

const strip = (html) => html
  .replace(/\s(?:placeholder|value|title|alt)="[^"]*"/gi, ' ') // 입력 예시 문구는 내용이 아니므로 제외
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

if (!fs.existsSync(DIST)) {
  console.error(`✗ ${DIST} 가 없습니다. 먼저 npm run build:static 을 실행하세요.`);
  process.exit(1);
}

const files = walk(DIST);
// 관리자·로그인 화면과 검색엔진 소유확인 파일은 콘텐츠 페이지가 아니므로 점검에서 제외합니다
const PRIVATE_PAGES = ['/admin.html', '/login.html'];
const VERIFICATION_FILE = /^\/(naver|google|yandex|bing|msvalidate)[a-z0-9_.-]*\.html?$/i;
const htmlFiles = files.filter((f) => {
  const url = '/' + rel(f).split(path.sep).join('/');
  return f.endsWith('.html') && !PRIVATE_PAGES.includes(url) && !VERIFICATION_FILE.test(url);
});
const existing = new Set(files.map((f) => '/' + rel(f).split(path.sep).join('/')));

// ---------- 1) 페이지별 점검
console.log(`\n■ 페이지 점검 (${htmlFiles.length}개)\n`);
console.log('  페이지'.padEnd(42) + '제목  설명  h1  본문자  canonical  광고');
for (const file of htmlFiles.sort()) {
  const html = fs.readFileSync(file, 'utf8');
  const url = '/' + rel(file).split(path.sep).join('/');
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const desc = (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || '';
  const canonical = (html.match(/rel="canonical" href="([^"]*)"/i) || [])[1] || '';
  const h1s = [...html.matchAll(/<h1[\s>]/gi)].length;
  const text = strip(html);
  const chars = text.replace(/\s/g, '').length;
  const ads = /adsbygoogle\.js\?client=ca-pub-\d+/.test(html);
  const is404 = url === '/404.html';
  const isAppFile = /^\/apps\/[^/]+\/index\.html$/.test(url);

  const row = [
    url.padEnd(40).slice(0, 40),
    String(title.length).padStart(4),
    String(desc.length).padStart(5),
    String(h1s).padStart(3),
    String(chars).padStart(6),
    canonical ? '   있음   ' : '   없음   ',
    ads ? ' 있음' : ' 없음',
  ].join(' ');
  console.log(`  ${row}`);

  if (is404) {
    if (!/noindex/.test(html)) bad('404 페이지에 noindex 가 없습니다');
    continue;
  }
  if (isAppFile) {
    // 앱 실행 화면: 상세 페이지로 canonical 을 모아 두고, 광고는 넣지 않습니다.
    if (!canonical) bad(`${url}: canonical 없음 (상세 페이지로 모아야 함)`);
    else if (!canonical.startsWith(`${SITE.domain}/app/`)) bad(`${url}: canonical 이 상세 페이지가 아닙니다 (${canonical})`);
    if (!desc) bad(`${url}: meta description 없음`);
    // 앱 실행 화면에도 광고를 넣습니다(운영자 요청) — head 스크립트와 하단 1개까지만 허용
    if (ads && !/class="rr-ad/.test(html)) warn(`${url}: 광고 스크립트는 있는데 광고 자리(rr-ad)가 없습니다`);
    continue;
  }
  if (!title) bad(`${url}: <title> 없음`);
  else if (title.length < 12) bad(`${url}: 제목이 너무 짧습니다 (${title.length}자)`);
  else if (title.length > 70) warn(`${url}: 제목이 깁니다 (${title.length}자, 60자 권장)`);
  if (!desc) bad(`${url}: meta description 없음`);
  else if (desc.length < 50) bad(`${url}: 설명이 너무 짧습니다 (${desc.length}자)`);
  else if (desc.length > 160) warn(`${url}: 설명이 깁니다 (${desc.length}자, 160자 권장)`);
  if (h1s !== 1) bad(`${url}: h1 이 ${h1s}개입니다 (1개 권장)`);
  if (!canonical) bad(`${url}: canonical 없음`);
  else if (!canonical.startsWith(SITE.domain)) bad(`${url}: canonical 이 도메인과 다릅니다 (${canonical})`);
  if (!ads) bad(`${url}: AdSense 코드 없음`);
  if (chars < 800) bad(`${url}: 본문이 빈약합니다 (${chars}자) — 애드센스 '가치가 낮은 콘텐츠' 위험`);
  else if (chars < 1500) warn(`${url}: 본문이 다소 짧습니다 (${chars}자)`);
}

// ---------- 2) 내부 링크
console.log('\n■ 내부 링크 점검\n');
const linkMap = new Map();
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const href = m[1];
    if (!linkMap.has(href)) linkMap.set(href, new Set());
    linkMap.get(href).add('/' + rel(file).split(path.sep).join('/'));
  }
}
let brokenCount = 0;
for (const [href, from] of linkMap) {
  const clean = href.replace(/\/$/, '');
  const candidates = [
    href,
    `${href}index.html`,
    clean ? `${clean}/index.html` : '/index.html',
    `${clean}.html`,
    clean,
  ];
  const ok = candidates.some((c) => existing.has(c))
    || files.some((f) => '/' + rel(f).split(path.sep).join('/') === clean);
  if (!ok) {
    brokenCount += 1;
    bad(`깨진 내부 링크: ${href} (${[...from].slice(0, 2).join(', ')})`);
  }
}
console.log(`  내부 링크 ${linkMap.size}개 · 깨진 링크 ${brokenCount}개`);

// ---------- 3) 필수 파일
console.log('\n■ 필수 파일\n');
const robots = fs.existsSync(path.join(DIST, 'robots.txt')) ? fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') : '';
const ads = fs.existsSync(path.join(DIST, 'ads.txt')) ? fs.readFileSync(path.join(DIST, 'ads.txt'), 'utf8') : '';
const sitemap = fs.existsSync(path.join(DIST, 'sitemap.xml')) ? fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8') : '';
console.log(`  robots.txt ${robots ? '있음' : '없음'} · ads.txt ${ads ? '있음' : '없음'} · sitemap.xml ${sitemap ? '있음' : '없음'}`);
if (!robots) bad('robots.txt 없음');
if (!ads) bad('ads.txt 없음');
if (!sitemap) bad('sitemap.xml 없음');
if (robots && !/Mediapartners-Google/.test(robots)) bad('robots.txt 에 Mediapartners-Google 허용이 없습니다');
if (ads && !/^google\.com, pub-\d+, DIRECT, f08c47fec0942fa0$/m.test(ads)) bad('ads.txt 형식이 올바르지 않습니다');
if (robots && !robots.includes(`${SITE.domain}/sitemap.xml`)) bad('robots.txt 의 Sitemap 주소가 도메인과 다릅니다');

const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const missingInSitemap = [];
for (const loc of locs) {
  const p = loc.replace(SITE.domain, '');
  const target = p === '/' ? '/index.html' : `${p.replace(/\/$/, '')}/index.html`;
  if (!existing.has(target)) missingInSitemap.push(loc);
}
console.log(`  sitemap URL ${locs.length}개 · 실제 파일 없는 URL ${missingInSitemap.length}개`);
missingInSitemap.forEach((l) => bad(`sitemap 에 있지만 파일이 없음: ${l}`));

// 사이트맵에 빠진 페이지
const sitemapPaths = new Set(locs.map((l) => l.replace(SITE.domain, '').replace(/\/$/, '') || '/'));
for (const file of htmlFiles) {
  const url = '/' + rel(file).split(path.sep).join('/');
  if (url === '/404.html') continue;
  if (/^\/apps\/[^/]+\/index\.html$/.test(url)) continue; // 앱 실행 화면은 canonical 로 상세 페이지에 모음
  const asPath = url === '/index.html' ? '/' : url.replace(/\/index\.html$/, '');
  if (!sitemapPaths.has(asPath)) warn(`sitemap 에 빠진 페이지: ${asPath}`);
}

// ---------- 3-1) 카테고리 점검
console.log('\n■ 카테고리 점검\n');
const { CATEGORIES } = require('../src/categories');
const usedSlugs = new Set(APPS.map((a) => a.category).filter(Boolean));
const unknown = [...usedSlugs].filter((slug) => !CATEGORIES.some((c) => c.slug === slug));
if (unknown.length) bad(`알 수 없는 카테고리: ${unknown.join(', ')}`);
const uncategorized = APPS.filter((a) => !a.category);
if (uncategorized.length) bad(`분야가 지정되지 않은 앱: ${uncategorized.map((a) => a.id).join(', ')}`);
for (const slug of usedSlugs) {
  const page = path.join(DIST, 'category', slug, 'index.html');
  if (!fs.existsSync(page)) bad(`카테고리 페이지 없음: /category/${slug}`);
}
console.log(`  앱 ${APPS.length}개 · 사용 중인 분야 ${usedSlugs.size}개: ${[...usedSlugs].join(', ')}`);
if (!fs.existsSync(path.join(DIST, 'categories', 'index.html'))) bad('/categories 페이지 없음');

// ---------- 4) 표현·플레이스홀더
console.log('\n■ 표현·플레이스홀더 점검\n');
const banned = [
  [/(준비\s*중|coming\s*soon|under\s*construction|공사중)/i, '준비 중 문구'],
  [/(example\.com|your-email@|테스트\s*문구|lorem ipsum)/i, '플레이스홀더'],
  [/(도박|카지노|성인|음란|불법\s*다운로드|토렌트|해킹\s*툴)/, '금지 가능 표현'],
  [/(광고를?\s*클릭\s*해\s*주세요|click\s+my\s+ads?)/i, '광고 클릭 유도'],
];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const text = strip(html);
  for (const [re, label] of banned) {
    if (re.test(text)) bad(`${label}: ${'/' + rel(file).split(path.sep).join('/')}`);
  }
}
console.log(`  금지 표현·플레이스홀더 검사 완료`);

// ---------- 4-1) 비밀값(API 키·토큰) 노출
console.log('\n■ 비밀값 노출 점검\n');
const { scanSecrets } = require('../src/secrets');
let secretHits = 0;
for (const app of APPS) {
  const target = path.join(DIST, 'apps', app.id, 'index.html');
  if (!fs.existsSync(target)) continue;
  const found = scanSecrets(fs.readFileSync(target, 'utf8'));
  if (found.length) {
    secretHits += found.length;
    bad(`앱에 비밀값 노출: ${app.id} → ${found.map((f) => f.name).join(', ')}`);
  }
}
console.log(`  앱 ${APPS.length}개 검사 · 비밀값 ${secretHits}건`);
if (!secretHits) console.log('  (깨끗함)');

// ---------- 5) 앱 파일
console.log('\n■ 앱 파일 점검\n');
for (const app of APPS) {
  const dir = path.join(DIST, 'apps', app.id);
  const target = path.join(dir, 'index.html');
  if (!fs.existsSync(target)) { bad(`앱 파일 없음: ${app.id}`); continue; }
  const html = fs.readFileSync(target, 'utf8');
  const bytes = Buffer.byteLength(html);
  const ext = [...new Set((html.match(/https?:\/\/[^"')\s]+/g) || []))].filter((u) => !/w3\.org|schema\.org/.test(u));
  const offlineFriendly = ext.length === 0;
  const risky = /(성인|음란|도박|카지노|해킹|크랙|불법|porn|casino|hack|crack)/i.test(strip(html));
  console.log(`  ${app.id.padEnd(24)} ${(bytes / 1024).toFixed(0).padStart(4)}KB · 외부 리소스 ${String(ext.length).padStart(2)}개 · 위험표현 ${risky ? '있음 ⚠' : '없음'}`);
  if (risky) bad(`앱에 위험 표현: ${app.id}`);
  if (!offlineFriendly) {
    const detail = path.join(DIST, 'app', app.id, 'index.html');
    const detailHtml = fs.existsSync(detail) ? fs.readFileSync(detail, 'utf8') : '';
    if (!/인터넷 연결이 필요합니다/.test(detailHtml)) {
      bad(`${app.id}: 외부 리소스 ${ext.length}개에 의존하는데 상세 페이지에 "인터넷 연결이 필요합니다" 안내가 없습니다`);
    } else {
      console.log(`  └ 상세 페이지에 인터넷 필요 안내 있음`);
    }
  }
  if (!html.includes('viewport')) warn(`${app.id}: viewport 메타 없음 (모바일 표시 문제 가능)`);
}

// ---------- 결과
console.log('\n' + '='.repeat(70));
if (problems.length === 0) {
  console.log('✅ 필수 점검 항목 모두 통과');
} else {
  console.log(`❌ 고쳐야 할 항목 ${problems.length}개`);
  problems.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
}
if (notes.length) {
  console.log(`\n△ 참고할 항목 ${notes.length}개`);
  notes.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
}
console.log('='.repeat(70) + '\n');
process.exit(problems.length ? 1 : 0);
