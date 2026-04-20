/**
 * Cloudflare Pages Function — Quarterly Model Pricing History
 * Route: /api/pricing-history
 * Method: GET
 *
 * Reads canonical daily snapshots from HISTORY_KV, filters each snapshot's
 * `pricing.models` array to the stable tracked basket, and derives a
 * quarterly average series with QoQ and YoY comparisons.
 *
 * Query params:
 *   ?metric=input   (default)  — input price per 1M tokens
 *   ?metric=output             — output price per 1M tokens
 *   ?range=N                   — number of days to scan (default 400, max 400)
 *
 * Methodology (documented here because it is the whole point):
 *   1. For each captured day, look at snapshot.pricing.models. That list
 *      contains only basket members present on pricepertoken.com that day.
 *   2. For that day, compute the equal-weighted average price across
 *      matched basket members. Call this dayAvg[d]. Record matchedCount[d].
 *   3. Group days by calendar quarter (Q1 = Jan-Mar, UTC).
 *   4. For each quarter, quarterAvg = mean of dayAvg over days in quarter.
 *      quarterCoverage = mean of matchedCount over days in quarter (rounded
 *      to the nearest basket member). quarterDayCount = days observed.
 *   5. QoQ = (quarterAvg[q] - quarterAvg[q-1]) / quarterAvg[q-1]
 *      YoY = (quarterAvg[q] - quarterAvg[q-4]) / quarterAvg[q-4]
 *      Both are null unless the exact adjacent / year-earlier quarter
 *      exists with real data.
 *   6. The current calendar quarter is marked partial:true (QTD avg).
 *
 * Explicitly NOT done:
 *   - No synthetic backfill.
 *   - No "closest available quarter" comparisons.
 *   - No usage weighting.
 *   - No computation from the full 530-model site universe.
 *
 * Response:
 *   {
 *     success,
 *     metric: 'input' | 'output',
 *     basket: { size, members: [{slug, provider, label}, ...] },
 *     trackingSinceDate,
 *     quarters: [
 *       {
 *         id: '2026-Q2',
 *         start: '2026-04-01', end: '2026-06-30',
 *         avg: 3.42, avgLabel: '$3.42',
 *         qoq: -0.031, qoqLabel: '-3.1%',
 *         yoy: null, yoyLabel: null,
 *         coverage: { matched: 14, basket: 16, ratio: 0.875 },
 *         dayCount: 12,
 *         partial: true,
 *         notes: 'QTD avg · partial quarter',
 *       },
 *       ...
 *     ]
 *   }
 */

import { PRICING_BASKET, BASKET_SIZE } from './_pricing-basket.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      ...CORS,
    },
  });
}

function parseDateUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function quarterOf(d) {
  return { year: d.getUTCFullYear(), quarter: Math.floor(d.getUTCMonth() / 3) + 1 };
}

function quarterKey(d) {
  const { year, quarter } = quarterOf(d);
  return year + '-Q' + quarter;
}

function quarterRange(d) {
  const { year, quarter } = quarterOf(d);
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/** "2026-Q2" -> "2025-Q2" */
function yearAgoKey(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  return (parseInt(m[1], 10) - 1) + '-Q' + m[2];
}

/** "2026-Q2" -> "2026-Q1"; "2026-Q1" -> "2025-Q4" */
function priorKey(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  const y = parseInt(m[1], 10), q = parseInt(m[2], 10);
  if (q === 1) return (y - 1) + '-Q4';
  return y + '-Q' + (q - 1);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10) / 10; }

function formatPrice(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 10) return '$' + n.toFixed(2);
  if (n >= 1)  return '$' + n.toFixed(2);
  return '$' + n.toFixed(3);
}

function formatPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const sign = n > 0 ? '+' : '';
  return sign + (n * 100).toFixed(1) + '%';
}

