/**
 * Cloudflare Pages Function — AWS Public Network Capacity Proxy: time series
 * Route: GET /api/aws/ip-ranges/timeseries
 *
 * Returns a per-service (or future per-region) time series built from the
 * captured daily snapshots already stored in HISTORY_KV. This endpoint is
 * READ-ONLY — it never fetches AWS upstream and never writes to KV.
 *
 * Query params (all optional, all with defaults):
 *   ?dimension=service                — only "service" is supported today;
 *                                       any other value returns 400 cleanly.
 *   ?metric=ipv4_addresses            — the by_service field to plot. The
 *                                       endpoint accepts ipv4_addresses,
 *                                       ipv4_prefixes, or ipv6_prefixes.
 *   ?grain=daily                      — daily only for now.
 *   ?limit=8                          — max series to return; ranked by
 *                                       LATEST snapshot value desc.
 *   ?range=400                        — max number of stored days to scan;
 *                                       capped at 400 to match index size.
 *
 * Series rules (matches customer spec):
 *   - Top-N is ranked by the LATEST snapshot's value, descending.
 *   - For each picked service, points[] spans every captured date (asc)
 *     in the scanned window.
 *   - If a service has no row on a given date (it appeared/disappeared,
 *     or that day's snapshot lacks it), the point's value is `null` — NOT 0
 *     — so the chart renders a gap rather than a fake zero.
 *   - With only one snapshot, absolute_change and pct_change are null per
 *     spec. With two or more, change is computed against the first
 *     non-null value in the series. If first_value is null or zero,
 *     pct_change stays null.
 *
 * Preview mode (opt-in, off by default):
 *   ?demo=1 (or ?preview=1)             enables a one-time synthetic prior
 *                                       point so the chart can render
 *                                       BEFORE real history has accumulated.
 *
 *   When demo is on AND only one real snapshot exists, each series gets
 *   one synthetic point prepended at (latest_date − 1 day) with value =
 *   round(latest_value × DEMO_PRIOR_FACTOR). Default factor is 0.985
 *   (synthetic prior is 1.5% lower than the real latest, so the chart
 *   shows realistic upward motion). The synthetic point is marked
 *   { synthetic: true } and the response carries demo:true,
 *   demo_factor:0.015 so the UI can render an unmistakable PREVIEW badge.
 *
 *   Demo is a NO-OP once two or more real snapshots exist — the feature
 *   self-retires the moment real history is enough to draw a chart.
 *
 *   Synthetic points are NEVER written to KV. Pure on-the-fly compute.
 */

import {
  DAY_PREFIX,
  INDEX_KEY,
  jsonResp,
  corsPreflight,
} from '../_ipr-utils.js';

// Whitelist of metrics the endpoint will plot. by_service rows carry these
// three fields and only these — anything else is a request-shape error.
const ALLOWED_METRICS = new Set(['ipv4_addresses', 'ipv4_prefixes', 'ipv6_prefixes']);

// Demo-mode synthetic prior point: 1.5% lower than the real latest. Picked
// to be small enough to look plausible but big enough to be visible at log
// scale; intentionally NOT user-tunable to keep the preview unambiguous.
const DEMO_PRIOR_FACTOR = 0.985;

