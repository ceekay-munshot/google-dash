// America/New_York time helpers. The codebase has no other ET logic —
// everything else is UTC. The capture endpoint needs to know "what is
// the current ET business date" without pulling in a timezone library.
// Intl.DateTimeFormat handles DST automatically.

export function nowInEasternTime(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]),
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date:    `${parts.year}-${parts.month}-${parts.day}`,
    time:    `${hour}:${parts.minute}:${parts.second}`,
    weekday: parts.weekday,
  };
}

// 10:00 ≤ hour < 12:00 in America/New_York. Day-of-week is NOT gated —
// captures run every calendar day; the time-of-day window only ensures
// consistent timestamps across cron-slot drift and DST.
export function isInsideCaptureWindow(et) {
  const hh = parseInt(et.time.slice(0, 2), 10);
  return hh >= 10 && hh < 12;
}

// Period-start ('YYYY-MM-DD') anchored at America/New_York.
//   wtd → Monday of current ET week
//   mtd → first day of current ET month
//   qtd → first day of current calendar quarter
export function periodStartET(period, now = new Date()) {
  const { date, weekday } = nowInEasternTime(now);
  const [y, m, d] = date.split('-').map(Number);
  if (period === 'mtd') return `${y}-${String(m).padStart(2,'0')}-01`;
  if (period === 'qtd') {
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    return `${y}-${String(qm).padStart(2,'0')}-01`;
  }
  // wtd
  const back = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(weekday);
  const t    = Date.UTC(y, m - 1, d) - back * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// Bucket key for a captured ET date, matching the SQL bucket math used
// in /history/series. Used in JS for source-priority resolution.
export function bucketKey(bucket, captured_date_et) {
  const [y, m, d] = captured_date_et.split('-').map(Number);
  if (bucket === 'daily')   return captured_date_et;
  if (bucket === 'monthly') return `${y}-${String(m).padStart(2,'0')}-01`;
  if (bucket === 'quarterly') {
    const q = Math.floor((m - 1) / 3) + 1;
    return `${y}-Q${q}`;
  }
  // weekly = Monday of the ISO week containing this date
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const back = (wd + 6) % 7;
  const t = Date.UTC(y, m - 1, d) - back * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
