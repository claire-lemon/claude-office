import { $ } from '../lib/dom.js';

// Header freshness badge + the "hooks 미설치" banner. freshnessLabel is pure (unit-tested); render*
// touch the DOM only when called, so Node can import this file.
// health.okAt: client time of the last successful /api/sessions; failed: the last poll failed.
const ago = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분`;
};
export const freshnessLabel = ({ okAt, failed }, now) => {
  if (failed) return { text: okAt ? `오프라인 · ${ago(now - okAt)} 전 데이터` : '오프라인', offline: true };
  if (!okAt) return { text: '연결 중…', offline: false };
  return { text: `${ago(now - okAt)} 전 갱신`, offline: false };
};

export const health = { okAt: null, failed: false, hooksInstalled: true, sessions: 0 };

export const renderFreshness = () => {
  const el = $('#freshness');
  const { text, offline } = freshnessLabel(health, Date.now());
  el.textContent = text;
  el.classList.toggle('offline', offline);
  el.title = offline ? '서버에 연결하지 못했어요. 화면은 마지막으로 받은 데이터예요 (node server.mjs 실행 중인지 확인)' : '2초마다 서버에서 다시 받아와요';
};

// App sessions on the board but no hook state at all = install.mjs never ran (or the hook fails).
export const renderHookBanner = () => {
  $('#notice-hooks').hidden = health.hooksInstalled || health.sessions === 0;
};