// Treat "1", "true", "yes" (any case) as truthy. Lets the flag work from
// browser query strings, curl, and gh-actions interchangeably.
function isTruthyFlag(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

// Subtract one calendar day from a YYYY-MM-DD UTC date string.
function dayBefore(dateStr) {
  const t = Date.parse(dateStr + 'T00:00:00Z');
  return new Date(t - 86400000).toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp({ success: false, error: 'HISTORY_KV not bound' }, 500);
  }

  const url = new URL(request.url);
  const dimension = (url.searchParams.get('dimension') || 'service').toLowerCase();
  const metric = (url.searchParams.get('metric') || 'ipv4_addresses').toLowerCase();
  const grain = (url.searchParams.get('grain') || 'daily').toLowerCase();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '8', 10) || 8, 1), 32);
  const range = Math.min(parseInt(url.searchParams.get('range') || '400', 10) || 400, 400);

  if (dimension !== 'service') {
    // Future-friendly: keeps the endpoint shape ready for dimension=region
    // without lying about current support.
    return jsonResp({
      success: false,
      error: 'Unsupported dimension: ' + dimension + ' (only "service" is supported today)',
    }, 400);
  }

  if (!ALLOWED_METRICS.has(metric)) {
    return jsonResp({
      success: false,
      error: 'Unsupported metric: ' + metric + ' (allowed: ipv4_addresses, ipv4_prefixes, ipv6_prefixes)',
    }, 400);
  }

  if (grain !== 'daily') {
    return jsonResp({
      success: false,
      error: 'Unsupported grain: ' + grain + ' (only "daily" is supported today)',
    }, 400);
  }

  // ── Load stored history ──
  const index = (await kv.get(INDEX_KEY, 'json')) || [];
  if (!index.length) {
    return jsonResp({
      success: true,
      dimension,
      metric,
      grain,
      limit,
      snapshot_count: 0,
      first_snapshot_date: null,
      latest_snapshot_date: null,
      series: [],
      message: 'No AWS IP-range history yet. Hit /api/aws/ip-ranges/capture to create the first snapshot.',
    });
  }

  // Index is desc; trim to the requested window then load each snapshot.
  // Because the response only ships {date, value} per series and we cap
  // both `range` and `limit`, even 400 days × 8 services is well under
  // 1MB of JSON.
  const dates = index.slice(0, range);
  const snapshots = (await Promise.all(
    dates.map(async (d) => kv.get(DAY_PREFIX + d, 'json'))
  )).filter(Boolean);

  if (!snapshots.length) {
    return jsonResp({
      success: true,
      dimension,
      metric,
      grain,
      limit,
      snapshot_count: 0,
      first_snapshot_date: null,
      latest_snapshot_date: null,
      series: [],
    });
  }

  // Snapshots come back desc — flip to asc for the points arrays so the
  // chart axis reads left-to-right naturally.
  snapshots.sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));
  const ascSnaps = snapshots;
  const latestSnap = ascSnaps[ascSnaps.length - 1];

  // ── Pick the top-N services by LATEST value ──
  const latestRows = Array.isArray(latestSnap?.by_service) ? latestSnap.by_service : [];
  const ranked = latestRows
    .filter(r => typeof r?.[metric] === 'number')
    .slice() // don't mutate the stored snapshot
    .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
    .slice(0, limit);

  const pickedNames = ranked.map(r => r.service);

  // ── Build series, one per picked service ──
  // For each service: walk every snapshot in chronological order and
  // emit { date, value } where value is `null` when that day's by_service
  // doesn't include the service (gap, not zero — see spec).
  const series = pickedNames.map(name => {
    const points = ascSnaps.map(snap => {
      const row = (snap.by_service || []).find(r => r.service === name);
      const value = (row && typeof row[metric] === 'number') ? row[metric] : null;
      return { date: snap.snapshot_date, value };
    });

    // first_value = first non-null value (chronologically earliest defined point)
    // latest_value = latest non-null value (latest defined point)
    let first_value = null, latest_value = null;
    for (let i = 0; i < points.length; i++) {
      if (points[i].value != null) {
        if (first_value === null) first_value = points[i].value;
        latest_value = points[i].value;
      }
    }

    let absolute_change = null;
    let pct_change = null;
    if (ascSnaps.length >= 2 && first_value != null && latest_value != null) {
      absolute_change = latest_value - first_value;
      if (first_value > 0) {
        pct_change = absolute_change / first_value;
      }
    }

    return {
      name,
      latest_value,
      first_value,
      absolute_change,
      pct_change,
      points,
    };
  });

  // ── Optional preview mode ──
  // Opt-in synthetic prior point so the chart can render before real
  // history accumulates. Self-retires the moment 2+ real snapshots exist:
  // the branch below fires only when ascSnaps.length === 1.
  const demoFlag = isTruthyFlag(url.searchParams.get('demo')) || isTruthyFlag(url.searchParams.get('preview'));
  let demo = false;
  let firstSnapshotDate = ascSnaps[0].snapshot_date;
  let snapshotCount = ascSnaps.length;

  if (demoFlag && ascSnaps.length === 1 && series.length > 0) {
    demo = true;
    const synthDate = dayBefore(latestSnap.snapshot_date);
    firstSnapshotDate = synthDate;
    snapshotCount = 2;

    for (const s of series) {
      if (typeof s.latest_value !== 'number') continue;
      // round to integer — IPv4 capacities are integer counts.
      const synthValue = Math.round(s.latest_value * DEMO_PRIOR_FACTOR);
      const synthPoint = { date: synthDate, value: synthValue, synthetic: true };
      s.points.unshift(synthPoint);
      s.first_value = synthValue;
      s.absolute_change = s.latest_value - synthValue;
      s.pct_change = synthValue > 0 ? s.absolute_change / synthValue : null;
    }
  }

  const respBody = {
    success: true,
    dimension,
    metric,
    grain,
    limit,
    snapshot_count: snapshotCount,
    first_snapshot_date: firstSnapshotDate,
    latest_snapshot_date: latestSnap.snapshot_date,
    series,
  };
  if (demo) {
    respBody.demo = true;
    respBody.demo_factor = +(1 - DEMO_PRIOR_FACTOR).toFixed(4); // 0.015 for default
    respBody.demo_note = 'Earliest point per series is a synthetic preview ' +
      ((1 - DEMO_PRIOR_FACTOR) * 100).toFixed(1) +
      '% below the real latest; will be replaced automatically once a second real snapshot is captured.';
  }

  return jsonResp(respBody, 200, { 'Cache-Control': 'public, max-age=60' });
}

export const onRequestOptions = corsPreflight;
