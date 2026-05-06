/**
 * Cloudflare Pages Function — AWS Public Network Capacity Proxy: matrix
 * Route: GET /api/aws/ip-ranges/matrix
 *
 * Powers the OpenRouter-style Current Breakdown matrix table in the
 * Amazon > AWS section. Returns:
 *   - periods[]:  ordered list of calendar quarters (or months) in the
 *                 captured window, with display labels and the
 *                 representative snapshot date for each.
 *   - items[]:    top-N services or regions ranked by the LATEST
 *                 period's IPv4 capacity. Each item carries a value per
 *                 period plus QoQ/MoM and YoY growth blocks (pct) and
 *                 absolute_change blocks. Missing comparison periods
 *                 yield null — never a synthetic 0.
 *
 * Read-only over HISTORY_KV. Never fetches AWS upstream, never writes
 * to KV. Each period's value is the LATEST snapshot in that calendar
 * period (no averaging).
 *
 * Query params:
 *   ?dimension=service|region        default service
 *   ?period=quarter|month            default quarter
 *   ?metric=ipv4_addresses           only metric supported today
 *   ?limit=8                         1..32, ranked by latest period value
 */

import {
  DAY_PREFIX,
  INDEX_KEY,
  jsonResp,
  corsPreflight,
} from '../_ipr-utils.js';

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Quarter info from a YYYY-MM-DD date string: { year, quarter, key, endMonthIdx }. */
function quarterInfo(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const quarter = Math.floor((m - 1) / 3) + 1;
  // Q1 ends Mar (idx 2), Q2 ends Jun (idx 5), Q3 ends Sep (idx 8), Q4 ends Dec (idx 11).
  const endMonthIdx = quarter * 3 - 1;
  return {
    year: y,
    quarter,
    key: y + '-Q' + quarter,
    endMonthIdx,
  };
}

/** Month info: { year, month (1..12), key, monthIdx (0..11) }. */
function monthInfo(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return {
    year: y,
    month: m,
    key: y + '-' + String(m).padStart(2, '0'),
    monthIdx: m - 1,
  };
}

/** Two-digit year suffix from full year. */
function yy(year) {
  return String(year % 100).padStart(2, '0');
}

/** "Jun-26" for a quarter (year + quarter), with optional " QTD" suffix. */
function quarterLabel(year, quarter, isCurrent) {
  const endMonthIdx = quarter * 3 - 1;
  return MONTH_ABBR[endMonthIdx] + '-' + yy(year) + (isCurrent ? ' QTD' : '');
}

/** "May-26" for a month (year + monthIdx 0..11), with optional " MTD" suffix. */
function monthLabel(year, monthIdx, isCurrent) {
  return MONTH_ABBR[monthIdx] + '-' + yy(year) + (isCurrent ? ' MTD' : '');
}

/** Whether period A is the same calendar period as period B (matching the period mode). */
function samePeriod(a, b, period) {
  if (period === 'quarter') return a.year === b.year && a.quarter === b.quarter;
  return a.year === b.year && a.month === b.month;
}

