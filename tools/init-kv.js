#!/usr/bin/env node
'use strict';

/**
 * 지금 이 PC의 데이터를 Cloudflare KV 로 옮깁니다 (최초 1회).
 *
 *   node tools/init-kv.js            # 현재 로컬 데이터 → KV
 *   node tools/init-kv.js --dry-run  # 무엇을 올릴지 미리 보기
 *
 * 옮기는 것: 앱 목록(data/apps.json), 사이트 설정(data/site.json), 관리자 비밀번호 해시,
 *            각 앱의 파일(apps/<id>/…), 그리고 사이트 페이지 전체(렌더링 결과)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const build = require('../src/build');
const siteStore = require('../src/site');

const ROOT = path.join(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'apps');
const DRY = process.argv.includes('--dry-run');

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '9ebf858d5da2f633750f832a756da085';
const NAMESPACE_ID = process.env.CF_KV_ID || '5a34f8926b674e57b7b94791b6fd6a40';

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

async function putRaw(token, key, value) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: value,
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`KV 업로드 실패 (${key}): ${JSON.stringify(data.errors || res.status)}`);
  }
}

async function listKeys(token, prefix) {
  const out = [];
  let cursor = '';
  for (;;) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/keys`);
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('limit', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.success) throw new Error(`KV 키 조회 실패: ${JSON.stringify(data.errors)}`);
    out.push(...data.result.map((r) => r.name));
    if (!data.result_info || !data.result_info.cursor) break;
    cursor = data.result_info.cursor;
  }
  return out;
}

async function deleteKey(token, key) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`KV 삭제 실패 (${key})`);
}

async function main() {
  const token = wranglerToken();
  const apps = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'apps.json'), 'utf8'));
  const siteRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site.json'), 'utf8'));
  let password = null;
  try {
    password = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'admin.json'), 'utf8'));
  } catch { /* 비밀번호 파일이 없으면 넘어감 */ }

  const entries = [];
  entries.push({ key: 'data:apps', value: JSON.stringify(apps), label: `앱 목록 (${apps.length}개)` });
  entries.push({ key: 'data:site', value: JSON.stringify(siteRaw), label: '사이트 설정' });
  if (password && password.password && password.password.hash) {
    entries.push({ key: 'data:password', value: JSON.stringify(password), label: '관리자 비밀번호 해시' });
  }

  // 앱 파일
  for (const app of apps) {
    const dir = path.join(APPS_DIR, app.id);
    if (!fs.existsSync(dir)) continue;
    const walk = (current, prefix = '') => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
        else {
          entries.push({
            key: `file:${app.id}/${prefix}${entry.name}`,
            value: fs.readFileSync(full),
            label: `${app.id}/${prefix}${entry.name}`,
          });
        }
      }
    };
    walk(dir);
  }

  // 페이지 렌더링 (배포 사이트 기준)
  const site = siteStore.publicSite(siteRaw);
  site.adminUrl = '/admin.html';
  const rendered = build.renderSite({ site, apps });
  for (const [rel, html] of Object.entries(rendered)) {
    // 페이지는 서버가 요청 시 렌더링합니다 — KV 에 쓰지 않습니다(쓰기 한도 절약)
  }
  entries.push({ key: 'meta:generatedAt', value: new Date().toISOString(), label: '생성 시각' });

  console.log(`KV(${NAMESPACE_ID}) 에 올릴 항목 ${entries.length}개`);
  if (DRY) {
    for (const e of entries.slice(0, 40)) console.log('  -', e.key, '|', e.label);
    if (entries.length > 40) console.log(`  … 외 ${entries.length - 40}개`);
    return;
  }

  let done = 0;
  for (const entry of entries) {
    await putRaw(token, entry.key, entry.value);
    done += 1;
    if (done % 10 === 0) process.stdout.write(`  ${done}/${entries.length}\r`);
  }
  // 더 이상 필요 없는 페이지 정리 (분야가 바뀌거나 앱이 삭제된 경우)
  const wanted = new Set(entries.filter((e) => e.key.startsWith('page:')).map((e) => e.key));
  const existing = await listKeys(token, 'page:');
  const stale = existing.filter((k) => !wanted.has(k));
  for (const key of stale) await deleteKey(token, key);
  if (stale.length) console.log(`  오래된 페이지 ${stale.length}개를 삭제했습니다.`);

  console.log(`\n✓ ${done}개 항목을 KV 에 저장했습니다.`);
  console.log('  이제 npx wrangler deploy 로 배포하면 배포 사이트에서 관리자 기능을 쓸 수 있습니다.');
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
