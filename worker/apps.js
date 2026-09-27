'use strict';

/** Worker 에서의 앱 관리(추가·수정·삭제·이름 변경) — KV 저장소 사용 */

const analyze = require('../src/analyze');
const meta = require('../src/meta');
const { extractZipFiles, createZip } = require('./zip');
const store = require('./store');

const { HttpError, isValidSlug, normalizeMeta, normalizeHidden, STARTER_HTML } = meta;
const MAX_UPLOAD = 20 * 1024 * 1024;

function looksLikeZip(buffer) {
  return buffer && buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function safeAnalyze(buffer, fileName) {
  try {
    return analyze.analyzeBuffer(Buffer.from(buffer), fileName);
  } catch {
    return null;
  }
}

function uniqueSlug(apps, base) {
  let candidate = base;
  let n = 2;
  while (apps.some((a) => a.id === candidate)) candidate = `${base}-${n++}`;
  return candidate;
}

/** 업로드(파일 또는 zip)에서 앱 파일 목록을 만듭니다 */
function filesFromUpload({ file, name }) {
  if (!file) {
    return [{ path: 'index.html', body: Buffer.from(STARTER_HTML(String(name || '새 앱').trim()), 'utf8') }];
  }
  const buffer = file.body;
  if (buffer.length > MAX_UPLOAD) throw new HttpError(413, '파일이 너무 큽니다 (20MB 이하)');
  const isZip = looksLikeZip(buffer) || /\.zip$/i.test(file.name || '');
  if (isZip) return extractZipFiles(buffer);
  return [{ path: 'index.html', body: Buffer.from(buffer) }];
}

async function addApp(env, { slug, name, desc, icon, tags, howto, category, file }) {
  const apps = await store.readApps(env);
  const key = String(slug || '').trim().toLowerCase();
  if (key && !isValidSlug(key)) throw new HttpError(400, 'id 는 영소문자·숫자·하이픈만 쓸 수 있습니다 (40자 이하)');
  if (key && apps.some((a) => a.id === key)) throw new HttpError(409, `앱 "${key}" 이(가) 이미 있습니다`);

  const files = filesFromUpload({ file, name });
  const entry = files.find((f) => f.path === 'index.html');
  const analysis = entry ? safeAnalyze(entry.body, (file && file.name) || 'index.html') : null;
  const guess = (analysis && analysis.guess) || {};

  const meta = normalizeMeta({ name, desc, icon, tags, howto, category }, guess);

  let finalSlug = key;
  if (!finalSlug) {
    const suggested = analyze.suggestSlug({
      name: meta.name,
      category: guess.siteCategory,
      fileName: file && file.name,
    });
    finalSlug = isValidSlug(suggested) ? suggested : `app-${Date.now().toString(36)}`;
    finalSlug = uniqueSlug(apps, finalSlug);
  }

  await store.putFiles(env, finalSlug, files);
  const now = new Date().toISOString();
  const online = Boolean(analysis && (analysis.details?.externalResources || []).length);
  const app = {
    id: finalSlug,
    ...meta,
    hidden: normalizeHidden(file && file.hidden, false),
    ...(online ? { online: true } : {}),
    path: `apps/${finalSlug}/`,
    entry: 'index.html',
    files: files.map((f) => f.path),
    createdAt: now,
    updatedAt: now,
  };
  apps.push(app);
  await store.writeApps(env, apps);
  const rebuild = await store.rebuild(env);
  return { app, analysis, rebuild };
}

async function updateApp(env, id, patch) {
  const apps = await store.readApps(env);
  const app = apps.find((a) => a.id === id);
  if (!app) throw new HttpError(404, '앱을 찾을 수 없습니다');
  const meta = normalizeMeta({
    name: patch.name ?? app.name,
    desc: patch.desc ?? app.desc,
    icon: patch.icon ?? app.icon,
    tags: patch.tags ?? app.tags,
    howto: patch.howto ?? app.howto,
    category: patch.category || app.category,
  });
  const hidden = normalizeHidden(patch.hidden, app.hidden);
  Object.assign(app, meta, { hidden, updatedAt: new Date().toISOString() });
  await store.writeApps(env, apps);
  await store.rebuild(env);
  return app;
}

async function renameApp(env, id, nextIdRaw) {
  const next = String(nextIdRaw || '').trim().toLowerCase();
  if (!isValidSlug(next)) throw new HttpError(400, 'id 는 영소문자·숫자·하이픈만 쓸 수 있습니다 (40자 이하)');
  if (next === id) return store.getApp(env, id);
  const apps = await store.readApps(env);
  const app = apps.find((a) => a.id === id);
  if (!app) throw new HttpError(404, '앱을 찾을 수 없습니다');
  if (apps.some((a) => a.id === next)) throw new HttpError(409, `앱 "${next}" 이(가) 이미 있습니다`);

  const files = await store.readFiles(env, id);
  if (files.length) await store.putFiles(env, next, files);
  await store.deleteAppFiles(env, id);

  app.id = next;
  app.path = `apps/${next}/`;
  app.updatedAt = new Date().toISOString();
  await store.writeApps(env, apps);
  await store.rebuild(env);
  return app;
}

async function removeApp(env, id, { permanent = false } = {}) {
  const apps = await store.readApps(env);
  const app = apps.find((a) => a.id === id);
  if (!app) throw new HttpError(404, '앱을 찾을 수 없습니다');

  // 목록에서 빼고 페이지를 다시 만듭니다. 정적 배포본에 남은 파일은 gone 표시로 가립니다.
  await store.markGone(env, id);
  if (permanent) await store.deleteAppFiles(env, id);

  await store.writeApps(env, apps.filter((a) => a.id !== id));
  await store.rebuild(env);
  return app;
}

async function analyzeApp(env, id) {
  const app = await store.getApp(env, id);
  if (!app) throw new HttpError(404, '앱을 찾을 수 없습니다');
  const body = await store.getFile(env, id, app.entry || 'index.html');
  if (!body) throw new HttpError(404, '앱의 index.html 을 찾을 수 없습니다');
  return { app: { id: app.id, name: app.name }, analysis: analyze.analyzeBuffer(Buffer.from(body), `${id}/index.html`) };
}

async function downloadApp(env, id) {
  const app = await store.getApp(env, id);
  if (!app) throw new HttpError(404, '앱을 찾을 수 없습니다');
  const files = await store.readFiles(env, id);
  if (!files.length) throw new HttpError(404, '앱 파일이 없습니다');
  return { buffer: createZip(files, id), name: app.name };
}

module.exports = { addApp, updateApp, renameApp, removeApp, analyzeApp, downloadApp, safeAnalyze };
