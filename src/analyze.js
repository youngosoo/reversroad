'use strict';

/**
 * Static analysis of a standalone HTML web app: it reads the markup and inline
 * scripts and derives a name, icon, description, tags and a step by step usage
 * guide. Everything is local and deterministic - no network, no LLM.
 */

const path = require('path');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const { classifyCategory } = require('./categories');

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ---------------------------------------------------------------- categories

const CATEGORIES = [
  {
    key: 'todo',
    label: '할일',
    icon: '✅',
    what: '할 일을 추가하고 완료 여부를 체크하는 도구',
    patterns: [/할\s?일/, /체크리스트/, /todo/i, /task/i, /checklist/i, /to-?do/i],
  },
  {
    key: 'memo',
    label: '메모',
    icon: '📝',
    what: '메모와 글을 적어 두는 도구',
    patterns: [/메모/, /노트/, /일기/, /memo/i, /\bnote\b/i, /diary/i, /journal/i],
  },
  {
    key: 'calc',
    label: '계산',
    icon: '🧮',
    what: '숫자를 입력해 계산 결과를 내는 도구',
    patterns: [/계산/, /calc/i, /계산기/, /산출/, /예산/, /정산/, /금액/, /합계/, /평균/, /이자/, /환율/, /단가/],
  },
  {
    key: 'timer',
    label: '타이머',
    icon: '⏱️',
    what: '시간을 재거나 알려주는 도구',
    patterns: [/타이머/, /스톱워치/, /뽀모도로/, /timer/i, /stopwatch/i, /pomodoro/i, /countdown/i, /카운트다운/, /알람/],
  },
  {
    key: 'clock',
    label: '시계',
    icon: '🕒',
    what: '날짜와 시각을 보여주는 도구',
    patterns: [/\bclock\b/i, /시계/, /달력/, /캘린더/, /calendar/i, /디데이/, /d-?day/i],
  },
  {
    key: 'game',
    label: '게임',
    icon: '🎮',
    what: '키보드와 마우스로 즐기는 게임',
    patterns: [/게임/, /game/i, /점수/, /score/i, /레벨/, /level/i, /퀴즈게임/, /tetris/i, /테트리스/, /스네이크/, /snake/i, /퍼즐/, /puzzle/i],
  },
  {
    key: 'quiz',
    label: '퀴즈',
    icon: '❓',
    what: '문제를 풀고 정답을 확인하는 도구',
    patterns: [/퀴즈/, /quiz/i, /문제/, /정답/, /시험/, /암기/, /flashcard/i, /단어장/],
  },
  {
    key: 'draw',
    label: '그림',
    icon: '🎨',
    what: '캔버스에 직접 그리거나 색을 칠하는 도구',
    patterns: [/그림/, /그리기/, /드로잉/, /draw/i, /paint/i, /스케치/, /색칠/, /서명/, /사인/],
  },
  {
    key: 'chart',
    label: '차트',
    icon: '📊',
    what: '숫자를 그래프나 차트로 시각화하는 도구',
    patterns: [/차트/, /그래프/, /chart/i, /graph/i, /통계/, /시각화/, /visuali[sz]/i],
  },
  {
    key: 'convert',
    label: '변환',
    icon: '🔄',
    what: '단위나 형식을 바꿔 주는 도구',
    patterns: [/변환/, /convert/i, /단위/, /인코딩/, /encode/i, /decode/i, /format/i, /포맷/],
  },
  {
    key: 'gallery',
    label: '갤러리',
    icon: '🖼️',
    what: '이미지를 모아 보여주는 도구',
    patterns: [/갤러리/, /gallery/i, /앨범/, /사진/, /슬라이드/, /carousel/i, /이미지 뷰어/],
  },
  {
    key: 'music',
    label: '소리',
    icon: '🎵',
    what: '소리를 만들거나 재생하는 도구',
    patterns: [/음악/, /소리/, /사운드/, /sound/i, /audio/i, /피아노/, /piano/i, /메트로놈/],
  },
  {
    key: 'text',
    label: '텍스트',
    icon: '🔤',
    what: '글자를 세거나 가공하는 도구',
    patterns: [/글자/, /텍스트/, /줄바꿈/, /대소문자/, /글자수/, /text/i, /cipher/i, /암호화/, /base64/i, /정규식/, /regex/i],
  },
  {
    key: 'table',
    label: '표',
    icon: '📋',
    what: '표에 데이터를 정리하는 도구',
    patterns: [/표 만들기/, /테이블/, /명단/, /가계부/, /목록 관리/, /inventory/i, /spreadsheet/i, /database/i],
  },
  {
    key: 'lookup',
    label: '조회',
    icon: '🔎',
    what: '검색하거나 조건에 맞는 값을 찾는 도구',
    patterns: [/검색/, /조회/, /사전/, /dictionary/i, /search/i, /filter/i, /필터/],
  },
];

// Short English id used when a Korean name leaves nothing to slugify.
const CATEGORY_SLUGS = {
  todo: 'todo',
  memo: 'memo',
  calc: 'calc',
  timer: 'timer',
  clock: 'clock',
  game: 'game',
  quiz: 'quiz',
  draw: 'draw',
  chart: 'chart',
  convert: 'convert',
  gallery: 'gallery',
  music: 'sound',
  text: 'text',
  table: 'table',
  lookup: 'find',
};