export async function onRequestGet({ request, env }) {
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp({ success: false, error: 'HISTORY_KV not bound' }, 500);
  }

  const url = new URL(request.url);
  const dimension = (url.searchParams.get('dimension') || 'service').toLowerCase();
  const period = (url.searchParams.get('period') || 'quarter').toLowerCase();
  const metric = (url.searchParams.get('metric') || 'ipv4_addresses').toLowerCase();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '8', 10) || 8, 1), 32);

  if (dimension !== 'service' && dimension !== 'region') {
    return jsonResp({ success: false, error: 'Unsupported dimension: ' + dimension + ' (only "service" and "region" are supported)' }, 400);
  }
  if (period !== 'quarter' && period !== 'month') {
    return jsonResp({ success: false, error: 'Unsupported period: ' + period + ' (only "quarter" and "month" are supported)' }, 400);
  }
  if (metric !== 'ipv4_addresses') {
    return jsonResp({ success: false, error: 'Unsupported metric: ' + metric + ' (only "ipv4_addresses" is supported today)' }, 400);
  }

  const dimField = dimension === 'service' ? 'by_service' : 'by_region';
  const dimKey = dimension === 'service' ? 'service' : 'region';

  // Load captured snapshots, asc by date.
  const index = (await kv.get(INDEX_KEY, 'json')) || [];
  if (!index.length) {
    return jsonResp({
      success: true,
      dimension, period, metric, limit,
      periods: [], items: [],
      message: 'No AWS IP-range history yet. Hit /api/aws/ip-ranges/capture to create the first snapshot.',
    });
  }
  const dates = index.slice(0, 400);
  const snaps = (await Promise.all(dates.map(async (d) => kv.get(DAY_PREFIX + d, 'json')))).filter(Boolean);
  if (!snaps.length) {
    return jsonResp({
      success: true,
      dimension, period, metric, limit,
      periods: [], items: [],
    });
  }
  snaps.sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));

  // ── Group snapshots into periods, picking the LATEST snapshot in each group. ──
  // The Map preserves insertion order; we walk asc and overwrite so each key
  // ends up holding the latest snapshot for that period.
  const byPeriod = new Map(); // periodKey → { info, snapshot }
  for (const s of snaps) {
    const info = period === 'quarter' ? quarterInfo(s.snapshot_date) : monthInfo(s.snapshot_date);
    byPeriod.set(info.key, { info, snapshot: s });
  }

  // Sort period keys chronologically asc.
  const sortedKeys = Array.from(byPeriod.keys()).sort();
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayInfo = period === 'quarter' ? quarterInfo(todayStr) : monthInfo(todayStr);

  const periods = sortedKeys.map(k => {
    const { info, snapshot } = byPeriod.get(k);
    const isCurrent = samePeriod(info, todayInfo, period);
    const label = period === 'quarter'
      ? quarterLabel(info.year, info.quarter, isCurrent)
      : monthLabel(info.year, info.monthIdx, isCurrent);
    return { key: k, label, snapshot_date: snapshot.snapshot_date };
  });

  if (!periods.length) {
    return jsonResp({ success: true, dimension, period, metric, limit, periods: [], items: [] });
  }

  // ── Pick top-N items by the LATEST period's value. ──
  const latestKey = sortedKeys[sortedKeys.length - 1];
  const latestSnap = byPeriod.get(latestKey).snapshot;
  const latestRows = Array.isArray(latestSnap[dimField]) ? latestSnap[dimField] : [];
  const ranked = latestRows
    .filter(r => typeof r?.[metric] === 'number')
    .slice()
    .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
    .slice(0, limit);
  const pickedNames = ranked.map(r => r[dimKey]);

  // ── Build values map per item, per period. Missing values stay null. ──
  // Keyed by (item, periodKey) → number | null.
  const values = new Map();
  function setValue(name, periodKey, v) {
    if (!values.has(name)) values.set(name, new Map());
    values.get(name).set(periodKey, v);
  }
  for (const name of pickedNames) {
    for (const k of sortedKeys) {
      const snap = byPeriod.get(k).snapshot;
      const row = (snap[dimField] || []).find(r => r[dimKey] === name);
      const v = row && typeof row[metric] === 'number' ? row[metric] : null;
      setValue(name, k, v);
    }
  }

  // ── Compute growth blocks (qoq/mom + yoy) for each item / period. ──
  // qoq fires only when period === 'quarter'. mom fires only when period === 'month'.
  // yoy fires for both modes when a same-period-prior-year snapshot exists.
  const periodIndex = new Map(); // periodKey → array index in sortedKeys
  sortedKeys.forEach((k, i) => periodIndex.set(k, i));

  function priorPeriodKey(currentKey) {
    const idx = periodIndex.get(currentKey);
    return idx > 0 ? sortedKeys[idx - 1] : null;
  }

  function yoyPriorKey(currentKey) {
    if (period === 'quarter') {
      const [y, qPart] = currentKey.split('-Q');
      return (parseInt(y, 10) - 1) + '-Q' + qPart;
    }
    const [y, m] = currentKey.split('-');
    return (parseInt(y, 10) - 1) + '-' + m;
  }

  function pctAndAbs(curr, prev) {
    if (curr == null || prev == null) return { pct: null, abs: null };
    const abs = curr - prev;
    const pct = prev !== 0 ? abs / prev : null;
    return { pct, abs };
  }

  const items = pickedNames.map(name => {
    const valuesMap = values.get(name) || new Map();
    const valuesObj = {};
    const growthQoq = {}, growthMom = {}, growthYoy = {};
    const absQoq = {}, absMom = {}, absYoy = {};
    for (const k of sortedKeys) {
      const v = valuesMap.has(k) ? valuesMap.get(k) : null;
      valuesObj[k] = v;

      // QoQ / MoM (period-prior).
      const priorKey = priorPeriodKey(k);
      if (priorKey) {
        const { pct, abs } = pctAndAbs(v, valuesMap.has(priorKey) ? valuesMap.get(priorKey) : null);
        if (period === 'quarter') {
          growthQoq[k] = pct;
          absQoq[k] = abs;
        } else {
          growthMom[k] = pct;
          absMom[k] = abs;
        }
      } else {
        if (period === 'quarter') { growthQoq[k] = null; absQoq[k] = null; }
        else { growthMom[k] = null; absMom[k] = null; }
      }

      // YoY (same period one year earlier).
      const yoyKey = yoyPriorKey(k);
      const yoyPrev = valuesMap.has(yoyKey) ? valuesMap.get(yoyKey) : null;
      const { pct: yPct, abs: yAbs } = pctAndAbs(v, yoyPrev);
      growthYoy[k] = yPct;
      absYoy[k] = yAbs;
    }
    return {
      name,
      values: valuesObj,
      growth: { qoq: growthQoq, mom: growthMom, yoy: growthYoy },
      absolute_change: { qoq: absQoq, mom: absMom, yoy: absYoy },
    };
  });

  return jsonResp({
    success: true,
    dimension,
    period,
    metric,
    limit,
    periods,
    items,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}

export const onRequestOptions = corsPreflight;
