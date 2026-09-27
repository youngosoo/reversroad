'use strict';

/**
 * Site-wide settings that the operator edits (admin → 사이트 설정), stored in
 * data/site.json. The public site name, contact address and AdSense publisher id
 * all come from here, so nothing about the operator is hard-coded in the views.
 */

const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'site.json');

const DEFAULTS = {
  name: '내 앱 홈',
  tagline: '직접 만든 웹앱을 한 곳에 모아 두는 홈페이지',
  description:
    '설치 없이 브라우저에서 바로 실행되는 단일 파일 웹앱을 모아 소개하는 사이트입니다. 각 앱은 인터넷이 없어도 동작하며, 입력한 내용은 서버가 아니라 사용자의 브라우저에만 저장됩니다.',
  owner: '', // 비워 두면 푸터/소개 페이지에서 "운영자" 로 표시됩니다
  email: '', // AdSense 심사 전 반드시 실제 연락 가능한 주소로 채우세요
  domain: '', // 예: https://myhome.example.com (비우면 요청 도메인 사용)
  locale: 'ko',
  adsense: {
    client: '', // 예: ca-pub-0000000000000000
    slotInline: '', // 본문 중간 광고 단위 ID (숫자)
  },
  analytics: { ga4: '' }, // 예: G-XXXXXXX
  social: { github: '', youtube: '', threads: '' },
  updatedAt: null,
};

function isPlaceholderEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return true;
  return /example\.(com|org|net)$/.test(value) || value === 'your-email@example.com';
}

/** AdSense 콘솔은 pub-… 로 보여주지만 스크립트에는 ca-pub-… 가 필요합니다. */
function normalizeAdsClient(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{10,}$/.test(raw)) return `ca-pub-${raw}`;
  if (/^pub-\d{10,}$/i.test(raw)) return `ca-pub-${raw.slice(4)}`;
  if (/^ca-pub-\d{10,}$/i.test(raw)) return `ca-pub-${raw.slice(7)}`;
  return raw;
}

function merge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object' && base[key] !== null) {
      out[key] = merge(base[key], value);
    } else {
      out[key] = typeof value === 'string' ? value.trim() : value;
    }
  }
  return out;
}

async function readSite() {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = merge(DEFAULTS, parsed && typeof parsed === 'object' ? parsed : {});
    merged.adsense = { ...merged.adsense, client: normalizeAdsClient(merged.adsense?.client) };
    return merged;
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULTS };
    throw new Error(`site.json 을 읽을 수 없습니다: ${err.message}`);
  }
}

async function writeSite(patch) {
  const current = await readSite();
  const next = merge(current, patch);
  next.adsense = { ...next.adsense, client: normalizeAdsClient(next.adsense?.client) };
  next.updatedAt = new Date().toISOString();
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, FILE);
  return next;
}

/** Everything the public pages may render, with derived helpers. */
function publicSite(site, reqDomain = '') {
  const domain = String(site.domain || reqDomain || '').replace(/\/+$/, '');
  const owner = site.owner || '운영자';
  const email = site.email || '';
  const client = normalizeAdsClient(site.adsense?.client);
  return {
    ...site,
    owner,
    domain,
    email,
    adsense: { ...site.adsense, client },
    emailReady: Boolean(email) && !isPlaceholderEmail(email),
    domainReady: Boolean(domain) && !/localhost|127\.0\.0\.1/.test(domain) && domain.startsWith('https://'),
    adsenseReady: /^ca-pub-\d{10,}$/.test(client),
  };
}

module.exports = {
  DEFAULTS,
  FILE,
  readSite,
  writeSite,
  publicSite,
  isPlaceholderEmail,
  normalizeAdsClient,
  merge,
};
