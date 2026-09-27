# myhome — 독립 웹앱을 모아 서비스하는 홈페이지

독립적으로 실행되는 HTML 웹앱을 `apps/<id>/` 폴더에 넣으면, 홈페이지가 그 목록을 소개하고
관리자 화면(`/admin.html`)에서 추가·수정·삭제할 수 있습니다. 각 앱은 홈페이지 없이도 단독 실행되고,
공개 페이지는 **검색엔진·광고 심사용으로 서버에서 HTML 을 완성해** 내려보냅니다.

```
myhome/
├─ server.js             # Express: 서버 렌더링 페이지 + REST API + OAuth 세션
├─ src/manifest.js       # apps.json 읽기/쓰기, 업로드(zip/html) 해제, 슬러그 검증
├─ src/analyze.js        # 업로드한 html/zip 을 읽어 이름·설명·태그·사용방법 생성
├─ src/auth.js           # 비밀번호·GitHub/Google OAuth 로그인 + 관리자 허용목록
├─ src/password.js       # 관리자 비밀번호(scrypt 해시) 저장·검증
├─ src/categories.js     # 앱 분야(카테고리) 정의 + 자동 분류기
├─ src/site.js           # 사이트 설정(이름·운영자·이메일·도메인·AdSense ID)
├─ src/seo.js            # robots.txt · sitemap.xml · ads.txt 생성
├─ src/assets.js         # 로고 등 정적 자산 경로 결정
├─ src/views/            # 공개 페이지 HTML 템플릿(레이아웃·카드·문서)
├─ src/content/          # 안내 글(가이드)과 정책 문구
├─ tools/analyze-dump.js # 분석기 단독 실행 도구 (디버깅용)
├─ tools/render-logo.js  # logo.svg → logo.png 렌더링
├─ tools/set-password.js # 관리자 비밀번호 설정/재설정 (서버용)
├─ tools/export-static.js# 공개 사이트 정적 빌드 (dist/)
├─ tools/audit.js        # 애드센스 관점 자동 점검
├─ tools/test-classify.js# 분야 자동 분류 정확도 확인
├─ tools/render-logo.js  # logo.svg → logo.png 렌더링
├─ data/apps.json        # 앱 매니페스트 (이 목록의 원본)
├─ data/site.json        # 사이트 설정 (관리자 화면에서 수정)
├─ data/admin.json       # 관리자 비밀번호 해시 (git 제외)
├─ public/               # 관리자·로그인 화면
│  └─ assets/            # style.css · theme.js · logo.png(원본 로고 자리) · logo.svg
├─ apps/<id>/index.html  # 각 웹앱 (진입점은 항상 index.html)
├─ uploads/              # 업로드 임시 작업 폴더 (비워 둠)
└─ .trash/               # 삭제된 앱 보관함
```

## 1. 설치 · 실행

```bash
npm install
cp .env.example .env      # 값 채우기
npm start                 # http://localhost:3000  /  관리자: /admin.html
```

개발 편의를 위해 이 저장소에는 `.env` 가 미리 만들어져 있습니다 (`ADMIN_LOGINS=*`, `ALLOW_DEV_LOGIN=1`).
이 상태에서는 OAuth 키 없이 `/login.html` 의 "개발 로그인" 으로 들어갈 수 있습니다.
**배포 전 반드시 `ALLOW_DEV_LOGIN=0`, `ADMIN_LOGINS=<본인 계정>` 으로 바꾸세요.**

## 2. 관리자 로그인

두 가지 방법을 쓸 수 있습니다. **비밀번호 로그인**이 가장 간단하고, OAuth 는 필요할 때 추가하면 됩니다.

### 2-1. 비밀번호 로그인 (기본)

- 관리자 화면(/admin.html) → **관리자 비밀번호**에서 설정·변경합니다. 변경할 때는 현재 비밀번호를 한 번 더 확인합니다.
- 평문은 어디에도 저장되지 않습니다. **scrypt 해시(+랜덤 salt)** 만 `data/admin.json` 에 남고, 이 파일은 `.gitignore` 로 제외되어 저장소에 올라가지 않습니다.
- 서버에서 직접 재설정하거나 최초 배포 때 설정하려면:

