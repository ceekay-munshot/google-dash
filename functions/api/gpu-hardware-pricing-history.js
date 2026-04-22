/**
 * Cloudflare Pages Function — GPU Pricing History Read
 * Route: /api/gpu-hardware-pricing-history
 * Method: GET
 *
 * Layers on top of the canonical daily history (`index:days` + the
 * `day:YYYY-MM-DD` snapshots written by /api/history-capture). Extracts
 * the `gpu` block from each snapshot.
 *
 * Query params:
 *   ?window=<integer days>   For daily view: default 60, clamp 7..180.
 *                            For quarterly view: auto-bumps to 400 unless
 *                            explicitly set, so multiple quarters are
 *                            included.
 *   ?view=daily|quarter      Default daily. Quarter returns calendar-
 *                            quarter aggregations and QoQ comparisons.
 *   ?include=real|all        Default real. "real" excludes synthetic /
 *                            backfill-only snapshots from the primary
 *                            output (investor-facing). "all" includes
 *                            everything for debugging. trackingSinceDate
 *                            is always reported against the filter used.
 *
 * Real-vs-synthetic classification:
 *   A snapshot is "real" iff !snapshot.backfill AND its source string
 *   does not contain "backfill" (case-insensitive). This cleanly excludes
 *   both main-capture backfills (source:"backfill") and GPU-only validation
 *   seeds (source:"gpu-refresh-backfill"), while keeping cron captures,
 *   manual dev runs, and mid-day gpu-refresh merges.
 *
 * Response — daily view:
 *   {
 *     success, view:"daily",
 *     trackingSinceDate, latestDate, daysWithGPU,
 *     trackedSKUs, availableSKUs,
 *     enough: { d7, d30 },
 *     latest: { "Nvidia H100": {...} },
 *     series: { "Nvidia H100": [ {date, minPricePerHour, ...} ] },
 *     comparisons: { d7: {...}, d30: {...} },
 *     signals: { "Nvidia H100": "loosening" | ... }
 *   }
 *
 * Response — quarter view:
 *   {
 *     success, view:"quarter",
 *     trackingSinceRealDate, latestRealSnapshotDate,
 *     quartersAvailable: ["2026-Q1","2026-Q2"],
 *     trackedSKUs, availableSKUs,
 *     series: {
 *       "Nvidia H100": [
 *         {
 *           quarter:"2026-Q1", year, q, periodStart, periodEnd,
 *           firstRealSnapshotDateInQuarter, lastRealSnapshotDateInQuarter,
 *           daysCoveredInQuarter, quarterDayCount, coverageRatioWithinQuarter,
 *           lowCoverage,
 *           quarterOpenMinPricePerHour, quarterCloseMinPricePerHour,
 *           quarterAverageMinPricePerHour, quarterLowMinPricePerHour,
 *           quarterHighMinPricePerHour,
 *           quarterCloseProviderCount, quarterAverageProviderCount,
 *           quarterCloseSpreadMultiple, quarterAverageSpreadMultiple,
 *           isQuarterComplete, isQTD
 *         }, ...
 *       ]
 *     },
 *     qoq: {
 *       "Nvidia H100": {
 *         status: "ok" | "insufficient",
 *         currentQuarter, priorQuarter,
 *         currentClose, priorClose, qoqPct, qoqAbs,
 *         currentProviders, priorProviders, providerDelta,
 *         currentSpread, priorSpread, spreadDelta,
 *         currentIsQTD, coverageRatio
 *       }
 *     },
 *     signals: { "Nvidia H100": "loosening" | "tightening" | "stable" | "insufficient-data" }
 *   }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TRACKED_SKUS = [
  'Nvidia H100',
  'Nvidia H200',
  'Nvidia B200',
  'Nvidia GB200',
  'Nvidia A100',
  'Nvidia L40S',
];

function jsonResp(data, status = 200, cache = 'public, max-age=120, s-maxage=300') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache,
      ...CORS,
    },
  });
}

function isRealSnapshot(snap) {
  if (!snap) return false;
  if (snap.backfill === true) return false;
  const src = typeof snap.source === 'string' ? snap.source : '';
  if (/backfill/i.test(src)) return false;
  return true;
}

export async function onRequestGet({ request, env }) {
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp(
      { success: false, error: 'HISTORY_KV not bound' },
      500,
      'no-store'
    );
  }

  const url = new URL(request.url);
  const view = (url.searchParams.get('view') || 'daily').toLowerCase();
  const isQuarter = view === 'quarter' || view === 'quarterly';
  const isFinancial = view === 'financial' || view === 'correlation';
  const include = (url.searchParams.get('include') || 'real').toLowerCase();
  const keepAll = include === 'all';

  // Window: daily default 60, quarter/financial default 400 (full cap).
  const windowParam = url.searchParams.get('window');
  let windowDays;
  if (windowParam != null) {
    windowDays = parseInt(windowParam, 10);
    if (!isFinite(windowDays) || windowDays < 7) windowDays = (isQuarter || isFinancial) ? 400 : 60;
    if (windowDays > 400) windowDays = 400;
  } else {
    windowDays = (isQuarter || isFinancial) ? 400 : 60;
  }

  const index = (await kv.get('index:days', 'json')) || [];
  if (!index.length) {
    if (isFinancial) return emptyFinancialResponse('no history yet');
    return emptyResponse('no history yet', isQuarter);
  }

  const dates = index.slice(0, windowDays);
  // Fetch all snapshots in parallel — same pattern as /api/history
  const snaps = await Promise.all(
    dates.map(async d => {
      const s = await kv.get('day:' + d, 'json');
      return s ? { date: d, snap: s } : null;
    })
  );

  // Build per-SKU series, newest-first → we'll reverse per-series to
  // oldest-first for chart friendliness.
  const series = {};
  const latestBySku = {};
  let daysWithGPU = 0;
  let trackingSince = null;    // earliest snapshot date (possibly synthetic if keepAll)
  let latestDate = null;
  let trackingSinceReal = null;
  let latestRealDate = null;

  for (const entry of snaps) {
    if (!entry) continue;
    const { date, snap } = entry;
    if (!snap || !snap.gpu || !Array.isArray(snap.gpu.models)) continue;
    const real = isRealSnapshot(snap);
    if (!real && !keepAll) continue;
    daysWithGPU++;
    if (!latestDate) latestDate = date;
    trackingSince = date; // loop is newest-first, so last non-null wins as earliest
    if (real) {
      if (!latestRealDate) latestRealDate = date;
      trackingSinceReal = date;
    }
    for (const m of snap.gpu.models) {
      const sku = m.gpuModel;
      if (!series[sku]) series[sku] = [];
      series[sku].push({
        date,
        minPricePerHour: m.minPricePerHour,
        maxPricePerHour: m.maxPricePerHour,
        providerCount: m.providerCount,
        spreadAbsolute: m.spreadAbsolute,
        spreadMultiple: m.spreadMultiple,
        priceMidpoint: m.priceMidpoint,
        _real: real,
      });
      if (!latestBySku[sku]) {
        latestBySku[sku] = { date, ...m, _real: real };
      }
    }
  }

  // Flip each series to chronological order (oldest → newest) for charts.
  for (const k of Object.keys(series)) series[k].reverse();

  // Available SKUs — intersection of trackedSKUs and what we actually have data for.
  const availableSKUs = TRACKED_SKUS.filter(s => series[s] && series[s].length);

  // Comparisons: take the latest point and the point closest-to-but-not-newer
  // than N days ago; compute delta. If no such prior point exists, null.
  const mkComparison = nDays => {
    const out = {};
    for (const sku of availableSKUs) {
      const pts = series[sku];
      if (!pts || pts.length < 2) {
        out[sku] = { status: 'insufficient', pointsAvailable: pts?.length || 0 };
        continue;
      }
      const latest = pts[pts.length - 1];
      const targetTs = Date.parse(latest.date + 'T00:00:00Z') - nDays * 86400000;
      // walk backwards to find the oldest point that is NOT newer than targetTs
      let priorIdx = -1;
      for (let i = pts.length - 2; i >= 0; i--) {
        if (Date.parse(pts[i].date + 'T00:00:00Z') <= targetTs) {
          priorIdx = i;
          break;
        }
      }
      if (priorIdx < 0) {
        out[sku] = { status: 'insufficient', pointsAvailable: pts.length, oldest: pts[0].date };
        continue;
      }
      const prior = pts[priorIdx];
      out[sku] = {
        status: 'ok',
        latestDate: latest.date,
        priorDate: prior.date,
        minDeltaAbs:
          latest.minPricePerHour != null && prior.minPricePerHour != null
            ? +(latest.minPricePerHour - prior.minPricePerHour).toFixed(4)
            : null,
        minDeltaPct:
          latest.minPricePerHour != null && prior.minPricePerHour && prior.minPricePerHour > 0
            ? +(
                ((latest.minPricePerHour - prior.minPricePerHour) / prior.minPricePerHour) *
                100
              ).toFixed(2)
            : null,
        providerDelta:
          latest.providerCount != null && prior.providerCount != null
            ? latest.providerCount - prior.providerCount
            : null,
        spreadMultipleDelta:
          latest.spreadMultiple != null && prior.spreadMultiple != null
            ? +(latest.spreadMultiple - prior.spreadMultiple).toFixed(3)
            : null,
      };
    }
    return out;
  };

  const d7 = mkComparison(7);
  const d30 = mkComparison(30);

  // Signal classification — uses the 7D window.
  // loosening: providers ↑ or min price ↓ meaningfully (>= 2%)
  // tightening: providers ↓ or min price ↑ meaningfully (>= 2%)
  // stable: small movement in both dimensions
  const signals = {};
  for (const sku of availableSKUs) {
    const c = d7[sku];
    if (!c || c.status !== 'ok') {
      signals[sku] = 'insufficient-data';
      continue;
    }
    const pricePct = c.minDeltaPct;
    const providerDelta = c.providerDelta;
    const priceDown = pricePct != null && pricePct <= -2;
    const priceUp = pricePct != null && pricePct >= 2;
    const providersUp = providerDelta != null && providerDelta > 0;
    const providersDown = providerDelta != null && providerDelta < 0;
    if ((priceDown && !providersDown) || (providersUp && !priceUp)) {
      signals[sku] = 'loosening';
    } else if ((priceUp && !providersUp) || (providersDown && !priceDown)) {
      signals[sku] = 'tightening';
    } else {
      signals[sku] = 'stable';
    }
  }

  // Enough-data flags: we need at least one point ≥ Nd old AND a latest point.
  const hasPoint = (sku, nDays) => {
    const pts = series[sku];
    if (!pts || pts.length < 2) return false;
    const latestTs = Date.parse(pts[pts.length - 1].date + 'T00:00:00Z');
    const target = latestTs - nDays * 86400000;
    return pts.some(p => Date.parse(p.date + 'T00:00:00Z') <= target);
  };
  const enough = {
    d7: availableSKUs.some(s => hasPoint(s, 7)),
    d30: availableSKUs.some(s => hasPoint(s, 30)),
  };

  if (isQuarter) {
    return buildQuarterResponse({
      series,
      latestBySku,
      trackingSinceReal,
      latestRealDate,
      trackingSince,
      latestDate,
      daysWithGPU,
      availableSKUs,
      windowDays,
      include,
    });
  }

  if (isFinancial) {
    return buildFinancialResponse({
      series,
      trackingSinceReal,
      latestRealDate,
      trackingSince,
      latestDate,
      daysWithGPU,
      availableSKUs,
      windowDays,
      include,
    });
  }

  return jsonResp({
    success: true,
    view: 'daily',
    include,
    trackingSinceDate: trackingSinceReal || trackingSince,
    trackingSinceRealDate: trackingSinceReal,
    latestDate: latestRealDate || latestDate,
    latestRealSnapshotDate: latestRealDate,
    daysWithGPU,
    windowDays,
    trackedSKUs: TRACKED_SKUS,
    availableSKUs,
    enough,
    latest: latestBySku,
    series,
    comparisons: { d7, d30 },
    signals,
  });
}

/* ─── Quarter aggregation ──────────────────────────────────
   Calendar quarters: Q1=Jan–Mar, Q2=Apr–Jun, Q3=Jul–Sep, Q4=Oct–Dec (UTC).
   Aggregates operate on the already-filtered per-SKU series (real-only by
   default; series points include a `_real` flag but the caller already
   applied the include filter, so every point here is eligible). */

