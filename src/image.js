'use strict';

/**
 * 업로드된 로고 이미지의 실제 형식과 크기를 확인합니다.
 *
 * 파일 이름이나 브라우저가 보낸 content-type 은 믿지 않고 매직 바이트로 판단합니다.
 * (앞부분을 위조한 파일을 로고로 올려 다른 형식이 서비스되는 것을 막습니다.)
 * Node 서버와 Cloudflare Worker 가 함께 씁니다.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const MIN_SIDE = 32; // 너무 작으면 파비콘에서 뭉개집니다
const MAX_SIDE = 4096;

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function png(b) {
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return { ext: 'png', width: u32(b, 16), height: u32(b, 20) };
}

function gif(b) {
  if (b.length < 10) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  return { ext: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
}

function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda) break; // 압축 데이터 시작 — 크기 정보는 그 앞에 있습니다
    const len = u16(b, i + 2);
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) return { ext: 'jpg', width: u16(b, i + 7), height: u16(b, i + 5) };
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

function webp(b) {
  if (b.length < 30) return null;
  if (u32(b, 0) !== 0x52494646 || u32(b, 8) !== 0x57454250) return null; // 'RIFF' … 'WEBP'
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === 'VP8X') {
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { ext: 'webp', width: w, height: h };
  }
  if (fourcc === 'VP8L') {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { ext: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8 ') {
    return { ext: 'webp', width: u16(b, 26) & 0x3fff, height: u16(b, 28) & 0x3fff };
  }
  return null;
}

/** 바이트에서 이미지 형식·크기를 알아냅니다. 이미지가 아니면 null. */
function detect(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const found = png(b) || jpeg(b) || webp(b) || gif(b);
  if (!found) return null;
  return { ...found, type: TYPES[found.ext], bytes: b.length };
}

/** 업로드 파일 검사 — 통과하면 { ok: true, image }, 아니면 { ok: false, error } */
function validate(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length) return { ok: false, error: '빈 파일입니다' };
  if (b.length > MAX_BYTES) return { ok: false, error: `파일이 너무 큽니다 (2MB 이하로 줄여 주세요 — 지금 ${Math.round(b.length / 1024)}KB)` };
  const image = detect(b);
  if (!image) return { ok: false, error: 'PNG · JPG · WEBP · GIF 이미지 파일만 올릴 수 있습니다' };
  if (!image.width || !image.height) return { ok: false, error: '이미지 크기를 읽지 못했습니다' };
  if (image.width < MIN_SIDE || image.height < MIN_SIDE) {
    return { ok: false, error: `이미지가 너무 작습니다 (${image.width}×${image.height} — ${MIN_SIDE}px 이상)` };
  }
  if (image.width > MAX_SIDE || image.height > MAX_SIDE) {
    return { ok: false, error: `이미지가 너무 큽니다 (${image.width}×${image.height} — ${MAX_SIDE}px 이하)` };
  }
  return { ok: true, image };
}

module.exports = { MAX_BYTES, MIN_SIDE, MAX_SIDE, TYPES, detect, validate };