```bash
node tools/set-password.js '새비밀번호'   # 인자를 생략하면 물어보고 입력받습니다(화면에 표시 안 됨)
```

- 로그인은 `/login.html` 의 비밀번호 입력칸에서 합니다. 잘못된 시도가 10분에 8회를 넘으면 10분간 잠깁니다(IP 기준).
- 최초 부팅용 임시값으로만 `.env` 의 `ADMIN_PASSWORD` 를 쓸 수 있습니다. 한 번 설정한 뒤에는 비워 두세요.

### 2-2. OAuth 로그인 (선택)

`.env` 에 값을 채우면 `/login.html` 에 해당 버튼이 나타납니다.

**GitHub** — https://github.com/settings/developers → New OAuth App
- Homepage URL: `http://localhost:3000` (배포 시 실제 도메인)
- Authorization callback URL: `http://localhost:3000/auth/github/callback`
- 발급된 Client ID/Secret → `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

**Google** — https://console.cloud.google.com/apis/credentials → OAuth 클라이언트 ID(웹 애플리케이션)
- 승인된 리디렉션 URI: `http://localhost:3000/auth/google/callback`
- → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

`ADMIN_LOGINS` 에 관리자 계정을 적습니다. GitHub 은 로그인 아이디, Google 은 이메일입니다.
여러 명은 쉼표로 구분합니다.

```
ADMIN_LOGINS=my-github-login,me@gmail.com
BASE_URL=https://myhome.example.com
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
ALLOW_DEV_LOGIN=0
```

> **주의할 두 가지** — `ADMIN_LOGINS=*` 는 *로그인한 모든 계정*을 관리자로 만들어 버립니다. 또 `ALLOW_DEV_LOGIN=1` 은 `/auth/dev-login` 으로 로그인을 건너뛰는 문입니다. 둘 다 로컬 테스트 전용이며, 관리자 화면의 "AdSense 준비 점검"이 켜져 있으면 경고합니다.

## 3. 앱 추가 방법 (관리자 화면)

`/admin.html` 에서:

| 방식 | 결과 |
| --- | --- |
| zip 업로드 | 압축 안에 `index.html` 이 있으면 그대로 해제. 폴더째 압축한 zip(`todo/index.html`)도 인식 |
| 단일 `.html` 업로드 | 그 파일이 `index.html` 로 저장 |
| 파일 없이 이름만 | 빈 앱 뼈대 생성 (나중에 파일 교체) |

추가하면 `apps/<id>/` 폴더가 생기고 `data/apps.json` 에 항목이 등록됩니다.
이름·아이콘·태그·설명·사용방법은 목록에서 "수정" 으로 바꿀 수 있고, "내려받기" 로 zip 백업이 가능합니다.

**삭제**는 두 단계입니다.
- `삭제` → `.trash/<id>-<시각>/` 으로 이동 (복구 가능)
- `완전삭제` → 폴더 삭제 (되돌릴 수 없음)

### 3.1 파일을 올리면 메타데이터가 자동으로 채워집니다

HTML(또는 zip)을 선택하는 순간 서버가 파일을 읽어 아래를 만들어 폼에 채웁니다. 마음에 안 들면 그대로 고쳐서 저장하면 됩니다.

