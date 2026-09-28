// localStorage get/set wrapped in try/catch (private windows, blocked storage, etc).
// Values are JSON; the older helpers below are thin wrappers and keep their stored format.
export const loadPref = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
};
export const savePref = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

export const loadSound = () => loadPref('office.sound', 1) !== 0;
export const saveSound = v => savePref('office.sound', v ? 1 : 0); // stored as '1' / '0', same as before

// Detail panel width (panel/resize.js).
export const loadPanelWidth = () => {
  const v = Number(loadPref('office.panelWidth', null));
  return Number.isFinite(v) && v > 0 ? v : null;
};
export const savePanelWidth = px => savePref('office.panelWidth', Math.round(px));
