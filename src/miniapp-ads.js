'use strict';

const { bannerParts } = require('./banner');

/**
 * 업로드된 앱 화면(/apps/<id>/…)에 애드센스 광고 코드를 끼워 넣습니다.
 *
 * 앱 파일 자체는 손대지 않고 "내보낼 때"만 주입하므로,
 *   - 앱을 다시 올려도 광고 코드가 파일에 남지 않습니다.
 *   - 이미 들어가 있으면(다른 방식으로 넣은 경우) 중복 삽입하지 않습니다.
 *
 * 사용: src/miniapp-ads.js → worker/index.js(배포), server.js(로컬), tools/export-static.js(정적 빌드)
 */

const PUB_RE = /^ca-pub-\d{10,}$/;

function headTag(client) {
  return `
<meta name="google-adsense-account" content="${client}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`;
}

function adBlock(client, slot, { adtest = false } = {}) {
  // 앱마다 레이아웃이 달라(body 가 grid/flex 인 앱도 있음) 광고가 찌그러지지 않도록
  // 폭·정렬을 인라인 스타일로 강제합니다.
  return `
<aside class="rr-ad no-print" aria-label="광고" style="display:block;position:relative;width:100%;max-width:1100px;min-width:0;margin:48px auto 24px;padding:0 16px;box-sizing:border-box;justify-self:stretch;grid-column:1/-1;align-self:start;">
  <div style="font-size:11px;opacity:.6;margin-bottom:4px;">광고</div>
  <ins class="adsbygoogle" style="display:block;width:100%;min-width:0;min-height:100px"
       data-ad-client="${client}" data-ad-slot="${slot}"${adtest ? ' data-adtest="on"' : ''}
       data-ad-format="auto" data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
</aside>
<style>@media print{.rr-ad{display:none!important}}</style>`;
}

/**
 * @param {string} html     앱의 HTML 원문
 * @param {object} options
 *   client  게시자 ID (ca-pub-…)
 *   slot    광고 단위 슬롯 ID
 *   adtest  true 면 테스트 광고 표시(개발환경)
 * @returns {string} 광고 코드가 들어간 HTML
 */
function injectAppAds(html, { client, slot, adtest = false } = {}) {
  if (typeof html !== 'string' || !PUB_RE.test(String(client || ''))) return html;
  let out = html;

  // 1) head 에 게시자 메타 + 스크립트
  if (!out.includes('adsbygoogle.js')) {
    const tag = headTag(client);
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${tag}\n</head>`);
    else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${tag}\n</head>`);
    else out = `${tag}\n${out}`;
  }

  // 2) body 끝에 광고 자리 (마지막 </body> 앞)
  if (slot && !/class="rr-ad/.test(out)) {
    const block = adBlock(client, slot, { adtest });
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${block}\n</body>`);
    else out = `${out}\n${block}`;
  }

  return out;
}

/**
 * 실행 화면(/apps/<id>/…)에 검색엔진용 태그를 넣습니다.
 *  - canonical → 설명·사용법이 있는 상세 페이지(/app/<id>)
 *  - meta description
 *  - 접근성을 막는 viewport 옵션(user-scalable=no, maximum-scale=1) 제거
 */
function injectAppMeta(html, { app, site } = {}) {
  if (typeof html !== 'string' || !app || !site?.domain) return html;
  let out = html;
  const canonical = `${String(site.domain).replace(/\/+$/, '')}/app/${app.id}`;
  const desc = String(app.desc || `${app.name} — ${site.name}에서 제공하는 웹앱`).slice(0, 300);
  const escAttr = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 접근성: 확대 금지 옵션 제거
  out = out.replace(
    /<meta[^>]+name=["']viewport["'][^>]*>/gi,
    '<meta name="viewport" content="width=device-width, initial-scale=1" />'
  );

  const tags = [];
  if (!/rel=["']canonical["']/i.test(out)) tags.push(`<link rel="canonical" href="${escAttr(canonical)}" />`);
  if (!/name=["']description["']/i.test(out)) tags.push(`<meta name="description" content="${escAttr(desc)}" />`);

  // 페이지 경험: 앱이 CDN 에서 불러오는 외부 리소스를 미리 연결해 첫 화면이 빨리 뜨게 합니다.
  if (!/rel=["']preconnect["']/i.test(out)) {
    const hosts = new Set();
    for (const m of out.matchAll(/(?:src|href)=["'](https?:\/\/[^"'\s]+)/gi)) {
      try { hosts.add(new URL(m[1]).origin); } catch { /* 무시 */ }
    }
    for (const origin of [...hosts].slice(0, 4)) {
      tags.push(`<link rel="preconnect" href="${escAttr(origin)}" crossorigin />`);
      tags.push(`<link rel="dns-prefetch" href="${escAttr(origin)}" />`);
    }
  }
  if (!tags.length) return out;
  if (/<\/head>/i.test(out)) return out.replace(/<\/head>/i, `${tags.join('\n')}\n</head>`);
  if (/<head[^>]*>/i.test(out)) return out.replace(/<head[^>]*>/i, (m) => `${m}\n${tags.join('\n')}`);
  if (/<html[^>]*>/i.test(out)) return out.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${tags.join('\n')}</head>`);
  return `${tags.join('\n')}\n${out}`;
}

