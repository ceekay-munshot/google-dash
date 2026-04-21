/**
 * Cloudflare Pages Function — GPU Pricing History Read
 * Route: /api/gpu-hardware-pricing-history
 * Method: GET
 *
 * Layers on top of the canonical daily history (`index:days` + the
 * `day:YYYY-MM-DD` snapshots written by /api/history-capture). Extracts
 * the `gpu` block from each snapshot and returns per-SKU daily series
 * + 7D / 30D comparisons for the strategic accelerator basket.
 *
 * Query params:
 *   ?window=<integer days>   default 60, clamp 7..180. Controls how many
 *                            days of history to read from the end of the
 *                            index (newest-first).
 *
 * Response shape (success):
 *   {
 *     success: true,
 *     trackingSinceDate: "YYYY-MM-DD" | null,
 *     latestDate:        "YYYY-MM-DD" | null,
 *     daysWithGPU: <int>,                 // snapshots in window that had gpu block
 *     availableSKUs: ["Nvidia H100", ...],
 *     enough: { d7: bool, d30: bool },    // do we have data spanning 7d / 30d?
 *     latest: { "Nvidia H100": { date, minPricePerHour, ... } },
 *     series: {
 *       "Nvidia H100": [
 *         { date, minPricePerHour, maxPricePerHour, providerCount,
 *           spreadAbsolute, spreadMultiple, priceMidpoint }, ...
 *       ],
 *       ...
 *     },
 *     comparisons: {
 *       d7:  { "Nvidia H100": { minDeltaPct, providerDelta, ... } },
 *       d30: { "Nvidia H100": { ... } }
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
  let windowDays = parseInt(url.searchParams.get('window') || '60', 10);
  if (!isFinite(windowDays) || windowDays < 7) windowDays = 60;
  if (windowDays > 180) windowDays = 180;

  const index = (await kv.get('index:days', 'json')) || [];
  if (!index.length) {
    return emptyResponse('no history yet');
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
  let trackingSince = null;
  let latestDate = null;

  for (const entry of snaps) {
    if (!entry) continue;
    const { date, snap } = entry;
    if (!snap || !snap.gpu || !Array.isArray(snap.gpu.models)) continue;
    daysWithGPU++;
    if (!latestDate) latestDate = date;
    trackingSince = date; // loop is newest-first, so last non-null wins as earliest
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
      });
      if (!latestBySku[sku]) {
        latestBySku[sku] = { date, ...m };
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

  return jsonResp({
    success: true,
    trackingSinceDate: trackingSince,
    latestDate,
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

function emptyResponse(reason) {
  return jsonResp({
    success: true,
    trackingSinceDate: null,
    latestDate: null,
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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
