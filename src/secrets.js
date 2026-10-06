'use strict';

/**
 * 업로드된 앱 파일에서 API 키·토큰 같은 비밀값을 찾아 제거합니다.
 *
 * 원칙: 비밀값은 서버(사이트)에 저장하지 않습니다. 앱은 실행할 때 사용자가 자기 PC에서
 * 입력한 키를 브라우저 저장소에만 두고 씁니다. (앱 UI: "API 키 관리")
 *
 * 쓰이는 곳
 *   - 업로드 시: 저장 전에 제거 (worker/apps.js, src/manifest.js)
 *   - 배포 시: 정적 빌드에도 제거 (tools/export-static.js)
 *   - 서빙 시: 만에 하나 남아 있어도 내보내지 않음 (worker/index.js, server.js)
 */

const PATTERNS = [
  {
    name: 'Google API 키',
    re: /AIza[0-9A-Za-z_-]{35}/g,
    replace: 'YOUR_GOOGLE_API_KEY',
  },
  {
    name: 'JWT 토큰',
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
    replace: 'YOUR_AUTH_TOKEN',
  },
  {
    name: 'OpenAI 키',
    re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    replace: 'YOUR_OPENAI_API_KEY',
  },
  {
    name: 'Anthropic 키',
    re: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    replace: 'YOUR_ANTHROPIC_API_KEY',
  },
  {
    name: '네이버 API 키',
    re: /NCP_[A-Za-z0-9_-]{10,}/g,
    replace: 'YOUR_NAVER_API_KEY',
  },
  {
    name: 'AWS 액세스 키',
    re: /AKIA[0-9A-Z]{16}/g,
    replace: 'YOUR_AWS_ACCESS_KEY',
  },
  {
    name: 'GitHub 토큰',
    re: /gh[pousr]_[A-Za-z0-9]{30,}/g,
    replace: 'YOUR_GITHUB_TOKEN',
  },
  {
    name: 'Private key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,4000}?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: 'YOUR_PRIVATE_KEY',
  },
  {
    name: 'Authorization 헤더',
    re: /(Authorization['"]?\s*[:=]\s*['"]?\s*(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: '$1YOUR_TOKEN',
  },
];

/** 파일에서 비밀값을 찾습니다 (수정하지 않음) */
function scanSecrets(text) {
  const source = String(text ?? '');
  const findings = [];
  for (const { name, re } of PATTERNS) {
    const pattern = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const match of source.matchAll(pattern)) {
      const value = match[0];
      const at = match.index || 0;
      findings.push({
        name,
        preview: value.length > 16 ? `${value.slice(0, 10)}…(${value.length}자)` : value,
        context: source.slice(Math.max(0, at - 60), at + value.length + 20).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return findings;
}

/** 비밀값을 자리표시자로 바꿔 돌려줍니다 */
function redactSecrets(text) {
  let out = String(text ?? '');
  const findings = [];
  for (const { name, re, replace } of PATTERNS) {
    const pattern = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    out = out.replace(pattern, (match) => {
      findings.push({ name, preview: match.length > 16 ? `${match.slice(0, 10)}…(${match.length}자)` : match });
      return replace;
    });
  }
  return { html: out, findings };
}

/**
 * AI Studio / Firebase Studio 내보내기에 딸려오는 설정 블록을 통째로 제거합니다.
 * 앱에서 window.__firebase_config / __initial_auth_token 을 읽지 않는 경우가 대부분이고,
 * 이 블록에 API 키와 인증 토큰이 들어 있습니다.
 */
function stripEmbeddedConfigScripts(html) {
  const before = String(html ?? '');
  let out = before;
  const removed = [];

  if (/__initial_auth_token/.test(out) && !/__initial_auth_token[\s\S]{0,4000}?\bget\b/.test(out)) {
    const re = /<script[^>]*>\s*\(function\s*\(\s*firebaseConfig[\s\S]*?<\/script>/i;
    if (re.test(out)) {
      out = out.replace(re, '<!-- 앱에 포함되어 있던 외부 서비스 설정(키·토큰)을 보안을 위해 제거했습니다 -->');
      removed.push('외부 서비스 설정 블록(API 키·인증 토큰 포함)');
    }
  }
  return { html: out, removed };
}

/** HTML 파일 하나를 정리: 설정 블록 제거 → 비밀값 치환 */
function cleanHtml(text) {
  const { html: withoutConfig, removed } = stripEmbeddedConfigScripts(text);
  const { html, findings } = redactSecrets(withoutConfig);
  return { html, findings, removed };
}

module.exports = { PATTERNS, scanSecrets, redactSecrets, stripEmbeddedConfigScripts, cleanHtml };
