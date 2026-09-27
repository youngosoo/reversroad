'use strict';

const crypto = require('crypto');
const { HttpError } = require('./manifest');

function env(name, fallback = '') {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

const allowDevLogin = env('ALLOW_DEV_LOGIN') === '1';

function adminLogins() {
  return env('ADMIN_LOGINS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowed(identity) {
  const list = adminLogins();
  if (list.includes('*')) return true;
  return list.includes(String(identity || '').toLowerCase());
}

function providers(baseUrl) {
  return {
    github: {
      label: 'GitHub',
      enabled: Boolean(env('GITHUB_CLIENT_ID') && env('GITHUB_CLIENT_SECRET')),
      callbackUrl: `${baseUrl}/auth/github/callback`,
    },
    google: {
      label: 'Google',
      enabled: Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
      callbackUrl: `${baseUrl}/auth/google/callback`,
    },
  };
}

function baseUrlOf(req) {
  const configured = env('BASE_URL');
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api')) {
    return res.status(401).json({ error: 'authentication required', login: '/login.html' });
  }
  const next_ = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login.html?next=${next_}`);
}

function stateFor(req) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  return state;
}

function checkState(req) {
  const sent = String(req.query.state || '');
  const saved = req.session.oauthState || '';
  delete req.session.oauthState;
  if (!sent || !saved || sent.length !== saved.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(saved));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { accept: 'application/json', 'user-agent': 'myhome', ...(options.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new HttpError(502, `${url} responded ${res.status}: ${text.slice(0, 200)}`);
  }
  return data;
}

function mount(app) {
  app.get('/auth/me', (req, res) => {
    const user = (req.session && req.session.user) || null;
    const baseUrl = baseUrlOf(req);
    res.json({ user, providers: providers(baseUrl), allowDevLogin });
  });

  app.post('/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/auth/dev-login', (req, res) => {
    if (!allowDevLogin) return res.status(404).json({ error: 'not found' });
    const as = String(req.query.as || adminLogins()[0] || 'dev');
    if (!isAllowed(as)) return res.status(403).json({ error: 'not in ADMIN_LOGINS' });
    req.session.user = { provider: 'dev', login: as, name: as, avatar: null };
    res.redirect(req.query.next ? String(req.query.next) : '/admin.html');
  });

  // ---- GitHub ----
  app.get('/auth/github', (req, res) => {
    const clientId = env('GITHUB_CLIENT_ID');
    if (!clientId) return res.status(503).send('GitHub OAuth is not configured');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${baseUrlOf(req)}/auth/github/callback`,
      scope: 'read:user user:email',
      state: stateFor(req),
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  app.get('/auth/github/callback', async (req, res, next) => {
    try {
      if (!checkState(req)) throw new HttpError(400, 'invalid oauth state');
      const token = await fetchJson('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: env('GITHUB_CLIENT_ID'),
          client_secret: env('GITHUB_CLIENT_SECRET'),
          code: String(req.query.code || ''),
          redirect_uri: `${baseUrlOf(req)}/auth/github/callback`,
        }),
      });
      if (!token || !token.access_token) throw new HttpError(401, 'github token exchange failed');
      const auth = { authorization: `Bearer ${token.access_token}` };
      const me = await fetchJson('https://api.github.com/user', { headers: auth });
      if (!isAllowed(me.login)) {
        throw new HttpError(403, `${me.login} is not in ADMIN_LOGINS`);
      }
      req.session.user = {
        provider: 'github',
        login: me.login,
        name: me.name || me.login,
        avatar: me.avatar_url || null,
      };
      res.redirect('/admin.html');
    } catch (err) {
      next(err);
    }
  });

  // ---- Google ----
  app.get('/auth/google', (req, res) => {
    const clientId = env('GOOGLE_CLIENT_ID');
    if (!clientId) return res.status(503).send('Google OAuth is not configured');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${baseUrlOf(req)}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state: stateFor(req),
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get('/auth/google/callback', async (req, res, next) => {
    try {
      if (!checkState(req)) throw new HttpError(400, 'invalid oauth state');
      const body = new URLSearchParams({
        code: String(req.query.code || ''),
        client_id: env('GOOGLE_CLIENT_ID'),
        client_secret: env('GOOGLE_CLIENT_SECRET'),
        redirect_uri: `${baseUrlOf(req)}/auth/google/callback`,
        grant_type: 'authorization_code',
      });
      const token = await fetchJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!token || !token.access_token) throw new HttpError(401, 'google token exchange failed');
      const me = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo?alt=json', {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!me || !me.email) throw new HttpError(401, 'could not read google profile');
      if (!isAllowed(me.email)) throw new HttpError(403, `${me.email} is not in ADMIN_LOGINS`);
      req.session.user = {
        provider: 'google',
        login: me.email,
        name: me.name || me.email,
        avatar: me.picture || null,
      };
      res.redirect('/admin.html');
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { mount, requireAuth, providers, baseUrlOf, isAllowed, adminLogins, allowDevLogin };
