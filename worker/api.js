'use strict';

/**
 * Cloudflare Worker 의 API.
 * 로컬 서버(server.js)와 같은 주소 체계를 씁니다 — 관리자 화면(public/admin.html)이
 * 수정 없이 그대로 동작하도록 하기 위해서입니다.
 */

const auth = require('./auth');
const store = require('./store');
const appService = require('./apps');
const meta = require('../src/meta');
const categories = require('../src/categories');
const siteStore = require('../src/site-config');

const { HttpError } = meta;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    const fields = {};
    const files = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') fields[key] = value;
      else files[key] = { name: value.name, body: new Uint8Array(await value.arrayBuffer()), type: value.type };
    }
    return { ...fields, _files: files };
  }
  return {};
}

/** /api/... 처리. 처리하지 않는 경로면 null 을 돌려줍니다. */
async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const host = url.host;

  /* -------------------------------------------- 인증 */
  if (path === '/auth/me' && method === 'GET') {
    const user = await auth.currentUser(request, env);
    const status = await auth.passwordStatus(env);
    return json({
      user,
      providers: { github: { label: 'GitHub', enabled: false }, google: { label: 'Google', enabled: false } },
      allowDevLogin: false,
      passwordEnabled: status.passwordSet || status.envFallback,
      passwordFromEnv: Boolean(status.envFallback),
      openOAuth: false,
    });
  }

  if (path === '/auth/password' && method === 'POST') {
    const ip = auth.clientIp(request);
    if (await auth.tooManyAttempts(env, ip)) throw new HttpError(429, '시도가 너무 많습니다. 10분 뒤에 다시 시도하세요');
    const body = await readBody(request);
    const status = await auth.passwordStatus(env);
    if (!status.passwordSet && !status.envFallback) {
      throw new HttpError(503, '비밀번호 로그인이 아직 설정되지 않았습니다');
    }
    if (!body.password || !(await auth.verifyPassword(env, body.password))) {
      await auth.noteFailure(env, ip);
      throw new HttpError(401, '비밀번호가 올바르지 않습니다');
    }
    await auth.clearFailures(env, ip);
    return json({ user: { provider: 'password', login: 'admin', name: '관리자' } }, 200, {
      'set-cookie': await auth.createSessionCookie(env),
    });
  }

  if (path === '/auth/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': auth.clearSessionCookie() });
  }

  if (path.startsWith('/auth/dev-login')) throw new HttpError(404, 'not found');

  /* -------------------------------------------- 공개 API */
  if (path === '/api/apps' && method === 'GET') {
    const all = (await store.readApps(env)).filter((a) => !a.trashed);
    const viewer = await auth.currentUser(request, env);
    const wantsAll = url.searchParams.get('all') === '1' && Boolean(viewer);
    return json({ apps: wantsAll ? all : all.filter((a) => !a.hidden) });
  }

  if (path === '/api/categories' && method === 'GET') {
    const apps = (await store.readApps(env)).filter((a) => !a.trashed);
    const counts = new Map();
    for (const app of apps) {
      const slug = app.category && categories.isValidCategory(app.category) ? app.category : 'etc';
      counts.set(slug, (counts.get(slug) || 0) + 1);
    }
    return json({
      categories: categories.listCategories().map((c) => ({ ...c, count: counts.get(c.slug) || 0 })),
    });
  }

  if (path === '/api/site' && method === 'GET') {
    const site = store.publicSite(await store.readSite(env), host);
    const status = await auth.passwordStatus(env);
    return json({
      site,
      security: {
        openOAuth: false,
        allowDevLogin: false,
        passwordSet: status.passwordSet,
        passwordFromEnv: Boolean(status.envFallback),
        passwordUpdatedAt: status.updatedAt,
        passwordMinLength: status.minLength,
      },
    });
  }

  /* -------------------------------------------- 관리자 전용 */
  const user = await auth.currentUser(request, env);
  if (!user) throw new HttpError(401, '로그인이 필요합니다');

  if (path === '/api/site' && method === 'PUT') {
    const patch = await readBody(request);
    const saved = await store.writeSite(env, patch);
    await store.rebuild(env, { host });
    return json({ site: store.publicSite(saved, host) });
  }

  if (path === '/api/admin/password' && method === 'GET') {
    return json({ status: await auth.passwordStatus(env) });
  }

  if (path === '/api/admin/password' && method === 'PUT') {
    const body = await readBody(request);
    const result = await auth.setPassword(env, body.next, { currentPassword: body.current, requireCurrent: true });
    return json({ ok: true, updatedAt: result.updatedAt });
  }

  if (path === '/api/rebuild' && method === 'POST') {
    const result = await store.rebuild(env, { host });
    return json({ ok: true, rebuild: result });
  }

  if (path === '/api/analyze' && method === 'POST') {
    const body = await readBody(request);
    const file = body._files && body._files.file;
    if (!file) throw new HttpError(400, '분석할 파일을 선택하세요');
    const analysis = appService.safeAnalyze(file.body, file.name);
    if (!analysis) throw new HttpError(400, '파일을 분석하지 못했습니다');
    return json({ analysis });
  }

  if (path === '/api/apps' && method === 'POST') {
    const body = await readBody(request);
    const file = body._files && body._files.file;
    const result = await appService.addApp(env, {
      slug: body.id || body.slug,
      name: body.name,
      desc: body.desc,
      icon: body.icon,
      tags: body.tags,
      howto: body.howto,
      category: body.category,
      file,
    });
    return json({ app: result.app, analysis: result.analysis }, 201);
  }

  const appMatch = path.match(/^\/api\/apps\/([^/]+)(\/[a-z]+)?$/);
  if (appMatch) {
    const id = decodeURIComponent(appMatch[1]);
    const action = appMatch[2];

    if (action === '/download' && method === 'GET') {
      const { buffer, name } = await appService.downloadApp(env, id);
      return new Response(buffer, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${id}.zip"`,
          'cache-control': 'no-store',
        },
      });
    }
    if (action === '/analyze' && method === 'POST') return json(await appService.analyzeApp(env, id));
    if (action === '/rename' && method === 'POST') {
      const body = await readBody(request);
      return json({ app: await appService.renameApp(env, id, body.id || body.newId) });
    }
    if (!action && method === 'GET') {
      const app = await store.getApp(env, id);
      if (!app) throw new HttpError(404, '앱을 찾을 수 없습니다');
      if (app.hidden) {
        const viewer = await auth.currentUser(request, env);
        if (!viewer) throw new HttpError(404, '앱을 찾을 수 없습니다');
      }
      return json({ app });
    }
    if (!action && method === 'PATCH') {
      return json({ app: await appService.updateApp(env, id, await readBody(request)) });
    }
    if (!action && method === 'DELETE') {
      const removed = await appService.removeApp(env, id, { permanent: url.searchParams.get('permanent') === '1' });
      return json({ removed });
    }
  }

  return null;
}

module.exports = { handleApi, json, readBody, HttpError, siteStore };