const LIBRARIES = [
  [/tailwind/i, 'Tailwind CSS'],
  [/bootstrap/i, 'Bootstrap'],
  [/chart(\.min)?\.js|chartjs/i, 'Chart.js'],
  [/jquery/i, 'jQuery'],
  [/react/i, 'React'],
  [/vue(\.runtime)?(\.min)?\.js|@vue/i, 'Vue'],
  [/alpine/i, 'Alpine.js'],
  [/three(\.min)?\.js|threejs/i, 'three.js'],
  [/(^|\/)d3(\.v\d+)?(\.min)?\.js|d3js/i, 'D3.js'],
  [/p5(\.min)?\.js|p5js/i, 'p5.js'],
  [/marked|markdown-it/i, 'Markdown 파서'],
  [/highlight(\.min)?\.js|prism/i, '코드 하이라이터'],
  [/font-?awesome/i, 'Font Awesome'],
  [/fonts\.googleapis|fonts\.gstatic/i, 'Google Fonts'],
  [/mathjax|katex/i, '수식 렌더러'],
  [/xlsx|sheetjs/i, 'SheetJS'],
  [/jspdf|pdf-lib|pdfjs/i, 'PDF 라이브러리'],
  [/lottie/i, 'Lottie'],
  [/sortable/i, 'SortableJS'],
  [/html2canvas/i, 'html2canvas'],
];

// ------------------------------------------------------------------ helpers

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const HANGUL_RE = /[가-힣]/;

function endsWithJongseong(word) {
  const ch = String(word || '').replace(/[”"'’)\]]+$/, '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (!ch) return null;
  if (/[aeiouAEIOU]/.test(ch)) return false;
  if (/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/.test(ch)) return true;
  return null;
}

/** Picks the right Korean particle, or "을(를)" when the ending is ambiguous. */
function josa(word, withJong, withoutJong) {
  const j = endsWithJongseong(word);
  if (j === null) return `${withJong}(${withoutJong})`;
  return j ? withJong : withoutJong;
}

function collapse(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function trimTo(text, max) {
  const t = collapse(text);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

const BAD_SLUGS = new Set(['index', 'main', 'app', 'untitled', 'new', 'test', 'document', 'html', 'home', 'page']);

/** ASCII-only, hyphenated id suggestion (Korean names simply yield nothing). */
function slugifyLoose(value) {
  const s = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  if (!s || s.length < 3 || BAD_SLUGS.has(s) || /^[0-9-]+$/.test(s)) return '';
  return s;
}

// ------------------------------------------------------- Hangul romanization

const CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'p', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

/** Revised-Romanization style conversion, enough to build short English ids. */
function romanizeHangul(text) {
  return String(text || '')
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const i = code - 0xac00;
        return CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
      }
      return ch;
    })
    .join('');
}

function slugifyRoman(value) {
  const s = romanizeHangul(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s || s.length < 3 || BAD_SLUGS.has(s) || /^[0-9-]+$/.test(s)) return '';
  return s;
}

function cutSlug(slug, max = 20) {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const at = cut.lastIndexOf('-');
  return (at >= 8 ? cut.slice(0, at) : cut).replace(/-+$/g, '');
}

/**
 * Mojibake file names (Korean names read with the wrong encoding) slugify into
 * noise like "i-i-e-i-1" or "a-a-a-a-3a-a-a-1-4a". Those make terrible ids, so
 * they get skipped in favour of a romanized name or a category word.
 */
function isNoisySlug(slug) {
  const segs = String(slug || '').split('-').filter(Boolean);
  if (segs.length < 4) return false;
  const singles = segs.filter((s) => s.length <= 2).length;
  return singles >= 3 && singles / segs.length >= 0.5;
}

/** Short English id: file name -> name/title words -> romanized Korean -> category. */
function suggestSlug({ name, category, fileName } = {}) {
  const fileBase = fileName ? path.basename(String(fileName), path.extname(String(fileName))) : '';
  const words = String(name || '').split(/\s+/).filter(Boolean);
  const candidates = [
    slugifyLoose(fileBase),
    slugifyLoose(name),
    slugifyLoose(words[words.length - 1]),
    slugifyRoman(name),
    slugifyRoman(words[words.length - 1]),
    slugifyRoman(words[0]),
    category ? CATEGORY_SLUGS[category] || '' : '',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const cut = cutSlug(candidate);
    if (cut.length < 3 || BAD_SLUGS.has(cut) || isNoisySlug(cut)) continue;
    return cut;
  }
  return '';
}

// ------------------------------------------------------------------ name

const NAME_MAX = 16;
const FILLER_WORDS = new Set([
  'the', 'my', 'our', 'your', 'a', 'an', 'simple', 'online', 'free', 'best', 'new', 'super', 'mini',
  '무료', '심플', '간단', '온라인', '나의', '내', '우리', '초간단',
]);
const GENERIC_SUFFIX = new RegExp(
  '\\s*(웹\\s?앱|어플리케이션|어플|애플리케이션|프로그램|사이트|페이지|앱|application|app|program|web\\s?app|website|site|tool)$',
  'i'
);

/** Keeps the app name short: first segment, no asides, no filler, <= 16 chars. */
function shortName(raw) {
  let t = collapse(raw);
  if (!t) return '';
  t = t.replace(/\.(html?|htm)$/i, '');
  t = t.replace(/[([{（【][^)\]})】]*[)\]})】]/g, ' ');
  t = t.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+/gu, ' ');
  const parts = t
    .split(/\s*[|·•—–»›:]\s*|\s+-\s+/)
    .map(collapse)
    .filter(Boolean);
  if (parts.length) t = parts[0];
  t = collapse(t.replace(GENERIC_SUFFIX, '')).replace(/[\s\-_·]+$/, '');
  let words = t.split(' ').filter(Boolean);
  while (words.length > 1 && FILLER_WORDS.has(words[0].toLowerCase().replace(/[^\w가-힣]/g, ''))) words.shift();
  while (words.length > 1 && /^(v|v\d+(\.\d+)*|ver\.?|version|버전|β|beta|\d+(\.\d+)?)$/i.test(words[words.length - 1])) words.pop();
  t = collapse(words.join(' ')).replace(/[\s\-_·]+$/, '');
  if (!t) return '';
  if (t.length > NAME_MAX) {
    let out = '';
    for (const word of t.split(' ')) {
      if (!out) out = word.slice(0, NAME_MAX);
      else if (`${out} ${word}`.length <= NAME_MAX) out = `${out} ${word}`;
      else break;
    }
    t = collapse(out);
  }
  return t;
}

