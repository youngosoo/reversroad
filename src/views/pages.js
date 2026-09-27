'use strict';

const { layout, esc, attr, safeJson, formatDate, appCard, adSlot, breadcrumbs, prose } = require('./layout');
const { GUIDES, findGuide } = require('../content/guides');
const { CATEGORIES, getCategory, listCategories } = require('../categories');
const { privacyPolicy, termsOfService, disclaimer } = require('../content/legal');

const FAQ = [
  {
    q: '앱을 쓰는 데 비용이 드나요?',
    a: '아니요. 모든 앱은 무료이고 회원가입도 없습니다. 사이트 운영 비용은 페이지에 게재되는 광고로 충당합니다.',
  },
  {
    q: '설치해야 하나요?',
    a: '설치하지 않습니다. 목록에서 앱을 누르면 브라우저에서 바로 실행됩니다. 주소를 북마크해 두면 다음부터는 바로 열 수 있습니다.',
  },
  {
    q: '인터넷이 없어도 쓸 수 있나요?',
    a: '앱 자체는 인터넷 없이 동작합니다. 다만 이 사이트에 접속해 처음 여는 순간에는 연결이 필요하고, 완전히 오프라인에서 쓰려면 상세 페이지의 안내에 따라 앱 폴더를 내려받아 두면 됩니다.',
  },
  {
    q: '입력한 내용은 어디에 저장되나요?',
    a: '이용자의 브라우저 안에만 저장되며 서버로 전송되지 않습니다. 운영자도 내용을 볼 수 없습니다. 대신 브라우저 데이터를 지우면 함께 사라지므로 중요한 기록은 내보내기 기능으로 백업해 주세요.',
  },
  {
    q: '앱 화면이 깨지거나 열리지 않아요.',
    a: '브라우저를 최신 버전으로 업데이트한 뒤 새로고침해 보세요. 시크릿 모드에서는 저장 기능이 동작하지 않으니 일반 창에서 열어야 합니다. 그래도 문제가 있으면 어떤 앱에서 어떤 상황이었는지 문의 페이지의 이메일로 알려 주세요.',
  },
  {
    q: '원하는 앱을 만들어 달라고 요청할 수 있나요?',
    a: '제안은 환영합니다. 다만 이 사이트에는 운영자가 직접 만들고 점검한 앱만 등록하기 때문에 모든 요청이 반영되지는 않습니다.',
  },
  {
    q: '앱 주소가 바뀌었어요.',
    a: '앱을 다듬는 과정에서 주소(경로)가 바뀔 수 있습니다. 기존 북마크가 열리지 않으면 앱 목록에서 같은 앱을 찾아 주소를 다시 저장해 주세요.',
  },
  {
    q: '광고가 보이지 않습니다.',
    a: '광고 차단 프로그램을 쓰거나, 지역·브라우저 설정에 따라 광고가 표시되지 않을 수 있습니다. 광고가 보이지 않아도 앱 이용에는 아무런 제한이 없습니다.',
  },
];

/** 카테고리별 앱 개수 (앱이 있는 카테고리만) */
function categoryCounts(apps) {
  const counts = new Map();
  for (const app of apps) {
    const slug = app.category && getCategory(app.category) ? app.category : 'etc';
    counts.set(slug, (counts.get(slug) || 0) + 1);
  }
  return [...CATEGORIES]
    .map((c) => ({ ...c, count: counts.get(c.slug) || 0 }))
    .filter((c) => c.count > 0);
}

/** 홈·목록 상단의 카테고리 이동 칩 */
function categoryChips(apps, { active = '' } = {}) {
  const items = categoryCounts(apps);
  if (!items.length) return '';
  return `
    <nav class="chips" aria-label="분야별 보기">
      <a class="chip${active ? '' : ' active'}" href="/apps">전체 <span>${apps.length}</span></a>
      ${items.map((c) => `<a class="chip${active === c.slug ? ' active' : ''}" href="/category/${attr(c.slug)}"><span aria-hidden="true">${esc(c.icon)}</span> ${esc(c.label)} <span>${c.count}</span></a>`).join('')}
    </nav>`;
}

function websiteJsonLd(site) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    description: site.description,
    inLanguage: site.locale || 'ko',
    ...(site.domain ? { url: site.domain } : {}),
    publisher: {
      '@type': 'Organization',
      name: site.name,
      ...(site.email ? { email: site.email } : {}),
    },
  };
}

function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

/** 홈/목록에서 쓰는 검색·정렬 스크립트(서버가 그린 카드를 그대로 걸러냅니다). */
const FILTER_SCRIPT = `<script>
(function () {
  var grid = document.getElementById('appGrid');
  if (!grid) return;
  var cards = [].slice.call(grid.querySelectorAll('[data-app]'));
  var q = document.getElementById('q');
  var sort = document.getElementById('sort');
  var empty = document.getElementById('gridEmpty');
  var counter = document.getElementById('gridCount');

  function text(card) { return card.getAttribute('data-search') || ''; }

  function apply() {
    var term = (q && q.value || '').trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      var hit = !term || text(card).indexOf(term) !== -1;
      card.hidden = !hit;
      if (hit) shown++;
    });
    if (empty) empty.hidden = shown !== 0;
    if (counter) counter.textContent = shown;
  }

  function sortCards() {
    if (!sort) return;
    var mode = sort.value;
    var key = { name: 'data-name', created: 'data-created', updated: 'data-updated' }[mode] || 'data-name';
    var desc = mode !== 'name';
    var sorted = cards.slice().sort(function (a, b) {
      var av = a.getAttribute(key) || '';
      var bv = b.getAttribute(key) || '';
      if (mode === 'name') return av.localeCompare(bv, 'ko');
      return desc ? bv.localeCompare(av) : av.localeCompare(bv);
    });
    sorted.forEach(function (card) { grid.appendChild(card); });
  }

  if (q) q.addEventListener('input', apply);
  if (sort) sort.addEventListener('change', function () { sortCards(); apply(); });
  sortCards();
  apply();
})();
</script>`;

