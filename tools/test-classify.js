#!/usr/bin/env node
'use strict';
// 카테고리 자동 분류 정확도 확인 (실제 앱 + 합성 예시)

const fs = require('fs');
const path = require('path');
const { classifyCategory } = require('../src/categories');
const analyze = require('../src/analyze');

const ROOT = path.join(__dirname, '..');
const apps = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/apps.json'), 'utf8'));

const expect = {
  'neibeo-syopingkeonek': 'content',
  'neibeo-yeohaeng': 'content',
  'ffmpeg-emotion': 'content',
  seumateu: 'business',
  'ai-nyuseu-syocheu': 'content',
};

let pass = 0;
let fail = 0;
console.log('■ 실제 등록된 앱');
for (const app of apps) {
  const file = path.join(ROOT, 'apps', app.id, 'index.html');
  if (!fs.existsSync(file)) continue;
  const result = analyze.analyzeBuffer(fs.readFileSync(file), `${app.id}.html`);
  const slug = result.guess.siteCategory;
  const want = expect[app.id];
  const ok = !want || want === slug;
  console.log(`  ${ok ? '✓' : '✗'} ${app.name.padEnd(26)} → ${slug}${want && !ok ? ` (기대: ${want})` : ''}`);
  ok ? (pass += 1) : (fail += 1);
}

const samples = [
  ['대출 이자 계산기', '원금과 금리를 입력하면 월 상환액과 총 이자를 계산합니다.', 'finance'],
  ['할 일 목록', '오늘 할 일을 추가하고 체크합니다. 습관처럼 매일 씁니다.', 'life'],
  ['영수증 정리', '영수증 사진을 올리면 금액과 날짜를 뽑아 표로 정리합니다.', 'business'],
  ['이미지 압축기', '사진 여러 장을 한 번에 압축하고 리사이즈합니다.', 'media'],
  ['글자 수 세기', '문장을 붙여넣으면 글자수와 공백 제거, 대소문자 변환을 합니다.', 'text'],
  ['영단어 퀴즈', '단어장을 만들고 퀴즈로 암기합니다. 오답 노트도 저장됩니다.', 'study'],
  ['JSON 변환기', 'JSON과 YAML을 서로 변환하고 포맷을 정리합니다.', 'data'],
  ['테트리스', '점수와 레벨이 있는 퍼즐 게임입니다.', 'game'],
  ['가계부', '수입과 지출을 기록하고 월 예산을 확인합니다.', 'finance'],
  ['회의록 표 만들기', '회의 내용을 표로 정리하고 엑셀(csv)로 내보냅니다.', 'document'],
  ['쇼츠 대본 생성기', '주제를 넣으면 30초 쇼츠 대본을 만들어 줍니다.', 'content'],
  ['여행 콘텐츠 원고', '여행 상품 이미지를 올리면 홍보 원고를 만듭니다.', 'content'],
  ['재고 확인표', '거래처별 재고 수량을 표로 관리합니다.', 'business'],
  ['색상 변환기', 'RGB와 HEX 색상 코드를 변환합니다.', 'data'],
  ['메트로놈', '박자를 맞춰 주는 소리 도구입니다.', 'media'],
];

console.log('\n■ 합성 예시');
for (const [name, desc, want] of samples) {
  const slug = classifyCategory(`${name} ${desc}`, { name });
  const ok = slug === want;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(18)} → ${slug.padEnd(10)}${ok ? '' : ` (기대: ${want})`}`);
  ok ? (pass += 1) : (fail += 1);
}

console.log(`\n정확도: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
