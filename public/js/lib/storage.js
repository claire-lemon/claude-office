// localStorage get/set wrapped in try/catch (private windows, blocked storage, etc).
export const loadSound = () => { try { return localStorage.getItem('office.sound') !== '0'; } catch { return true; } };
export const saveSound = v => { try { localStorage.setItem('office.sound', v ? '1':'0'); } catch {} };
