#!/usr/bin/env node
'use strict';

/**
 * 관리자 비밀번호를 설정하거나 재설정합니다 (서버 최초 배포용).
 *
 *   node tools/set-password.js '새-비밀번호'
 *   node tools/set-password.js            # 물어보고 입력 (화면에 표시되지 않음)
 *
 * 비밀번호는 scrypt 해시로 data/admin.json 에만 저장됩니다(평문 저장 안 함).
 */

const readline = require('readline');
const passwordStore = require('../src/password');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (!['\n', '\r', '\u0004'].includes(char.toString())) {
        process.stdout.write('\x1b[2K\x1b[200D' + question);
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  let next = process.argv[2];
  if (!next) {
    next = await askHidden('새 관리자 비밀번호: ');
    const again = await askHidden('한 번 더 입력: ');
    if (next !== again) {
      console.error('두 값이 다릅니다. 다시 시도하세요.');
      process.exit(1);
    }
  }

  const before = await passwordStore.status();
  try {
    const result = await passwordStore.setPassword(next, { requireCurrent: false });
    console.log(`✓ 관리자 비밀번호를 ${before.passwordSet ? '변경' : '설정'}했습니다 (${result.updatedAt})`);
    console.log(`  파일: ${passwordStore.FILE}`);
    console.log('  이 파일은 .gitignore 로 제외되어 저장소에 올라가지 않습니다.');
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
})();