function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map(collapse)
    .filter(Boolean);
}

function findEmoji(...texts) {
  for (const text of texts) {
    const m = String(text || '').match(EMOJI_RE);
    if (m) return m[0];
  }
  return '';
}

/** 입력 예시(URL·이메일 등)는 라벨로 쓰지 않습니다 — "https://example.com 에 입력" 같은 문장을 막습니다 */
function isExampleText(text) {
  const value = collapse(text);
  if (!value) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value)) return true;
  if (/example\.(com|org|net)/i.test(value)) return true;
  if (/^(입력|여기에|예:|예시|type|enter)\b/i.test(value)) return true;
  return false;
}

function labelFor($, el) {
  const $el = $(el);
  const aria = $el.attr('aria-label');
  if (aria) return { label: collapse(aria), explicit: true };
  const id = $el.attr('id');
  if (id) {
    const sel = `label[for="${String(id).replace(/"/g, '\\"')}"]`;
    const text = collapse($(sel).first().text());
    if (text) return { label: text, explicit: true };
  }
  const wrap = $el.closest('label');
  if (wrap.length) {
    const clone = wrap.clone();
    clone.children('input, select, textarea, button, svg').remove();
    const text = collapse(clone.text());
    if (text) return { label: text, explicit: true };
  }
  const placeholder = $el.attr('placeholder');
  if (placeholder && !isExampleText(placeholder)) return { label: collapse(placeholder), explicit: true };
  const title = $el.attr('title');
  if (title) return { label: collapse(title), explicit: true };
  if ($el.is('button')) {
    const text = collapse($el.text());
    if (text) return { label: text, explicit: true };
  }
  if ($el.is('select')) {
    const opts = $el
      .find('option')
      .map((_, o) => collapse($(o).text()))
      .get()
      .filter(Boolean)
      .slice(0, 4);
    if (opts.length) return { label: trimTo(opts.join(' / '), 40), explicit: false };
  }
  const value = $el.attr('value');
  if (value && ['submit', 'button', 'reset'].includes(($el.attr('type') || '').toLowerCase())) {
    return { label: collapse(value), explicit: true };
  }
  const name = $el.attr('name');
  if (name && !/^[a-z0-9_-]{1,3}$/i.test(name)) return { label: collapse(name), explicit: true };
  return { label: '', explicit: false };
}

function describeControl(tag, type, label) {
  const quoted = label ? `“${label}”` : '';
  switch (tag) {
    case 'button':
      return quoted ? `${quoted} ${josa(label, '을', '를')} 누릅니다.` : '버튼을 누릅니다.';
    case 'select':
      return quoted ? `${quoted} 에서 항목을 고릅니다.` : '드롭다운에서 항목을 고릅니다.';
    case 'textarea':
      return quoted ? `${quoted} 에 내용을 붙여넣거나 직접 작성합니다.` : '입력 영역에 내용을 붙여넣거나 직접 작성합니다.';
    case 'input':
      switch (type) {
        case 'range':
          return quoted ? `${quoted} ${josa(label, '을', '를')} 좌우로 움직여 값을 조절합니다.` : '슬라이더를 좌우로 움직여 값을 조절합니다.';
        case 'number':
          return quoted ? `${quoted} 에 숫자를 입력합니다.` : '숫자 입력란에 숫자를 입력합니다.';
        case 'checkbox':
          return quoted ? `${quoted} ${josa(label, '을', '를')} 체크하거나 해제합니다.` : '체크박스를 체크하거나 해제합니다.';
        case 'radio':
          return quoted ? `${quoted} 중 하나를 고릅니다.` : '선택지 중 하나를 고릅니다.';
        case 'file':
          return quoted ? `${quoted} 에서 파일을 올립니다.` : '파일 선택에서 파일을 올립니다.';
        case 'date':
        case 'datetime-local':
        case 'month':
        case 'time':
        case 'week':
          return quoted ? `${quoted} 에서 날짜나 시각을 지정합니다.` : '날짜/시간 입력란에서 날짜나 시각을 지정합니다.';
        case 'color':
          return quoted ? `${quoted} 에서 색을 고릅니다.` : '색상 선택에서 색을 고릅니다.';
        case 'search':
          return quoted ? `${quoted} 에 찾을 말을 입력합니다.` : '검색창에 찾을 말을 입력합니다.';
        default:
          return quoted ? `${quoted} 에 값을 입력합니다.` : '입력란에 값을 입력합니다.';
      }
    default:
      return quoted ? `${quoted} ${josa(label, '을', '를')} 사용합니다.` : '화면의 요소를 눌러 조작합니다.';
  }
}

