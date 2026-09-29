'use strict';

/**
 * 아주 작은 마크다운 → HTML 변환기.
 *
 * 외부 라이브러리 없이 쓰는 최소 기능만 지원합니다:
 *   제목(#, ##, ###), 문단, 목록(-, *), 번호 목록(1.), 인용(>), 코드 블록(```),
 *   굵게(**), 기울임(*), 인라인 코드(`), 링크([글](주소)), 구분선(---)
 *
 * 먼저 HTML 을 이스케이프한 뒤 변환하므로 사용자가 넣은 태그가 실행되지 않습니다.
 */

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (m, label, href) => {
    const external = /^https?:/i.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener nofollow"' : ''}>${label}</a>`;
  });
  return out;
}

function renderMarkdown(markdown) {
  const text = String(markdown || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';

  const lines = text.split('\n');
  const out = [];
  let paragraph = [];
  let list = null; // { type: 'ul' | 'ol', items: [] }
  let quote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map((q) => inline(q)).join('<br />')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // 코드 블록
    if (trimmed.startsWith('```')) {
      flushAll();
      const lang = trimmed.slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      out.push(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!trimmed) { flushAll(); continue; }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length + 1, 5); // h1 → h2 (페이지 제목과 충돌 방지)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      out.push('<hr />');
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph(); flushQuote();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph(); flushQuote();
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(ordered[1]);
      continue;
    }

    const quoteLine = trimmed.match(/^>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph(); flushList();
      quote.push(quoteLine[1]);
      continue;
    }

    flushList(); flushQuote();
    paragraph.push(trimmed);
  }

  flushAll();
  return out.join('\n');
}

/** 목록에 쓰는 짧은 미리보기 */
function markdownSummary(markdown, max = 120) {
  const plain = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`\-]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

module.exports = { renderMarkdown, markdownSummary, escapeHtml };
