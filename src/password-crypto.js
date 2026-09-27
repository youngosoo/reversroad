'use strict';

/**
 * 관리자 비밀번호 해시/검증 (파일 시스템을 쓰지 않는 순수 모듈).
 * Node 서버와 Cloudflare Worker 가 함께 사용합니다.
 */

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

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


module.exports = {
  MIN_LENGTH,
  MAX_LENGTH,
  SCRYPT,
  PasswordError,
  assertUsable,
  hashPassword,
  verifyHash,
};