| 항목 | 어떻게 알아내나 |
| --- | --- |
| **분야** | 제목·설명·화면 라벨의 낱말로 **자동 분류** (콘텐츠 제작·업무·금융·문서·이미지·텍스트·학습·생활·데이터·게임·기타). 관리자 화면에서 언제든 바꿀 수 있습니다 |
| 이름 | `<title>` → `<h1>` → 파일명 순. **16자 이내로 짧게** 다듬습니다 (괄호 설명·`앱`/`프로그램` 같은 꼬리말·`v2`·`The/Simple/무료` 같은 수식어 제거) |
| 아이콘 | 제목/파일명의 이모지, 없으면 감지된 분류의 기본 이모지 |
| 설명 | `<meta name="description">`(og/twitter 포함) → 본문 첫 문단 → 자동 생성 문장 |
| 태그 | 감지된 분류(할일·계산·게임·차트·그림 …) + 기능(저장형·입력형·인쇄·키보드·캔버스·오프라인·단일파일 …) |
| 사용방법 | 실제 마크업의 입력·버튼·체크박스·캔버스를 읽어 **번호 순서로 단계**를 쓰고, 저장 방식·단축키·인쇄·외부 라이브러리를 "참고" 로 덧붙입니다 |
| ID | **짧은 영문(20자 이내)**: 파일명 → 이름/제목의 영문 단어 → 한글 로마자(`가계부` → `gagyebu`) → 분류어(`calc`, `timer` …) 순으로 만들고, 그래도 못 만들면 무작위 |

ID 규칙 세부:

- 영소문자·숫자·하이픈만, 20자 이내로 잘라 씁니다 (`my-todo-app-1` 처럼 짧으면 그대로 유지)
- 한글 이름은 표준 로마자 표기로 바꿔 짧게 씁니다 (`대출계산기` → `daechulgyesangi`)
- 인코딩이 깨진 파일명(`ìì¤ë§...`)은 슬러그 노이즈로 보고 건너뜁니다 → 제목 기반 ID 가 선택됩니다
- 이미 쓰는 ID 면 `-2`, `-3` 을 붙입니다
- 직접 입력한 ID 는 그대로 존중합니다

분석은 **인터넷 없이 서버 안에서** 결정적으로 수행합니다(`src/analyze.js`). 파일 크기·조작 요소 수·저장 방식·외부 리소스 목록도 함께 보여주고, 문제가 될 만한 점은 경고로 표시합니다.

- 앱 폴더 밖을 가리키는 루트 경로(`/foo.js`) → 단독 실행 시 깨질 수 있음
- 외부 CDN 의존(인터넷 필요), `<form action>` 서버 전송, `document.write`, viewport 누락, 큰 파일 크기

**분석기 직접 돌려보기**:

```bash
node tools/analyze-dump.js ~/Downloads/myapp.html      # 결과를 눈으로 확인
```

등록된 앱도 목록에서 "수정" 으로 **이름·ID·설명·태그·사용방법**을 고칠 수 있고, **파일 다시 분석** 으로 파일을 다시 읽어 덮어쓸 수 있습니다. ID 를 바꾸면 주소(`/apps/<id>/`)도 함께 바뀝니다.

## 4. 수동으로 앱 추가하기

관리자 화면 없이도 됩니다.

```bash
mkdir -p apps/my-app
cp ~/Downloads/my-app.html apps/my-app/index.html
```

그리고 `data/apps.json` 에 항목 한 개 추가 (`howto` 는 선택):

```json
{
  "id": "my-app",
  "name": "내 앱",
  "desc": "한 줄 설명",
  "icon": "🧪",
  "tags": ["도구"],
  "howto": "1) 값을 입력합니다.\n2) 실행 버튼을 누릅니다.",
  "path": "apps/my-app/",
  "entry": "index.html",
  "createdAt": "2026-09-27T00:00:00.000Z",
  "updatedAt": "2026-09-27T00:00:00.000Z"
}
```

## 5. 분야(카테고리) 자동 분류

앱을 올리면 파일을 읽어 **분야를 자동으로 정합니다.** 태그가 "저장형·인쇄·키보드" 같은 기능 특성이라면, 분야는 "무엇을 하는 앱인지"입니다.

| 분야 | 들어가는 앱 |
| --- | --- |
| 🎬 콘텐츠 제작 | 영상·대본·문구 생성 (쇼츠·상품 콘텐츠 등) |
| 💼 업무·비즈니스 | 영수증·정산·재고 |
| 🧮 금융·계산 | 이자·세금·예산 |
| 📋 문서·표 | 표·목록·내보내기 |
| 🖼️ 이미지·영상 | 사진·영상 변환·다듬기 |
| 🔤 텍스트 도구 | 글자 수·변환·비교 |
| 📚 학습·퀴즈 | 단어장·문제 풀이 |
| 🏠 생활·기록 | 할 일·습관·타이머·메모 |
| 🔄 데이터·변환 | 단위·형식·코드 변환 |
| 🎮 게임·오락 | 작은 게임 |
| 📦 기타 도구 | 위에 딱 맞지 않는 도구 |