function heroStats(apps, guides) {
  return `
    <ul class="stats">
      <li><strong>${apps.length}</strong><span>등록된 웹앱</span></li>
      <li><strong>${guides.length}</strong><span>안내 글</span></li>
      <li><strong>0원</strong><span>이용 요금</span></li>
      <li><strong>오프라인</strong><span>설치 없이 실행</span></li>
    </ul>`;
}

function homePage({ site, apps, guides = GUIDES }) {
  const crumbs = breadcrumbs([{ label: '홈', href: '/', url: site.domain || undefined }]);
  const body = `
  <section class="hero">
    <div class="shell hero-inner">
      <p class="eyebrow">직접 만든 웹앱 모음</p>
      <h1>${esc(site.name)}</h1>
      <p class="lead">${esc(site.tagline)}</p>
      <p class="hero-desc">${esc(site.description)}</p>
      ${heroStats(apps, guides)}
    </div>
  </section>

  <div class="shell">
    ${crumbs.html}

    <section class="section" id="apps">
      <div class="section-head">
        <h2>등록된 웹앱 <span class="count">(<span id="gridCount">${apps.length}</span>)</span></h2>
        <p class="section-desc">버튼을 누르면 바로 실행됩니다. 각 카드의 “사용법”에서 입력 순서와 주의사항을 볼 수 있습니다.</p>
      </div>
      ${categoryChips(apps)}
      <div class="toolbar">
        <label class="sr-only" for="q">앱 검색</label>
        <input class="search" id="q" type="search" placeholder="앱 이름·설명·태그로 검색" autocomplete="off" />
        <label class="sr-only" for="sort">정렬</label>
        <select id="sort">
          <option value="name">이름순</option>
          <option value="created">최신 등록순</option>
          <option value="updated">최근 수정순</option>
        </select>
      </div>
      ${apps.length
        ? `<div class="grid" id="appGrid">${apps.map((a) => appCard(a, { site })).join('')}</div>
           <p class="empty" id="gridEmpty" hidden>검색 조건에 맞는 앱이 없습니다.</p>`
        : '<p class="empty card">아직 등록된 앱이 없습니다. 곧 정리해서 올리겠습니다.</p>'}
      ${adSlot(site, { slot: site.adsense?.slotInline, className: 'ad-inline' })}
    </section>

    <section class="section split">
      <div>
        <h2>이 사이트는 무엇인가요</h2>
        <p>설치도, 회원가입도 없이 브라우저에서 바로 쓰는 작은 도구들을 모아 둔 개인 사이트입니다. 파일 하나로 완결되는 웹앱만 올리기 때문에, 앱마다 주소 하나만 있으면 언제든 다시 열 수 있습니다.</p>
        <p>앱에 입력한 내용은 서버가 아니라 <strong>이용자의 브라우저에만</strong> 저장됩니다. 운영자를 포함해 누구도 그 내용을 볼 수 없고, 대신 기기를 바꾸면 자동으로 따라오지 않습니다. 중요한 기록은 각 앱의 내보내기 기능으로 백업하는 습관을 권합니다.</p>
        <p>운영 방식과 앱을 만드는 기준은 <a href="/about">사이트 소개</a>에, 데이터 처리에 대한 설명은 <a href="/privacy">개인정보처리방침</a>에 정리해 두었습니다.</p>
        <div class="actions">
          <a class="btn" href="/apps">앱 전체 보기</a>
          <a class="btn" href="/about">운영 방식 보기</a>
        </div>
      </div>
      <div class="card aside-card">
        <h3>이런 앱을 올립니다</h3>
        <ul class="checklist">
          <li>하루에 몇 번씩 쓰는 계산·정리 도구</li>
          <li>인터넷이 없어도 동작하는 단일 파일 앱</li>
          <li>입력한 값이 브라우저 밖으로 나가지 않는 앱</li>
          <li>휴대폰 화면에서도 쓸 수 있는 반응형 앱</li>
        </ul>
        <p class="muted small">직접 만들고 점검한 앱만 등록합니다. 저작권이 불분명한 자료는 쓰지 않습니다.</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>읽어볼 만한 안내</h2>
        <p class="section-desc">앱을 오래, 안전하게 쓰는 방법을 정리한 글입니다.</p>
      </div>
      <div class="grid guide-grid">
        ${guides.map((g) => `
          <article class="card guide-card">
            <p class="muted small">${esc(formatDate(g.date))} · ${g.minutes}분</p>
            <h3><a href="/guide/${attr(g.slug)}">${esc(g.title)}</a></h3>
            <p>${esc(g.summary)}</p>
            <a class="more" href="/guide/${attr(g.slug)}">읽기 →</a>
          </article>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>자주 묻는 질문</h2>
        <p class="section-desc">앱을 처음 쓰는 분들이 가장 많이 묻는 내용을 모았습니다.</p>
      </div>
      <div class="faq">
        ${FAQ.map((item) => `<details><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`).join('')}
      </div>
    </section>

    <section class="section cta">
      <div class="card cta-card">
        <h2>앱에서 문제를 발견하셨나요?</h2>
        <p>어떤 앱의 어느 화면에서 무슨 일이 있었는지 알려 주시면 확인 후 반영합니다. 앱 제안도 환영합니다.</p>
        <a class="btn primary" href="/contact">문의하기</a>
      </div>
    </section>
  </div>
  ${FILTER_SCRIPT}`;

  return layout({
    site,
    title: null,
    description: `${site.tagline} — 설치 없이 브라우저에서 바로 쓰는 웹앱 ${apps.length}개를 소개합니다.`,
    path: '/',
    body,
    nav: '',
    jsonLd: [websiteJsonLd(site), faqJsonLd()],
  });
}

function appsPage({ site, apps }) {
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: '앱 목록', href: '/apps' },
  ]);
  const body = `
  <div class="shell">
    ${crumbs.html}
    <header class="page-head">
      <h1>앱 목록</h1>
      <p class="lead">설치 없이 실행되는 단일 파일 웹앱 ${apps.length}개입니다. 분야별로 묶어 두었으니 아래에서 골라 보세요. 이름을 누르면 사용법을 볼 수 있고, “앱 열기”를 누르면 바로 실행됩니다.</p>
    </header>
    ${categoryChips(apps)}
    <div class="toolbar">
      <label class="sr-only" for="q">앱 검색</label>
      <input class="search" id="q" type="search" placeholder="앱 이름·설명·태그로 검색" autocomplete="off" />
      <label class="sr-only" for="sort">정렬</label>
      <select id="sort">
        <option value="name">이름순</option>
        <option value="created">최신 등록순</option>
        <option value="updated">최근 수정순</option>
      </select>
    </div>
    ${apps.length
      ? `<div class="grid" id="appGrid">${apps.map((a) => appCard(a, { site })).join('')}</div>
         <p class="empty" id="gridEmpty" hidden>검색 조건에 맞는 앱이 없습니다.</p>`
      : '<div class="card empty">아직 등록된 앱이 없습니다.</div>'}
    ${adSlot(site, { slot: site.adsense?.slotInline, className: 'ad-inline' })}
    <section class="section prose">
      <h2>앱을 고르는 기준</h2>
      <p>모든 앱은 운영자가 직접 만들었고, 등록 전에 휴대폰 화면에서의 사용성과 실행 여부를 확인합니다. 외부 서버에서 자료를 불러오지 않는 앱을 우선하기 때문에, 인터넷이 느리거나 끊긴 환경에서도 대부분 그대로 동작합니다. 다만 AI 분석이나 영상 렌더링처럼 외부 서비스가 필요한 앱은 인터넷 연결이 필요하며, 그 사실을 상세 페이지에 적어 두었습니다.</p>
      <p>각 앱의 상세 페이지에는 입력 순서, 데이터가 저장되는 위치, 백업 방법, 그리고 실제로 써 보며 알게 된 사용 팁이 함께 적혀 있습니다. 처음 쓰는 앱이라면 상세 페이지를 먼저 읽어 보시길 권합니다.</p>
      <h2>앱을 고를 때 확인하면 좋은 것</h2>
      <ul>
        <li><strong>데이터가 어디에 저장되는지</strong> — 이 사이트의 앱은 모두 브라우저에만 저장합니다. 기기를 바꾸면 이어지지 않으므로 중요한 기록은 내보내기로 백업하세요.</li>
        <li><strong>인터넷이 필요한지</strong> — 외부 API를 쓰는 앱은 연결이 필요합니다.</li>
        <li><strong>결과를 그대로 믿어도 되는지</strong> — 자동 분석·계산 결과는 참고용입니다. 정산이나 게시 전에는 원본과 대조하세요.</li>
      </ul>
      <h2>앱이 열리지 않을 때</h2>
      <p>브라우저를 최신 버전으로 업데이트한 뒤 새로고침해 보시고, 시크릿 모드에서는 저장 기능이 동작하지 않으니 일반 창에서 열어 주세요. 그래도 문제가 있으면 <a href="/contact">문의 페이지</a>로 알려 주시면 확인 후 반영합니다.</p>
    </section>
  </div>
  ${FILTER_SCRIPT}`;

  return layout({
    site,
    title: '앱 목록',
    description: `설치 없이 브라우저에서 실행되는 웹앱 ${apps.length}개를 한눈에 봅니다. 각 앱의 사용법과 백업 방법도 함께 안내합니다.`,
    path: '/apps',
    body,
    nav: 'apps',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `${site.name} 앱 목록`,
        numberOfItems: apps.length,
        itemListElement: apps.map((a, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: a.name,
          ...(site.domain ? { url: `${site.domain}/app/${a.id}` } : {}),
        })),
      },
    ],
  });
}

function relatedApps(app, apps, limit = 3) {
  const tags = new Set(app.tags || []);
  return apps
    .filter((a) => a.id !== app.id)
    .map((a) => ({ app: a, score: (a.tags || []).filter((t) => tags.has(t)).length }))
    .sort((a, b) => b.score - a.score || String(b.app.createdAt).localeCompare(String(a.app.createdAt)))
    .slice(0, limit)
    .map((x) => x.app);
}

function appDetailPage({ site, app, apps }) {
  const openHref = `/${app.path || `apps/${app.id}/`}`;
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: '앱 목록', href: '/apps', url: site.domain ? `${site.domain}/apps` : undefined },
    { label: app.name, href: `/app/${app.id}` },
  ]);
  const related = relatedApps(app, apps);
  const howto = String(app.howto || '').trim();
  const tips = Array.isArray(app.tips) ? app.tips.filter(Boolean) : [];
  const relatedGuides = GUIDES.filter((g) => (g.related || []).includes(app.id));
  const meta = [
    ['실행 주소', openHref],
    ['등록일', formatDate(app.createdAt)],
    ['최근 수정', formatDate(app.updatedAt)],
    ['분류', app.category && getCategory(app.category) ? `${getCategory(app.category).icon} ${getCategory(app.category).label}` : '기타 도구'],
    ['특성', (app.tags || []).join(' · ') || '—'],
    ['실행 환경', '웹 브라우저 (모바일·데스크톱)'],
  ];

  const body = `
  <div class="shell">
    ${crumbs.html}
    <article class="app-detail">
      <header class="app-detail-head">
        <span class="icon big" aria-hidden="true">${esc(app.icon || '📦')}</span>
        <div>
          <h1>${esc(app.name)}</h1>
          ${app.tags?.length ? `<div class="tags">${app.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
      </header>
      <p class="lead">${esc(app.desc || '설명이 아직 등록되지 않았습니다.')}</p>
      <div class="actions">
        <a class="btn primary" href="${attr(openHref)}" target="_blank" rel="noopener">앱 열기</a>
        <a class="btn" href="/apps">다른 앱 보기</a>
        <button class="btn" type="button" id="copyLink" data-href="${attr(openHref)}">주소 복사</button>
      </div>

      <div class="detail-columns">
        <div>
          <section class="section prose">
            <h2>사용 방법</h2>
            ${howto
              ? `<div class="howto">${esc(howto)}</div>`
              : `<p>이 앱은 화면의 안내에 따라 바로 사용할 수 있습니다. 입력한 값은 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>`}
          </section>
          ${tips.length ? `
          <section class="section prose">
            <h2>이럴 때 유용합니다 — 사용 팁</h2>
            <ul class="tips">
              ${tips.map((t) => `<li>${esc(t)}</li>`).join('')}
            </ul>
          </section>` : ''}
          <section class="section prose">
            <h2>사용 전에 알아두세요</h2>
            <ul>
              <li>입력한 내용은 <strong>이 브라우저에만</strong> 저장됩니다. 다른 기기에서는 이어지지 않습니다.</li>
              <li>브라우저의 사이트 데이터를 삭제하거나 시크릿 모드로 열면 기록이 남지 않습니다.</li>
              <li>중요한 기록은 앱의 내보내기(내려받기) 기능으로 파일로 백업해 두세요.</li>
              <li>계산·분석 결과는 참고용입니다. 중요한 결정에는 공식 자료나 전문가의 확인을 거치세요.</li>
              ${app.online ? '<li>이 앱은 외부 서비스(API·라이브러리)를 사용하므로 인터넷 연결이 필요합니다.</li>' : ''}
            </ul>
            <p class="muted small">자세한 내용은 <a href="/privacy">개인정보처리방침</a>, <a href="/terms">이용약관</a>, <a href="/disclaimer">책임 한계·광고 고지</a>를 확인하세요.</p>
          </section>
          ${relatedGuides.length ? `
          <section class="section prose">
            <h2>함께 읽으면 좋은 안내</h2>
            <ul class="related-list">
              ${relatedGuides.map((g) => `<li><a href="/guide/${attr(g.slug)}">${esc(g.title)}</a> — <span class="muted">${esc(g.summary)}</span></li>`).join('')}
            </ul>
          </section>` : ''}
          ${adSlot(site, { slot: site.adsense?.slotInline, className: 'ad-inline' })}
        </div>
        <aside class="detail-side">
          <div class="card info-card">
            <h2>앱 정보</h2>
            <dl class="kv">
              ${meta.map(([k, v]) => {
                if (k === '실행 주소') return `<dt>${esc(k)}</dt><dd><span class="mono">${esc(v)}</span></dd>`;
                if (k === '분류' && app.category && getCategory(app.category)) {
                  const c = getCategory(app.category);
                  return `<dt>${esc(k)}</dt><dd><a href="/category/${attr(c.slug)}">${esc(c.icon)} ${esc(c.label)}</a></dd>`;
                }
                return `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
              }).join('')}
            </dl>
          </div>
          ${related.length ? `
          <div class="card info-card">
            <h2>함께 쓰면 좋은 앱</h2>
            <ul class="related">
              ${related.map((a) => `<li><a href="/app/${attr(a.id)}"><span aria-hidden="true">${esc(a.icon || '📦')}</span> ${esc(a.name)}</a><p class="muted small">${esc(a.desc || '')}</p></li>`).join('')}
            </ul>
          </div>` : ''}
          <div class="card info-card">
            <h2>오프라인에서 쓰기</h2>
            <p class="muted small">앱 주소를 북마크해 두거나, 관리자에게 앱 폴더를 zip으로 요청해 내려받아 두면 인터넷 없이도 실행할 수 있습니다.</p>
            <a class="more" href="/guide/single-file-webapp">자세히 보기 →</a>
          </div>
        </aside>
      </div>
    </article>
  </div>
  <script>
  (function () {
    var btn = document.getElementById('copyLink');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      var url = new URL(btn.getAttribute('data-href'), location.origin).href;
      try { await navigator.clipboard.writeText(url); btn.textContent = '복사되었습니다'; }
      catch (e) { prompt('주소를 복사하세요', url); }
      setTimeout(function () { btn.textContent = '주소 복사'; }, 2000);
    });
  })();
  </script>`;

  return layout({
    site,
    title: app.name,
    description: `${app.name} — ${(app.desc || '단일 파일 웹앱').slice(0, 140)}`,
    path: `/app/${app.id}`,
    body,
    nav: 'apps',
    jsonLd: [
      crumbs.jsonLd,
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: app.name,
        description: app.desc || '',
        applicationCategory: 'UtilityApplication',
        operatingSystem: '웹 브라우저(Chrome, Safari, Edge, Firefox)',
        inLanguage: site.locale || 'ko',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
        ...(app.tags?.length ? { keywords: app.tags.join(', ') } : {}),
        ...(app.createdAt ? { datePublished: app.createdAt.slice(0, 10) } : {}),
        ...(app.updatedAt ? { dateModified: app.updatedAt.slice(0, 10) } : {}),
      },
    ],
  });
}

function aboutPage({ site, apps, guides = GUIDES }) {
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: '사이트 소개', href: '/about' },
  ]);
  const recent = [...apps].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);
  const body = `
  <div class="shell">
    ${crumbs.html}
    <header class="page-head">
      <h1>사이트 소개</h1>
      <p class="lead">${esc(site.name)}는 직접 만든 단일 파일 웹앱을 모아 두고, 필요할 때 바로 꺼내 쓰기 위해 만든 개인 사이트입니다.</p>
    </header>
    <div class="prose narrow">
      <section class="prose-block">
        <h2>왜 이런 사이트를 만들었나요</h2>
        <p>작은 도구들은 설치까지 하기는 번거롭고, 그렇다고 어디에 두지 않으면 다시 찾기 어렵습니다. 브라우저 탭 하나로 열리는 앱이라면 북마크처럼 모아 둘 수 있다는 점에 착안해, 파일 하나로 완결되는 앱만 모아 정리하고 있습니다.</p>
        <p>앱은 모두 운영자가 직접 작성합니다. 외부에서 받은 코드를 그대로 올리지 않고, 저작권이 불분명한 이미지나 자료를 쓰지 않습니다.</p>
      </section>
      <section class="prose-block">
        <h2>제공하는 것</h2>
        <ul>
          <li>설치 없이 실행되는 웹앱 ${apps.length}개 (${apps.slice(0, 4).map((a) => esc(a.name)).join(', ')}${apps.length > 4 ? ' 등' : ''})</li>
          <li>앱마다의 사용 방법과 데이터 저장 위치 안내</li>
          <li>웹앱을 안전하게 쓰고 백업하는 방법을 다룬 안내 글 ${guides.length}편</li>
        </ul>
      </section>
      <section class="prose-block">
        <h2>운영 방식</h2>
        <p>새 앱을 만들면 브라우저에서 직접 열어 휴대폰 화면과 키보드 조작까지 확인한 뒤 등록합니다. 등록된 앱은 독립된 주소(${'/apps/이름/'})로도 열리기 때문에, 이 사이트가 아닌 곳에서도 그대로 사용할 수 있습니다.</p>
        <p>사이트 운영 비용은 페이지에 게재되는 광고로 충당합니다. 광고는 앱의 동작이나 저장된 데이터에 영향을 주지 않습니다.</p>
      </section>
      <section class="prose-block">
        <h2>데이터에 대해</h2>
        <p>이 사이트의 앱은 서버에 데이터를 보내지 않습니다. 입력한 값은 이용자의 브라우저 저장소에만 남고, 운영자는 그것을 볼 수 없습니다. 대신 기기 간 동기화는 되지 않으므로, 오래 보관할 기록은 앱의 내보내기 기능으로 백업해 두시길 권합니다. 자세한 처리는 <a href="/privacy">개인정보처리방침</a>에 적어 두었습니다.</p>
      </section>
      <section class="prose-block">
        <h2>업데이트 원칙</h2>
        <p>새 앱은 만들고 점검한 뒤에 올리고, 기존 앱은 브라우저 동작이 바뀌거나 사용 중 불편이 확인되면 고칩니다. 고칠 때는 상세 페이지의 “최근 수정” 날짜와 사용법이 함께 갱신되므로, 어느 앱이 최신인지 이 페이지에서 바로 확인할 수 있습니다.</p>
        <p>앱을 정리해 목록에서 내리는 경우도 있습니다. 주소가 바뀌면 기존 북마크가 열리지 않을 수 있으니, 자주 쓰는 앱은 <a href="/apps">앱 목록</a>에서 다시 확인해 주세요.</p>
      </section>
      <section class="prose-block">
        <h2>최근 등록한 앱</h2>
        ${recent.length
          ? `<ul class="timeline">${recent.map((a) => `<li><span class="muted small">${esc(formatDate(a.createdAt))}</span> <a href="/app/${attr(a.id)}">${esc(a.name)}</a> — ${esc(a.desc || '')}</li>`).join('')}</ul>`
          : '<p>아직 등록된 앱이 없습니다.</p>'}
      </section>
      <section class="prose-block">
        <h2>연락처</h2>
        <p>운영자: ${esc(site.owner)}${site.email ? ` · 이메일: <a href="mailto:${attr(site.email)}">${esc(site.email)}</a>` : ''}</p>
        <p>앱 오류 제보, 콘텐츠 정정 요청, 개인정보 관련 문의는 <a href="/contact">문의 페이지</a>를 참고해 주세요.</p>
      </section>
    </div>
  </div>`;

  return layout({
    site,
    title: '사이트 소개',
    description: `${site.name}가 무엇을 제공하는지, 앱을 어떤 기준으로 만들고 등록하는지, 데이터가 어떻게 처리되는지 안내합니다.`,
    path: '/about',
    body,
    nav: 'about',
    jsonLd: [
      crumbs.jsonLd,
      {
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: `${site.name} 소개`,
        description: site.description,
      },
    ],
  });
}

function contactPage({ site }) {
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: '문의', href: '/contact' },
  ]);
  const mail = site.email || '';
  const body = `
  <div class="shell">
    ${crumbs.html}
    <header class="page-head">
      <h1>문의하기</h1>
      <p class="lead">앱 오류 제보, 콘텐츠 정정, 광고·제휴, 개인정보 관련 요청을 아래 이메일로 받습니다.</p>
    </header>
    <div class="contact-grid">
      <div class="card contact-card">
        <h2>이메일</h2>
        ${mail
          ? `<p class="mail"><a href="mailto:${attr(mail)}">${esc(mail)}</a></p>`
          : '<p class="notice err">운영자 이메일이 아직 설정되지 않았습니다. 관리자 화면의 “사이트 설정”에서 입력해 주세요.</p>'}
        <p class="muted small">스팸 필터를 피하기 위해 제목에 문의 종류를 적어 주시면 확인이 빠릅니다. 예: <span class="mono">[앱 오류] 계산기 결과가 이상합니다</span></p>
      </div>
      <div class="card contact-card">
        <h2>이런 내용을 알려 주세요</h2>
        <ul class="checklist">
          <li><strong>앱 오류</strong> — 앱 이름, 사용한 기기와 브라우저, 문제가 생긴 순서</li>
          <li><strong>결과의 오류</strong> — 입력한 값과 기대한 값</li>
          <li><strong>콘텐츠 정정</strong> — 해당 페이지 주소와 정정할 내용</li>
          <li><strong>광고·제휴</strong> — 회사명과 제안 내용</li>
          <li><strong>개인정보</strong> — 열람·삭제 요청 (이메일 제목: [개인정보])</li>
        </ul>
      </div>
    </div>
    <div class="prose narrow">
      <section class="prose-block">
        <h2>답변 안내</h2>
        <p>개인이 운영하는 사이트라 모든 메일을 바로 확인하기 어렵습니다. 접수 순서대로 확인하며, 보통 영업일 기준 2~3일 안에 답변드립니다. 다만 모든 제안이 반영되지는 않습니다.</p>
        <p>앱은 운영자가 직접 만들고 점검하지만, 브라우저·기기·사용 환경에 따라 다르게 동작할 수 있습니다. 문제를 알려 주실 때는 위의 네 가지만 적어 주시면 원인을 훨씬 빠르게 좁힐 수 있습니다.</p>
      </section>
      <section class="prose-block">
        <h2>이런 문의는 답변이 어렵습니다</h2>
        <ul>
          <li>특정 상품·업체의 홍보나 순위 조정 요청 — 이 사이트는 광고성 콘텐츠를 싣지 않습니다.</li>
          <li>다른 사람의 저작물을 대신 올려 달라는 요청 — 권리 관계를 확인할 수 없어 받지 않습니다.</li>
          <li>앱을 대신 만들어 달라는 요청 — 제안은 읽지만 제작 일정을 약속드리지는 않습니다.</li>
        </ul>
      </section>
      <section class="prose-block">
        <h2>광고·제휴 문의</h2>
        <p>페이지에 게재되는 광고는 Google AdSense를 통해 자동으로 집행되며, 운영자가 개별 광고를 직접 판매하거나 중개하지 않습니다. 다만 콘텐츠 협업 제안은 위 이메일로 보내 주시면 검토하겠습니다.</p>
      </section>
      <section class="prose-block">
        <h2>개인정보 관련 요청</h2>
        <p>사이트는 회원 정보를 보관하지 않으며, 앱에 입력한 내용은 서버로 전송되지 않습니다. 문의 과정에서 남은 이메일과 문의 내용의 삭제를 원하시면 같은 주소로 요청해 주세요. 자세한 내용은 <a href="/privacy">개인정보처리방침</a>을 확인하세요.</p>
      </section>
    </div>
  </div>`;

  return layout({
    site,
    title: '문의하기',
    description: `${site.name} 운영자에게 연락하는 방법과 문의 시 알려 주시면 좋은 내용을 안내합니다.`,
    path: '/contact',
    body,
    nav: 'contact',
    jsonLd: [
      crumbs.jsonLd,
      {
        '@context': 'https://schema.org',
        '@type': 'ContactPage',
        name: `${site.name} 문의`,
        ...(mail ? { description: `이메일: ${mail}` } : {}),
      },
    ],
  });
}

function guideIndexPage({ site, apps, guides = GUIDES }) {
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: '가이드', href: '/guide' },
  ]);
  const body = `
  <div class="shell">
    ${crumbs.html}
    <header class="page-head">
      <h1>가이드</h1>
      <p class="lead">이 사이트의 앱을 오래, 안전하게 쓰는 방법을 정리한 글 모음입니다. 도구의 사용법뿐 아니라 데이터를 어디에 두고 어떻게 백업할지, AI API 키를 어떻게 다룰지까지 함께 다룹니다.</p>
      <p class="muted">처음 방문했다면 <a href="/guide/single-file-webapp">단일 파일 웹앱이란 무엇인가</a>부터, 앱을 이미 쓰고 있다면 <a href="/guide/api-key-safety">AI API 키 관리</a>를 먼저 읽어 보시길 권합니다.</p>
    </header>
    <div class="grid guide-grid">
      ${guides.map((g) => `
        <article class="card guide-card">
          <p class="muted small">${esc(formatDate(g.date))} · ${g.minutes}분 분량</p>
          <h2><a href="/guide/${attr(g.slug)}">${esc(g.title)}</a></h2>
          <p>${esc(g.summary)}</p>
          <div class="tags">${(g.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <a class="more" href="/guide/${attr(g.slug)}">읽기 →</a>
        </article>`).join('')}
    </div>
    <section class="section prose narrow">
      <h2>앱 목록으로 돌아가기</h2>
      <p>바로 앱을 써 보고 싶다면 <a href="/apps">앱 목록</a>에서 원하는 도구를 고르세요. 현재 ${apps.length}개의 앱이 등록되어 있습니다.</p>
    </section>
  </div>`;

  return layout({
    site,
    title: '가이드',
    description: '단일 파일 웹앱의 개념, 브라우저 저장소와 백업, 이 사이트의 앱 제작 기준을 정리한 안내 글 모음입니다.',
    path: '/guide',
    body,
    nav: 'guide',
    jsonLd: [
      crumbs.jsonLd,
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${site.name} 가이드`,
        hasPart: guides.map((g) => ({
          '@type': 'Article',
          headline: g.title,
          description: g.summary,
          datePublished: g.date,
          ...(site.domain ? { url: `${site.domain}/guide/${g.slug}` } : {}),
        })),
      },
    ],
  });
}

