'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { isValidCategory, DEFAULT_SLUG, getCategory } = require('./categories');

const ROOT = path.join(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'apps');
const TRASH_DIR = path.join(ROOT, '.trash');
const STAGING_DIR = path.join(ROOT, 'uploads');
const MANIFEST = path.join(ROOT, 'data', 'apps.json');

const HOWTO_MAX = 4000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

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
  try {
    if (isZip) {
      await extractZip(file.buffer, stage);
    } else if (file) {
      await fsp.writeFile(path.join(stage, 'index.html'), file.buffer);
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
    const app = {
      id: finalSlug,
      ...meta,
      path: `apps/${finalSlug}/`,
      entry: 'index.html',
      createdAt: now,
      updatedAt: now,
    };
    apps.push(app);
    await writeApps(apps);
    return { app, analysis };
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
  Object.assign(app, meta, { updatedAt: new Date().toISOString() });
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
  app.id = next;
  app.path = `apps/${next}/`;
  app.updatedAt = new Date().toISOString();
  await writeApps(apps);
  return app;
}

/** Re-runs the analyzer over an app that is already stored on disk. */
async function analyzeApp(id) {
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
  return { app, analysis: analyzeBuffer(html, `${id}/index.html`) };
}

module.exports = {
  ROOT,
  APPS_DIR,
  MANIFEST,
  HttpError,
  isValidSlug,
  ensureDirs,
  readApps,
  writeApps,
  addApp,
  updateApp,
  removeApp,
  getApp,
  analyzeApp,
  renameApp,
  safeAnalyze,
  STARTER_HTML,
};