**어떻게 분류하나** (`src/categories.js`)

- 화면에 보이는 글(제목·설명·버튼·라벨)에 **2배 가중치**를 주고, 코드에 섞여 있는 라이브러리 이름은 낮게 봅니다. 그래서 "이미지 파일을 다루는 계산기"도 실제 쓰임새 쪽으로 묶입니다.
- 분류기가 애매하다고 판단하면 `기타 도구`로 두고, 관리자 화면에서 사람이 고칠 수 있습니다.
- 정확도 확인: `node tools/test-classify.js` (실제 앱 + 합성 예시 20건) — 현재 20/20.

**사이트에서 분야가 쓰이는 곳**

| 주소 | 내용 |
| --- | --- |
| `/categories` | 분야 목록 + 분야별 앱 수 |
| `/category/<slug>` | 그 분야의 앱 모음 (앱이 있는 분야만 생성) |
| 홈·앱 목록 | 상단 분야 버튼(칩)으로 바로 이동 |
| 앱 카드·상세 | 분야 배지, 상세 페이지의 "분류" 항목에서 분야 페이지로 이동 |
| sitemap.xml | 앱이 있는 분야 페이지 자동 포함 |

## 6. 앱 작성 규칙 (계약)

1. 앱 1개 = `apps/<id>/` 폴더 1개, 진입점은 `index.html`
2. **상대경로 + 루트 절대경로(`/apps/<id>/...`)만 사용** — 홈페이지를 거치지 않고 `http://host/apps/<id>/` 로 열어도 동작해야 함
3. 외부 라이브러리는 CDN 또는 앱 폴더 안에 동봉
4. 서버 API 호출은 선택. 없어도 단독으로 완결되게 만들면 이식성이 좋음
5. `id` 는 `^[a-z0-9][a-z0-9-]{0,39}$` (영소문자·숫자·하이픈), 이름은 16자 이내 권장
6. 한글 제목을 쓰면 ID 는 로마자로 자동 변환됨. 원하는 영문 ID 가 있으면 ID 칸에 직접 입력

자동 분석 품질을 올리려면 앱에 이걸 넣어 두세요.

```html
<title>가계부</title>
<meta name="description" content="수입과 지출을 기록하고 합계를 보여주는 도구입니다." />
<h2>지출 입력</h2>
<label for="amount">금액</label><input id="amount" type="number" />
<button type="submit">기록 추가</button>
```

`<title>`/`<h1>`, `meta description`, `label`·`placeholder`·버튼 글자가 곧 설명과 사용방법의 재료가 됩니다. 버튼 라벨은 `시작`, `일시정지`, `초기화`, `인쇄`, `내려받기`, `복사`, `설정`, `도움말` 처럼 흔한 표현을 쓰면 그에 맞는 문장이 생성됩니다.

