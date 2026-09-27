'use strict';

/** Cloudflare Worker 관리자 인증: 비밀번호 로그인 + 서명 쿠키 세션 */

const password = require('../src/password-crypto');
const store = require('./store');

const COOKIE = 'myhome.sid';
const MAX_AGE = 7 * 24 * 60 * 60; // 7일 (초)
const ATTEMPT_MAX = 8;
const ATTEMPT_WINDOW = 10 * 60; // 10분 (초)

function HttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ------------------------------------------------ 쿠키 서명 */

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text) {
  const pad = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(secret, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

async function verify(secret, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), new TextEncoder().encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

async function currentUser(request, env) {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE];
  if (!token) return null;
  const payload = await verify(await store.sessionSecret(env), token);
  if (!payload || payload.sub !== 'admin') return null;
  return { provider: 'password', login: 'admin', name: '관리자', avatar: null };
}

async function createSessionCookie(env) {
  const token = await sign(await store.sessionSecret(env), { sub: 'admin', exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/* ------------------------------------------------ 비밀번호 */

async function passwordStatus(env) {
  const record = await store.readJson(env, store.KEY.password, {});
  const hash = record?.password?.hash;
  return {
    passwordSet: Boolean(hash),
    updatedAt: record?.password?.updatedAt || null,
    minLength: password.MIN_LENGTH,
    envFallback: Boolean(!hash && env.ADMIN_PASSWORD),
  };
}

async function setPassword(env, next, { currentPassword = null, requireCurrent = true } = {}) {
  const record = (await store.readJson(env, store.KEY.password, {})) || {};
  if (requireCurrent) {
    const ok = await verifyPassword(env, String(currentPassword ?? ''));
    if (!ok) throw HttpError(401, '현재 비밀번호가 올바르지 않습니다');
  }
  const value = password.assertUsable(next, { field: '새 비밀번호' });
  if (await verifyPassword(env, value)) throw HttpError(400, '지금 쓰는 비밀번호와 다르게 정해 주세요');
  record.password = {
    hash: await password.hashPassword(value),
    updatedAt: new Date().toISOString(),
    algorithm: 'scrypt',
  };
  await env.MYHOME.put(store.KEY.password, JSON.stringify(record));
  return { updatedAt: record.password.updatedAt };
}

async function verifyPassword(env, value) {
  const plain = String(value ?? '');
  if (!plain) return false;
  const record = await store.readJson(env, store.KEY.password, {});
  const hash = record?.password?.hash;
  if (hash) return password.verifyHash(plain, hash);
  if (env.ADMIN_PASSWORD) {
    const a = new TextEncoder().encode(plain);
    const b = new TextEncoder().encode(String(env.ADMIN_PASSWORD));
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
  }
  return false;
}

/* ------------------------------------------------ 시도 제한 */

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

async function tooManyAttempts(env, ip) {
  const count = Number((await env.MYHOME.get(`rl:${ip}`)) || 0);
  return count >= ATTEMPT_MAX;
}

async function noteFailure(env, ip) {
  const key = `rl:${ip}`;
  const count = Number((await env.MYHOME.get(key)) || 0) + 1;
  await env.MYHOME.put(key, String(count), { expirationTtl: ATTEMPT_WINDOW });
}

async function clearFailures(env, ip) {
  await env.MYHOME.delete(`rl:${ip}`);
}

module.exports = {
  HttpError,
  COOKIE,
  currentUser,
  createSessionCookie,
  clearSessionCookie,
  passwordStatus,
  setPassword,
  verifyPassword,
  clientIp,
  tooManyAttempts,
  noteFailure,
  clearFailures,
};
