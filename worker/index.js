'use strict';

/**
 * Cloudflare Worker 진입점.
 *
 *  - 관리자 API(/api/*, /auth/*)와 관리자 화면은 KV 저장소를 사용합니다.
 *  - 공개 페이지는 관리자가 마지막으로 만든 페이지(KV)를 우선 내려보내고,
 *    없으면 배포된 정적 파일(dist)을 사용합니다.
 *  - 앱 파일(/apps/<id>/…)도 KV 에 있으면 그것을 우선 사용합니다.
 */

const { handleApi, json, HttpError } = require('./api');
const store = require('./store');
const auth = require('./auth');
const build = require('../src/build');
const { injectAppAds, injectAppMeta } = require('../src/miniapp-ads');
const { redactSecrets } = require('../src/secrets');

const CANONICAL_HOST = 'www.reversroad.com';
// 관리자가 올린 로고를 내려보내는 주소 (기본 로고 파일과 같은 이름)
const LOGO_PATHS = new Set(['/assets/logo.png', '/assets/logo.jpg', '/assets/logo.jpeg', '/assets/logo.webp', '/assets/logo.gif']);
const PRODUCTION_HOSTS = new Set([CANONICAL_HOST, 'reversroad.com']);

/** 같은 페이지가 여러 주소로 열리지 않도록 표준 주소로 301 (링크 점수 한 곳으로 모음) */
function canonicalRedirect(request, url) {
  if (!PRODUCTION_HOSTS.has(url.hostname)) return null; // 로컬·workers.dev 미리보기는 그대로
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  let path = url.pathname;
  let changed = false;
  if (/\/index\.html$/i.test(path)) {
    path = path.replace(/\/index\.html$/i, '/');
    changed = true;
  }
  if (proto !== 'https' || url.hostname !== CANONICAL_HOST || changed) {
    return Response.redirect(`https://${CANONICAL_HOST}${path}${url.search}`, 301);
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      const redirect = canonicalRedirect(request, url);
      if (redirect) return redirect;

      // 1) API · 인증
      if (path.startsWith('/api/') || path.startsWith('/auth/')) {
        const response = await handleApi(request, env, url);
        if (response) return response;
        return json({ error: 'not found' }, 404);
      }

      // 2) 관리자 화면은 로그인이 필요합니다
      if (path === '/admin.html' || path === '/admin') {
        const user = await auth.currentUser(request, env);
        if (!user) return Response.redirect(`${url.origin}/login.html?next=/admin.html`, 302);
        return serveAsset(request, env, '/admin.html', { 'cache-control': 'no-store' });
      }

      if (path === '/login.html') {
        return serveAsset(request, env, path, { 'cache-control': 'no-store' });
      }

      // 2-1) 관리자가 올린 로고 (KV) — 배포된 기본 로고 파일보다 우선
      if (LOGO_PATHS.has(path) && (request.method === 'GET' || request.method === 'HEAD')) {
        const uploaded = await store.readLogo(env);
        if (uploaded) return logoResponse(request, uploaded);
      }

      // 2-2) 사용설명서 원문(.md)
      const manualMatch = path.match(/^\/apps\/([^/]+)\/manual\.md$/);
      if (manualMatch) {
        const id = decodeURIComponent(manualMatch[1]);
        const app = await store.getApp(env, id);
        if (app && app.manual && !app.trashed) {
          return new Response(app.manual, {
            headers: {
              'content-type': 'text/markdown; charset=utf-8',
              'content-disposition': `attachment; filename="${id}-manual.md"`,
              'cache-control': 'no-store',
            },
          });
        }
        return notFound(request, env);
      }

      // 3) 앱 파일 (KV 우선 → 정적 파일)
      // /apps/<id>, /apps/<id>/, /apps/<id>/파일 전부 처리
      const appFileMatch = path.match(/^\/apps\/([^/]+)(?:\/(.*))?$/);
      if (appFileMatch) {
        const id = decodeURIComponent(appFileMatch[1]);
        const rel = appFileMatch[2] && appFileMatch[2].length ? appFileMatch[2] : 'index.html';
        // 이름을 바꾼 앱의 옛 주소는 새 주소로 301 (색인된 링크·북마크 보존)
        const moved = await formerAppRedirect(request, env, url, id);
        if (moved && !(await store.getApp(env, id))) return moved;
        const generated = await store.isGenerated(env);
        if (generated) {
          if (await store.isGone(env, id)) return notFound(request, env);
          const body = await store.getFile(env, id, rel);
          if (body) {
            // 앱 화면(HTML)에는 광고 코드를 끼워 넣어 내보냅니다 (파일 자체는 그대로)
            if (/\.html?$/i.test(rel)) {
              const site = await store.readSite(env);
              const app = await store.getApp(env, id);
              const ads = site.adsense || {};
              const publicSite = store.publicSite(site, url.host);
              let served = redactSecrets(new TextDecoder().decode(body)).html; // 혹시 남아 있으면 내보내지 않음
              served = injectAppMeta(served, { app, site: publicSite });
              if (ads.inApps !== false) {
                const html = injectAppAds(served, {
                  client: ads.client,
                  slot: ads.slotDisplay || ads.slotInline,
                });
                return new Response(html, {
                  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
                });
              }
            }
            if (/^text\/html/i.test(build.contentTypeFor(rel)) || /\.html?$/i.test(rel)) {
              return new Response(redactSecrets(new TextDecoder().decode(body)).html, {
                headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
              });
            }
            return new Response(body, {
              headers: {
                'content-type': build.contentTypeFor(rel),
                'cache-control': 'no-store',
              },
            });
          }
          return notFound(request, env);
        }
        const asset = await serveAsset(request, env, path);
        if (asset && asset.status === 200 && /\.html?$/i.test(path) && /^\/apps\//.test(path)) {
          const site = await store.readSite(env);
          const ads = site.adsense || {};
          const appId = (path.match(/^\/apps\/([^/]+)/) || [])[1];
          const app = appId ? await store.getApp(env, decodeURIComponent(appId)) : null;
          let text = injectAppMeta(redactSecrets(await asset.text()).html, { app, site: store.publicSite(site, url.host) });
          if (ads.inApps !== false) {
            const html = injectAppAds(text, {
              client: ads.client,
              slot: ads.slotDisplay || ads.slotInline,
            });
            return new Response(html, {
              headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
            });
          }
          return new Response(text, {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
        return asset;
      }

      // 4) 페이지 — 요청이 들어올 때 즉시 렌더링하고 Cloudflare 캐시에 담아 둡니다.
      //    (KV 에 페이지를 써 두지 않으므로 관리자 저장이 KV 쓰기 한도를 쓰지 않습니다)
      if (!path.startsWith('/assets/')) {
        const key = build.pageKeyForPath(path);
        if (build.isDynamicPageKey(key)) {
          const html = await renderPageCached(request, env, url, key);
          if (html !== null) return htmlResponse(html, key);
          const appPage = key.match(/^app\/([^/]+)\/index\.html$/);
          if (appPage) {
            const moved = await formerAppRedirect(request, env, url, decodeURIComponent(appPage[1]));
            if (moved) return moved;
          }
          return notFound(request, env);
        }
      }

      // 5) 나머지는 정적 파일
      return serveAsset(request, env, path);
    } catch (err) {
      // 무료 플랜은 KV 쓰기 1,000건/일 제한이 있습니다 — 관리자 저장이 막히면 이 메시지로 안내합니다
      if (/KV (put|delete|list)\(\) limit exceeded/i.test(String(err && err.message))) {
        const quota = new HttpError(429, 'Cloudflare KV 오늘 쓰기 한도(무료 1,000건/일)를 모두 사용했습니다. UTC 00:00(한국 시간 09:00)에 초기화되니 그 뒤에 다시 시도해 주세요. 급하면 관리자 화면 설정은 그대로 두고 잠시 후 이용하세요.');
        const body = json({ error: quota.message, status: 429 });
        if (path.startsWith('/api/') || path.startsWith('/auth/')) return body;
        return new Response(quota.message, { status: 429, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      const status = err.status || 500;
      if (status >= 500) console.error('[myhome]', err && err.stack ? err.stack : String(err));
      const message = err.message || 'internal error';
      if (path.startsWith('/api/') || path.startsWith('/auth/')) {
        return json({ error: message, status }, status);
      }
      return new Response(`${status} ${message}\n`, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

/**
 * 관리자가 올린 로고를 내려보냅니다.
 * 로고를 바꾸면 곧바로 보여야 하므로 캐시하지 않고(no-cache) ETag 로만 다시 확인합니다.
 */
function logoResponse(request, { body, meta }) {
  const etag = `"${meta.version || meta.hash || 'logo'}"`;
  const headers = {
    'content-type': meta.contentType || 'image/png',
    'cache-control': 'no-cache',
    etag,
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}

function htmlResponse(html, key) {
  // 관리자가 바꾸면 즉시 반영되어야 하므로 엣지·브라우저 캐시를 쓰지 않습니다
  return new Response(html, {
    headers: {
      'content-type': build.contentTypeFor(key),
      'cache-control': 'no-store',
    },
  });
}

/** 이름을 바꾼 앱의 옛 id 로 들어오면 새 주소로 301 합니다 */
async function formerAppRedirect(request, env, url, id) {
  const apps = await store.readApps(env);
  const target = apps.find((a) => Array.isArray(a.formerIds) && a.formerIds.includes(id));
  if (!target) return null;
  const rest = url.pathname.replace(/^\/apps\/[^/]+\/?/, '');
  const suffix = url.pathname.startsWith('/app/') ? '' : (rest && rest !== 'index.html' ? `/${rest}` : '/');
  return Response.redirect(`${url.origin}${url.pathname.startsWith('/app/') ? '/app/' : '/apps/'}${target.id}${suffix}${url.search}`, 301);
}

/** 정적 자산을 그대로 가져옵니다 (없으면 null) */
async function fetchAsset(request, env, path) {
  if (!env.ASSETS) return null;
  const target = new URL(request.url);
  target.pathname = path;
  try {
    return await env.ASSETS.fetch(new Request(target.toString(), { method: 'GET' }));
  } catch {
    return null;
  }
}

async function serveAsset(request, env, path, extraHeaders = {}) {
  if (!env.ASSETS) return new Response('assets binding missing', { status: 500 });
  const target = new URL(request.url);
  target.pathname = path;
  const response = await env.ASSETS.fetch(new Request(target.toString(), request));
  if (!extraHeaders || !Object.keys(extraHeaders).length) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

/** 404 페이지 (요청 시 렌더링, 실패하면 배포된 정적 파일) */
async function notFound(request, env) {
  const url = new URL(request.url);
  const html = await renderPageCached(request, env, url, '404.html');
  if (html) {
    return new Response(html, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return serveAsset(request, env, '/404.html');
}

/**
 * 페이지 한 장을 렌더링합니다.
 *
 * - 데이터(KV 2건 읽기)로 즉시 그리고, 결과는 Cloudflare 캐시에 담아 다음 요청은 캐시로 답합니다.
 * - 캐시 키에 데이터 버전을 붙여서, 관리자가 내용을 바꾸면 곧바로 새로 그려집니다.
 * - KV 쓰기가 없으므로 무료 플랜의 일일 쓰기 한도를 쓰지 않습니다.
 */
async function renderPageCached(request, env, url, key) {
  const data = await pageData(env, url);
  const version = `${pageVersion(data, url.host)}`;
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const cacheKey = new Request(`https://page-cache.local/${key}?v=${encodeURIComponent(version)}`, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.text();
  }
  let html = null;
  try {
    html = build.renderPage(key, data);
  } catch (err) {
    console.error('[myhome] render failed', key, err && err.stack ? err.stack : String(err));
    html = null;
  }
  if (html === null) return null;
  if (cache) {
    try {
      await cache.put(cacheKey, new Response(html, {
        headers: { 'content-type': build.contentTypeFor(key), 'cache-control': 'public, max-age=86400' },
      }));
    } catch { /* 캐시 저장 실패는 무시 (다음 요청에 다시 그림) */ }
  }
  return html;
}

// 데이터 스냅샷은 짧게(5초) 메모리에 둬서 KV 읽기를 아낍니다
let dataSnapshot = { at: 0, key: '', value: null };

async function pageData(env, url) {
  const host = url && url.host ? url.host : '';
  if (dataSnapshot.value && Date.now() - dataSnapshot.at < 5000 && dataSnapshot.key === host) return dataSnapshot.value;
  const raw = await store.readSite(env);
  const site = store.publicSite(raw, host);
  site.adminUrl = '/admin.html'; // 관리자 화면은 같은 주소에 있으므로 상대 경로
  const apps = await store.readApps(env);
  const value = { site, apps };
  dataSnapshot = { at: Date.now(), key: host, value };
  return value;
}

/** 데이터가 바뀌면 값이 달라지는 버전 문자열 (캐시 키에 씁니다) */
function pageVersion({ site, apps }, host = '') {
  let newest = '';
  for (const app of apps) {
    const stamp = app.updatedAt || app.createdAt || '';
    if (stamp > newest) newest = stamp;
  }
  return `${host}|${site.updatedAt || ''}|${apps.length}|${newest}|${site.logoVersion || ''}`;
}
