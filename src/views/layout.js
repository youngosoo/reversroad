'use strict';

const { logoUrl, assetUrl } = require('../assets');
const { getCategory } = require('../categories');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function attr(value) {
  return esc(value);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 앱 카드. 목록/상세/홈에서 공통으로 씁니다. */
function appCard(app, { site } = {}) {
  const href = `/${app.path || `apps/${app.id}/`}`; // 실행 화면
  const detailHref = `/app/${app.id}`; // 설명·사용법이 있는 상세 페이지 (검색 유입용)
  const category = getCategory(app.category);
  const haystack = [app.name, app.desc, app.id, ...(app.tags || [])].join(' ').toLowerCase();
  return `
    <article class="card app-card" data-app data-search="${attr(haystack)}" data-name="${attr(String(app.name || '').toLowerCase())}" data-tags="${attr((app.tags || []).join(','))}" data-created="${attr(app.createdAt || '')}" data-updated="${attr(app.updatedAt || '')}">
      <div class="app-card-top">
        <span class="icon" aria-hidden="true">${esc(app.icon || '📦')}</span>
        <div class="app-card-head">
          <h3><a href="${attr(detailHref)}">${esc(app.name)}</a></h3>
          ${category ? `<a class="cat-badge" href="/category/${attr(category.slug)}"><span aria-hidden="true">${esc(category.icon)}</span> ${esc(category.label)}</a>` : ''}
          ${app.tags?.length ? `<div class="tags">${app.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      <p class="desc">${esc(app.desc || '설명이 아직 등록되지 않았습니다.')}</p>
      <div class="actions">
        <a class="btn primary small" href="${attr(href)}" target="_blank" rel="noopener">앱 열기</a>
        <a class="btn small" href="/app/${attr(app.id)}">사용법</a>
      </div>
    </article>`;
}

/**
 * 광고 자리.
 *
 * - 배포 도메인: AdSense 코드를 그대로 내보냅니다.
 * - 개발환경(localhost)·게시자 ID 미설정: 코드 대신 "자리표시자"를 그려서
 *   어느 위치에 어떤 광고가 들어가는지 눈으로 확인할 수 있게 합니다.
 */
function adSlot(site, { slot = '', label = '광고', className = '', name = '' } = {}) {
  const id = String(slot || '').trim();
  const ready = Boolean(site?.adsenseReady && id && !site?.adsPreview);
  const position = className.replace(/\bad-inline\b/, '').trim().replace(/\s+/g, '·') || '기본';

  if (ready) {
    return `
    <aside class="ad-slot ${attr(className)}" aria-label="${attr(label)}">
      <span class="ad-label">${esc(label)}</span>
      <ins class="adsbygoogle" style="display:block" data-ad-client="${attr(site.adsense.client)}" data-ad-slot="${attr(id)}" data-ad-format="auto" data-full-width-responsive="true"></ins>
      <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    </aside>`;
  }

  // 개발환경: 실제 광고 코드에 data-adtest="on" 을 붙여 테스트 광고를 요청합니다.
  // (게시자 ID·슬롯 ID 가 없으면 자리만 표시)
  if (site?.adsensePreviewUsable && id) {
    return `
    <aside class="ad-slot ${attr(className)}" aria-label="${attr(label)} 자리">
      <span class="ad-label">${esc(label)} · 테스트(개발환경)</span>
      <ins class="adsbygoogle" style="display:block" data-ad-client="${attr(site.adsense.client)}" data-ad-slot="${attr(id)}" data-ad-format="auto" data-full-width-responsive="true" data-adtest="on"></ins>
      <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    </aside>`;
  }

  const reason = !site?.adsense?.client
    ? '게시자 ID 미설정'
    : (site?.adsPreview ? '개발환경 미리보기' : '슬롯 ID 미설정');
  return `
    <aside class="ad-slot ad-placeholder ${attr(className)}" aria-label="${attr(label)} 자리">
      <span class="ad-label">${esc(label)} 자리 · ${esc(reason)}</span>
      <div class="ad-placeholder-body">
        <strong>${esc(name || '반응형 디스플레이 광고')}</strong>
        <span class="mono">${id ? `slot ${esc(id)}` : 'slot 미설정'} · ${esc(position)}</span>
        <span class="muted small">실제 광고는 배포 사이트에서 표시됩니다. 이 상자는 개발환경에만 보입니다.</span>
      </div>
    </aside>`;
}

function breadcrumbs(items) {
  const parts = items.map((item, i) => {
    const last = i === items.length - 1;
    return last
      ? `<li aria-current="page">${esc(item.label)}</li>`
      : `<li><a href="${attr(item.href)}">${esc(item.label)}</a></li>`;
  });
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      item: item.url || undefined,
    })),
  };
  return {
    html: `<nav class="breadcrumb" aria-label="현재 위치"><ol>${parts.join('')}</ol></nav>`,
    jsonLd,
  };
}

/** sections: [{ h, p: [...], list: [...] }] 형태의 문서 본문 */
function prose(sections) {
  return sections
    .map((section) => {
      const paragraphs = (section.p || []).map((text) => `<p>${linkify(text)}</p>`).join('');
      const list = section.list?.length
        ? `<ul>${section.list.map((item) => `<li>${linkify(item)}</li>`).join('')}</ul>`
        : '';
      return `<section class="prose-block">${section.h ? `<h2>${esc(section.h)}</h2>` : ''}${paragraphs}${list}</section>`;
    })
    .join('');
}

/** 본문 안의 http(s) 주소를 클릭 가능한 링크로 바꿉니다. */
function linkify(text) {
  const escaped = esc(text);
  return escaped.replace(/https?:\/\/[^\s<)]+/g, (url) => {
    const clean = url.replace(/[.,;:]+$/, '');
    const tail = url.slice(clean.length);
    return `<a href="${attr(clean)}" target="_blank" rel="noopener nofollow">${esc(clean)}</a>${tail}`;
  });
}

/**
 * 라이트/다크 모드 전환 버튼. 아이콘은 /assets/theme.js 가 채워 넣고, 현재 테마에
 * 따라 CSS 가 해 또는 달 하나만 보여 줍니다.
 */
function themeToggle() {
  return '<button class="theme-toggle" type="button" data-theme-toggle aria-pressed="false" title="테마 전환" aria-label="테마 전환"></button>';
}

/**
 * 브랜드 로고 이미지. 원본 로고를 public/assets/logo.png 로 넣으면 그것이 쓰입니다.
 */
function brandLogo({ size = 28, className = 'brand-logo', site = null } = {}) {
  const src = logoUrl(site); // 내용 해시를 붙여 로고 교체가 즉시 반영되게
  const type = src.endsWith('.svg') ? 'image/svg+xml' : '';
  return `<img class="${attr(className)}" src="${attr(src)}"${type ? ` type="${type}"` : ''} width="${size}" height="${size}" alt="" decoding="async" />`;
}

/**
 * 사이트 공통 껍데기. 검색엔진과 광고 심사가 읽는 값(제목·설명·canonical·구조화
 * 데이터·광고 스크립트)을 모두 여기서 한 번에 넣습니다.
 */
function layout({
  site,
  title,
  description,
  path: pagePath = '/',
  body = '',
  nav = '',
  jsonLd = [],
  noIndex = false,
  bodyClass = '',
  ogImage = '',
  ogType = 'website',
}) {
  const fullTitle = title
    ? `${title} · ${site.name}`
    : (site.homeTitle ? `${site.homeTitle} | ${site.name}` : `${site.name} — ${site.tagline}`);
  const desc = description || site.description;
  const canonical = site.domain ? `${site.domain}${pagePath === '/' ? '/' : pagePath}` : null;
  const graphs = jsonLd.filter(Boolean);

  const navItems = [
    { href: '/apps', label: '앱 목록', key: 'apps' },
    { href: '/guide', label: '가이드', key: 'guide' },
    { href: '/about', label: '사이트 소개', key: 'about' },
    { href: '/contact', label: '문의', key: 'contact' },
  ];

  return `<!doctype html>
<html lang="${attr(site.locale || 'ko')}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(desc)}" />
${canonical ? `<link rel="canonical" href="${attr(canonical)}" />` : ''}
${site.domain ? `<link rel="alternate" type="application/rss+xml" title="${attr(site.name)}" href="${attr(`${site.domain}/rss.xml`)}" />` : ''}
<meta name="robots" content="${noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />
<meta name="theme-color" id="themeColor" content="#f6f7fb" />
<meta property="og:type" content="${attr(ogType)}" />
<meta property="og:site_name" content="${attr(site.name)}" />
<meta property="og:title" content="${attr(fullTitle)}" />
<meta property="og:description" content="${attr(desc)}" />
${canonical ? `<meta property="og:url" content="${attr(canonical)}" />` : ''}
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" href="${attr(assetUrl('favicon-48.png'))}" sizes="48x48" type="image/png" />
<link rel="icon" href="${attr(assetUrl('favicon-96.png'))}" sizes="96x96" type="image/png" />
<link rel="icon" href="${attr(assetUrl('favicon-192.png'))}" sizes="192x192" type="image/png" />
<link rel="apple-touch-icon" href="${attr(assetUrl('favicon-180.png'))}" sizes="180x180" />
${site.domain ? `<meta property="og:image" content="${attr(site.domain + (ogImage || assetUrl('og-home.png')))}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${attr(site.name)}" />` : ''}
<script src="${attr(assetUrl('theme.js'))}"></script>
<link rel="stylesheet" href="${attr(assetUrl('style.css'))}" />
${site.adsenseReady ? `<meta name="google-adsense-account" content="${attr(site.adsense.client)}" />
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${attr(site.adsense.client)}" crossorigin="anonymous"></script>` : ''}
${site.analytics?.ga4 ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${attr(site.analytics.ga4)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${attr(site.analytics.ga4)}');</script>` : ''}
${graphs.length ? `<script type="application/ld+json">${safeJson(graphs.length === 1 ? graphs[0] : { '@context': 'https://schema.org', '@graph': graphs })}</script>` : ''}
</head>
<body class="${attr(bodyClass)}">
<a class="skip-link" href="#main">본문으로 바로 가기</a>
<header class="site-header">
  <div class="shell header-inner">
    <a class="brand" href="/">${brandLogo({ site })}<span class="brand-text">${esc(site.name)}</span></a>
    <nav class="site-nav" aria-label="주요 메뉴">
      ${navItems.map((item) => `<a href="${attr(item.href)}"${nav === item.key ? ' class="active" aria-current="page"' : ''}>${esc(item.label)}</a>`).join('')}
      ${site.hideAdmin || !site.showAdminLink ? '' : `<a class="nav-admin" href="${attr(site.adminUrl || '/admin.html')}"${site.adminUrl && !site.adminUrl.startsWith('/') ? ' target="_blank" rel="noopener"' : ''}>관리자</a>`}
      ${themeToggle()}
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="shell footer-grid">
    <div>
      <p class="footer-brand">${brandLogo({ site, size: 22, className: 'brand-logo footer-logo' })}${esc(site.name)}</p>
      <p class="muted">${esc(site.tagline)}</p>
      <p class="muted small">${esc(site.description)}</p>
    </div>
    <div>
      <h3>둘러보기</h3>
      <ul>
        <li><a href="/apps">앱 목록</a></li>
        <li><a href="/guide">가이드</a></li>
        <li><a href="/about">사이트 소개</a></li>
        <li><a href="/contact">문의하기</a></li>
      </ul>
    </div>
    <div>
      <h3>정책</h3>
      <ul>
        <li><a href="/privacy">개인정보처리방침</a></li>
        <li><a href="/terms">이용약관</a></li>
        <li><a href="/disclaimer">책임 한계·광고 고지</a></li>
      </ul>
    </div>
    <div>
      <h3>운영 정보</h3>
      <ul>
        <li>운영자: ${esc(site.owner)}</li>
        ${site.email ? `<li>이메일: <a href="mailto:${attr(site.email)}">${esc(site.email)}</a></li>` : '<li class="muted">이메일: 문의 페이지 참고</li>'}
        <li class="muted small">사이트 업데이트: ${esc(formatDate(site.updatedAt) || '2026년 9월 27일')}</li>
      </ul>
    </div>
  </div>
  <div class="shell footer-bottom">
    <p class="muted small">© ${new Date().getFullYear()} ${esc(site.name)}. 모든 앱과 글은 운영자가 직접 만들었습니다.</p>
    <p class="muted small">이 사이트는 Google AdSense 등 제3자 광고를 통해 운영됩니다. 광고 게재 방식은 <a href="/privacy">개인정보처리방침</a>에서 확인할 수 있습니다.</p>
  </div>
</footer>
${site.adsenseReady && !site.adsPreview ? `<script>
// 광고가 채워지지 않은 자리는 빈 상자로 남지 않도록 숨깁니다 (채워지면 다시 보입니다)
(function () {
  var checks = 0;
  function sweep() {
    checks += 1;
    var pending = false;
    var slots = document.querySelectorAll('.ad-slot ins.adsbygoogle');
    for (var i = 0; i < slots.length; i++) {
      var ins = slots[i];
      var box = ins.closest ? ins.closest('.ad-slot') : null;
      if (!box) continue;
      var status = ins.getAttribute('data-ad-status');
      if (status === 'filled') box.classList.remove('ad-empty');
      else if (status === 'unfilled') box.classList.add('ad-empty');
      else pending = true;
    }
    if (!pending || checks > 12) clearInterval(timer);
  }
  var timer = setInterval(sweep, 2000);
  setTimeout(sweep, 6000);
})();
</script>` : ''}
<div class="consent" id="consent" hidden>
  <p>이 사이트는 앱 실행과 광고 게재를 위해 브라우저 저장소와 쿠키를 사용합니다. 자세한 내용은 <a href="/privacy">개인정보처리방침</a>을 확인하세요.</p>
  <button class="btn small primary" type="button" id="consentOk">확인</button>
</div>
<script>
(function () {
  var KEY = 'myhome.consent';
  try {
    if (!localStorage.getItem(KEY)) document.getElementById('consent').hidden = false;
  } catch (e) { /* storage blocked */ }
  var ok = document.getElementById('consentOk');
  if (ok) ok.addEventListener('click', function () {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
    document.getElementById('consent').hidden = true;
  });
})();
</script>
</body>
</html>`;
}

module.exports = { layout, esc, attr, safeJson, formatDate, appCard, adSlot, breadcrumbs, prose, linkify, themeToggle, brandLogo };
