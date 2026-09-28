// Pure layout math for the office grid and kanban column widths
// (docs/specs/2026-09-28-board-interactions-design.md §5.1, §5.2). Imports nothing; Node-importable.

// Seats open in blocks: a full block opens the next one, so there is always at least one empty seat.
export const seatCount = (n, block) => (Math.floor(n / block) + 1) * block;

// Stable seating: a session keeps its previous seat while it exists and that seat still exists;
// everyone else fills the first free seats in `ids` order.
export const assignSeats = (prev, ids, total) => {
  const alive = new Set(ids);
  const kept = Array.from({ length: total }, (_, i) => (alive.has(prev[i]) ? prev[i] : null));
  const seated = new Set(kept);
  const free = kept.flatMap((id, i) => (id === null ? [i] : []));
  ids.filter(id => !seated.has(id)).forEach((id, k) => { if (k < free.length) kept[free[k]] = id; });
  return kept;
};

// Largest desk width that fits `count` desks into width x height, trying each column option.
// Desk height = size * ratio + extra. height may be Infinity (fit by width only).
// Below `min`, desks stay at min and the caller's container scrolls.
export const fitGrid = ({ count, width, height, colsOptions, gap = 8, ratio = 86 / 64, extra = 0, min = 56, max = 150 }) => {
  if (!count) return { cols: 0, size: 0 };
  const fitting = colsOptions.filter(c => c > 0 && c <= count);
  const options = fitting.length ? fitting : [count];
  const sizeFor = cols => {
    const rows = Math.ceil(count / cols);
    const byW = (width - gap * (cols - 1)) / cols;
    const byH = ((height - gap * (rows - 1)) / rows - extra) / ratio;
    return Math.min(byW, byH, max);
  };
  const best = options.map(cols => ({ cols, size: sizeFor(cols) })).reduce((a, b) => (b.size > a.size ? b : a));
  if (best.size >= min) return best;
  const cols = Math.min(Math.max(Math.floor((width + gap) / (min + gap)), 1), Math.max(...options));
  return { cols, size: min };
};

// Columns i and i+1 trade dx pixels; the pair's total stays the same and neither drops below minPx.
// totalPx is the width all fracs share (container width minus gaps).
export const resizePair = (fracs, i, dx, totalPx, minPx) => {
  if (i < 0 || i + 1 >= fracs.length) return [...fracs];
  const pxPerFrac = totalPx / fracs.reduce((a, b) => a + b, 0);
  const a = fracs[i] * pxPerFrac;
  const pair = a + fracs[i + 1] * pxPerFrac;
  const lo = Math.min(minPx, pair / 2); // pair already narrower than 2*min: an even split is the best we can do
  const next = Math.min(Math.max(a + dx, lo), pair - lo);
  return fracs.map((f, k) => (k === i ? next / pxPerFrac : k === i + 1 ? (pair - next) / pxPerFrac : f));
};
