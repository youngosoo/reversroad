/* 라이트/다크 모드 전환.
   head 에서 동기 실행되어 첫 페인트 전에 테마를 정합니다(깜빡임 방지).
   저장된 값이 없으면 운영체제 설정(prefers-color-scheme)을 따릅니다. */
(function () {
  var KEY = 'myhome.theme';
  var root = document.documentElement;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function system() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  var SUN = '<svg class="ico-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2"/><g><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/></g></svg>';
  var MOON = '<svg class="ico-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.3 8.3 0 1 0 10.2 10.2Z"/></svg>';

  function apply(mode, persist) {
    root.setAttribute('data-theme', mode);
    root.style.colorScheme = mode;
    if (persist) {
      try { localStorage.setItem(KEY, mode); } catch (e) { /* 저장 불가 환경 */ }
    }
    var meta = document.getElementById('themeColor');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0b0d12' : '#f6f7fb');
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!btn.firstChild) btn.innerHTML = SUN + MOON;
      btn.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
      btn.setAttribute('aria-label', mode === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
      btn.setAttribute('title', mode === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    }
  }

  // 1) 첫 페인트 전에 테마 결정
  apply(stored() || system(), false);

  // 2) 버튼 연결
  function bind() {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next, true);
      });
    }
    apply(root.getAttribute('data-theme') || system(), false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  // 3) 사용자가 직접 고르지 않았다면 시스템 변경을 따라갑니다
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (!stored()) apply(e.matches ? 'dark' : 'light', false);
      });
    } catch (err) { /* 구형 브라우저 */ }
  }

  window.MyHomeTheme = { get: function () { return root.getAttribute('data-theme'); }, set: apply };
})();