function quarterIdForDate(date) {
  const [y, m] = date.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return { id: y + '-Q' + q, year: y, q };
}

function quarterBounds(year, q) {
  const startMonth = (q - 1) * 3; // 0-indexed
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 1)); // exclusive
  end.setUTCDate(end.getUTCDate() - 1); // inclusive last day
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    days: Math.round((Date.UTC(year, startMonth + 3, 1) - Date.UTC(year, startMonth, 1)) / 86400000),
  };
}

function daysInclusive(startDate, endDate) {
  return Math.round(
    (Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000
  ) + 1;
}

function avg(nums) {
  const valid = nums.filter(n => typeof n === 'number' && isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function aggregateQuartersForSKU(series, todayStr) {
  if (!series || !series.length) return [];
  // Group by quarter, preserving chronological order (series is already oldest-first).
  const groups = new Map();
  for (const pt of series) {
    const { id, year, q } = quarterIdForDate(pt.date);
    if (!groups.has(id)) groups.set(id, { id, year, q, points: [] });
    groups.get(id).points.push(pt);
  }
  const quarters = Array.from(groups.values()).sort((a, b) => a.id < b.id ? -1 : 1);
  return quarters.map(g => {
    const { start: periodStart, end: periodEnd, days: totalDaysInQuarter } = quarterBounds(g.year, g.q);
    const pts = g.points; // already ordered oldest → newest
    const first = pts[0];
    const last = pts[pts.length - 1];
    const mins = pts.map(p => p.minPricePerHour);
    const providers = pts.map(p => p.providerCount);
    const spreads = pts.map(p => p.spreadMultiple);
    const uniqDates = new Set(pts.map(p => p.date));
    const daysCovered = uniqDates.size;

    const isQTD = periodStart <= todayStr && todayStr <= periodEnd;
    const isComplete = periodEnd < todayStr;
    // Effective denominator for QTD: days elapsed so far within quarter
    const effectiveDays = isQTD ? daysInclusive(periodStart, todayStr) : totalDaysInQuarter;
    const coverageRatio = effectiveDays > 0 ? daysCovered / effectiveDays : null;

    const quarterAvgMin = avg(mins);
    const quarterAvgProviders = avg(providers);
    const quarterAvgSpread = avg(spreads);

    return {
      quarter: g.id,
      year: g.year,
      q: g.q,
      periodStart,
      periodEnd,
      firstRealSnapshotDateInQuarter: first.date,
      lastRealSnapshotDateInQuarter: last.date,
      daysCoveredInQuarter: daysCovered,
      quarterDayCount: effectiveDays,
      coverageRatioWithinQuarter: coverageRatio != null ? +coverageRatio.toFixed(3) : null,
      lowCoverage: coverageRatio != null && coverageRatio < 0.25,
      quarterOpenMinPricePerHour: first.minPricePerHour,
      quarterCloseMinPricePerHour: last.minPricePerHour,
      quarterAverageMinPricePerHour: quarterAvgMin != null ? +quarterAvgMin.toFixed(4) : null,
      quarterLowMinPricePerHour: mins.length ? Math.min.apply(null, mins.filter(n => typeof n === 'number')) : null,
      quarterHighMinPricePerHour: mins.length ? Math.max.apply(null, mins.filter(n => typeof n === 'number')) : null,
      quarterCloseProviderCount: last.providerCount,
      quarterAverageProviderCount: quarterAvgProviders != null ? +quarterAvgProviders.toFixed(2) : null,
      quarterCloseSpreadMultiple: last.spreadMultiple,
      quarterAverageSpreadMultiple: quarterAvgSpread != null ? +quarterAvgSpread.toFixed(3) : null,
      isQuarterComplete: isComplete,
      isQTD,
      snapshotCount: pts.length,
    };
  });
}

function classifyQoQSignal(qoqPct, providerDelta) {
  if (qoqPct == null && providerDelta == null) return 'insufficient-data';
  const priceDown = qoqPct != null && qoqPct <= -2;
  const priceUp = qoqPct != null && qoqPct >= 2;
  const providersUp = providerDelta != null && providerDelta > 0;
  const providersDown = providerDelta != null && providerDelta < 0;
  if ((priceDown && !providersDown) || (providersUp && !priceUp)) return 'loosening';
  if ((priceUp && !providersUp) || (providersDown && !priceDown)) return 'tightening';
  return 'stable';
}

function buildQuarterResponse(ctx) {
  const { series, latestBySku, trackingSinceReal, latestRealDate, trackingSince, latestDate,
          daysWithGPU, availableSKUs, windowDays, include } = ctx;
  const today = new Date().toISOString().slice(0, 10);

  const quarterSeries = {};
  const qoq = {};
  const signals = {};
  const quarterIdSet = new Set();

  for (const sku of availableSKUs) {
    const agg = aggregateQuartersForSKU(series[sku] || [], today);
    quarterSeries[sku] = agg;
    for (const a of agg) quarterIdSet.add(a.quarter);

    if (agg.length >= 2) {
      const current = agg[agg.length - 1];
      const prior = agg[agg.length - 2];
      const currentClose = current.quarterCloseMinPricePerHour;
      const priorClose = prior.quarterCloseMinPricePerHour;
      const qoqAbs = (currentClose != null && priorClose != null) ? +(currentClose - priorClose).toFixed(4) : null;
      const qoqPct = (currentClose != null && priorClose && priorClose > 0)
        ? +(((currentClose - priorClose) / priorClose) * 100).toFixed(2)
        : null;
      const providerDelta = (current.quarterCloseProviderCount != null && prior.quarterCloseProviderCount != null)
        ? current.quarterCloseProviderCount - prior.quarterCloseProviderCount
        : null;
      const spreadDelta = (current.quarterCloseSpreadMultiple != null && prior.quarterCloseSpreadMultiple != null)
        ? +(current.quarterCloseSpreadMultiple - prior.quarterCloseSpreadMultiple).toFixed(3)
        : null;
      qoq[sku] = {
        status: 'ok',
        currentQuarter: current.quarter,
        priorQuarter: prior.quarter,
        currentClose,
        priorClose,
        qoqAbs,
        qoqPct,
        currentProviders: current.quarterCloseProviderCount,
        priorProviders: prior.quarterCloseProviderCount,
        providerDelta,
        currentSpread: current.quarterCloseSpreadMultiple,
        priorSpread: prior.quarterCloseSpreadMultiple,
        spreadDelta,
        currentIsQTD: current.isQTD,
        currentCoverageRatio: current.coverageRatioWithinQuarter,
        priorCoverageRatio: prior.coverageRatioWithinQuarter,
        lowCoverageFlag: current.lowCoverage || prior.lowCoverage,
      };
      signals[sku] = classifyQoQSignal(qoqPct, providerDelta);
    } else {
      qoq[sku] = {
        status: 'insufficient',
        quartersAvailable: agg.length,
        latestQuarter: agg[agg.length - 1]?.quarter || null,
        currentIsQTD: agg[agg.length - 1]?.isQTD || false,
      };
      signals[sku] = 'insufficient-data';
    }
  }

  const quartersAvailable = Array.from(quarterIdSet).sort();

  return jsonResp({
    success: true,
    view: 'quarter',
    include,
    trackingSinceRealDate: trackingSinceReal,
    latestRealSnapshotDate: latestRealDate,
    trackingSinceAny: trackingSince,
    latestDateAny: latestDate,
    daysWithGPU,
    windowDays,
    today,
    trackedSKUs: TRACKED_SKUS,
    availableSKUs,
    quartersAvailable,
    series: quarterSeries,
    qoq,
    signals,
  });
}

function emptyResponse(reason, isQuarter) {
  if (isQuarter) {
    return jsonResp({
      success: true,
      view: 'quarter',
      trackingSinceRealDate: null,
      latestRealSnapshotDate: null,
      trackingSinceAny: null,
      latestDateAny: null,
      daysWithGPU: 0,
      windowDays: 0,
      trackedSKUs: TRACKED_SKUS,
      availableSKUs: [],
      quartersAvailable: [],
      series: {},
      qoq: {},
      signals: {},
      note: reason,
    });
  }
  return jsonResp({
    success: true,
    view: 'daily',
    trackingSinceDate: null,
    trackingSinceRealDate: null,
    latestDate: null,
    latestRealSnapshotDate: null,
    daysWithGPU: 0,
    windowDays: 0,
    trackedSKUs: TRACKED_SKUS,
    availableSKUs: [],
    enough: { d7: false, d30: false },
    latest: {},
    series: {},
    comparisons: { d7: {}, d30: {} },
    signals: {},
    note: reason,
  });
}

/* ─── Financial correlation view ──────────────────────────
   Analyst-worksheet matrix. Unlike the quarter view (which uses quarter-
   CLOSE values), this view uses PERIOD AVERAGES — the arithmetic mean of
   every real daily minPricePerHour within the calendar period. Averages
   are computed from daily snapshots directly (not month-of-months) so
   uneven daily coverage doesn't skew quarterly numbers.

   QoQ growth = (current quarter avg - prior quarter avg) / prior quarter avg
   YoY growth = (current quarter avg - same quarter previous year avg) / same quarter previous year avg
   MoM growth = month analog of QoQ

   Quarter labels are quarter-end month format (Q1→Mar, Q2→Jun, Q3→Sep,
   Q4→Dec) — matches equity analyst period conventions. */

const FINANCIAL_PRIMARY_SKUS = ['Nvidia B200', 'Nvidia H200', 'Nvidia H100'];
const FINANCIAL_SECONDARY_SKUS = ['Nvidia GB200', 'Nvidia A100', 'Nvidia L40S'];

function monthIdForDate(dateStr) {
  return dateStr.slice(0, 7); // "2026-04-21" → "2026-04"
}

function monthBounds(year, monthIdx /* 1-12 */) {
  const start = new Date(Date.UTC(year, monthIdx - 1, 1));
  const nextStart = new Date(Date.UTC(year, monthIdx, 1));
  const end = new Date(nextStart.getTime() - 86400000);
  const days = Math.round((nextStart.getTime() - start.getTime()) / 86400000);
  return {
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
    days,
  };
}

function quarterEndLabel(year, q) {
  const endMonth = q * 3; // Q1→3, Q2→6, Q3→9, Q4→12
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[endMonth] + '-' + String(year % 100).padStart(2, '0');
}

function monthLabel(year, monthIdx) {
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[monthIdx] + '-' + String(year % 100).padStart(2, '0');
}

function avgOrNull(arr) {
  const valid = arr.filter(n => typeof n === 'number' && isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function pctChange(curr, prior) {
  if (curr == null || prior == null || prior === 0) return null;
  return +(((curr - prior) / prior) * 100).toFixed(2);
}

function buildFinancialResponse(ctx) {
  const { series, trackingSinceReal, latestRealDate, trackingSince, latestDate,
          daysWithGPU, availableSKUs, windowDays, include } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const todayMonthId = today.slice(0, 7);
  const { id: todayQuarterId } = quarterIdForDate(today);

  // Build per-SKU month + quarter aggregates.
  const monthlyBySku = {};
  const quarterlyBySku = {};
  const monthIdSet = new Set();
  const quarterIdSet = new Set();

  for (const sku of availableSKUs) {
    const pts = series[sku] || [];
    const monthBuckets = new Map();
    const quarterBuckets = new Map();

    for (const p of pts) {
      const mid = monthIdForDate(p.date);
      if (!monthBuckets.has(mid)) monthBuckets.set(mid, []);
      monthBuckets.get(mid).push(p);
      const { id: qid } = quarterIdForDate(p.date);
      if (!quarterBuckets.has(qid)) quarterBuckets.set(qid, []);
      quarterBuckets.get(qid).push(p);
    }

    const months = [];
    for (const [mid, arr] of Array.from(monthBuckets.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      monthIdSet.add(mid);
      const [y, m] = mid.split('-').map(Number);
      const { start, end, days: denom } = monthBounds(y, m);
      const dates = new Set(arr.map(p => p.date));
      const daysCovered = dates.size;
      const isMTD = mid === todayMonthId;
      // For MTD use days elapsed (today inclusive); for completed months use full month length.
      const effectiveDays = isMTD ? daysInclusive(start, today) : denom;
      const coverage = effectiveDays > 0 ? +(daysCovered / effectiveDays).toFixed(3) : null;
      months.push({
        period: mid,
        label: monthLabel(y, m),
        year: y,
        month: m,
        periodStart: start,
        periodEnd: end,
        daysCoveredInMonth: daysCovered,
        monthDayCount: effectiveDays,
        coverageRatioWithinMonth: coverage,
        isPartialMonth: isMTD || daysCovered < denom,
        isMTD,
        avgMinPricePerHour: roundMaybe(avgOrNull(arr.map(p => p.minPricePerHour)), 4),
        avgProviderCount:   roundMaybe(avgOrNull(arr.map(p => p.providerCount)), 2),
        avgSpreadMultiple:  roundMaybe(avgOrNull(arr.map(p => p.spreadMultiple)), 3),
      });
    }
    monthlyBySku[sku] = months;

    const quarters = [];
    for (const [qid, arr] of Array.from(quarterBuckets.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      quarterIdSet.add(qid);
      const m = /^(\d{4})-Q([1-4])$/.exec(qid);
      const y = parseInt(m[1], 10);
      const qi = parseInt(m[2], 10);
      const { start, end, days: denom } = quarterBounds(y, qi);
      const dates = new Set(arr.map(p => p.date));
      const daysCovered = dates.size;
      const isQTD = qid === todayQuarterId;
      const effectiveDays = isQTD ? daysInclusive(start, today) : denom;
      const coverage = effectiveDays > 0 ? +(daysCovered / effectiveDays).toFixed(3) : null;
      quarters.push({
        period: qid,
        label: quarterEndLabel(y, qi),
        year: y,
        q: qi,
        periodStart: start,
        periodEnd: end,
        daysCoveredInQuarter: daysCovered,
        quarterDayCount: effectiveDays,
        coverageRatioWithinQuarter: coverage,
        isPartialQuarter: isQTD || daysCovered < denom,
        isQTD,
        avgMinPricePerHour: roundMaybe(avgOrNull(arr.map(p => p.minPricePerHour)), 4),
        avgProviderCount:   roundMaybe(avgOrNull(arr.map(p => p.providerCount)), 2),
        avgSpreadMultiple:  roundMaybe(avgOrNull(arr.map(p => p.spreadMultiple)), 3),
      });
    }
    quarterlyBySku[sku] = quarters;
  }

  const monthlyLabels = Array.from(monthIdSet).sort().map(mid => {
    const [y, m] = mid.split('-').map(Number);
    return { period: mid, label: monthLabel(y, m) };
  });
  const quarterlyLabels = Array.from(quarterIdSet).sort().map(qid => {
    const m = /^(\d{4})-Q([1-4])$/.exec(qid);
    return { period: qid, label: quarterEndLabel(+m[1], +m[2]) };
  });

  // Growth matrices: MoM / QoQ / YoY (per SKU, keyed by period id, value = pct or null).
  const mom = {};
  const qoq = {};
  const yoyMonth = {};
  const yoyQuarter = {};

  for (const sku of availableSKUs) {
    mom[sku] = {};
    qoq[sku] = {};
    yoyMonth[sku] = {};
    yoyQuarter[sku] = {};

    // MoM
    const months = monthlyBySku[sku];
    const monthByPeriod = Object.fromEntries(months.map(x => [x.period, x]));
    for (const cur of months) {
      const priorId = priorMonthId(cur.period);
      const prior = monthByPeriod[priorId];
      mom[sku][cur.period] = pctChange(cur.avgMinPricePerHour, prior?.avgMinPricePerHour);
      const yoyId = yearPriorMonthId(cur.period);
      const yoyPrior = monthByPeriod[yoyId];
      yoyMonth[sku][cur.period] = pctChange(cur.avgMinPricePerHour, yoyPrior?.avgMinPricePerHour);
    }

    // QoQ + YoY (quarter)
    const quarters = quarterlyBySku[sku];
    const quarterByPeriod = Object.fromEntries(quarters.map(x => [x.period, x]));
    for (const cur of quarters) {
      const priorId = priorQuarterId(cur.period);
      const prior = quarterByPeriod[priorId];
      qoq[sku][cur.period] = pctChange(cur.avgMinPricePerHour, prior?.avgMinPricePerHour);
      const yoyId = yearPriorQuarterId(cur.period);
      const yoyPrior = quarterByPeriod[yoyId];
      yoyQuarter[sku][cur.period] = pctChange(cur.avgMinPricePerHour, yoyPrior?.avgMinPricePerHour);
    }
  }

  return jsonResp({
    success: true,
    view: 'financial',
    include,
    trackingSinceRealDate: trackingSinceReal,
    latestRealSnapshotDate: latestRealDate,
    trackingSinceAny: trackingSince,
    latestDateAny: latestDate,
    daysWithGPU,
    windowDays,
    today,
    primarySKUs: FINANCIAL_PRIMARY_SKUS,
    secondarySKUs: FINANCIAL_SECONDARY_SKUS,
    trackedSKUs: TRACKED_SKUS,
    availableSKUs,
    monthly: {
      labels: monthlyLabels,
      series: monthlyBySku,
      mom,
      yoy: yoyMonth,
    },
    quarterly: {
      labels: quarterlyLabels,
      series: quarterlyBySku,
      qoq,
      yoy: yoyQuarter,
    },
    methodology: {
      avgBasis: 'daily',
      note: 'Period averages are arithmetic means of daily minPricePerHour within the period. QoQ/YoY/MoM = (current period avg - prior period avg) / prior period avg × 100. Only real snapshots are included (synthetic backfill excluded by default).',
    },
  });
}

function roundMaybe(v, digits) {
  if (v == null || !isFinite(v)) return null;
  return +v.toFixed(digits);
}

function priorMonthId(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  if (m === 1) return (y - 1) + '-12';
  return y + '-' + String(m - 1).padStart(2, '0');
}

function yearPriorMonthId(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  return (y - 1) + '-' + String(m).padStart(2, '0');
}

function priorQuarterId(qid) {
  const m = /^(\d{4})-Q([1-4])$/.exec(qid);
  if (!m) return null;
  const y = +m[1], q = +m[2];
  if (q === 1) return (y - 1) + '-Q4';
  return y + '-Q' + (q - 1);
}

function yearPriorQuarterId(qid) {
  const m = /^(\d{4})-Q([1-4])$/.exec(qid);
  if (!m) return null;
  return (+m[1] - 1) + '-Q' + m[2];
}

function emptyFinancialResponse(reason) {
  return jsonResp({
    success: true,
    view: 'financial',
    trackingSinceRealDate: null,
    latestRealSnapshotDate: null,
    trackingSinceAny: null,
    latestDateAny: null,
    daysWithGPU: 0,
    windowDays: 0,
    primarySKUs: FINANCIAL_PRIMARY_SKUS,
    secondarySKUs: FINANCIAL_SECONDARY_SKUS,
    trackedSKUs: TRACKED_SKUS,
    availableSKUs: [],
    monthly: { labels: [], series: {}, mom: {}, yoy: {} },
    quarterly: { labels: [], series: {}, qoq: {}, yoy: {} },
    note: reason,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
