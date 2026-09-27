'use strict';

/**
 * 관리자 비밀번호.
 *
 * - 평문은 어디에도 저장하지 않습니다. scrypt 해시(+랜덤 salt)만 data/admin.json 에 남습니다.
 * - data/admin.json 은 .gitignore 대상이라 저장소에 올라가지 않습니다.
 * - 파일이 없고 ADMIN_PASSWORD 환경변수가 있으면 그 값으로 로그인할 수 있습니다(서버 최초 부팅용).
 */

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'admin.json');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

class PasswordError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function assertUsable(password, { field = '비밀번호' } = {}) {
  const value = String(password ?? '');
  if (!value) throw new PasswordError(400, `${field}를 입력하세요`);
  if (value.length < MIN_LENGTH) throw new PasswordError(400, `${field}는 ${MIN_LENGTH}자 이상이어야 합니다`);
  if (value.length > MAX_LENGTH) throw new PasswordError(400, `${field}가 너무 깁니다`);
  return value;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

async function verifyHash(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  try {
    const key = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

async function readRecord() {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    // 파일이 깨졌더라도 서버는 떠야 합니다. (비밀번호 로그인만 막힘)
    console.warn('[myhome] data/admin.json 을 읽지 못했습니다:', err.message);
    return {};
  }
}

async function writeRecord(record) {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fsp.rename(tmp, FILE);
  return record;
}

/** 비밀번호 로그인이 가능한 상태인지 (파일 또는 환경변수) */
async function status() {
  const record = await readRecord();
  return {
    passwordSet: Boolean(record.password && record.password.hash),
    updatedAt: record.password?.updatedAt || null,
    envFallback: Boolean(!(record.password && record.password.hash) && process.env.ADMIN_PASSWORD),
    minLength: MIN_LENGTH,
  };
}

async function verify(password) {
  const value = String(password ?? '');
  if (!value) return false;
  const record = await readRecord();
  if (record.password && record.password.hash) {
    return verifyHash(value, record.password.hash);
  }
  const fallback = process.env.ADMIN_PASSWORD;
  if (fallback) {
    const a = Buffer.from(value);
    const b = Buffer.from(String(fallback));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}

/** 새 비밀번호 설정. currentPassword 를 주면 먼저 검증합니다. */
async function setPassword(nextPassword, { currentPassword = null, requireCurrent = false } = {}) {
  const record = await readRecord();
  const hasStored = Boolean(record.password && record.password.hash);

  if (requireCurrent || (hasStored && currentPassword !== null)) {
    const ok = await verify(String(currentPassword ?? ''));
    if (!ok) throw new PasswordError(401, '현재 비밀번호가 올바르지 않습니다');
  }
  if (process.env.ADMIN_PASSWORD && !hasStored) {
    const okFallback = currentPassword !== null ? await verify(String(currentPassword)) : false;
    if (!okFallback && currentPassword !== null) {
      throw new PasswordError(401, '현재 비밀번호가 올바르지 않습니다');
    }
  }

  const next = assertUsable(nextPassword, { field: '새 비밀번호' });
  if (await verify(next)) {
    throw new PasswordError(400, '지금 쓰는 비밀번호와 다르게 정해 주세요');
  }

  record.password = {
    hash: await hashPassword(next),
    updatedAt: new Date().toISOString(),
    algorithm: `scrypt(N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p})`,
  };
  await writeRecord(record);
  return { updatedAt: record.password.updatedAt };
}

module.exports = {
  FILE,
  MIN_LENGTH,
  PasswordError,
  status,
  verify,
  setPassword,
  hashPassword,
  verifyHash,
  assertUsable,
};
