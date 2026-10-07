'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const fsp = require('fs/promises');
const session = require('express-session');
const multer = require('multer');
const AdmZip = require('adm-zip');

const manifest = require('./src/manifest');
const meta = require('./src/meta');
const markdownLib = require('./src/markdown');
const miniappAds = require('./src/miniapp-ads');
const secrets = require('./src/secrets');
const analyze = require('./src/analyze');
const auth = require('./src/auth');
const siteStore = require('./src/site');
const categories = require('./src/categories');
const passwordStore = require('./src/password');
const seo = require('./src/seo');
const pages = require('./src/views/pages');
const { GUIDES, findGuide } = require('./src/content/guides');

const { ROOT, APPS_DIR, HttpError } = manifest;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const sessionSecret =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim()
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: 'myhome.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

// ---------------- API ----------------

app.get('/api/apps', async (req, res, next) => {
  try {
    const all = await manifest.readApps();
    // 관리자(?all=1, 로그인 필요)만 비노출 앱까지 봅니다
    const wantsAll = req.query.all === '1' && req.session && req.session.user;
    const list = wantsAll ? all : meta.filterVisible(all);
    res.json({ apps: meta.stripManual(list) });
  } catch (err) {
    next(err);
  }
});

// 등록된 앱의 파일 교체 (관리자) — 업로드본과 같은 정리(비밀값 제거)를 거칩니다
app.put('/api/apps/:id/files', auth.requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, '교체할 파일을 선택하세요 (html 또는 zip)');
    const updated = await manifest.replaceFiles(req.params.id, req.file);
    res.json({ app: updated.app, secrets: updated.secrets, removedBlocks: updated.removedBlocks });
  } catch (err) {
    next(err);
  }
});

// 마크다운 미리보기 (관리자)
app.post('/api/markdown', auth.requireAuth, async (req, res, next) => {
  try {
    const markdown = String((req.body && req.body.markdown) || '').slice(0, 200000);
    res.json({ html: markdownLib.renderMarkdown(markdown) });
  } catch (err) {
    next(err);
  }
});

// 사용설명서(.md) 저장·삭제
app.put('/api/apps/:id/manual', auth.requireAuth, async (req, res, next) => {
  try {
    const manual = meta.normalizeManual((req.body && req.body.markdown) ?? '');
    const updated = await manifest.updateApp(req.params.id, { manual });
    res.json({ app: { id: updated.id, manualChars: (updated.manual || '').length } });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/apps/:id/manual', auth.requireAuth, async (req, res, next) => {
  try {
    const updated = await manifest.updateApp(req.params.id, { manual: '' });
    res.json({ app: { id: updated.id, manualChars: (updated.manual || '').length } });
  } catch (err) {
    next(err);
  }
});

app.get('/apps/:id/manual.md', async (req, res, next) => {
  try {
    const app_ = await manifest.getApp(req.params.id);
    if (!app_ || !app_.manual) return next();
    res.type('text/markdown; charset=utf-8').send(app_.manual);
  } catch (err) {
    next(err);
  }
});

app.get('/api/apps/:id', async (req, res, next) => {
  try {
    const found = await manifest.getApp(req.params.id);
    const viewer = req.session && req.session.user;
    if (!found || (found.hidden && !viewer)) throw new HttpError(404, 'app not found');
    res.json({ app: found });
  } catch (err) {
    next(err);
  }
});

app.post('/api/analyze', auth.requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, '분석할 파일을 선택하세요');
    const analysis = analyze.analyzeBuffer(req.file.buffer, req.file.originalname);
    res.json({ analysis });
  } catch (err) {
    next(err);
  }
});

app.post('/api/apps/:id/analyze', auth.requireAuth, async (req, res, next) => {
  try {
    const { app, analysis } = await manifest.analyzeApp(req.params.id);
    res.json({ app: { id: app.id, name: app.name }, analysis });
  } catch (err) {
    next(err);
  }
});

app.post('/api/apps', auth.requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    const { app: app_, analysis } = await manifest.addApp({
      slug: req.body.id || req.body.slug,
      name: req.body.name,
      desc: req.body.desc,
      icon: req.body.icon,
      tags: req.body.tags,
      howto: req.body.howto,
      category: req.body.category,
      file: req.file,
      zip: req.body.zip === 'true',
    });
    res.status(201).json({ app: app_, analysis });
  } catch (err) {
    next(err);
  }
});

