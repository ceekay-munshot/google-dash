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

  return jsonResp({
    success: true,
    dimension,
    metric,
    grain,
    limit,
    snapshot_count: ascSnaps.length,
    first_snapshot_date: ascSnaps[0].snapshot_date,
    latest_snapshot_date: latestSnap.snapshot_date,
    series,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}

export const onRequestOptions = corsPreflight;
