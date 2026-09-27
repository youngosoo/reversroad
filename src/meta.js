'use strict';

/**
 * 앱 메타데이터 검증·정규화 (파일 시스템을 쓰지 않는 순수 모듈).
 * Node 서버(src/manifest.js)와 Cloudflare Worker(worker/apps.js)가 함께 사용합니다.
 */

const { isValidCategory, DEFAULT_SLUG } = require('./categories');

const HOWTO_MAX = 4000; // 설명·사용법 길이 상한
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
  return String(value || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeMeta(input, fallback = {}) {
  const name = String(input.name || '').trim() || String(fallback.name || '').trim();
  if (!name) throw new HttpError(400, 'name is required');
  const desc = (String(input.desc || '').trim() || String(fallback.desc || '').trim()).slice(0, 300);
  const icon = String(input.icon || '').trim().slice(0, 8) || String(fallback.icon || '').trim() || '📦';
  const tags = parseTags(input.tags);
  const finalTags = tags.length ? tags : parseTags(fallback.tags);
  const howto = (String(input.howto || '').trim() || String(fallback.howto || '').trim()).slice(0, HOWTO_MAX);
  const requested = String(input.category || '').trim();
  const category = isValidCategory(requested)
    ? requested
    : (isValidCategory(fallback.category)
      ? fallback.category
      : (isValidCategory(fallback.siteCategory) ? fallback.siteCategory : DEFAULT_SLUG));
  return { name, desc, icon, tags: finalTags, howto, category };
}

/** Best-effort static analysis of a file that was just uploaded (never throws). */
function safeAnalyze(buffer, fileName) {
  try {
    const { analyzeBuffer } = require('./analyze');
    return analyzeBuffer(buffer, fileName);
  } catch {
    return null;
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}


const STARTER_HTML = (name) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { text-align: center; padding: 2rem; }
  a { color: inherit; }
</style>
</head>
<body>
  <main>
    <h1>${name}</h1>
    <p>이 파일은 <code>apps/&lt;id&gt;/index.html</code> 입니다. 단독 실행 가능합니다.</p>
    <p><a href="/">&larr; 홈으로</a></p>
  </main>
</body>
</html>
`;

module.exports = {
  STARTER_HTML,
  safeAnalyze,
  HOWTO_MAX,
  isValidSlug,
  parseTags,
  normalizeMeta,
  HttpError,
};
