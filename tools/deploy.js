#!/usr/bin/env node
'use strict';

/**
 * 배포 한 번에: 정적 빌드 → KV 페이지 재생성 → Cloudflare 배포
 *
 *   npm run deploy
 *
 * KV 재생성이 실패해도(토큰 만료 등) 배포는 계속 진행하고 경고만 남깁니다.
 * → 사이트가 옛 화면으로 남는 일을 줄이려면 KV 재생성이 성공해야 하므로, 경고가 보이면
 *    npx wrangler login 후 `npm run rebuild:remote` 를 다시 실행하세요.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(script, args = [], { optional = false } = {}) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    if (optional) {
      console.warn(`\n⚠ ${script} 가 실패했습니다 (계속 진행). 위 메시지를 확인하세요.\n`);
      return false;
    }
    console.error(`\n✗ ${script} 실패 — 배포를 중단합니다.`);
    process.exit(result.status || 1);
  }
  return true;
}

console.log('① 정적 빌드 (dist/)');
run('export-static.js');

console.log('\n② KV 페이지 재생성 (배포 사이트가 쓰는 최신 화면)');
const kvOk = run('rebuild-kv-pages.js', [], { optional: true });

console.log('\n③ Cloudflare 배포');
const deployed = spawnSync('npx', ['wrangler', 'deploy'], { cwd: ROOT, stdio: 'inherit' });
if (deployed.status !== 0) {
  console.error('\n✗ 배포 실패');
  process.exit(deployed.status || 1);
}

console.log('\n✓ 완료');
if (!kvOk) {
  console.log('⚠ KV 페이지 재생성은 실패했습니다. `npx wrangler login` 후 `npm run rebuild:remote` 를 실행하세요.');
}
