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
const { injectAppAds } = require('../src/miniapp-ads');
const { redactSecrets } = require('../src/secrets');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
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

      // 2-1) 사용설명서 원문(.md)
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
        const generated = await store.isGenerated(env);
        if (generated) {
          if (await store.isGone(env, id)) return notFound(request, env);
          const body = await store.getFile(env, id, rel);
          if (body) {
            // 앱 화면(HTML)에는 광고 코드를 끼워 넣어 내보냅니다 (파일 자체는 그대로)
            if (/\.html?$/i.test(rel)) {
              const site = await store.readSite(env);
              const ads = site.adsense || {};
              const served = redactSecrets(new TextDecoder().decode(body)).html; // 혹시 남아 있으면 내보내지 않음
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
          if (ads.inApps !== false) {
            const html = injectAppAds(redactSecrets(await asset.text()).html, {
              client: ads.client,
              slot: ads.slotDisplay || ads.slotInline,
            });
            return new Response(html, {
              headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
            });
          }
        }
        return asset;
      }

      // 4) 페이지 — 관리자가 만든 페이지(KV) 우선, 없으면 배포된 정적 파일로 폴백
      if (!path.startsWith('/assets/')) {
        const key = build.pageKeyForPath(path);
        if (build.isDynamicPageKey(key)) {
          if (await store.isGenerated(env)) {
            const html = await store.getPage(env, key);
            if (html !== null) return htmlResponse(html, key);
            return notFound(request, env); // 관리자가 지운 페이지
          }
          const asset = await fetchAsset(request, env, `/${key}`);
          if (asset && asset.status !== 404) return asset;
          return notFound(request, env);
        }
      }

      // 5) 나머지는 정적 파일
      return serveAsset(request, env, path);
    } catch (err) {
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

function htmlResponse(html, key) {
  // 관리자가 바꾸면 즉시 반영되어야 하므로 엣지·브라우저 캐시를 쓰지 않습니다
  return new Response(html, {
    headers: {
      'content-type': build.contentTypeFor(key),
      'cache-control': 'no-store',
    },
  });
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

/** 관리자가 만든 404 페이지를 내려보냅니다 */
async function notFound(request, env) {
  const custom = await store.getPage(env, '404.html');
  if (custom) {
    return new Response(custom, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return serveAsset(request, env, '/404.html');
}
