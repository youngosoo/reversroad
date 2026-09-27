'use strict';

/**
 * 앱 카테고리(분야).
 *
 * - 앱 하나는 카테고리 하나에 속합니다(자동 분류 + 필요하면 관리자 화면에서 변경).
 * - 태그(tags)는 "저장형·인쇄·키보드" 같은 기능 특성이고, 카테고리는 "무엇을 하는 앱인지"입니다.
 * - 분류는 파일 내용(제목·설명·화면 라벨·스크립트)에서 키워드 점수로 결정합니다.
 */

const CATEGORIES = [
  {
    slug: 'content',
    label: '콘텐츠 제작',
    icon: '🎬',
    blurb: '영상·대본·문구처럼 만들어서 쓰는 결과물을 다루는 앱입니다.',
    intro: [
      '콘텐츠 제작 앱은 상품·여행·뉴스처럼 원본 자료를 바탕으로 영상, 대본, 홍보 문구를 만듭니다. 대부분 AI 서비스(Google AI Studio 등)를 함께 사용하기 때문에 인터넷 연결과 API 키가 필요합니다.',
      '만들어진 결과는 초안입니다. 게시하기 전에 사실 관계를 확인하고, 인용한 자료의 출처를 표기해 주세요.',
      '콘텐츠 제작 앱은 결과물을 그대로 올리기보다 초안으로 쓰는 편이 좋습니다. 문장을 다듬고, 숫자와 고유명사를 확인하고, 우리 브랜드의 말투로 한 번 더 고치는 과정을 거치면 완성도가 크게 올라갑니다.',
    ],
    keywords: [
      ['쇼츠', 4], ['숏폼', 4], ['릴스', 3], ['대본', 4], ['원고', 3], ['문구', 3], ['카피', 3],
      ['콘텐츠 생성', 4], ['영상 생성', 4], ['자막', 3], ['썸네일', 2], ['텔레프롬프터', 4],
      ['유튜브', 3], ['인스타', 2], ['블로그 글', 3], ['상세페이지', 2], ['홍보 문구', 3],
      ['생성기', 3], ['제작', 3], ['만들기', 2], ['슬라이드 영상', 4], ['모션', 3], ['배경음악', 3],
      ['script', 2], ['caption', 2], ['video generator', 4], ['content', 1], ['storyboard', 3],
    ],
  },
  {
    slug: 'business',
    label: '업무·비즈니스',
    icon: '💼',
    blurb: '영수증·정산·재고처럼 일하는 과정에서 쓰는 앱입니다.',
    intro: [
      '업무용 앱은 반복되는 기록과 정리를 대신합니다. 영수증 정리, 거래 내역 정산, 재고 확인처럼 매달 되풀이되는 일에 특히 잘 맞습니다.',
      '자동 분석 결과는 참고용입니다. 금액과 날짜는 원본과 대조한 뒤 사용하세요.',
      '업무 앱을 쓸 때는 기준일을 먼저 정하는 것이 좋습니다. 정산은 월 단위로 끊어야 비교가 되고, 같은 달을 두 번 정리하는 일이 줄어듭니다.',
    ],
    keywords: [
      ['영수증', 6], ['영수증 분석', 6], ['정산', 5], ['매출', 4], ['주문', 4], ['재고', 5], ['거래명세', 5],
      ['부가세 신고', 5], ['지출 결의', 5], ['경비', 4], ['사업자', 3], ['일괄 분석', 3],
      ['세금계산서', 4], ['급여', 3], ['견적서', 3], ['업무', 2], ['거래처', 3], ['명함', 3],
      ['invoice', 3], ['receipt', 3], ['expense', 3], ['inventory', 3], ['payroll', 3],
    ],
  },
  {
    slug: 'finance',
    label: '금융·계산',
    icon: '🧮',
    blurb: '이자·세금·예산처럼 숫자를 계산해 판단을 돕는 앱입니다.',
    intro: [
      '금융·계산 앱은 입력한 값으로 결과를 바로 보여 줍니다. 대출 이자, 부가세, 할인가, 예산처럼 숫자가 얽힌 일을 빠르게 정리할 때 씁니다.',
      '금액이 걸린 계산은 참고용입니다. 계약·신고처럼 중요한 결정에는 공식 자료나 전문가의 확인을 거치세요.',
      '같은 계산이라도 무엇을 변수로 두느냐에 따라 결과가 달라집니다. 금리를 연으로 볼지 월로 볼지, 세금을 포함할지 먼저 정하고 입력하세요.',
    ],
    keywords: [
      ['이자', 4], ['대출', 4], ['원리금', 4], ['예금', 3], ['적금', 3], ['환율', 4], ['주식', 3],
      ['수익률', 4], ['부가세', 4], ['세금', 3], ['가계부', 4], ['예산', 3], ['견적', 2],
      ['할인', 2], ['평균', 1], ['계산기', 4], ['interest', 3], ['loan', 3], ['tax', 3], ['budget', 3],
    ],
  },
  {
    slug: 'document',
    label: '문서·표',
    icon: '📋',
    blurb: '표·목록·문서를 정리하고 파일로 내보내는 앱입니다.',
    intro: [
      '문서·표 앱은 흩어진 정보를 표로 모으고, 필요하면 엑셀·CSV·PDF로 내보냅니다. 회의 기록, 명단, 재고표처럼 칸을 맞춰 정리하는 일에 씁니다.',
      '내보낸 파일은 브라우저의 다운로드 폴더에 저장됩니다. 중요한 자료는 백업을 따로 두세요.',
      '표는 칸을 먼저 정하고 채우는 편이 빠릅니다. 어떤 항목이 꼭 필요한지 정한 뒤 앱에 넣으면 나중에 정리하는 시간이 줄어듭니다.',
    ],
    keywords: [
      ['표 만들기', 4], ['테이블', 3], ['명단', 4], ['목록 관리', 3], ['회의록', 3], ['일정표', 3],
      ['엑셀', 3], ['csv', 3], ['xlsx', 3], ['pdf', 2], ['docx', 3], ['markdown', 3], ['체크리스트', 2],
      ['spreadsheet', 3], ['inventory', 2], ['database', 2], ['table', 2],
    ],
  },
  {
    slug: 'media',
    label: '이미지·영상',
    icon: '🖼️',
    blurb: '사진과 영상을 다듬고 변환하는 앱입니다.',
    intro: [
      '이미지·영상 앱은 파일을 올려 자르고, 줄이고, 형식을 바꿉니다. 대부분 처리가 브라우저 안에서 끝나서 사진이 서버로 전송되지 않습니다.',
      '영상 변환처럼 연산이 많은 작업은 기기 성능에 따라 시간이 걸릴 수 있습니다.',
      '파일을 다루는 앱은 원본을 보관해 두는 것이 중요합니다. 압축·변환한 파일만 남겨 두면 나중에 더 좋은 화질이 필요할 때 되돌릴 수 없습니다.',
    ],
    keywords: [
      ['리사이즈', 5], ['크기 조절', 4], ['압축', 4], ['배경 제거', 5], ['자르기', 4], ['회전', 3],
      ['필터', 3], ['갤러리', 4], ['슬라이드 쇼', 4], ['메트로놈', 5], ['박자', 4], ['음악', 3], ['소리', 3],
      ['사운드', 4], ['피아노', 4], ['오디오', 3], ['이미지 뷰어', 4], ['업스케일', 4],
      ['이미지', 1], ['사진', 1], ['mp4', 2], ['mp3', 2], ['wav', 2], ['gif', 2], ['webp', 2],
      ['image', 1], ['photo', 1], ['resize', 3], ['compress', 3], ['crop', 3], ['convert video', 3],
    ],
  },
  {
    slug: 'text',
    label: '텍스트 도구',
    icon: '🔤',
    blurb: '글자를 세고, 바꾸고, 비교하는 앱입니다.',
    intro: [
      '텍스트 도구는 문장을 복사해 넣으면 즉시 결과를 보여 줍니다. 글자 수 세기, 대소문자 바꾸기, 줄 정렬, 중복 줄 제거처럼 문서를 다듬는 일에 씁니다.',
      '개인정보가 담긴 문장을 붙여넣을 때는 화면 공유나 캡처에 주의하세요.',
      '텍스트 도구는 원문을 지우지 말고 복사본으로 작업하세요. 바꾼 결과가 마음에 안 들면 원문으로 되돌리는 것이 가장 빠릅니다.',
    ],
    keywords: [
      ['글자 수', 4], ['글자수', 4], ['줄바꿈', 3], ['대소문자', 4], ['공백 제거', 3], ['중복 제거', 3],
      ['정규식', 4], ['치환', 3], ['비교', 2], ['diff', 3], ['base64', 3], ['암호화', 2], ['해시', 3],
      ['text', 2], ['word count', 3], ['regex', 3], ['sort lines', 3],
    ],
  },
  {
    slug: 'study',
    label: '학습·퀴즈',
    icon: '📚',
    blurb: '외우고 확인하는 학습용 앱입니다.',
    intro: [
      '학습 앱은 문제를 내고 채점하거나, 카드로 반복 암기를 돕습니다. 시험 준비나 자격증 공부처럼 같은 내용을 여러 번 봐야 할 때 효과적입니다.',
      '학습 기록은 브라우저에 저장되므로 기기를 바꾸면 이어지지 않습니다.',
      '짧게 자주 보는 것이 오래 보는 것보다 낫습니다. 하루 10분씩 며칠을 반복하는 편이 한 번에 몰아 보는 것보다 기억에 오래 남습니다.',
    ],
    keywords: [
      ['퀴즈', 4], ['문제', 3], ['정답', 3], ['단어장', 4], ['암기', 4], ['플래시카드', 4],
      ['시험', 3], ['학습', 3], ['받아쓰기', 3], ['오답', 4], ['quiz', 3], ['flashcard', 4], ['vocab', 3], ['study', 2],
    ],
  },
  {
    slug: 'life',
    label: '생활·기록',
    icon: '🏠',
    blurb: '할 일, 습관, 시간처럼 매일 쓰는 생활 도구입니다.',
    intro: [
      '생활 앱은 하루 루틴을 가볍게 관리합니다. 할 일 목록, 습관 체크, 타이머, 메모처럼 짧게 자주 쓰는 도구가 많습니다.',
      '입력한 내용은 브라우저에만 저장됩니다. 오래 남길 기록은 내보내기로 백업해 두세요.',
      '생활 도구는 처음부터 완벽하게 만들려 하지 않는 편이 오래갑니다. 항목 몇 개로 시작해 며칠 써 보고, 불편한 부분만 고치세요.',
    ],
    keywords: [
      ['할 일', 4], ['할일', 4], ['todo', 4], ['체크', 2], ['습관', 4], ['루틴', 3], ['타이머', 4],
      ['스톱워치', 4], ['뽀모도로', 4], ['알람', 3], ['메모', 3], ['일기', 4], ['달력', 3], ['디데이', 4],
      ['요리', 3], ['레시피', 4], ['칼로리', 4], ['운동', 3], ['건강', 3], ['기념일', 3],
      ['habit', 3], ['timer', 3], ['diary', 3], ['recipe', 3], ['d-day', 3],
    ],
  },
  {
    slug: 'data',
    label: '데이터·변환',
    icon: '🔄',
    blurb: '단위·형식·코드를 바꾸고 만들어 주는 앱입니다.',
    intro: [
      '데이터·변환 앱은 값이나 형식을 다른 형태로 바꿉니다. 단위 환산, 날짜 계산, 색상 변환, JSON 정리처럼 개발·실무에서 자주 필요한 변환을 다룹니다.',
      '변환 결과는 입력값에 따라 달라집니다. 중요한 작업 전에는 소량으로 먼저 시험해 보세요.',
      '변환 결과가 이상하면 먼저 입력 형식을 의심하세요. 공백·줄바꿈·따옴표 하나 때문에 결과가 달라지는 경우가 많습니다.',
    ],
    keywords: [
      ['단위', 4], ['환산', 4], ['변환기', 4], ['인코딩', 3], ['디코딩', 3], ['포맷', 3], ['json', 4],
      ['yaml', 4], ['xml', 3], ['색상', 3], ['rgb', 3], ['hex', 3], ['난수', 3], ['uuid', 4],
      ['타임스탬프', 4], ['날짜 계산', 3], ['convert', 2], ['format', 2], ['encode', 2], ['unit', 2],
    ],
  },
  {
    slug: 'game',
    label: '게임·오락',
    icon: '🎮',
    blurb: '잠깐 쉬어 가며 즐기는 작은 게임입니다.',
    intro: [
      '게임 앱은 설치 없이 브라우저에서 바로 시작합니다. 점수와 진행 상황은 브라우저에 저장되어 다음에 이어서 즐길 수 있습니다.',
      '키보드 조작 게임은 화면을 한 번 클릭한 뒤 키를 눌러야 입력이 잘 전달됩니다.',
      '게임은 기록이 남을 때 더 재미있습니다. 점수와 진행 상황은 브라우저에 저장되므로, 기록을 지우고 싶다면 브라우저의 사이트 데이터를 삭제하면 됩니다.',
    ],
    keywords: [
      ['게임', 4], ['점수', 3], ['레벨', 3], ['퍼즐', 4], ['테트리스', 4], ['스네이크', 4], ['지뢰찾기', 4],
      ['카드 게임', 4], ['game', 3], ['score', 2], ['puzzle', 3], ['arcade', 3],
    ],
  },
  {
    slug: 'etc',
    label: '기타 도구',
    icon: '📦',
    blurb: '위 분류에 딱 맞지 않는, 그래도 쓸모 있는 도구들입니다.',
    intro: [
      '한 가지 분야로 묶기 어려운 도구를 모아 두었습니다. 필요할 때 찾아 쓰기 좋게 사용법과 저장 방식을 함께 적어 두었습니다.',
      '도구를 쓰다 보면 “이런 기능이 있으면 좋겠다”는 지점이 보입니다. 그런 의견은 문의 페이지로 보내 주시면 다음 업데이트에 반영합니다.',
    ],
    keywords: [],
  },
];

