'use strict';

/**
 * Cloudflare KV 저장소.
 *
 * 키 구조
 *   data:apps          앱 목록(JSON)
 *   data:site          사이트 설정(JSON)
 *   data:password      관리자 비밀번호 해시
 *   meta:generatedAt   마지막으로 페이지를 만든 시각 (있으면 KV 페이지가 우선)
 *   meta:sessionSecret 세션 쿠키 서명 키 (자동 생성)
 *   page:<경로>        렌더링된 페이지 (index.html, apps/index.html …)
 *   file:<id>/<경로>   앱 파일 (index.html 등)
 *   gone:<id>          삭제된 앱 표시 (정적 배포본에 남은 파일을 가리기 위함)
 *   rl:<ip>            로그인 시도 횟수
 */

const { renderSite } = require('../src/build');
const siteStore = require('../src/site-config');

const KEY = {
  apps: 'data:apps',
  site: 'data:site',
  password: 'data:password',
  generatedAt: 'meta:generatedAt',
  sessionSecret: 'meta:sessionSecret',
};

const fileKey = (id, rel) => `file:${id}/${rel}`;
const pageKey = (rel) => `page:${rel}`;
const goneKey = (id) => `gone:${id}`;

function kv(env) {
  if (!env || !env.MYHOME) throw new Error('KV 바인딩(MYHOME)이 없습니다');
  return env.MYHOME;
}

async function readJson(env, key, fallback) {
  const raw = await kv(env).get(key, 'text');
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------ 앱 목록 */

async function readApps(env) {
  const apps = await readJson(env, KEY.apps, []);
  return Array.isArray(apps) ? apps : [];
}

async function writeApps(env, apps) {
  const sorted = [...apps].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
  await kv(env).put(KEY.apps, JSON.stringify(sorted));
  return sorted;
}

async function getApp(env, id) {
  const apps = await readApps(env);
  return apps.find((a) => a.id === id) || null;
}

/* ------------------------------------------------ 사이트 설정 */

async function readSite(env) {
  const stored = await readJson(env, KEY.site, null);
  return stored ? siteStore.merge(siteStore.DEFAULTS, stored) : { ...siteStore.DEFAULTS };
}

async function writeSite(env, patch) {
  const current = await readSite(env);
  const next = siteStore.merge(current, patch || {});
  next.adsense = { ...next.adsense, client: siteStore.normalizeAdsClient(next.adsense?.client) };
  next.updatedAt = new Date().toISOString();
  await kv(env).put(KEY.site, JSON.stringify(next));
  return next;
}

function publicSite(site, host) {
  return siteStore.publicSite(site, host ? `https://${host}` : '');
}

/* ------------------------------------------------ 앱 파일 */

async function putFiles(env, id, files) {
  await Promise.all(files.map((f) => kv(env).put(fileKey(id, f.path), f.body)));
  await kv(env).delete(goneKey(id));
}

async function listFiles(env, id) {
  const listed = await kv(env).list({ prefix: `file:${id}/` });
  const out = [];
  for (const item of listed.keys) {
    const rel = item.name.slice(`file:${id}/`.length);
    out.push({ path: rel });
  }
  return out;
}

async function getFile(env, id, rel) {
  return kv(env).get(fileKey(id, rel), 'arrayBuffer');
}

async function readFiles(env, id) {
  const list = await listFiles(env, id);
  const out = [];
  for (const item of list) {
    const body = await getFile(env, id, item.path);
    if (body) out.push({ path: item.path, body });
  }
  return out;
}

async function deleteAppFiles(env, id) {
  const list = await listFiles(env, id);
  await Promise.all(list.map((f) => kv(env).delete(fileKey(id, f.path))));
  // 정적 배포본(dist)에 남아 있는 같은 이름의 파일을 가립니다
  await kv(env).put(goneKey(id), '1');
}

async function markGone(env, id) {
  await kv(env).put(goneKey(id), '1');
}

async function isGone(env, id) {
  return (await kv(env).get(goneKey(id))) !== null;
}

/* ------------------------------------------------ 페이지 */

async function writePages(env, rendered) {
  const wanted = new Set(Object.keys(rendered));
  const existing = await kv(env).list({ prefix: 'page:', limit: 1000 });
  const stale = existing.keys
    .map((k) => k.name.slice('page:'.length))
    .filter((rel) => !wanted.has(rel));

  await Promise.all(Object.entries(rendered).map(([rel, html]) => kv(env).put(pageKey(rel), html)));
  await Promise.all(stale.map((rel) => kv(env).delete(pageKey(rel))));
  await kv(env).put(KEY.generatedAt, new Date().toISOString());
  return { written: wanted.size, removed: stale.length };
}

async function getPage(env, rel) {
  return kv(env).get(pageKey(rel), 'text');
}

async function isGenerated(env) {
  return (await kv(env).get(KEY.generatedAt)) !== null;
}

/** 관리자 변경 후 사이트 전체 페이지를 다시 만듭니다 */
async function rebuild(env, { host = '' } = {}) {
  const raw = await readSite(env);
  const site = publicSite(raw, host);
  // 배포 사이트에서는 관리자 화면이 같은 주소에 있으므로 상대 경로로 둡니다
  site.adminUrl = '/admin.html';
  const apps = await readApps(env);
  const rendered = renderSite({ site, apps });
  const result = await writePages(env, rendered);
  return { ...result, apps: apps.length };
}

/* ------------------------------------------------ 세션 키 */

async function sessionSecret(env) {
  if (env.SESSION_SECRET && String(env.SESSION_SECRET).trim()) return String(env.SESSION_SECRET).trim();
  let stored = await kv(env).get(KEY.sessionSecret);
  if (stored) return stored;
  stored = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await kv(env).put(KEY.sessionSecret, stored);
  return stored;
}

module.exports = {
  KEY,
  readJson,
  fileKey,
  pageKey,
  goneKey,
  readApps,
  writeApps,
  getApp,
  readSite,
  writeSite,
  publicSite,
  putFiles,
  listFiles,
  readFiles,
  getFile,
  deleteAppFiles,
  markGone,
  isGone,
  writePages,
  getPage,
  isGenerated,
  rebuild,
  sessionSecret,
};
