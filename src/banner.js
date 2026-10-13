'use strict';

/**
 * 상단 고정 배너 — 사이트 레이아웃과 앱 화면 주입이 함께 쓰는 값 정리.
 *
 * 관리자에서 이미지를 올리면 이미지 배너, 올리지 않으면 글자(제목·부제·버튼) 배너입니다.
 * 둘 다 없으면 아무것도 그리지 않습니다.
 */

const { bannerUrl } = require('./assets');

function bannerParts(site) {
  const banner = (site && site.banner) || {};
  if (!banner.enabled) return null;
  const hasImage = Boolean(banner.version);
  if (!hasImage && !banner.title && !banner.subtitle && !banner.button) return null;
  return {
    image: hasImage ? bannerUrl(site) : '',
    url: banner.url || 'http://www.jademol.com',
    target: banner.newTab === false ? '' : '_blank',
    alt: banner.alt || banner.title || (site && site.name) || '배너',
    title: banner.title || '',
    subtitle: banner.subtitle || '',
    button: banner.button || '',
  };
}

module.exports = { bannerParts };
