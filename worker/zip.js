'use strict';

/** Cloudflare Worker 용 압축 처리 (adm-zip 사용, 파일 시스템 없이) */

const AdmZip = require('adm-zip');

function HttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** zip 안에서 앱 진입점을 찾습니다 (index.html 우선, 없으면 가장 얕은 html) */
function pickHtmlEntry(entries) {
  const files = entries.filter((e) => !e.isDirectory);
  if (!files.length) throw HttpError(400, '압축 파일이 비어 있습니다');
  const named = (re) => files.filter((e) => re.test(e.entryName.replace(/\\/g, '/')));
  const candidates = named(/(^|\/)index\.html?$/i).length ? named(/(^|\/)index\.html?$/i) : named(/\.html?$/i);
  if (!candidates.length) throw HttpError(400, '압축 안에 html 파일이 없습니다');
  candidates.sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length);
  return candidates[0];
}

/** zip 을 메모리에서 풀어 [{ path, body }] 로 돌려줍니다 (경로 탈출 차단) */
function extractZipFiles(buffer, { maxFiles = 500, maxBytes = 20 * 1024 * 1024 } = {}) {
  let zip;
  try {
    zip = new AdmZip(Buffer.from(buffer));
  } catch {
    throw HttpError(400, 'zip 파일을 읽을 수 없습니다');
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) throw HttpError(400, '압축 파일이 비어 있습니다');
  if (entries.length > maxFiles) throw HttpError(400, `압축 안 파일이 너무 많습니다 (${entries.length}개)`);

  // 폴더째 압축한 경우(예: todo/index.html) 최상위 폴더명을 잘라냅니다
  const names = entries.map((e) => e.entryName.replace(/\\/g, '/'));
  let prefix = '';
  if (!names.includes('index.html')) {
    const first = names[0].split('/')[0];
    if (first && names.every((n) => n.startsWith(`${first}/`))) prefix = `${first}/`;
  }

  const out = [];
  let total = 0;
  let hasIndex = false;
  for (const entry of entries) {
    const rel = entry.entryName.replace(/\\/g, '/').slice(prefix.length);
    if (!rel || rel.startsWith('/') || rel.includes('\0') || rel.split('/').some((seg) => seg === '..')) {
      throw HttpError(400, '압축 안에 안전하지 않은 경로가 있습니다');
    }
    const data = entry.getData();
    total += data.length;
    if (total > maxBytes) throw HttpError(400, '압축을 푼 용량이 너무 큽니다 (20MB 초과)');
    if (rel === 'index.html') hasIndex = true;
    out.push({ path: rel, body: data });
  }
  if (!hasIndex) throw HttpError(400, '앱에는 index.html 진입점이 있어야 합니다');
  return out;
}

/** 파일 목록을 zip 으로 묶습니다 (다운로드용) */
function createZip(files, rootName) {
  const zip = new AdmZip();
  for (const file of files) {
    zip.addFile(`${rootName}/${file.path}`, Buffer.from(file.body));
  }
  return zip.toBuffer();
}

module.exports = { HttpError, extractZipFiles, createZip, pickHtmlEntry };