/**
 * 앱 화면 상단에 고정 배너를 넣습니다.
 *
 * 앱은 자기 CSS 를 쓰므로 #rr-promo-banner 안에서만 적용되는 스타일을 함께 넣고,
 * position: sticky 로 두어 앱의 고정 툴바를 가리지 않습니다(안 되면 그냥 맨 위에 표시).
 */
function injectAppBanner(html, { site } = {}) {
  if (typeof html !== 'string' || !html) return html;
  const parts = bannerParts(site);
  if (!parts) return html;
  if (!parts.image && !parts.title && !parts.button) return html;
  if (site && site.banner && site.banner.showInApps === false) return html;
  if (/id=["']rr-promo-banner["']/.test(html)) return html; // 이미 들어 있으면 그대로

  const escAttr = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const target = parts.target ? ' target="_blank" rel="noopener"' : '';
  const inner = parts.image
    ? `<img src="${escAttr(parts.image)}" alt="${escAttr(parts.alt)}" />`
    : [
      '<span class="rb-text">',
      parts.title ? `<b>${escAttr(parts.title)}</b>` : '',
      parts.subtitle ? `<i>${escAttr(parts.subtitle)}</i>` : '',
      '</span>',
      parts.button ? `<span class="rb-cta">${escAttr(parts.button)}</span>` : '',
    ].join('');

  const block = `<div id="rr-promo-banner"><a href="${escAttr(parts.url)}"${target} aria-label="${escAttr(`${parts.title || parts.alt} 바로가기`)}">${inner}</a></div>
<style>
#rr-promo-banner{position:sticky;top:0;z-index:2147483000;width:100%;}
#rr-promo-banner a{display:flex;align-items:center;justify-content:center;gap:14px;min-height:60px;padding:7px 14px;background:linear-gradient(120deg,#0e4a3c,#136450 55%,#0e4a3c);color:#fff;text-decoration:none;font-family:inherit;}
#rr-promo-banner img{display:block;width:auto;max-width:100%;max-height:104px;height:auto;object-fit:contain;}
#rr-promo-banner .rb-text{display:flex;flex-direction:column;gap:2px;line-height:1.25;}
#rr-promo-banner .rb-text b{font-size:1.05rem;font-weight:800;letter-spacing:-0.01em;}
#rr-promo-banner .rb-text i{font-style:normal;font-size:0.82rem;opacity:0.85;}
#rr-promo-banner .rb-cta{border:1px solid rgba(255,255,255,0.7);border-radius:999px;padding:5px 14px;font-size:0.85rem;font-weight:700;white-space:nowrap;}
@media (max-width:640px){
  #rr-promo-banner a{gap:10px;min-height:52px;padding:7px 12px;}
  #rr-promo-banner img{max-height:76px;}
  #rr-promo-banner .rb-text i{display:none;}
}
</style>
`;

  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => `${m}
${block}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}
${block}`);
  return block + html;
}

module.exports = { injectAppAds, injectAppMeta, injectAppBanner, headTag, adBlock, PUB_RE };