const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));
const DEFAULT_SLUG = 'etc';

function getCategory(slug) {
  return BY_SLUG.get(String(slug || '').trim()) || null;
}

function isValidCategory(slug) {
  return BY_SLUG.has(String(slug || '').trim());
}

function listCategories() {
  return CATEGORIES.map((c) => ({ slug: c.slug, label: c.label, icon: c.icon, blurb: c.blurb }));
}

/**
 * 파일 내용에서 카테고리를 고릅니다.
 *
 * input: 문자열(전체 내용) 또는 { primary, secondary }
 *   - primary   : 사용자가 실제로 보는 글 (제목·설명·화면 라벨) — 2배 가중치
 *   - secondary : 본문·코드 (라이브러리 이름이 섞여 있어 가중치를 낮춤)
 * hint: analyze.js 가 판단한 앱 종류(예: 'calc', 'todo') — 보조 점수.
 */
function classifyCategory(input, { hint = null, name = '' } = {}) {
  const primary = typeof input === 'string' ? String(input) : String(input?.primary || '');
  const secondary = typeof input === 'string' ? '' : String(input?.secondary || '');
  const haystack = { primary: `${name} ${primary}`.toLowerCase(), secondary: secondary.toLowerCase() };
  const scores = new Map();
  for (const category of CATEGORIES) {
    let score = 0;
    for (const [keyword, weight] of category.keywords) {
      const needle = keyword.toLowerCase();
      if (!needle) continue;
      const inPrimary = haystack.primary.split(needle).length - 1;
      const inSecondary = haystack.secondary.split(needle).length - 1;
      if (!inPrimary && !inSecondary) continue;
      score += weight * (Math.min(inPrimary, 3) * 2 + Math.min(inSecondary, 3));
    }
    if (score > 0) scores.set(category.slug, score);
  }
  if (hint && HINT_MAP[hint]) {
    const slug = HINT_MAP[hint];
    scores.set(slug, (scores.get(slug) || 0) + 4);
  }
  let best = null;
  for (const [slug, score] of scores) {
    const order = CATEGORIES.findIndex((c) => c.slug === slug);
    if (!best || score > best.score || (score === best.score && order < best.order)) {
      best = { slug, score, order };
    }
  }
  if (!best || best.score < 3) return DEFAULT_SLUG;
  return best.slug;
}

/** analyze.js 의 앱 종류 → 카테고리 */
const HINT_MAP = {
  todo: 'life',
  memo: 'life',
  calc: 'finance',
  timer: 'life',
  clock: 'life',
  game: 'game',
  quiz: 'study',
  draw: 'media',
  chart: 'document',
  convert: 'data',
  gallery: 'media',
  music: 'media',
  text: 'text',
  table: 'document',
  lookup: 'data',
};

module.exports = {
  CATEGORIES,
  DEFAULT_SLUG,
  HINT_MAP,
  getCategory,
  isValidCategory,
  listCategories,
  classifyCategory,
};