app.post('/api/apps/:id/rename', auth.requireAuth, async (req, res, next) => {
  try {
    const nextId = (req.body && (req.body.id || req.body.newId)) || '';
    const renamed = await manifest.renameApp(req.params.id, nextId);
    res.json({ app: renamed });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/apps/:id', auth.requireAuth, async (req, res, next) => {
  try {
    const updated = await manifest.updateApp(req.params.id, req.body || {});
    res.json({ app: updated });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/apps/:id', auth.requireAuth, async (req, res, next) => {
  try {
    const removed = await manifest.removeApp(req.params.id, {
      permanent: req.query.permanent === '1',
    });
    res.json({ removed });
  } catch (err) {
    next(err);
  }
});

app.get('/api/apps/:id/download', auth.requireAuth, async (req, res, next) => {
  try {
    const found = await manifest.getApp(req.params.id);
    if (!found) throw new HttpError(404, 'app not found');
    const dir = path.join(APPS_DIR, found.id);
    const zip = new AdmZip();
    zip.addLocalFolder(dir, found.id);
    const buffer = zip.toBuffer();
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="${found.id}.zip"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// ---------------- 사이트 설정 API ----------------

app.get('/api/site', async (req, res, next) => {
  try {
    const raw = await siteStore.readSite();
    const site = siteStore.publicSite(raw, `${req.protocol}://${req.get('host')}`);
    let passwordStatus = { passwordSet: false, updatedAt: null, minLength: passwordStore.MIN_LENGTH };
    try {
      passwordStatus = await passwordStore.status();
    } catch { /* 파일 문제 시 기본값 */ }
    res.json({
      site,
      security: {
        openOAuth: auth.adminLogins().includes('*'),
        allowDevLogin: auth.allowDevLogin,
        passwordSet: passwordStatus.passwordSet,
        passwordFromEnv: Boolean(passwordStatus.envFallback),
        passwordUpdatedAt: passwordStatus.updatedAt,
        passwordMinLength: passwordStore.MIN_LENGTH,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------- 관리자 비밀번호 ----------------

app.get('/api/admin/password', auth.requireAuth, async (req, res, next) => {
  try {
    const status = await passwordStore.status();
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

app.put('/api/admin/password', auth.requireAuth, async (req, res, next) => {
  try {
    const { current, next: nextPassword } = req.body || {};
    const result = await passwordStore.setPassword(nextPassword, {
      currentPassword: current ?? null,
      requireCurrent: true,
    });
    res.json({ ok: true, updatedAt: result.updatedAt });
  } catch (err) {
    next(err);
  }
});

app.put('/api/site', auth.requireAuth, async (req, res, next) => {
  try {
    const saved = await siteStore.writeSite(req.body || {});
    res.json({ site: siteStore.publicSite(saved, `${req.protocol}://${req.get('host')}`) });
  } catch (err) {
    next(err);
  }
});

// ---------------- 검색엔진·광고용 파일 ----------------

async function currentSite(req) {
  const site = await siteStore.readSite();
  return siteStore.publicSite(site, `${req.protocol}://${req.get('host')}`);
}

app.get('/robots.txt', async (req, res, next) => {
  try {
    res.type('text/plain').send(seo.robots({ site: await currentSite(req) }));
  } catch (err) {
    next(err);
  }
});

app.get('/rss.xml', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const apps = meta.filterVisible(await manifest.readApps());
    res.type('application/rss+xml; charset=utf-8').send(seo.rss({ site, apps, guides: GUIDES }));
  } catch (err) {
    next(err);
  }
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const apps = meta.filterVisible(await manifest.readApps());
    res.type('application/xml').send(seo.sitemap({ site, apps }));
  } catch (err) {
    next(err);
  }
});

app.get('/ads.txt', async (req, res, next) => {
  try {
    const content = seo.adsTxt({ site: await currentSite(req) });
    if (!content) return res.status(404).type('text/plain').send('ads.txt is not configured yet\n');
    res.type('text/plain').send(content);
  } catch (err) {
    next(err);
  }
});

// ---------------- 공개 페이지 (서버 렌더링) ----------------

app.get('/', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const apps = meta.filterVisible(await manifest.readApps());
    res.send(pages.homePage({ site, apps, guides: GUIDES }));
  } catch (err) {
    next(err);
  }
});

app.get('/apps', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const apps = meta.filterVisible(await manifest.readApps());
    res.send(pages.appsPage({ site, apps }));
  } catch (err) {
    next(err);
  }
});

app.get('/categories', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const apps = meta.filterVisible(await manifest.readApps());
    res.send(pages.categoriesPage({ site, apps }));
  } catch (err) {
    next(err);
  }
});

app.get('/category/:slug', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const category = categories.getCategory(req.params.slug);
    if (!category) return res.status(404).send(pages.notFoundPage({ site }));
    const apps = await manifest.readApps();
    const hasApps = meta.filterVisible(apps).some((a) => (a.category || 'etc') === category.slug);
    if (!hasApps) return res.redirect(302, '/categories');
    res.send(pages.categoryPage({ site, apps, category }));
  } catch (err) {
    next(err);
  }
});

app.get('/api/categories', async (req, res, next) => {
  try {
    const apps = meta.filterVisible(await manifest.readApps());
    const counted = pages.categoryCounts(apps);
    res.json({
      categories: categories.listCategories().map((c) => ({
        ...c,
        count: (counted.find((x) => x.slug === c.slug) || { count: 0 }).count,
      })),
    });
  } catch (err) {
    next(err);
  }
});

app.get('/app/:id', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const apps = await manifest.readApps();
    const app_ = apps.find((a) => a.id === req.params.id);
    if (!app_) return res.status(404).send(pages.notFoundPage({ site }));
    res.send(pages.appDetailPage({ site, app: app_, apps }));
  } catch (err) {
    next(err);
  }
});

app.get('/guide', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const apps = meta.filterVisible(await manifest.readApps());
    res.send(pages.guideIndexPage({ site, apps, guides: GUIDES }));
  } catch (err) {
    next(err);
  }
});

