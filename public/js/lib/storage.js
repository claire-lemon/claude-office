// localStorage get/set wrapped in try/catch (private windows, blocked storage, etc).
export const loadSound = () => { try { return localStorage.getItem('office.sound') !== '0'; } catch { return true; } };
export const saveSound = v => { try { localStorage.setItem('office.sound', v ? '1':'0'); } catch {} };

// Detail panel width (panel/resize.js). Additive per docs/specs 2026-09-28 §6.3.
export const loadPanelWidth = () => {
  try {
    const v = Number(localStorage.getItem('office.panelWidth'));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
};
export const savePanelWidth = px => { try { localStorage.setItem('office.panelWidth', String(Math.round(px))); } catch {} };