function numbered(lines) {
  return lines.map((line, i) => `${i + 1}) ${line}`).join('\n');
}

// Wording for buttons, keyed by what the label usually means. Order matters:
// the specific cases (인쇄, 내려받기) must be tested before the generic ones.
const BUTTON_HINTS = [
  { key: 'start', re: /(시작|start|play|새\s?게임|실행)/i, text: (l) => `“${l}” 버튼을 눌러 시작합니다.` },
  { key: 'pause', re: /(일시\s?정지|정지|중지|pause|stop|멈춤)/i, text: (l) => `“${l}” 버튼으로 잠시 멈추거나 다시 이어서 진행합니다.` },
  { key: 'reset', re: /(초기화|리셋|reset|clear|비우기|전체\s?삭제)/i, text: (l) => `“${l}” 버튼으로 입력과 결과를 처음 상태로 되돌립니다.` },
  { key: 'restart', re: /(다시|재시작|restart|새로고침|reload)/i, text: (l) => `“${l}” 버튼으로 처음부터 다시 시작합니다.` },
  { key: 'print', re: /(인쇄|출력|print)/i, text: (l) => `“${l}” 버튼을 누르면 인쇄 화면이 열립니다.` },
  { key: 'download', re: /(내려받기|다운로드|download|내보내기|export|저장하기)/i, text: (l) => `“${l}” 버튼으로 결과 파일을 내려받습니다.` },
  { key: 'copy', re: /(복사|copy|클립보드)/i, text: (l) => `“${l}” 버튼으로 결과를 클립보드에 복사합니다.` },
  { key: 'share', re: /(공유|share)/i, text: (l) => `“${l}” 버튼으로 결과를 공유합니다.` },
  { key: 'help', re: /(도움말|사용법|help|설명)/i, text: (l) => `“${l}” 버튼으로 사용법을 확인합니다.` },
  { key: 'settings', re: /(설정|옵션|settings|option|config)/i, text: (l) => `“${l}” 버튼으로 세부 옵션을 엽니다.` },
  { key: 'open', re: /(불러오기|업로드|가져오기|열기|open|load|import)/i, text: (l) => `“${l}” 버튼으로 파일을 불러옵니다.` },
  { key: 'edit', re: /(수정|편집|edit|update|고치)/i, text: (l) => `“${l}” 버튼으로 내용을 고칩니다.` },
  { key: 'delete', re: /(삭제|지우|제거|delete|remove)/i, text: (l) => `“${l}” 버튼으로 해당 항목을 지웁니다.` },
  { key: 'add', re: /(추가|등록|만들기|새로|add|new|create)/i, text: (l) => `“${l}” 버튼으로 항목을 새로 만듭니다.` },
  { key: 'save', re: /(저장|save|적용|apply)/i, text: (l) => `“${l}” 버튼으로 현재 내용을 저장합니다.` },
];

function buttonStep(label) {
  const text = collapse(label);
  if (!text) return '버튼을 누릅니다.';
  const hint = BUTTON_HINTS.find((h) => h.re.test(text));
  return hint ? hint.text(text) : `“${text}” 버튼을 누릅니다.`;
}

function buttonHintKey(label) {
  const text = collapse(label);
  const hint = BUTTON_HINTS.find((h) => h.re.test(text));
  return hint ? hint.key : `label:${text}`;
}

