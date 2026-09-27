#!/usr/bin/env node
'use strict';

/**
 * Cloudflare KV 에 있는 관리자 데이터를 이 PC 로 내려받아 백업합니다.
 *
 *   node tools/pull-kv.js            # data/apps.json, data/site.json, apps/ 를 KV 내용으로 갱신
 *   node tools/pull-kv.js --out backup-2026-09-28
 *
 * 배포 사이트의 관리자 화면에서 앱을 추가·삭제하면 데이터는 Cloudflare KV 에 있습니다.
 * 이 스크립트로 그 내용을 저장소(GitHub)로 가져와 백업할 수 있습니다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '9ebf858d5da2f633750f832a756da085';
const NAMESPACE_ID = process.env.CF_KV_ID || '5a34f8926b674e57b7b94791b6fd6a40';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

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
    cursor = data.result_info && data.result_info.cursor;
    if (!cursor) break;
  }
  return out;
}

async function getValue(token, key) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/values/${encodeURIComponent(key)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`KV 읽기 실패 (${key}): HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const token = wranglerToken();
  const outRoot = arg('out') ? path.join(ROOT, arg('out')) : ROOT;

  const appsRaw = await getValue(token, 'data:apps');
  const apps = JSON.parse(appsRaw.toString('utf8'));
  fs.writeFileSync(path.join(outRoot, 'data', 'apps.json'), `${JSON.stringify(apps, null, 2)}\n`);
  console.log(`✓ 앱 목록 ${apps.length}개 → data/apps.json`);

  try {
    const siteRaw = await getValue(token, 'data:site');
    fs.writeFileSync(path.join(outRoot, 'data', 'site.json'), siteRaw);
    console.log('✓ 사이트 설정 → data/site.json');
  } catch {
    console.log('△ 사이트 설정은 건너뜀(없음)');
  }

  const fileKeys = await listKeys(token, 'file:');
  let count = 0;
  for (const key of fileKeys) {
    const rel = key.slice('file:'.length); // <id>/<경로>
    const target = path.join(outRoot, 'apps', rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await getValue(token, key));
    count += 1;
  }
  console.log(`✓ 앱 파일 ${count}개 → apps/`);
  console.log('\n이제 git commit 으로 백업해 두세요.');
  console.log('  git add -A && git commit -m "배포 서버에서 수정한 앱 목록 백업"');
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
