import { $ } from '../lib/dom.js';
import { loadSound, saveSound } from '../lib/storage.js';
import { pendingAlert } from './filters.js';

// ---------- notifications ----------
const soundState = { on: loadSound() };
const updateSoundBtn = () => {
  const b = $('#sound-toggle');
  b.textContent = soundState.on ? '🔔' : '🔕';
  b.setAttribute('aria-pressed', String(soundState.on));
};
updateSoundBtn();
$('#sound-toggle').addEventListener('click', () => { soundState.on = !soundState.on; saveSound(soundState.on); updateSoundBtn(); });

const audioRef = { ctx:null };
document.addEventListener('click', () => {
  if (window.Notification && Notification.permission === 'default') { try { Notification.requestPermission(); } catch {} }
  if (!audioRef.ctx) { try { audioRef.ctx = new (window.AudioContext||window.webkitAudioContext)(); } catch {} }
}, { once:true });

const playDing = () => {
  const ctx = audioRef.ctx;
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.4);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime+0.4);
  } catch {}
};

const pendingRef = { ids:null };
export const checkNotifications = list => {
  const { count, ids, fresh } = pendingAlert(list, pendingRef.ids);
  document.title = count>0 ? `(${count}) 결재 대기 · 오피스` : '오늘의 사무실';
  if (fresh.length) {
    if (soundState.on) playDing();
    if (window.Notification && Notification.permission === 'granted') {
      const blocked = list.some(s => fresh.includes(s.id) && s.status === 'blocked');
      try { new Notification(`결재 대기 ${count}건`, { body: blocked ? '도움이 필요한 세션이 있어요' : '확인이 필요한 세션이 있어요', tag:'office-pending' }); } catch {}
    }
  }
  pendingRef.ids = ids;
};