function guideDetailPage({ site, guide, apps = [] }) {
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: '가이드', href: '/guide', url: site.domain ? `${site.domain}/guide` : undefined },
    { label: guide.title, href: `/guide/${guide.slug}` },
  ]);
  const others = GUIDES.filter((g) => g.slug !== guide.slug).slice(0, 2);
  const relatedAppList = (guide.related || [])
    .map((id) => apps.find((a) => a.id === id))
    .filter(Boolean);
  const body = `
  <div class="shell">
    ${crumbs.html}
    <article class="article">
      <header class="page-head">
        <p class="eyebrow">${esc((guide.tags || []).join(' · '))}</p>
        <h1>${esc(guide.title)}</h1>
        <p class="lead">${esc(guide.summary)}</p>
        <p class="muted small">${esc(formatDate(guide.date))} · 약 ${guide.minutes}분 분량</p>
      </header>
      <nav class="toc" aria-label="목차">
        <h2>목차</h2>
        <ol>
          ${guide.sections.filter((s) => s.h).map((s) => `<li><a href="#${attr(slugifyHeading(s.h))}">${esc(s.h)}</a></li>`).join('')}
        </ol>
      </nav>
      <div class="prose">
        ${guide.sections.map((s) => {
          const inner = [
            s.p?.length ? s.p.map((t) => `<p>${esc(t)}</p>`).join('') : '',
            s.list?.length ? `<ul>${s.list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '',
          ].join('');
          return s.h ? `<section class="prose-block"><h2 id="${attr(slugifyHeading(s.h))}">${esc(s.h)}</h2>${inner}</section>` : inner;
        }).join('')}
      </div>
      ${adSlot(site, { slot: site.adsense?.slotInline, className: 'ad-inline' })}
      ${relatedAppList.length ? `
      <section class="section">
        <h2>이 글과 관련된 앱</h2>
        <div class="grid">
          ${relatedAppList.map((a) => appCard(a, { site })).join('')}
        </div>
      </section>` : ''}
      <section class="section">
        <h2>이어서 읽기</h2>
        <div class="grid guide-grid">
          ${others.map((g) => `
            <article class="card guide-card">
              <h3><a href="/guide/${attr(g.slug)}">${esc(g.title)}</a></h3>
              <p>${esc(g.summary)}</p>
              <a class="more" href="/guide/${attr(g.slug)}">읽기 →</a>
            </article>`).join('')}
        </div>
      </section>
      <p class="muted small">이 글은 ${esc(site.name)} 운영자가 작성했습니다. 내용에 대한 정정 요청은 <a href="/contact">문의 페이지</a>로 보내 주세요.</p>
    </article>
  </div>`;

  return layout({
    site,
    title: guide.title,
    description: guide.summary,
    path: `/guide/${guide.slug}`,
    body,
    nav: 'guide',
    jsonLd: [
      crumbs.jsonLd,
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: guide.title,
        description: guide.summary,
        datePublished: guide.date,
        dateModified: guide.date,
        inLanguage: site.locale || 'ko',
        author: { '@type': 'Organization', name: site.owner || site.name },
        publisher: { '@type': 'Organization', name: site.name },
        ...(site.domain ? { mainEntityOfPage: `${site.domain}/guide/${guide.slug}` } : {}),
      },
    ],
  });
}

function slugifyHeading(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `section`;
}

function categoriesPage({ site, apps }) {
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: '분야별 보기', href: '/categories' },
  ]);
  const items = categoryCounts(apps);
  const etcLink = items.some((c) => c.slug === 'etc')
    ? '<a href="/category/etc">기타 도구</a>'
    : '기타 도구';
  const body = `
  <div class="shell">
    ${crumbs.html}
    <header class="page-head">
      <h1>분야별로 앱 찾기</h1>
      <p class="lead">등록된 웹앱 ${apps.length}개를 쓰임새별로 묶었습니다. 분야를 고르면 그 분야의 앱과 사용법을 한 번에 볼 수 있습니다.</p>
    </header>
    <div class="grid cat-grid">
      ${items.map((c) => `
        <a class="card cat-card" href="/category/${attr(c.slug)}">
          <span class="cat-icon" aria-hidden="true">${esc(c.icon)}</span>
          <h2>${esc(c.label)}</h2>
          <p>${esc(c.blurb)}</p>
          <span class="cat-count">앱 ${c.count}개</span>
        </a>`).join('')}
    </div>
    <section class="section prose">
      <h2>분야별 앱 수</h2>
      <p>지금 올라와 있는 앱을 분야별로 세어 보면 아래와 같습니다. 앱이 하나도 없는 분야는 목록에서 빠지고, 새로운 앱이 등록되면 그때 자동으로 생깁니다.</p>
      <table class="cat-table">
        <thead><tr><th>분야</th><th>앱 수</th><th>이런 앱이 들어갑니다</th></tr></thead>
        <tbody>
          ${items.map((c) => `<tr><td><a href="/category/${attr(c.slug)}">${esc(c.icon)} ${esc(c.label)}</a></td><td>${c.count}개</td><td class="muted">${esc(c.blurb)}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>
    <section class="section prose narrow">
      <h2>분야는 이렇게 정합니다</h2>
      <p>앱 파일을 읽어 제목·설명·화면 라벨에 나타난 낱말로 자동 분류하고, 운영자가 등록 전에 한 번 더 확인합니다. 화면에 보이는 글을 우선하고 코드에 섞여 있는 라이브러리 이름은 가중치를 낮게 보기 때문에, “이미지 파일을 다루는 계산기”처럼 겹치는 앱도 실제 쓰임새 쪽으로 묶입니다.</p>
      <p>그래서 같은 앱이라도 기능이 바뀌면 분야가 옮겨질 수 있습니다. 앱을 고칠 때 분야도 함께 다시 확인하기 때문입니다.</p>
      <p>분야가 애매한 도구는 ${etcLink} 에 모아 두고, 쓰임새가 분명해지면 알맞은 분야로 옮깁니다. 원하는 분야가 없거나 잘못 묶인 앱이 보이면 <a href="/contact">문의 페이지</a>로 알려 주세요. 확인 후 반영합니다.</p>
    </section>
    <section class="section prose narrow">
      <h2>분야별로 찾는 방법</h2>
      <ul>
        <li>홈과 <a href="/apps">앱 목록</a> 위쪽의 분야 버튼을 누르면 그 분야의 앱만 모아 볼 수 있습니다.</li>
        <li>앱 상세 페이지의 “분류” 항목을 누르면 같은 분야의 다른 앱으로 이동합니다.</li>
        <li>분야 페이지마다 그 분야에서 자주 필요한 안내 글을 함께 걸어 두었습니다.</li>
      </ul>
    </section>
  </div>`;
  return layout({
    site,
    title: '분야별로 앱 찾기',
    description: `등록된 웹앱 ${apps.length}개를 콘텐츠 제작·업무·금융·문서·이미지·텍스트·학습·생활·데이터·게임 분야로 나눠 소개합니다.`,
    path: '/categories',
    body,
    nav: 'apps',
    jsonLd: [
      crumbs.jsonLd,
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${site.name} 분야별 앱 목록`,
        hasPart: items.map((c) => ({
          '@type': 'CollectionPage',
          name: c.label,
          description: c.blurb,
          ...(site.domain ? { url: `${site.domain}/category/${c.slug}` } : {}),
        })),
      },
    ],
  });
}

function categoryPage({ site, apps, category }) {
  const items = apps.filter((a) => (a.category && getCategory(a.category) ? a.category : 'etc') === category.slug);
  const others = categoryCounts(apps).filter((c) => c.slug !== category.slug);
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: '분야별 보기', href: '/categories', url: site.domain ? `${site.domain}/categories` : undefined },
    { label: category.label, href: `/category/${category.slug}` },
  ]);
  const relatedGuides = GUIDES.filter((g) => (g.related || []).some((id) => items.some((a) => a.id === id))).slice(0, 3);
  const body = `
  <div class="shell">
    ${crumbs.html}
    <header class="page-head">
      <p class="eyebrow">${esc(category.icon)} 분야</p>
      <h1>${esc(category.label)} 앱 <span class="count">(${items.length})</span></h1>
      <p class="lead">${esc(category.blurb)}</p>
    </header>
    ${categoryChips(apps, { active: category.slug })}
    ${items.length
      ? `<div class="grid">${items.map((a) => appCard(a, { site })).join('')}</div>`
      : '<div class="card empty">이 분야에는 아직 앱이 없습니다. 다른 분야를 살펴보세요.</div>'}
    <section class="section prose narrow">
      ${(category.intro || []).map((t) => `<p>${esc(t)}</p>`).join('')}
      <p>분야가 잘못 묶였다고 생각되면 <a href="/contact">문의 페이지</a>로 알려 주세요. 확인 후 옮기겠습니다.</p>
    </section>
    ${relatedGuides.length ? `
    <section class="section">
      <h2>이 분야와 함께 읽을 안내</h2>
      <div class="grid guide-grid">
        ${relatedGuides.map((g) => `
          <article class="card guide-card">
            <h3><a href="/guide/${attr(g.slug)}">${esc(g.title)}</a></h3>
            <p>${esc(g.summary)}</p>
            <a class="more" href="/guide/${attr(g.slug)}">읽기 →</a>
          </article>`).join('')}
      </div>
    </section>` : ''}
    ${adSlot(site, { slot: site.adsense?.slotInline, className: 'ad-inline' })}
    ${others.length ? `
    <section class="section">
      <h2>다른 분야</h2>
      <nav class="chips" aria-label="다른 분야">
        ${others.map((c) => `<a class="chip" href="/category/${attr(c.slug)}"><span aria-hidden="true">${esc(c.icon)}</span> ${esc(c.label)} <span>${c.count}</span></a>`).join('')}
      </nav>
    </section>` : ''}
  </div>`;
  return layout({
    site,
    title: `${category.label} 앱`,
    description: `${category.blurb} 현재 ${items.length}개의 앱을 소개합니다. 각 앱의 사용법과 데이터 저장 방식도 함께 안내합니다.`,
    path: `/category/${category.slug}`,
    body,
    nav: 'apps',
    jsonLd: [
      crumbs.jsonLd,
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${category.label} 앱 모음`,
        description: category.blurb,
        ...(items.length ? {
          hasPart: items.map((a) => ({
            '@type': 'WebApplication',
            name: a.name,
            description: a.desc || '',
            ...(site.domain ? { url: `${site.domain}/app/${a.id}` } : {}),
          })),
        } : {}),
      },
    ],
  });
}

