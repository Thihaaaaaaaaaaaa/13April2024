/* Shared constants for the garden. The server can override startDate/names
   via /api/config; these are the defaults and the couple's identity. */

export const CONFIG = {
  startDate: '2024-04-13',
  names: ['Lina', 'Thiha'],
  profiles: {
    Lina:  { emoji: '🌸', color: '#d96a7b', soft: '#f3ccd3', word: 'rose'  },
    Thiha: { emoji: '🌙', color: '#7d8fd9', soft: '#ccd3f0', word: 'moon'  },
  },
};

/* Local-midnight day maths: day 1 = the day it all began. */
export function localMidnight(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function startMidnight() {
  const [y, m, d] = CONFIG.startDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function dayNumber(now = new Date()) {
  const ms = localMidnight(now) - startMidnight();
  return Math.floor(ms / 86400000) + 1;
}
export function msToNextDay(now = new Date()) {
  const next = localMidnight(now);
  next.setDate(next.getDate() + 1);
  return next - now;
}

/* Milestones — day counts and yearly anniversaries. Gold roses. */
export function milestoneSet(maxDay) {
  const set = new Map(); // day -> label
  for (const d of [100, 200, 300, 365, 500, 730, 1000, 1095, 1461, 1500, 2000])
    if (d <= maxDay + 400) set.set(d, d === 365 ? '1 year' : d === 730 ? '2 years' : d === 1095 ? '3 years' : d === 1461 ? '4 years' : `day ${d}`);
  // anniversaries beyond the fixed list
  for (let yr = 1; yr <= 30; yr++) {
    const s = startMidnight();
    const a = new Date(s.getFullYear() + yr, s.getMonth(), s.getDate());
    const d = Math.floor((a - s) / 86400000) + 1;
    if (d <= maxDay + 400 && !set.has(d)) set.set(d, `${yr} year${yr > 1 ? 's' : ''}`);
  }
  return set;
}

export function fmtDate(d) {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x)) return String(d).slice(0, 10);
  return x.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