## 7. API 요약

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/apps` | 공개 | 앱 목록 |
| GET | `/api/apps/:id` | 공개 | 앱 하나 |
| GET | `/api/categories` | 공개 | 분야 목록 + 분야별 앱 수 |
| GET | `/api/site` | 공개 | 사이트 설정(공개분) |
| PUT | `/api/site` | 관리자 | 사이트 설정 저장 (이름·운영자·이메일·도메인·AdSense ID 등) |
| POST | `/api/analyze` | 관리자 | 파일만 분석해 메타데이터 초안 반환 (저장 안 함) |
| POST | `/api/apps` | 관리자 | 추가 (`multipart/form-data`: id, name, desc, icon, tags, howto, file) |
| POST | `/api/apps/:id/analyze` | 관리자 | 등록된 앱의 `index.html` 을 다시 분석 |
| POST | `/api/apps/:id/rename` | 관리자 | ID(주소) 변경 (JSON: `{ "id": "new-id" }`) — 폴더도 함께 이동 |
| PATCH | `/api/apps/:id` | 관리자 | 메타 수정 (JSON: name, desc, icon, tags, howto) |
| DELETE | `/api/apps/:id` | 관리자 | 휴지통 이동 (`?permanent=1` 이면 완전 삭제) |
| GET | `/api/apps/:id/download` | 관리자 | 앱 폴더를 zip 으로 백업 |
| POST | `/auth/password` | 공개 | 관리자 비밀번호로 로그인 (JSON: `{ "password": "..." }`) |
| GET | `/api/admin/password` | 관리자 | 비밀번호 설정 여부 확인 |
| PUT | `/api/admin/password` | 관리자 | 비밀번호 변경 (JSON: `{ "current": "...", "next": "..." }`) |
| GET | `/auth/me` | 공개 | 로그인 상태 + 사용 가능한 provider |
| POST | `/auth/logout` | 공개 | 로그아웃 |

`POST /api/apps` 는 넘어오지 않은 항목(설명·태그·사용방법·이름·아이콘)을 서버에서 자동 분석해 채웁니다. 즉 파일만 올려도 최소한의 정보가 등록됩니다.

## 8. 공개 페이지 (서버 렌더링)

홈·목록·상세·정책 페이지는 **서버에서 HTML 로 완성해 내려보냅니다.** 검색엔진과 광고 심사 크롤러가 자바스크립트를 실행하지 않아도 내용이 그대로 보입니다.

| 주소 | 내용 |
| --- | --- |
| `/` | 사이트 소개, 앱 목록(검색·정렬), 가이드, 자주 묻는 질문 |
| `/apps` | 앱 전체 목록 |
| `/app/<id>` | 앱 상세 — 설명, 사용법, 저장 방식, 앱 정보, 관련 앱 |
| `/guide`, `/guide/<slug>` | 안내 글 (단일 파일 웹앱 개념 / 데이터 저장과 백업 / 앱 제작 기준) |
| `/about` | 사이트 소개, 운영 방식, 데이터 처리, 최근 등록 앱 |
| `/contact` | 문의 이메일, 문의 유형, 답변 안내 |
| `/privacy` | 개인정보처리방침 (쿠키·제3자 광고·거부 방법 포함) |
| `/terms` | 이용약관 |
| `/disclaimer` | 책임 한계·광고 고지 |
| `/robots.txt`, `/sitemap.xml` | 검색엔진용 파일 (sitemap 은 도메인 기준 절대 URL) |
| `/ads.txt` | AdSense 게시자 ID 를 넣으면 자동으로 생성 |

글과 정책 문구는 `src/content/`, 화면 코드는 `src/views/` 에 있습니다. 사이트 이름·운영자·이메일·도메인·AdSense ID 는 파일을 고치지 말고 **관리자 화면 → 사이트 설정**에서 바꾸세요 (`data/site.json` 에 저장됩니다).

### 라이트 / 다크 모드

헤더 오른쪽의 아이콘 버튼(해 ↔ 달)으로 전환합니다.

- 첫 방문에는 운영체제 설정(`prefers-color-scheme`)을 따르고, 직접 고르면 그 선택이 저장되어 다음 방문에도 유지됩니다.
- 아이콘·테마 적용은 `public/assets/theme.js` 가 담당하고, 색상 값은 `public/assets/style.css` 의 `--l-*`(라이트)·`--d-*`(다크) 팔레트 한 곳에서 정의합니다. 색을 바꾸려면 그 값만 고치면 됩니다.
- 자바스크립트가 없어도 시스템 설정에 따라 두 테마 모두 정상 표시됩니다.
- AdSense 게시자 ID는 `pub-…` 로 입력해도 `ca-pub-…` 로 자동 변환됩니다(스크립트에 필요한 형식).

### 로고 바꾸기

로고는 헤더·푸터·파비콘·애플 터치 아이콘·`og:image` 에 함께 쓰입니다.

| 파일 | 설명 |
| --- | --- |
| `public/assets/logo.png` | **우선 사용되는 파일.** 원본 로고 이미지를 이 이름으로 넣으면 즉시 그 로고로 바뀝니다(가로세로 같은 정사각형 권장, 512×512 이상). |
| `public/assets/logo.svg` | 로고가 없을 때 쓰는 기본 시안(주황 원 + 흰 R). 벡터라 어느 크기에서도 선명합니다. |
| `public/assets/logo.jpg` · `logo.webp` | PNG 대신 이 형식을 써도 인식합니다. |

- 헤더에서는 `border-radius: 50%` 로 원형으로 잘라 쓰기 때문에, 배경이 흰색인 이미지도 다크 모드에서 사각형으로 보이지 않습니다.
- SVG 를 수정했다면 PNG 를 다시 만들어 두세요: `node tools/render-logo.js public/assets/logo.svg public/assets/logo.png 512`
- 파일을 넣고 5초 안에 자동 반영됩니다(파일 존재 여부를 잠깐 캐시합니다).

## 9. 배포

Node 가 돌아가는 곳(자체 서버, VPS, Render/Railway/Fly 등)에 폴더를 올리고:

```bash
NODE_ENV=production SESSION_SECRET=... ADMIN_LOGINS=... BASE_URL=https://... npm start
```

- HTTPS 뒤에 둘 때는 `BASE_URL` 을 실제 도메인으로 맞추세요 (OAuth 리디렉션·쿠키 secure 판정에 사용).
- 리버스 프록시(nginx/Caddy)를 쓴다면 `X-Forwarded-Proto` 를 넘겨주세요 (`trust proxy` 가 켜져 있습니다).
- 앱은 정적 파일이므로, 별도 호스트에 두고 싶으면 `apps/` 를 통째로 올린 뒤 `data/apps.json` 의 `path` 만 맞춰도 됩니다.

## 10. 구글 애드센스 준비

심사에 필요한 요소는 코드에 미리 넣어 두었습니다. 관리자 화면 맨 위의 **“AdSense 준비 점검”** 카드가 남은 항목을 자동으로 알려 줍니다.

### 이미 준비된 것

- **서버 렌더링** — 모든 공개 페이지가 완성된 HTML 로 내려가므로 검색엔진·광고 크롤러가 내용을 읽을 수 있습니다.
- **필수 페이지** — 사이트 소개, 문의(이메일), 개인정보처리방침, 이용약관, 책임 한계·광고 고지.
- **개인정보처리방침의 필수 고지** — 쿠키 사용, 제3자 광고 사업자(Google), 맞춤 광고 거부 방법(Google 광고 설정·aboutads.info·youronlinechoices), EEA/영국 동의 절차, 아동 개인정보, 문의처.
- **원본 콘텐츠** — 앱 상세 페이지(설명·사용법·저장 방식·관련 앱)와 안내 글 3편, 자주 묻는 질문 8개.
- **기술 요소** — `robots.txt`, `sitemap.xml`, `ads.txt`, canonical, Open Graph, 구조화 데이터(WebSite·FAQ·Breadcrumb·WebApplication·Article), 모바일 대응, 다크 모드.
- **광고 코드 자동 삽입** — 게시자 ID만 넣으면 모든 페이지 `<head>` 에 AdSense 스크립트가 들어가고, 홈·목록·상세·가이드에 광고 슬롯이 생깁니다(설정 전에는 아무것도 삽입되지 않습니다).
- **쿠키 고지 배너** — 첫 방문 시 개인정보처리방침으로 안내합니다.
- **라이트/다크 모드 전환 아이콘** — 헤더에 있으며 선택값이 저장됩니다.
- **관리자 보안 점검** — 비밀번호 설정 여부, OAuth 허용목록이 `*` 로 열려 있는지, 개발용 로그인이 켜져 있는지까지 함께 확인합니다.

### 광고를 표시하는 두 가지 방법

| 방법 | 설정 |
| --- | --- |
| 자동 광고(Auto ads) | AdSense 콘솔에서 “자동 광고”를 켜면 됩니다. 게시자 ID만 넣어 두면 코드는 이미 모든 페이지에 있습니다. |
| 수동 광고 단위 | AdSense에서 광고 단위를 만들어 나온 **슬롯 ID**를 사이트 설정의 “본문 광고 슬롯 ID”에 넣으면 홈·목록·상세·가이드의 지정 위치에 표시됩니다. |

### 직접 해야 하는 것 (순서대로)

1. **도메인 연결 + HTTPS** — AdSense 심사는 `localhost` 에서 진행되지 않습니다. 도메인을 사이트에 연결하고 HTTPS 를 켜세요.
2. **관리자 → 사이트 설정**에 값 입력: 사이트 이름(실제 이름), 운영자 이름, **문의 이메일**(실제 수신 가능한 주소), 도메인(`https://…`), 그리고 AdSense 게시자 ID(`ca-pub-…`).
3. **앱 5개 이상 + 모든 앱에 설명·사용법** — 점검 카드에서 통과를 확인하세요.
4. **AdSense 가입 → 사이트 추가** — “사이트” 메뉴에서 도메인을 등록하면 게시자 ID가 나옵니다. 그 값을 2번에 넣으면 코드 삽입과 `ads.txt` 생성이 자동으로 됩니다.
5. **Google Search Console 등록 → `/sitemap.xml` 제출** — 색인되면 심사에 유리합니다.
6. **EEA·영국 대응** — AdSense의 “개인정보 보호 및 메시지”에서 Google 인증 CMP(동의 관리 메시지)를 켜세요. 유럽 이용자에게 맞춤 광고를 게재하려면 필수입니다.
7. **ads.txt 연결** — `/ads.txt` 가 자동 제공되지만, 도메인 루트에서 접근 가능해야 합니다(이 서버가 루트 도메인이면 그대로 동작).
8. **심사 신청** — 보통 며칠에서 2주 정도 걸립니다.