app.get('/guide/:slug', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const guide = findGuide(req.params.slug);
    if (!guide) return res.status(404).send(pages.notFoundPage({ site }));
    const apps = meta.filterVisible(await manifest.readApps());
    res.send(pages.guideDetailPage({ site, guide, apps }));
  } catch (err) {
    next(err);
  }
});

app.get('/about', async (req, res, next) => {
  try {
    const site = await currentSite(req);
    const apps = meta.filterVisible(await manifest.readApps());
    res.send(pages.aboutPage({ site, apps, guides: GUIDES }));
  } catch (err) {
    next(err);
  }
});

app.get('/contact', async (req, res, next) => {
  try {
    res.send(pages.contactPage({ site: await currentSite(req) }));
  } catch (err) {
    next(err);
  }
});

for (const [route, build] of [
  ['/privacy', 'privacyPolicy'],
  ['/terms', 'termsOfService'],
  ['/disclaimer', 'disclaimer'],
]) {
  app.get(route, async (req, res, next) => {
    try {
      const site = await currentSite(req);
      res.send(pages.policyPage({ site, doc: pages[build](site) }));
    } catch (err) {
      next(err);
    }
  });
}

// ---------------- Auth + static ----------------

auth.mount(app);

app.get('/admin.html', auth.requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
// 업로드된 앱 화면에 광고 코드를 끼워 넣어 내보냅니다 (파일은 그대로 두고 응답만 가공)
app.get([/^\/apps\/([a-z0-9-]+)\/$/i, /^\/apps\/([a-z0-9-]+)\/([^/]+\.html?)$/i], async (req, res, next) => {
  try {
    const slug = String(req.params[0]);
    const rel = req.params[1] || 'index.html';
    if (!/^[a-z0-9-]{1,64}$/.test(slug) || rel.includes('..')) return next();
    const site = await currentSite(req);
    const ads = site.adsense || {};
    if (ads.inApps === false) return next();
    const target = path.join(APPS_DIR, slug, rel);
    if (!target.startsWith(APPS_DIR)) return next();
    const html = secrets.cleanHtml(await fsp.readFile(target, 'utf8')).html;
    res.type('html').send(miniappAds.injectAppAds(html, {
      client: ads.client,
      slot: ads.slotDisplay || ads.slotInline,
      adtest: Boolean(site.adsPreview),
    }));
  } catch {
    next();
  }
});

app.use('/apps', express.static(APPS_DIR, { extensions: ['html'], index: 'index.html' }));

app.use(async (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  try {
    res.status(404).send(pages.notFoundPage({ site: await currentSite(req) }));
  } catch {
    res.status(404).type('text/plain').send('404 not found\n');
  }
});

app.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const message = err.message || 'internal error';
  if (status >= 500) console.error('[myhome]', err);
  const wantsJson = req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.xhr;
  if (wantsJson) return res.status(status).json({ error: message, status });
  res.status(status).type('text/plain').send(`${status} ${message}\n\n뒤로 가서 다시 시도하세요.`);
});

async function start() {
  await manifest.ensureDirs();
  const apps = await manifest.readApps();
  if (apps.length === 0) {
    await manifest.addApp({
      slug: 'welcome',
      name: '환영합니다',
      desc: '홈페이지에 등록된 첫 번째 앱 예시입니다.',
      icon: '👋',
      tags: ['예시'],
    });
    console.log('[myhome] seeded apps/welcome (example app)');
  }

  app.listen(PORT, () => {
    const providers = auth.providers(`http://localhost:${PORT}`);
    const enabled = Object.entries(providers)
      .filter(([, p]) => p.enabled)
      .map(([k]) => k);
    console.log(`[myhome] http://localhost:${PORT}  (admin: /admin.html)`);
    console.log(
      enabled.length
        ? `[myhome] login providers: ${enabled.join(', ')}`
        : '[myhome] no OAuth provider configured - set GITHUB_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID/SECRET'
    );
    if (auth.allowDevLogin) {
      console.log('[myhome] ALLOW_DEV_LOGIN=1 - dev login available at /auth/dev-login?as=<ADMIN_LOGINS>');
    }
    if (!process.env.SESSION_SECRET) {
      console.log('[myhome] SESSION_SECRET is unset - using a random secret, logins drop on restart');
    }
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = app;
