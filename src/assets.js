'use strict';

/**
 * 로고 파일 경로를 정합니다.
 * public/assets/logo.png (또는 .jpg/.jpeg/.webp/.svg) 중 실제로 존재하는 파일을 쓰고,
 * 원본 이미지를 그 이름으로 넣으면 그대로 우선 사용됩니다.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'public', 'assets');
const CANDIDATES = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'logo.svg'];
const TTL_MS = 5000;

let cache = { at: 0, name: null };

function resolveLogoName() {
  const now = Date.now();
  if (cache.name && now - cache.at < TTL_MS) return cache.name;
  let found = CANDIDATES[CANDIDATES.length - 1];
  for (const name of CANDIDATES) {
    if (fs.existsSync(path.join(ASSETS_DIR, name))) {
      found = name;
      break;
    }
  }
  cache = { at: now, name: found };
  return found;
}

/** 브라우저에서 쓸 수 있는 경로 (예: /assets/logo.png) */
function logoPath() {
  return `/assets/${resolveLogoName()}`;
}

module.exports = { logoPath, resolveLogoName };