export async function onRequestGet({ request, env }) {
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp({ success: false, error: 'HISTORY_KV not bound' }, 500);
  }

  const url = new URL(request.url);
  const metric = (url.searchParams.get('metric') || 'input').toLowerCase();
  if (metric !== 'input' && metric !== 'output') {
    return jsonResp(
      { success: false, error: 'metric must be "input" or "output"' },
      400
    );
  }
  const range = Math.min(
    parseInt(url.searchParams.get('range') || '400', 10) || 400,
    400
  );

  // ── Load index + all daily snapshots in range ──
  const index = (await kv.get('index:days', 'json')) || [];
  const days = index.slice(0, range);
  const dailies = (
    await Promise.all(days.map(d => kv.get('day:' + d, 'json')))
  ).filter(s => s && s.pricing && Array.isArray(s.pricing.models));

  if (!dailies.length) {
    return jsonResp({
      success: true,
      metric,
      basket: { size: BASKET_SIZE, members: PRICING_BASKET },
      trackingSinceDate: null,
      quarters: [],
      message:
        'No canonical pricing snapshots yet. Run /api/history-capture to create the first snapshot.',
    });
  }

  // Tracking-since = earliest day that has basket-pricing data
  const trackingSinceDate = dailies.reduce(
    (min, s) => (s.date < min ? s.date : min),
    dailies[0].date
  );

  // ── Per-day basket average ──
  // Equal-weighted mean across matched basket members on that day.
  const dailyStats = dailies
    .map(s => {
      const prices = [];
      for (const m of s.pricing.models) {
        const v = metric === 'input' ? m.input : m.output;
        if (typeof v === 'number' && isFinite(v)) prices.push(v);
      }
      if (!prices.length) return null;
      const sum = prices.reduce((a, b) => a + b, 0);
      return {
        date: s.date,
        dayAvg: sum / prices.length,
        matched: prices.length,
      };
    })
    .filter(Boolean);

  if (!dailyStats.length) {
    return jsonResp({
      success: true,
      metric,
      basket: { size: BASKET_SIZE, members: PRICING_BASKET },
      trackingSinceDate,
      quarters: [],
      message:
        'No pricing observations for metric=' + metric +
        ' in captured snapshots yet.',
    });
  }

  // ── Group by calendar quarter ──
  const todayKey = quarterKey(new Date());
  const groups = new Map(); // key -> { key, range, days:[] }
  for (const ds of dailyStats) {
    const dt = parseDateUTC(ds.date);
    const key = quarterKey(dt);
    if (!groups.has(key)) {
      groups.set(key, { key, range: quarterRange(dt), days: [] });
    }
    groups.get(key).days.push(ds);
  }

  // ── Compute per-quarter averages ──
  const quarterMap = new Map(); // key -> { avg, dayCount, coverage }
  for (const [key, g] of groups) {
    const avg = g.days.reduce((s, d) => s + d.dayAvg, 0) / g.days.length;
    const coverageAvg =
      g.days.reduce((s, d) => s + d.matched, 0) / g.days.length;
    quarterMap.set(key, {
      avg,
      dayCount: g.days.length,
      matched: Math.round(coverageAvg),
      range: g.range,
    });
  }

  // ── Build output sorted newest quarter first ──
  const sortedKeys = Array.from(quarterMap.keys()).sort().reverse();

  const quarters = sortedKeys.map(key => {
    const q = quarterMap.get(key);
    const prior = quarterMap.get(priorKey(key));
    const yearAgo = quarterMap.get(yearAgoKey(key));
    const partial = key === todayKey;

    const qoq =
      prior && prior.avg > 0 ? (q.avg - prior.avg) / prior.avg : null;
    const yoy =
      yearAgo && yearAgo.avg > 0 ? (q.avg - yearAgo.avg) / yearAgo.avg : null;

    const coverageRatio = q.matched / BASKET_SIZE;
    const lowCoverage = coverageRatio < 0.625; // <10/16

    const notes = [];
    if (partial) notes.push('QTD avg · partial quarter');
    notes.push('basket coverage ' + q.matched + '/' + BASKET_SIZE);
    if (lowCoverage) notes.push('low coverage — comparisons may be noisy');
    if (q.dayCount < 7 && !partial)
      notes.push('only ' + q.dayCount + ' observed day' + (q.dayCount === 1 ? '' : 's'));
    if (qoq === null) notes.push('QoQ: insufficient prior-quarter history');
    if (yoy === null) notes.push('YoY: insufficient year-ago history');

    return {
      id: key,
      start: q.range.start,
      end: q.range.end,
      avg: round2(q.avg),
      avgLabel: formatPrice(q.avg),
      qoq: qoq !== null ? round2(qoq * 1000) / 1000 : null,
      qoqLabel: formatPct(qoq),
      yoy: yoy !== null ? round2(yoy * 1000) / 1000 : null,
      yoyLabel: formatPct(yoy),
      coverage: {
        matched: q.matched,
        basket: BASKET_SIZE,
        ratio: round2(coverageRatio),
      },
      dayCount: q.dayCount,
      partial,
      notes,
    };
  });

  return jsonResp({
    success: true,
    metric,
    methodology:
      'Equal-weighted arithmetic mean across matched basket members per day, ' +
      'then mean of daily averages per quarter. Stable tracked basket only. ' +
      'QoQ vs immediately prior quarter; YoY vs same calendar quarter one year earlier. ' +
      'Real captured snapshots only — no backfill, no synthetic data.',
    basket: {
      size: BASKET_SIZE,
      members: PRICING_BASKET,
    },
    trackingSinceDate,
    quarters,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
