'use strict';

/**
 * 로고 파일 경로를 정합니다.
 * public/assets/logo.png (또는 .jpg/.jpeg/.webp/.svg) 중 실제로 존재하는 파일을 쓰고,
 * 원본 이미지를 그 이름으로 넣으면 그대로 우선 사용됩니다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

/**
 * 파일 내용 해시를 붙인 자산 주소 (예: /assets/style.css?v=ab12cd34).
 * 자산을 오래 캐시해도 내용이 바뀌면 새 주소가 되어 즉시 반영됩니다.
 */
const versionCache = new Map();
const VERSION_TTL_MS = 3000;

function assetUrl(name) {
  const file = path.join(ASSETS_DIR, name);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return `/assets/${name}`;
  }
  const key = `${stat.size}:${stat.mtimeMs}`;
  const cached = versionCache.get(name);
  if (cached && cached.key === key && Date.now() - cached.at < VERSION_TTL_MS) {
    return `/assets/${name}?v=${cached.hash}`;
  }
  let hash;
  try {
    hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
  } catch {
    hash = String(Math.round(stat.mtimeMs)).slice(-8);
  }
  versionCache.set(name, { key, hash, at: Date.now() });
  return `/assets/${name}?v=${hash}`;
}

module.exports = { logoPath, assetUrl, resolveLogoName };