### 심사에서 떨어질 때 흔한 이유와 대응

| 사유 | 대응 |
| --- | --- |
| 가치가 낮은 콘텐츠 | 앱을 더 등록하고, 각 앱의 **사용법을 구체적으로** 다듬으세요. 가이드 글을 늘리는 것도 효과적입니다. |
| 크롤러가 콘텐츠를 못 읽음 | 이 사이트는 서버 렌더링이라 해당 없음. `도메인/sitemap.xml` 이 열리는지 확인하세요. |
| 사이트 미완성 | 빈 페이지·깨진 링크·준비 중 문구를 남기지 마세요. 404 페이지에는 광고가 없습니다. |
| 정책 페이지 누락 | `/privacy`, `/terms`, `/contact` 가 살아 있는지 확인하세요. |
| 광고 코드 미설치 | 사이트 설정에 게시자 ID를 넣으면 모든 페이지에 자동 삽입됩니다. |

**주의**: 통과를 보장할 수는 없습니다(최종 판단은 Google 몫입니다). 심사 중에는 자기 광고를 클릭하지 말고, 승인 후에도 콘텐츠 없는 페이지에 광고를 넣지 마세요.

## 11. 운영 수칙

- `apps/`, `data/`, `.trash/` 를 git 으로 버전관리하고, 커밋은 `git init && git add -A && git commit -m "..."` 로 남기면 앱 변경 이력이 그대로 남습니다.
- 업로드 검증: 슬러그 정규식, zip 경로 탈출(`../`) 차단, 50MB·2000파일 상한이 적용되어 있습니다.
- 관리자 세션은 7일이며 메모리에 저장됩니다. 서버를 재시작하면 다시 로그인해야 합니다(다중 인스턴스 운영 시 세션 스토어 교체 필요).
- `data/site.json` 은 git 에 함께 커밋해도 되지만, 공개 저장소라면 이메일 노출을 감안하세요(어차피 사이트에 표시되는 정보입니다).