/** One step per distinct button intent, so "게임 시작"/"새 게임" don't repeat. */
function extraButtonSteps(buttons) {
  const seen = new Set();
  const out = [];
  for (const b of buttons) {
    const key = buttonHintKey(b.label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(buttonStep(b.label));
    if (out.length >= 5) break;
  }
  return out;
}

const FILL_TYPES = new Set([
  'text', 'number', 'search', 'email', 'password', 'tel', 'url',
  'date', 'datetime-local', 'month', 'week', 'time', 'textarea',
]);
const CHOOSE_TYPES = new Set(['select', 'radio', 'checkbox']);

function inputsPhrase(inputs) {
  const names = (arr) => arr.map((c) => `“${c.label || c.type}”`).join(', ');
  const fill = inputs.filter((c) => FILL_TYPES.has(c.type));
  const choose = inputs.filter((c) => CHOOSE_TYPES.has(c.type));
  const parts = [];
  if (fill.length) {
    const n = names(fill);
    parts.push(`${n} ${josa(n, '을', '를')} 입력하고`);
  }
  if (choose.length) {
    const n = names(choose);
    const fromOptions = choose.every((c) => !c.explicit);
    parts.push(fromOptions ? `${n} 중에서 고르고` : `${n} ${josa(n, '을', '를')} 고르고`);
  }
  if (!parts.length) return '';
  return `${parts.join(' ')} `;
}

// --------------------------------------------------------------- extraction

function collectControls($) {
  const controls = [];
  const seen = new Set();
  $('button, input, select, textarea, [contenteditable="true"], [role="button"]').each((_, el) => {
    const $el = $(el);
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input') {
      const type = ($el.attr('type') || 'text').toLowerCase();
      if (type === 'hidden') return;
    }
    const type = tag === 'input' ? ($el.attr('type') || 'text').toLowerCase() : tag;
    const { label, explicit } = labelFor($, el);
    const trimmed = trimTo(label, 40);
    const key = `${tag}:${type}:${trimmed}`;
    if (seen.has(key)) return;
    seen.add(key);
    const formIndex = $el.closest('form').length ? $('form').index($el.closest('form')) : -1;
    controls.push({ tag, type, label: trimmed, explicit, formIndex });
  });
  return controls.slice(0, 40);
}

