import { $ } from '../lib/dom.js';

// Lives outside the panel: panel actions are re-rendered on every poll.
export const flashPanelError = (msg, ms = 2500) => {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  (document.querySelector('dialog[open]') || document.body).appendChild(t); // a modal dialog covers body
  setTimeout(() => t.remove(), ms);
};
export const stampFx = text => {
  const stamp = document.createElement('div');
  stamp.className = 'stamp-fx'; stamp.textContent = text;
  $('#stamp-layer').appendChild(stamp);
  stamp.addEventListener('animationend', () => stamp.remove());
};
