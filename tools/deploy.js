#!/usr/bin/env node
'use strict';

/**
 * 배포 한 번에: 정적 빌드(dist/) → Cloudflare 배포
 *
 *   npm run deploy
 *
 * 공개 페이지는 배포본이 아니라 요청이 들어올 때 서버(Worker)가 데이터로 직접 그려서
 * Cloudflare 캐시에 담아 둡니다. 그래서 KV 페이지 재생성 단계가 필요 없습니다
 * (예전에는 배포·저장마다 40여 개 페이지를 KV 에 썼고, 무료 플랜의 일일 쓰기 한도를
 *  넘겨 관리자 저장이 실패했습니다 — 2026-10-11 수정).
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

console.log('\n② Cloudflare 배포');
const deployed = spawnSync('npx', ['wrangler', 'deploy'], { cwd: ROOT, stdio: 'inherit' });
if (deployed.status !== 0) {
  console.error('\n✗ 배포 실패');
  process.exit(deployed.status || 1);
}

console.log('\n✓ 완료');
console.log('ℹ 공개 페이지는 요청 시 서버가 그려서 캐시합니다 — KV 페이지 재생성은 필요 없습니다.');
