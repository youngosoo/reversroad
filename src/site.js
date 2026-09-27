'use strict';

/**
 * Site-wide settings that the operator edits (admin → 사이트 설정), stored in
 * data/site.json. The public site name, contact address and AdSense publisher id
 * all come from here, so nothing about the operator is hard-coded in the views.
 */

const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data', 'site.json');

const {
  DEFAULTS,
  merge,
  isPlaceholderEmail,
  normalizeAdsClient,
  publicSite,
} = require('./site-config');

async function readSite() {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = merge(DEFAULTS, parsed && typeof parsed === 'object' ? parsed : {});
    merged.adsense = { ...merged.adsense, client: normalizeAdsClient(merged.adsense?.client) };
    return merged;
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULTS };
    throw new Error(`site.json 을 읽을 수 없습니다: ${err.message}`);
  }
}

async function writeSite(patch) {
  const current = await readSite();
  const next = merge(current, patch);
  next.adsense = { ...next.adsense, client: normalizeAdsClient(next.adsense?.client) };
  next.updatedAt = new Date().toISOString();
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await fsp.rename(tmp, FILE);
  return next;
}

module.exports = {
  DEFAULTS,
  FILE,
  merge: (a, b) => merge(a, b),
  isPlaceholderEmail,
  readSite,
  writeSite,
  publicSite,
  isPlaceholderEmail,
  normalizeAdsClient,
  merge,
};
