'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const secrets = require('./secrets');
const { isValidCategory, DEFAULT_SLUG, getCategory } = require('./categories');

const ROOT = path.join(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'apps');
const TRASH_DIR = path.join(ROOT, '.trash');
const STAGING_DIR = path.join(ROOT, 'uploads');
const MANIFEST = path.join(ROOT, 'data', 'apps.json');

const meta = require('./meta');

const { HOWTO_MAX, isValidSlug, parseTags, normalizeMeta, normalizeHidden, normalizeManual, HttpError, safeAnalyze } = meta;

async function ensureDirs() {
  await fsp.mkdir(APPS_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(MANIFEST), { recursive: true });
  await fsp.mkdir(TRASH_DIR, { recursive: true });
  await fsp.mkdir(STAGING_DIR, { recursive: true });
}

async function readApps() {
  try {
    const raw = await fsp.readFile(MANIFEST, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`apps.json is not readable JSON: ${err.message}`);
  }
}

async function writeApps(apps) {
  apps.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const tmp = `${MANIFEST}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(apps, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, MANIFEST);
  return apps;
}

function assertInside(baseDir, target) {
  const base = path.resolve(baseDir);
  const full = path.resolve(target);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new HttpError(400, 'archive contains an unsafe path');
  }
  return full;
}

/**
 * A zip may wrap everything in one top level folder ("todo/index.html").
 * Detect that and rewrite entries to the folder root.
 */
function topLevelPrefix(entries) {
  const names = entries
    .filter((e) => !e.isDirectory)
    .map((e) => e.entryName.replace(/\\/g, '/'));
  if (names.length === 0) return '';
  if (names.some((n) => n === 'index.html')) return '';
  const first = names[0].split('/')[0];
  if (!first || first === names[0]) return '';
  if (!names.every((n) => n.startsWith(`${first}/`))) return '';
  return `${first}/`;
}

async function extractZip(buffer, destDir) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new HttpError(400, 'uploaded file is not a valid zip');
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length === 0) throw new HttpError(400, 'archive is empty');
  if (entries.length > 2000) throw new HttpError(400, 'archive has too many files');

  const prefix = topLevelPrefix(entries);
  let total = 0;
  let hasIndex = false;

  for (const entry of entries) {
    const rel = entry.entryName.replace(/\\/g, '/').slice(prefix.length);
    if (!rel) continue;
    if (rel.startsWith('/') || rel.includes('\0')) {
      throw new HttpError(400, 'archive contains an unsafe path');
    }
    const target = assertInside(destDir, path.join(destDir, rel));
    const data = entry.getData();
    total += data.length;
    if (total > 50 * 1024 * 1024) throw new HttpError(400, 'archive is larger than 50MB');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
    if (rel === 'index.html') hasIndex = true;
  }
  if (!hasIndex) {
    throw new HttpError(400, 'the app must contain an index.html entry point');
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

async function moveDir(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.cp(from, to, { recursive: true });
    await fsp.rm(from, { recursive: true, force: true });
  }
}

async function addApp(input) {
  const { slug, name, desc, icon, tags, howto, file, zip } = input;
  await ensureDirs();
  const apps = await readApps();

  const key = String(slug || '').trim().toLowerCase();
  if (key && !isValidSlug(key)) {
    throw new HttpError(400, 'id must be lowercase letters, digits and hyphens (max 40)');
  }
  if (key && apps.some((a) => a.id === key)) {
    throw new HttpError(409, `app "${key}" already exists`);
  }

  const isZip =
    zip ||
    (file && (file.originalname.toLowerCase().endsWith('.zip') || file.mimetype === 'application/zip'));

  // Stage the upload first: the analysis needs to read index.html, and the
  // final app id may be derived from what the analysis finds.
  const stage = await fsp.mkdtemp(path.join(STAGING_DIR, 'stage-'));
  let uploadSecrets = null;
  try {
    if (isZip) {
      await extractZip(file.buffer, stage);
      // 압축 안의 html 도 정리
      const collected = [];
      const walkStage = async (dir, prefix = '') => {
        for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walkStage(full, `${prefix}${entry.name}/`);
          else collected.push({ path: `${prefix}${entry.name}`, full });
        }
      };
      await walkStage(stage);
      const { files: cleanedFiles, secrets: found, removedBlocks } = cleanUploadedFiles(
        await Promise.all(collected.map(async (c) => ({ path: c.path, body: await fsp.readFile(c.full) })))
      );
      uploadSecrets = { secrets: found, removedBlocks };
      for (const entry of cleanedFiles) {
        if (!/\.html?$/i.test(entry.path)) continue;
        await fsp.writeFile(path.join(stage, entry.path), entry.body, 'utf8');
      }
    } else if (file) {
      const cleaned = secrets.cleanHtml(file.buffer.toString('utf8'));
      uploadSecrets = { secrets: cleaned.findings, removedBlocks: cleaned.removed };
      await fsp.writeFile(path.join(stage, 'index.html'), cleaned.html, 'utf8');
    } else {
      await fsp.writeFile(path.join(stage, 'index.html'), STARTER_HTML(String(name || '새 앱').trim()), 'utf8');
    }

    let analysis = null;
    try {
      const html = await fsp.readFile(path.join(stage, 'index.html'));
      analysis = safeAnalyze(html, (file && file.originalname) || 'index.html');
    } catch {
      analysis = null;
    }
    const guess = (analysis && analysis.guess) || {};

    const meta = normalizeMeta({ name, desc, icon, tags, howto }, guess);

    let finalSlug = key;
    if (!finalSlug) {
      // Short English id: file name -> title words -> romanized Korean -> category.
      // Falls back to a random suffix only when nothing usable could be derived.
      const { suggestSlug } = require('./analyze');
      const derived = suggestSlug({
        name: meta.name,
        category: guess.category,
        fileName: file && file.originalname,
      });
      finalSlug = isValidSlug(derived) ? derived : `app-${Date.now().toString(36)}`;
      let candidate = finalSlug;
      let n = 2;
      while (apps.some((a) => a.id === candidate) || fs.existsSync(path.join(APPS_DIR, candidate))) {
        candidate = `${finalSlug}-${n++}`;
      }
      finalSlug = candidate;
    }

    const destDir = assertInside(APPS_DIR, path.join(APPS_DIR, finalSlug));
    await fsp.rm(destDir, { recursive: true, force: true });
    await moveDir(stage, destDir);

    const now = new Date().toISOString();
    const online = Boolean(analysis && (analysis.details?.externalResources || []).length);
    const app = {
      id: finalSlug,
      ...meta,
      hidden: normalizeHidden(input.hidden, false),
      ...(online ? { online: true } : {}),
      path: `apps/${finalSlug}/`,
      entry: 'index.html',
      createdAt: now,
      updatedAt: now,
    };
    apps.push(app);
    await writeApps(apps);
    return { app, analysis, secrets: uploadSecrets ? uploadSecrets.secrets : [], removedBlocks: uploadSecrets ? uploadSecrets.removedBlocks : [] };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

async function updateApp(id, patch) {
  const apps = await readApps();
  const app = apps.find((a) => a.id === id);
  if (!app) throw new HttpError(404, 'app not found');
  const meta = normalizeMeta({
    name: patch.name ?? app.name,
    desc: patch.desc ?? app.desc,
    icon: patch.icon ?? app.icon,
    tags: patch.tags ?? app.tags,
    howto: patch.howto ?? app.howto,
    category: patch.category || app.category, // 빈 값이면 기존 분야 유지
  });
  const hidden = normalizeHidden(patch.hidden, app.hidden);
  const manual = normalizeManual(patch.manual);
  Object.assign(app, meta, { hidden, updatedAt: new Date().toISOString() });
  if (manual !== undefined) app.manual = manual; // undefined = 변경 없음, '' = 삭제
  await writeApps(apps);
  return app;
}

async function removeApp(id, { permanent = false } = {}) {
  const apps = await readApps();
  const app = apps.find((a) => a.id === id);
  if (!app) throw new HttpError(404, 'app not found');
  const dir = assertInside(APPS_DIR, path.join(APPS_DIR, id));

  if (permanent) {
    await fsp.rm(dir, { recursive: true, force: true });
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.mkdir(TRASH_DIR, { recursive: true });
    await fsp.rename(dir, path.join(TRASH_DIR, `${id}-${stamp}`)).catch(async (err) => {
      if (err.code === 'ENOENT') return;
      throw err;
    });
  }

  await writeApps(apps.filter((a) => a.id !== id));
  return app;
}

async function getApp(id) {
  const apps = await readApps();
  return apps.find((a) => a.id === id) || null;
}

/** Moves an app folder and rewrites its id (used to fix unreadable ids). */
async function renameApp(id, newId) {
  const next = String(newId || '').trim().toLowerCase();
  if (!isValidSlug(next)) {
    throw new HttpError(400, 'id must be lowercase letters, digits and hyphens (max 40)');
  }
  if (next === id) return getApp(id);
  const apps = await readApps();
  const app = apps.find((a) => a.id === id);
  if (!app) throw new HttpError(404, 'app not found');
  if (apps.some((a) => a.id === next) || fs.existsSync(path.join(APPS_DIR, next))) {
    throw new HttpError(409, `app "${next}" already exists`);
  }
  const from = assertInside(APPS_DIR, path.join(APPS_DIR, id));
  const to = assertInside(APPS_DIR, path.join(APPS_DIR, next));
  if (fs.existsSync(from)) await moveDir(from, to);
  // 옛 주소로 들어오는 요청이 끊기지 않게 이전 id 를 남겨 둡니다 (301 로 연결)
  const former = Array.isArray(app.formerIds) ? app.formerIds.filter((x) => x && x !== next) : [];
  app.formerIds = [...new Set([...former, id])].slice(-10);
  app.id = next;
  app.path = `apps/${next}/`;
  app.updatedAt = new Date().toISOString();
  await writeApps(apps);
  return app;
}

/** Re-runs the analyzer over an app that is already stored on disk. */
async function analyzeApp(id) {
  // 아래에서 분석 결과로 online 플래그를 갱신합니다
  const app = await getApp(id);
  if (!app) throw new HttpError(404, 'app not found');
  const entry = assertInside(APPS_DIR, path.join(APPS_DIR, id, app.entry || 'index.html'));
  let html;
  try {
    html = await fsp.readFile(entry);
  } catch {
    throw new HttpError(404, 'index.html not found for this app');
  }
  const { analyzeBuffer } = require('./analyze');
  const analysis = analyzeBuffer(html, `${id}/index.html`);
  // 인터넷이 필요한 앱인지(외부 리소스 사용) 다시 판정해 저장합니다 — 상세 페이지에 안내가 나갑니다
  const apps = await readApps();
  const target = apps.find((a) => a.id === id);
  if (target) {
    const online = Boolean(analysis && (analysis.details?.externalResources || []).length);
    if (online) target.online = true;
    else delete target.online;
    target.updatedAt = new Date().toISOString();
    await writeApps(apps);
  }
  return { app: target || app, analysis };
}

/** 업로드된 HTML 에서 API 키·토큰을 제거합니다 (저장 전) */
function cleanUploadedFiles(files) {
  const findings = [];
  const removedBlocks = [];
  const cleaned = files.map((entry) => {
    if (!/\.html?$/i.test(entry.path)) return entry;
    const text = typeof entry.body === 'string' ? entry.body : Buffer.from(entry.body).toString('utf8');
    const result = secrets.cleanHtml(text);
    findings.push(...result.findings.map((f) => ({ ...f, file: entry.path })));
    removedBlocks.push(...result.removed);
    return { ...entry, body: result.html };
  });
  return { files: cleaned, secrets: findings, removedBlocks };
}

/** 등록된 앱의 파일만 교체합니다 (html 또는 zip 업로드) */
async function replaceFiles(id, file) {
  const app = await getApp(id);
  if (!app) throw new HttpError(404, 'app not found');
  const stage = await fsp.mkdtemp(path.join(STAGING_DIR, 'swap-'));
  try {
    const isZip = file.originalname.toLowerCase().endsWith('.zip') || file.mimetype === 'application/zip';
    if (isZip) await extractZip(file.buffer, stage);
    else await fsp.writeFile(path.join(stage, 'index.html'), file.buffer);

    const collected = [];
    const walk = async (dir, prefix = '') => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
        else collected.push({ path: `${prefix}${entry.name}`, body: await fsp.readFile(full) });
      }
    };
    await walk(stage);

    const { files: cleaned, secrets: found, removedBlocks } = cleanUploadedFiles(collected);
    const destDir = assertInside(APPS_DIR, path.join(APPS_DIR, id));
    await fsp.rm(destDir, { recursive: true, force: true });
    await fsp.mkdir(destDir, { recursive: true });
    for (const entry of cleaned) {
      const target = assertInside(destDir, path.join(destDir, entry.path));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, entry.body);
    }

    const apps = await readApps();
    const record = apps.find((a) => a.id === id);
    if (record) {
      record.files = cleaned.map((f) => f.path);
      record.updatedAt = new Date().toISOString();
      await writeApps(apps);
    }
    return { app: record || app, secrets: found, removedBlocks };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  ROOT,
  APPS_DIR,
  MANIFEST,
  HttpError,
  isValidSlug,
  normalizeMeta,
  parseTags,
  ensureDirs,
  readApps,
  writeApps,
  addApp,
  updateApp,
  removeApp,
  replaceFiles,
  cleanUploadedFiles,
  getApp,
  analyzeApp,
  normalizeMeta,
  parseTags,
  renameApp,
  safeAnalyze,
  STARTER_HTML,
};
