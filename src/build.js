'use strict';

/**
 * 사이트 전체를 문자열로 렌더링합니다 (파일 시스템을 쓰지 않습니다).
 *
 * - Node 정적 빌드(tools/export-static.js) 와 Cloudflare Worker(worker/index.js) 가
 *   같은 함수를 써서 항상 같은 결과를 만듭니다.
 * - 반환값: { 'index.html': '<html>…', 'ads.txt': '…', … } 형태의 경로→내용 맵
 */

const pages = require('./views/pages');
const seo = require('./seo');
const { GUIDES } = require('./content/guides');
const { CATEGORIES } = require('./categories');
const { filterVisible } = require('./meta');

function renderSite({ site, apps }) {
  const out = {};
  // 목록·분야·sitemap 에는 '노출' 앱만 넣고, 상세 페이지는 비노출 앱도 만듭니다(검색엔진 noindex).
  const listed = filterVisible(apps);

  out['index.html'] = pages.homePage({ site, apps: listed, guides: GUIDES });
  out['apps/index.html'] = pages.appsPage({ site, apps: listed });
  for (const app of apps) {
    out[`app/${app.id}/index.html`] = pages.appDetailPage({ site, app, apps });
  }

  out['categories/index.html'] = pages.categoriesPage({ site, apps: listed });
  const usedCategories = new Set(listed.map((a) => a.category).filter(Boolean));
  for (const category of CATEGORIES) {
    if (!usedCategories.has(category.slug)) continue;
    out[`category/${category.slug}/index.html`] = pages.categoryPage({ site, apps: listed, category });
  }

  out['guide/index.html'] = pages.guideIndexPage({ site, apps: listed, guides: GUIDES });
  for (const guide of GUIDES) {
    out[`guide/${guide.slug}/index.html`] = pages.guideDetailPage({ site, guide, apps: listed });
  }

  out['about/index.html'] = pages.aboutPage({ site, apps: listed, guides: GUIDES });
  out['contact/index.html'] = pages.contactPage({ site });
  out['privacy/index.html'] = pages.policyPage({ site, doc: pages.privacyPolicy(site) });
  out['terms/index.html'] = pages.policyPage({ site, doc: pages.termsOfService(site) });
  out['disclaimer/index.html'] = pages.policyPage({ site, doc: pages.disclaimer(site) });
  out['404.html'] = pages.notFoundPage({ site });

  out['robots.txt'] = seo.robots({ site });
  out['sitemap.xml'] = seo.sitemap({ site, apps: listed });
  const ads = seo.adsTxt({ site });
  if (ads) out['ads.txt'] = ads;

  return out;
}

/** 요청 경로 → 렌더링된 페이지 키 ('/apps' → 'apps/index.html') */
function pageKeyForPath(pathname) {
  let p = String(pathname || '/').split('?')[0].split('#')[0];
  if (p === '/') return 'index.html';
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!p) return 'index.html';
  if (/\.[a-z0-9]+$/i.test(p)) return p; // 확장자가 있으면 그대로 (robots.txt, sitemap.xml …)
  return `${p}/index.html`;
}

/** 정적 배포에 포함되는 파일인지 (동적 페이지로 대체 가능한지 판단용) */
function isDynamicPageKey(key) {
  return key === 'index.html'
    || key === '404.html'
    || key === 'apps/index.html'
    || key === 'categories/index.html'
    || key === 'about/index.html'
    || key === 'contact/index.html'
    || key === 'privacy/index.html'
    || key === 'terms/index.html'
    || key === 'disclaimer/index.html'
    || key === 'robots.txt'
    || key === 'sitemap.xml'
    || key === 'ads.txt'
    || /^(app|category|guide)\//.test(key);
}

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

function contentTypeFor(filePath) {
  const ext = String(filePath).split('.').pop().toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

/** Cloudflare Workers 정적 자산용 헤더 규칙 */
const HEADERS = `# 보안 헤더
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), camera=(), microphone=()
  Strict-Transport-Security: max-age=31536000

# 정적 자산: 주소에 내용 해시(?v=)가 붙으므로 길게 캐시해도 안전합니다.
/assets/*
  Cache-Control: public, max-age=86400

# 앱 파일은 자주 바뀌므로 짧게 캐시
/apps/*
  Cache-Control: public, max-age=600

# 관리자 화면은 캐시하지 않습니다
/admin.html
  Cache-Control: no-store
/login.html
  Cache-Control: no-store
`;

module.exports = { renderSite, pageKeyForPath, isDynamicPageKey, contentTypeFor, HEADERS };
