#!/usr/bin/env node
'use strict';

/**
 * KV 에 저장된 데이터(앱·설정)로 사이트 페이지를 다시 만들어 KV 에 넣습니다.
 *
 *   node tools/rebuild-kv-pages.js
 *
 * 왜 필요한가: 배포 사이트는 KV 에 있는 "생성된 페이지"를 우선 내려보냅니다.
 * 화면 코드(뷰)를 바꿔 배포할 때 이 스크립트를 함께 돌려야 새 화면이 반영됩니다.
 * (npm run deploy 가 자동으로 실행합니다)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const build = require('../src/build');
const siteStore = require('../src/site-config');

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '9ebf858d5da2f633750f832a756da085';
const NAMESPACE_ID = process.env.CF_KV_ID || '5a34f8926b674e57b7b94791b6fd6a40';
const DRY = process.argv.includes('--dry-run');

function wranglerToken() {
  const candidates = [
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
    path.join(os.homedir(), '.wrangler/config/default.toml'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const match = text.match(/(?:oauth_token|api_token)\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    } catch { /* 다음 후보 */ }
  }
  throw new Error('wrangler 인증 토큰을 찾지 못했습니다. npx wrangler login 후 다시 실행하세요.');
}

const kvUrl = (suffix = '') =>
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}${suffix}`;

async function kvGet(token, key) {
  const res = await fetch(`${kvUrl(`/values/${encodeURIComponent(key)}`)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV 읽기 실패 (${key}): HTTP ${res.status}`);
  return await res.text();
}

async function kvPut(token, key, value) {
  const res = await fetch(kvUrl(`/values/${encodeURIComponent(key)}`), {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain; charset=utf-8' },
    body: value,
  });
  if (!res.ok) throw new Error(`KV 쓰기 실패 (${key}): HTTP ${res.status}`);
}

async function kvList(token, prefix) {
  const out = [];
  let cursor = '';
  for (;;) {
    const url = new URL(kvUrl('/keys'));
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('limit', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.success) throw new Error(`KV 키 조회 실패: ${JSON.stringify(data.errors)}`);
    out.push(...data.result.map((r) => r.name));
    cursor = data.result_info && data.result_info.cursor;
    if (!cursor) break;
  }
  return out;
}

async function kvDelete(token, key) {
  const res = await fetch(kvUrl(`/values/${encodeURIComponent(key)}`), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV 삭제 실패 (${key}): HTTP ${res.status}`);
}

async function main() {
  const token = wranglerToken();
  const appsRaw = await kvGet(token, 'data:apps');
  const siteRaw = await kvGet(token, 'data:site');
  if (!appsRaw) throw new Error('KV 에 앱 목록(data:apps)이 없습니다. node tools/init-kv.js 로 먼저 올리세요.');

  const apps = JSON.parse(appsRaw);
  const site = siteStore.publicSite(siteRaw ? JSON.parse(siteRaw) : { ...siteStore.DEFAULTS });
  site.adminUrl = '/admin.html';

  const rendered = build.renderSite({ site, apps });
  const wanted = Object.keys(rendered);
  console.log(`KV 페이지 재생성: ${wanted.length}개 (앱 ${apps.length}개 기준)`);

  if (DRY) {
    for (const rel of wanted.slice(0, 12)) console.log('  -', rel);
    return;
  }

  const existing = await kvList(token, 'page:');
  const stale = existing.map((k) => k.slice('page:'.length)).filter((rel) => !wanted.includes(rel));

  let done = 0;
  for (const [rel, html] of Object.entries(rendered)) {
    await kvPut(token, `page:${rel}`, html);
    done += 1;
  }
  for (const rel of stale) await kvDelete(token, `page:${rel}`);
  await kvPut(token, 'meta:generatedAt', new Date().toISOString());

  console.log(`✓ ${done}개 페이지를 KV 에 반영했습니다${stale.length ? ` (오래된 페이지 ${stale.length}개 삭제)` : ''}`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
