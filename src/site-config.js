'use strict';

/**
 * 사이트 설정 스키마와 파생 값 계산 (파일 시스템을 쓰지 않는 순수 모듈).
 * Node 서버(src/site.js)와 Cloudflare Worker(worker/store.js)가 함께 사용합니다.
 */

const DEFAULTS = {
  name: '내 앱 홈',
  tagline: '직접 만든 웹앱을 한 곳에 모아 두는 홈페이지',
  description:
    '설치 없이 브라우저에서 바로 실행되는 단일 파일 웹앱을 모아 소개하는 사이트입니다. 각 앱은 인터넷이 없어도 동작하며, 입력한 내용은 서버가 아니라 사용자의 브라우저에만 저장됩니다.',
  owner: '', // 비워 두면 푸터/소개 페이지에서 "운영자" 로 표시됩니다
  email: '', // AdSense 심사 전 반드시 실제 연락 가능한 주소로 채우세요
  domain: '', // 예: https://myhome.example.com (비우면 요청 도메인 사용)
  locale: 'ko',
  adminUrl: 'http://localhost:3000/admin.html', // 공개 사이트의 "관리자" 링크가 가리킬 주소 (터널·도메인 주소로 바꿔 쓰세요)
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


/** 공개 페이지가 쓰는 값 (운영자·도메인·광고 준비 상태 등) */
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
  merge,
  isPlaceholderEmail,
  normalizeAdsClient,
  publicSite,
};
