'use strict';

const { GUIDES } = require('./content/guides');
const { CATEGORIES } = require('./categories');
const { privacyPolicy, termsOfService, disclaimer } = require('./content/legal');

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function dayOf(iso, fallback = '2026-09-27') {
  const text = String(iso || '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : fallback;
}

function entries({ site, apps }) {
  const list = [
    { path: '/', lastmod: dayOf(site.updatedAt), changefreq: 'daily', priority: '1.0' },
    { path: '/apps', lastmod: dayOf(site.updatedAt), changefreq: 'daily', priority: '0.9' },
    { path: '/guide', lastmod: dayOf(site.updatedAt), changefreq: 'weekly', priority: '0.7' },
    { path: '/categories', lastmod: dayOf(site.updatedAt), changefreq: 'weekly', priority: '0.7' },
    { path: '/about', lastmod: dayOf(site.updatedAt), changefreq: 'monthly', priority: '0.6' },
    { path: '/contact', lastmod: dayOf(site.updatedAt), changefreq: 'monthly', priority: '0.5' },
  ];
  for (const app of apps) {
    list.push({ path: `/app/${app.id}`, lastmod: dayOf(app.updatedAt || app.createdAt), changefreq: 'monthly', priority: '0.8' });
  }
  const usedCategories = new Set(apps.map((a) => a.category).filter(Boolean));
  for (const category of CATEGORIES) {
    if (!usedCategories.has(category.slug)) continue;
    list.push({ path: `/category/${category.slug}`, lastmod: dayOf(site.updatedAt), changefreq: 'weekly', priority: '0.7' });
  }
  for (const guide of GUIDES) {
    list.push({ path: `/guide/${guide.slug}`, lastmod: dayOf(guide.date), changefreq: 'yearly', priority: '0.6' });
  }
  for (const doc of [privacyPolicy(site), termsOfService(site), disclaimer(site)]) {
    list.push({ path: `/${doc.slug}`, lastmod: dayOf(doc.updated), changefreq: 'yearly', priority: '0.4' });
  }
  return list;
}

function sitemap({ site, apps }) {
  const base = String(site.domain || '').replace(/\/+$/, '');
  const urls = entries({ site, apps })
    .map((e) => `  <url>
    <loc>${xmlEscape(base + e.path)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

function robots({ site }) {
  const base = String(site.domain || '').replace(/\/+$/, '');
  const lines = [
    '# 검색엔진 전체 허용',
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin.html',
    'Disallow: /login.html',
    'Disallow: /api/',
    'Disallow: /uploads/',
    '',
    '# Google 광고 크롤러(광고 게재를 위해 필요)',
    'User-agent: Mediapartners-Google',
    'Allow: /',
    '',
    'User-agent: AdsBot-Google',
    'Allow: /',
    '',
  ];
  if (base) lines.push(`Sitemap: ${base}/sitemap.xml`, '');
  return lines.join('\n');
}

/** AdSense 에서 요구하는 ads.txt (게시자 ID가 설정된 경우에만 내용을 만듭니다). */
function adsTxt({ site }) {
  const client = String(site.adsense?.client || '').trim();
  const pub = client.replace(/^ca-/, '');
  if (!/^pub-\d{10,}$/.test(pub)) return '';
  return `# Google AdSense
google.com, ${pub}, DIRECT, f08c47fec0942fa0
`;
}

module.exports = { sitemap, robots, adsTxt, entries };
