#!/usr/bin/env node
'use strict';

/**
 * 파비콘 파일을 만듭니다 (Google 검색 파비콘 규격: 정사각형 · 48px 의 배수).
 *
 *   node tools/make-favicons.js
 *
 * public/assets/logo.* (관리자가 올린 로고 포함) 을 원본으로
 *   favicon-48.png · favicon-96.png · favicon-192.png · favicon-180.png(애플 터치) · favicon.ico
 * 를 다시 만듭니다. 로고를 바꾼 뒤 `npm run deploy` 전에 실행하세요.
 *
 * macOS 의 sips 를 사용합니다(이 저장소의 배포는 macOS 에서 돌아갑니다).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const SIZES = [48, 96, 192, 180];

function sourceFile() {
  for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp']) {
    const file = path.join(ASSETS, name);
    if (fs.existsSync(file)) return file;
  }
  throw new Error('public/assets/logo.png 같은 로고 파일이 없습니다');
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('△ macOS(sips)에서만 실행됩니다 — favicon 파일은 이미 만들어져 있습니다');
    return;
  }
  const src = sourceFile();
  const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src], { encoding: 'utf8' });
  console.log(`원본: ${path.relative(ROOT, src)} (${info.match(/pixelWidth: (\d+)/)?.[1]}×${info.match(/pixelHeight: (\d+)/)?.[1]})`);

  for (const size of SIZES) {
    const out = path.join(ASSETS, `favicon-${size}.png`);
    execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), src, '--out', out], { stdio: 'ignore' });
    console.log(`  ✓ favicon-${size}.png (${size}×${size})`);
  }

  // .ico — sips 는 정사각형 PNG 를 ico 로 저장할 수 있습니다
  const tmp = path.join(os.tmpdir(), `favicon-${Date.now()}.png`);
  execFileSync('sips', ['-s', 'format', 'png', '-z', '48', '48', src, '--out', tmp], { stdio: 'ignore' });
  try {
    execFileSync('sips', ['-s', 'format', 'ico', tmp, '--out', path.join(ASSETS, 'favicon.ico')], { stdio: 'ignore' });
    console.log('  ✓ favicon.ico (48×48)');
  } catch {
    console.log('  △ favicon.ico 는 만들지 못했습니다(브라우저는 png 파비콘을 씁니다)');
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 무시 */ }
  }

  // 브라우저가 자동으로 요청하는 루트 주소(/favicon.ico)에도 같은 파일을 둡니다
  try {
    fs.copyFileSync(path.join(ASSETS, 'favicon.ico'), path.join(ROOT, 'public', 'favicon.ico'));
    console.log('  ✓ public/favicon.ico (= /favicon.ico)');
  } catch { /* 무시 */ }
  console.log('\n로고를 바꿨다면 이 명령을 실행한 뒤 npm run deploy 하세요.');
}

try { main(); } catch (err) { console.error(`✗ ${err.message}`); process.exit(1); }
