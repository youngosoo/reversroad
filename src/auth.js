'use strict';

const crypto = require('crypto');
const { HttpError } = require('./manifest');
const password = require('./password');

function env(name, fallback = '') {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

const allowDevLogin = env('ALLOW_DEV_LOGIN') === '1';

/* 비밀번호 로그인 시도 제한 (IP 기준, 메모리) */
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPT_MAX = 8;
const attempts = new Map();

function attemptState(ip) {
  const now = Date.now();
  const found = attempts.get(ip);
  if (!found || now - found.first > ATTEMPT_WINDOW_MS) return { count: 0, first: now };
  return found;
}

function noteFailure(ip) {
  const state = attemptState(ip);
  attempts.set(ip, { count: state.count + 1, first: state.first });
  if (attempts.size > 500) attempts.clear();
}

function tooManyAttempts(ip) {
  const state = attemptState(ip);
  return state.count >= ATTEMPT_MAX;
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

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
  app.get('/auth/me', async (req, res) => {
    const user = (req.session && req.session.user) || null;
    const baseUrl = baseUrlOf(req);
    let passwordStatus = { passwordSet: false };
    try {
      passwordStatus = await password.status();
    } catch { /* 비밀번호 파일 문제 시 OAuth 만 노출 */ }
    res.json({
      user,
      providers: providers(baseUrl),
      allowDevLogin,
      passwordEnabled: passwordStatus.passwordSet || passwordStatus.envFallback,
      passwordFromEnv: Boolean(passwordStatus.envFallback),
      openOAuth: adminLogins().includes('*'),
    });
  });

  // 아이디 없이 비밀번호 하나로 로그인
  app.post('/auth/password', async (req, res, next) => {
    const ip = clientIp(req);
    try {
      if (tooManyAttempts(ip)) {
        throw new HttpError(429, '시도가 너무 많습니다. 10분 뒤에 다시 시도하세요');
      }
      const value = String((req.body && req.body.password) || '');
      const status = await password.status();
      if (!status.passwordSet && !status.envFallback) {
        throw new HttpError(503, '비밀번호 로그인이 설정되어 있지 않습니다. 관리자 화면에서 설정하세요');
      }
      if (!value || !(await password.verify(value))) {
        noteFailure(ip);
        throw new HttpError(401, '비밀번호가 올바르지 않습니다');
      }
      attempts.delete(ip);
      req.session.user = {
        provider: 'password',
        login: 'admin',
        name: '관리자',
        avatar: null,
      };
      res.json({ user: req.session.user });
    } catch (err) {
      next(err);
    }
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

module.exports = {
  mount,
  requireAuth,
  providers,
  baseUrlOf,
  isAllowed,
  adminLogins,
  allowDevLogin,
  attempts,
};