function collectShortcuts(scriptText, $) {
  const found = new Set();
  const patterns = [
    /key\s*===?\s*['"]([^'"]{1,20})['"]/gi,
    /code\s*===?\s*['"](?:Key|Digit|Numpad)?([^'"]{1,20})['"]/gi,
    /addEventListener\(\s*['"]key(?:down|up|press)['"]/gi,
  ];
  for (const re of patterns) {
    for (const m of scriptText.matchAll(re)) found.add(m[1] || '키보드');
  }
  $('[accesskey]').each((_, el) => {
    const k = $(el).attr('accesskey');
    if (k) found.add(k);
  });
  const named = {
    Escape: 'Esc',
    Enter: 'Enter',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ' ': 'Space',
  };
  return unique([...found].map((k) => named[k] || (k === '키보드' ? '' : k))).slice(0, 6);
}

function collectFeatures(scriptText, htmlText, $) {
  const has = (re, target = scriptText) => re.test(target);
  const features = [];
  if (has(/addEventListener\(\s*['"]key(down|up)/i) || $('[accesskey]').length) features.push('키보드 조작');
  if (has(/['"](dragover|dragstart|drop)['"]/i)) features.push('드래그 앤 드롭');
  if (has(/addEventListener\(\s*['"]paste/i)) features.push('붙여넣기');
  if (has(/@media\s+print|window\.print\(/i, htmlText)) features.push('인쇄');
  if (has(/prefers-color-scheme/i, htmlText)) features.push('다크 모드');
  if (has(/@media[^{]*max-width/i, htmlText) || $('meta[name="viewport"]').length) features.push('모바일 대응');
  if ($('canvas').length || has(/(getContext\(|requestAnimationFrame)/i)) features.push('캔버스 렌더링');
  if ($('svg').length) features.push('SVG 그래픽');
  if ($('table').length) features.push('표');
  if (has(/(navigator\.geolocation)/i)) features.push('위치 정보');
  if (has(/(getUserMedia|mediaDevices)/i)) features.push('카메라/마이크');
  if (has(/(new\s+AudioContext|SpeechSynthesis|new\s+Audio\()/i)) features.push('소리 재생');
  if (has(/(new\s+WebSocket)/i)) features.push('실시간 통신');
  if (has(/(new\s+Worker|serviceWorker)/i)) features.push('백그라운드 처리');
  if (has(/(requestFullscreen)/i)) features.push('전체화면');
  if (has(/(clipboard\.writeText|execCommand\(\s*['"]copy)/i)) features.push('클립보드 복사');
  if (has(/(createObjectURL|new\s+Blob\([^)]*\)[\s\S]{0,80}download)/i)) features.push('파일 내려받기');
  return unique(features);
}

function detectCategory(haystack) {
  let best = null;
  for (const cat of CATEGORIES) {
    let score = 0;
    for (const re of cat.patterns) {
      const matches = haystack.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
      if (matches) score += Math.min(matches.length, 4);
    }
    if (score > 0 && (!best || score > best.score)) best = { cat, score };
  }
  return best ? best.cat : null;
}

function collectAbsolutePaths($) {
  const hits = new Set();
  $('[href], [src], [action]').each((_, el) => {
    const $el = $(el);
    for (const attr of ['href', 'src', 'action']) {
      const v = $el.attr(attr);
      if (!v || typeof v !== 'string') continue;
      if (!v.startsWith('/') || v.startsWith('//')) continue;
      if (v.startsWith('/apps/') || v === '/') continue;
      hits.add(v.split(/[?#]/)[0]);
    }
  });
  return [...hits].slice(0, 10);
}

function collectExternal($, styleText = '') {
  const hits = new Set();
  const add = (v) => {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) hits.add(v.replace(/[)"'\s]+$/, ''));
  };
  $('[src], [href]').each((_, el) => {
    const $el = $(el);
    for (const attr of ['src', 'href']) add($el.attr(attr));
  });
  // CSS(@import, @font-face url(...), background: url(...)) 안의 외부 주소도 인터넷이 필요합니다
  for (const m of String(styleText).matchAll(/url\(\s*['"]?(https?:\/\/[^)'"\s]+)/gi)) add(m[1]);
  for (const m of String(styleText).matchAll(/@import\s+(?:url\()?\s*['"]?(https?:\/\/[^)'"\s;]+)/gi)) add(m[1]);
  return [...hits];
}

// ------------------------------------------------------------------- analyze

function analyzeHtml(html, meta = {}) {
  const $ = cheerio.load(html);
  const head = $('head').html() || '';
  const body = $('body').clone();
  const scriptText = $('script').map((_, el) => $(el).html() || '').get().join('\n');
  const styleText = $('style').map((_, el) => $(el).html() || '').get().join('\n');
  const cssText = `${styleText}\n${head}`;
  const innerText = collapse(body.find('script, style, template, noscript').remove().end().text() || $('body').text());

  const title = collapse($('title').first().text());
  const h1 = collapse($('h1').first().text());
  const headings = $('h1, h2, h3')
    .map((_, el) => trimTo($(el).text(), 60))
    .get()
    .filter(Boolean)
    .slice(0, 12);
  const metaDescription = collapse(
    $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      ''
  );

  const controls = collectControls($);
  const libraries = unique(
    LIBRARIES.filter(([re]) => re.test(html)).map(([, name]) => name)
  );
  const externalResources = collectExternal($, `${styleText}\n${cssText}`);
  const absolutePaths = collectAbsolutePaths($);
  const features = collectFeatures(scriptText, `${html}`, $);
  const shortcuts = collectShortcuts(scriptText, $);

  const storage = [];
  if (/localStorage/i.test(scriptText)) storage.push('localStorage');
  if (/sessionStorage/i.test(scriptText)) storage.push('sessionStorage');
  if (/indexedDB/i.test(scriptText)) storage.push('indexedDB');

  const network = [];
  if (/\bfetch\s*\(|XMLHttpRequest|axios/i.test(scriptText)) network.push('네트워크 요청');

  const haystack = [
    title,
    h1,
    metaDescription,
    headings.join(' '),
    innerText,
    controls.map((c) => c.label).join(' '),
    scriptText,
  ]
    .join(' ')
    .toLowerCase();

  const category = detectCategory(haystack);

  // ---- name & icon
  const fileBase = meta.fileName ? path.basename(meta.fileName, path.extname(meta.fileName)) : '';
  const name = shortName(title) || shortName(h1) || shortName(fileBase) || '새 앱';
  const icon = findEmoji(title, h1, fileBase) || (category ? category.icon : '📦');
  // 화면에 보이는 글(제목·설명·라벨)을 우선해 분류합니다. 코드에 섞인 라이브러리 이름은 가중치를 낮춥니다.
  const siteCategory = classifyCategory(
    {
      primary: [name, title, h1, metaDescription, headings.join(' '), controls.map((c) => c.label).join(' ')].join(' '),
      secondary: `${innerText.slice(0, 6000)} ${scriptText.slice(0, 4000)}`,
    },
    { hint: category ? category.key : null, name }
  );
  const slug = suggestSlug({ name, category: category ? category.key : '', fileName: meta.fileName });

  // ---- description
  let desc = trimTo(metaDescription, 300);
  if (!desc) {
    const paragraphs = $('p')
      .map((_, el) => collapse($(el).text()))
      .get()
      .filter((t) => t.length >= 25 && t.length <= 220);
    if (paragraphs.length) desc = trimTo(paragraphs[0], 300);
  }
  if (!desc) {
    const bits = [];
    if (category) bits.push(`${category.what}입니다.`);
    else bits.push(`${headings[0] || '단일 화면'} 중심으로 구성된 웹앱입니다.`);
    if (category?.key === 'game' && storage.length) {
      bits.push('최고 점수나 진행 상황이 브라우저에 저장됩니다.');
    } else if (storage.length) {
      bits.push('입력한 내용은 브라우저에 저장되어 다시 열어도 유지됩니다.');
    }
    if (!category && controls.length) bits.push(`화면에 ${controls.length}개의 조작 요소가 있습니다.`);
    if (network.length) bits.push('일부 기능은 인터넷 연결이 필요합니다.');
    desc = trimTo(bits.join(' '), 300);
  }

  // ---- tags
  const tags = [];
  if (category) tags.push(category.label);
  if (storage.length) tags.push('저장형');
  if (controls.some((c) => c.tag === 'input' && ['text', 'number', 'search', 'email'].includes(c.type))) tags.push('입력형');
  if (controls.some((c) => c.type === 'checkbox' || c.type === 'radio')) tags.push('선택형');
  if (controls.some((c) => c.type === 'file')) tags.push('파일');
  if (features.includes('캔버스 렌더링')) tags.push('캔버스');
  if (features.includes('인쇄')) tags.push('인쇄');
  if (features.includes('키보드 조작')) tags.push('키보드');
  if (features.includes('다크 모드')) tags.push('다크');
  if (features.includes('파일 내려받기')) tags.push('내보내기');
  if (network.length || externalResources.length) tags.push('온라인');
  if (!externalResources.length) tags.push('오프라인');
  if (!$('link[rel="stylesheet"][href^="http"]').length && !$('script[src^="http"]').length) tags.push('단일파일');
  if ($('table').length) tags.push('표');
  if (libraries.length) tags.push(libraries[0]);
  const finalTags = unique(tags).slice(0, 8);

  // ---- howto
  const steps = [];
  const noteLines = [];

  const forms = $('form');
  const controlsByForm = new Map();
  for (const c of controls) {
    if (c.formIndex < 0) continue;
    if (!controlsByForm.has(c.formIndex)) controlsByForm.set(c.formIndex, []);
    controlsByForm.get(c.formIndex).push(c);
  }

  const standalone = controls.filter((c) => c.formIndex < 0);

  controlsByForm.forEach((group, idx) => {
    const inputs = group.filter((c) => c.tag !== 'button');
    const btns = group.filter((c) => c.tag === 'button');
    const formName = trimTo($(forms.get(idx)).find('h1,h2,h3').first().text() || '', 30);
    const named = inputs.filter((c) => FILL_TYPES.has(c.type) || CHOOSE_TYPES.has(c.type));
    if (named.length && btns.length) {
      const phrase = inputsPhrase(named);
      steps.push(
        formName
          ? `“${formName}” 에서 ${phrase}“${btns[0].label || '실행'}” 버튼을 누릅니다.`
          : `${phrase}“${btns[0].label || '실행'}” 버튼을 누릅니다.`
      );
      steps.push(...extraButtonSteps(btns.slice(1)));
    } else if (inputs.length) {
      steps.push(inputs.map((c) => describeControl(c.tag, c.type, c.label)).join(' '));
      steps.push(...extraButtonSteps(btns));
    } else if (btns.length) {
      steps.push(...extraButtonSteps(btns));
    }
  });

  // Controls that the app builds at runtime (innerHTML templates, createElement)
  // are invisible to the parser, so hint at them from the script source.
  const renders = /innerHTML|insertAdjacentHTML|appendChild|\.map\([\s\S]{0,300}createElement/.test(scriptText);
  const dynamicCheckbox = /type\s*=\s*["'`]checkbox|createElement\(\s*["'`]input["'`]\)[\s\S]{0,120}checkbox/i.test(scriptText);
  const dynamicRemove = /(splice|filter)\s*\([\s\S]{0,120}(delete|remove|del|trash|삭제)|remove(Item|Row|Todo|Task)|delete(Item|Row|Todo|Task)/i.test(scriptText);

  const standaloneButtons = standalone.filter((c) => c.tag === 'button');
  steps.push(...extraButtonSteps(standaloneButtons));
  for (const c of standalone.filter((c) => c.tag !== 'button').slice(0, 6)) {
    steps.push(describeControl(c.tag, c.type, c.label));
  }

  if (dynamicCheckbox && !controls.some((c) => c.type === 'checkbox')) {
    steps.push('목록에 생기는 각 항목의 체크박스를 눌러 완료 상태로 바꿉니다.');
  }
  if (dynamicRemove) {
    steps.push('항목의 삭제(×) 버튼을 누르면 그 항목만 지워집니다.');
  }
  if ($('canvas').length && !steps.length) {
    steps.push('화면의 캔버스 영역을 마우스나 손가락으로 조작합니다.');
  }
  if (!steps.length) {
    steps.push('별도의 입력 없이 화면을 보고 스크롤하며 사용합니다.');
  }
  if ((category?.key === 'game' || $('canvas').length) && shortcuts.some((s) => ['←', '↑', '↓', '→', 'Space'].includes(s))) {
    steps.push('키보드의 방향키(← ↑ ↓ →)로 조작하고, Space 로 시작하거나 일시정지합니다.');
  }

  if (storage.includes('localStorage')) {
    noteLines.push(
      category?.key === 'game' || category?.key === 'quiz'
        ? '기록(점수·진행 상황)은 이 브라우저에 자동 저장됩니다. 브라우저 데이터를 지우면 함께 사라집니다.'
        : '입력한 내용은 이 브라우저에 자동 저장됩니다. 브라우저 데이터를 지우면 함께 사라집니다.'
    );
  }
  if (storage.includes('sessionStorage')) noteLines.push('입력한 내용은 탭을 닫을 때까지 임시로 유지됩니다.');
  if (storage.includes('indexedDB')) noteLines.push('큰 데이터는 브라우저의 indexedDB에 저장됩니다.');
  if (shortcuts.length) noteLines.push(`키보드 단축키: ${shortcuts.join(', ')}`);
  if (renders) noteLines.push('입력한 내용에 따라 목록이나 결과 영역이 그때그때 다시 그려집니다.');
  if (category?.key === 'game') noteLines.push('화면을 한 번 클릭한 뒤 키보드로 조작하면 키 입력이 잘 전달됩니다.');
  if (features.includes('인쇄')) noteLines.push('인쇄 버튼이나 브라우저 인쇄(Ctrl/Cmd+P)로 종이에 출력할 수 있습니다.');
  if (features.includes('파일 내려받기')) noteLines.push('내려받기를 실행하면 브라우저의 다운로드 폴더에 저장됩니다.');
  if (libraries.length) noteLines.push(`사용 라이브러리: ${libraries.join(', ')}`);
  if (externalResources.length) noteLines.push(`외부 리소스 ${externalResources.length}개를 불러옵니다. 인터넷이 없으면 일부 화면이 비어 보일 수 있습니다.`);

  const howto = [numbered(steps), noteLines.length ? `\n참고\n- ${noteLines.join('\n- ')}` : '']
    .filter(Boolean)
    .join('\n');

  // ---- warnings
  const warnings = [];
  if (absolutePaths.length) {
    warnings.push(`앱 폴더 밖을 가리키는 루트 경로가 있습니다: ${absolutePaths.join(', ')} — 단독 실행 시 깨질 수 있습니다.`);
  }
  const externals = externalResources.filter((u) => /^https?:\/\//i.test(u));
  if (externals.length) warnings.push(`외부 리소스 ${externals.length}개(인터넷 필요): ${externals.slice(0, 3).join(', ')}${externals.length > 3 ? ' …' : ''}`);
  if ($('form[action]').filter((_, el) => {
    const a = ($(el).attr('action') || '').trim();
    return a && !a.startsWith('#');
  }).length) {
    warnings.push('서버로 전송하는 <form action> 이 있습니다. 정적 호스팅에서는 전송이 동작하지 않을 수 있습니다.');
  }
  if (/document\.write\s*\(/.test(scriptText)) warnings.push('document.write 사용이 감지되었습니다.');
  if (meta.bytes && meta.bytes > 800 * 1024) warnings.push(`파일이 ${(meta.bytes / 1024 / 1024).toFixed(1)}MB 로 큽니다. 로딩이 느릴 수 있습니다.`);
  if (!/viewport/i.test(head) && !$('meta[name="viewport"]').length) warnings.push('viewport 메타 태그가 없어 모바일에서 화면이 넓게 보일 수 있습니다.');
  if (network.length && !externals.length) warnings.push('코드에 네트워크 요청이 있습니다. 서버 주소가 없으면 실패할 수 있습니다.');

  return {
    source: {
      file: meta.fileName || null,
      bytes: meta.bytes || Buffer.byteLength(html, 'utf8'),
      lang: ($('html').attr('lang') || '').slice(0, 10) || null,
      title: title || null,
      h1: h1 || null,
    },
    guess: {
      name,
      icon,
      slug,
      kind: category ? category.key : '',
      siteCategory,
      desc,
      tags: finalTags,
      howto,
    },
    details: {
      kind: category ? category.key : null,
      category: category ? category.label : null,
      siteCategory,
      headings,
      metaDescription: metaDescription || null,
      controls: controls.map((c) => ({ tag: c.tag, type: c.type, label: c.label })),
      features,
      libraries,
      storage,
      shortcuts,
      forms: forms.length,
      externalResources,
      absolutePaths,
      inlineTextChars: innerText.length,
      scriptChars: scriptText.length,
      styleChars: cssText.length,
    },
    warnings,
  };
}

function pickHtmlFromZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw fail(400, 'zip 파일을 읽을 수 없습니다');
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) throw fail(400, '압축 파일이 비어 있습니다');
  const byName = (re) => entries.filter((e) => re.test(e.entryName.replace(/\\/g, '/')));
  const candidates = byName(/(^|\/)index\.html?$/i).length ? byName(/(^|\/)index\.html?$/i) : byName(/\.html?$/i);
  if (!candidates.length) throw fail(400, '압축 안에 html 파일이 없습니다');
  candidates.sort((a, b) => a.entryName.split('/').length - b.entryName.split('/').length);
  const chosen = candidates[0];
  const data = chosen.getData();
  if (data.length > 5 * 1024 * 1024) throw fail(400, 'html 파일이 5MB 를 넘어 분석할 수 없습니다');
  return { html: data.toString('utf8'), entry: chosen.entryName };
}

function analyzeBuffer(buffer, fileName = '') {
  if (!buffer || !buffer.length) throw fail(400, '분석할 파일이 없습니다');
  // Trust the zip magic number, not the file name: callers may hand us the
  // extracted index.html while still passing the original "*.zip" label.
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip) {
    const { html, entry } = pickHtmlFromZip(buffer);
    return analyzeHtml(html, { fileName, bytes: buffer.length, entry });
  }
  if (buffer.length > 5 * 1024 * 1024) throw fail(400, 'html 파일이 5MB 를 넘어 분석할 수 없습니다');
  return analyzeHtml(buffer.toString('utf8'), { fileName, bytes: buffer.length });
}

module.exports = {
  analyzeHtml,
  analyzeBuffer,
  pickHtmlFromZip,
  CATEGORIES,
  CATEGORY_SLUGS,
  suggestSlug,
  isNoisySlug,
  shortName,
  slugifyLoose,
  romanizeHangul,
};
