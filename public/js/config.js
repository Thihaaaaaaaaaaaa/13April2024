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
  // day -> { label, kind }  ·  kind: 'anniv' (yearly, 13 Apr — the glass-dome rose)
  //                                | 'monthsary' (every other 13th-of-the-month — the lavender bloom)
  const ms = new Map();
  const start = startMidnight();
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th');

  // yearly anniversaries first — they take priority on any day they land on
  for (let y = 1; y <= 30; y++) {
    const a = new Date(start);
    a.setFullYear(a.getFullYear() + y);
    const d = Math.round((a - start) / 86400000) + 1;
    if (d > maxDay) break;
    ms.set(d, { label: `our ${ord(y)} year`, kind: 'anniv' });
  }

  // monthsaries — every 13th of the month you two actually track, skipping the day that's already an anniversary
  let monthCount = 0;
  const cursor = new Date(start);
  cursor.setDate(13);
  if (cursor <= start) cursor.setMonth(cursor.getMonth() + 1);   // day 1 itself is not a monthsary
  for (let guard = 0; guard < 400; guard++) {
    const d = Math.round((cursor - start) / 86400000) + 1;
    if (d > maxDay) break;
    if (d >= 1) {
      monthCount++;
      if (!ms.has(d)) ms.set(d, { label: `${monthCount} month${monthCount === 1 ? '' : 's'} today 💜`, kind: 'monthsary' });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ms;
}

export function fmtDate(d) {
  if (!d) return '';
  const x = new Date(d);
  if (isNaN(x)) return String(d).slice(0, 10);
  return x.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