function policyPage({ site, doc }) {
  const crumbs = breadcrumbs([
    { label: '홈', href: '/', url: site.domain ? `${site.domain}/` : undefined },
    { label: doc.title, href: `/${doc.slug}` },
  ]);
  const body = `
  <div class="shell">
    ${crumbs.html}
    <header class="page-head">
      <h1>${esc(doc.title)}</h1>
      <p class="lead">${esc(doc.summary)}</p>
      <p class="muted small">최종 수정: ${esc(formatDate(doc.updated) || doc.updated)}</p>
    </header>
    <div class="prose narrow">
      ${prose(doc.sections)}
      <section class="prose-block">
        <h2>문의</h2>
        <p>${site.email
          ? `내용에 대한 문의는 <a href="mailto:${attr(site.email)}">${esc(site.email)}</a> 로 보내 주세요.`
          : '내용에 대한 문의는 사이트의 <a href="/contact">문의 페이지</a>를 이용해 주세요.'}</p>
        <p>운영자: ${esc(site.owner)} · 사이트: <a href="/">${esc(site.name)}</a></p>
      </section>
    </div>
  </div>`;

  return layout({
    site,
    title: doc.title,
    description: doc.summary,
    path: `/${doc.slug}`,
    body,
    jsonLd: [crumbs.jsonLd],
  });
}

function notFoundPage({ site }) {
  const body = `
  <div class="shell">
    <div class="card notfound">
      <p class="eyebrow">404</p>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>주소가 바뀌었거나 삭제된 앱일 수 있습니다. 아래에서 다시 찾아보세요.</p>
      <div class="actions">
        <a class="btn primary" href="/">홈으로</a>
        <a class="btn" href="/apps">앱 목록</a>
        <a class="btn" href="/contact">문의하기</a>
      </div>
    </div>
  </div>`;
  return layout({
    site,
    title: '페이지를 찾을 수 없습니다',
    description: '요청한 페이지를 찾을 수 없습니다.',
    path: '/404',
    body,
    noIndex: true,
  });
}

module.exports = {
  FAQ,
  homePage,
  appsPage,
  appDetailPage,
  aboutPage,
  contactPage,
  guideIndexPage,
  guideDetailPage,
  policyPage,
  categoriesPage,
  categoryPage,
  categoryCounts,
  categoryChips,
  notFoundPage,
  privacyPolicy,
  termsOfService,
  disclaimer,
  findGuide,
  GUIDES,
};
