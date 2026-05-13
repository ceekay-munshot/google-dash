/**
 * Cloudflare Pages Function — UBS dataset trend reader.
 * Route: GET /api/ubs/snapshots/:datasetKey/trend
 *
 * Read-only time-series endpoint. Serves rows captured into
 * ubs_dataset_snapshots by POST /api/ubs/capture. NEVER calls UBS —
 * fast, cacheable, no auth. The 5-min edge cache (Cache-Control:
 * public, max-age=300) is safe because the capture endpoint runs at
 * most daily.
 *
 * Currently captured dataset: global_app_downloads_ai. Other keys
 * return 404 dataset_not_captured. The handler is generic enough to
 * pick up new captured datasets once they're added to
 * ALLOWED_DATASETS / UBS_DATASET_IDS.
 *
 * Param surface (all optional unless noted):
 *   metric     ∈ METRIC_UNITS keys   default downloadsShare
 *   geography  matched as dimension_2 default Global_90
 *   period     matched as period      default week
 *   app        comma-separated; max 50; exact-match against dimension_1.
 *              When set: returns those apps (empty series preserved).
 *              When absent: picks top-N apps by metric_value at the
 *              filter's MAX(snapshot_date). For unit=rank we sort ASC
 *              (lower rank = better); otherwise DESC.
 *   topN       clamped [1, 50]; default 10
 *   startDate  YYYY-MM-DD; filter snapshot_date >= startDate
 *   endDate    YYYY-MM-DD; filter snapshot_date <= endDate
 *   limit      clamped [1, 10000]; default 5000; total-rows cap
 *
 * Returns the response shape from the user spec verbatim
 * (snapshotDateRange, appsTotal, appsReturned, topApps, series[]).
 */

const ALLOWED_DATASETS = new Set(['global_app_downloads_ai']);

// Maps registry datasetKey → UBS dataAssetKey (echoed in response so
// the chart layer doesn't have to look it up separately).
const UBS_DATASET_IDS = {
  global_app_downloads_ai: '10087',
};

// Mirrors capture.js METRIC_UNITS. Keep these in sync if new metrics
// are captured.
const METRIC_UNITS = {
  downloadsGrowth:  'growth',
  revenueGrowth:    'growth',
  downloadsShare:   'share',
  revenueShare:     'share',
  downloadsRank:    'rank',
  revenueRank:      'rank',
  downloadsIndex:   'index',
  revenueIndex:     'index',
  indexedDownloads: 'index',
  indexedRevenue:   'index',
};

const DEFAULT_METRIC    = 'downloadsShare';
const DEFAULT_GEOGRAPHY = 'Global_90';
const DEFAULT_PERIOD    = 'week';

const DEFAULT_TOP_N     = 10;
const MAX_TOP_N         = 50;
const DEFAULT_LIMIT     = 5000;
const MAX_LIMIT         = 10000;
const MAX_EXPLICIT_APPS = 50;  // keep IN-clause + other params well under D1's 100-bound-param cap

const DATE_SHAPE        = /^\d{4}-\d{2}-\d{2}$/;
const DATASET_KEY_SHAPE = /^[A-Za-z0-9_-]{1,80}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status >= 400 ? 'no-store' : 'public, max-age=300',
      ...CORS,
      ...extraHeaders,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

function clampInt(raw, min, max, defaultValue) {
  const n = parseInt(raw == null ? '' : String(raw), 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(Math.max(n, min), max);
}

async function tableExists(db, name) {
  try {
    const r = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
    return !!r;
  } catch {
    return false;
  }
}

/**
 * Group flat (app, snapshot_date, value) rows into per-app series.
 * Preserves the order of `appsToFetch` so explicit-app callers see
 * their request order honored. Empty series are kept (with
 * pointCount: 0, latest: null) so callers can tell apart "missing
 * data" from "data not requested".
 */
export function groupSeries(rows, appsToFetch) {
  const map = new Map();
  for (const r of rows) {
    const arr = map.get(r.app) || [];
    arr.push({ snapshot_date: r.snapshot_date, value: r.value });
    map.set(r.app, arr);
  }
  return appsToFetch.map((app) => {
    const points = map.get(app) || [];
    const latest = points.length > 0 ? points[points.length - 1] : null;
    return {
      app,
      pointCount: points.length,
      latest,
      points,
    };
  });
}

export async function onRequestGet({ request, env, params }) {
  const fetchedAt = new Date().toISOString();
  const url = new URL(request.url);
  const datasetKey = String(params?.datasetKey || '').trim();

  // ── Validate dataset key ──────────────────────────────────────────
  if (!DATASET_KEY_SHAPE.test(datasetKey)) {
    return jsonResp({
      ok: false, error: 'invalid_dataset_key',
      detail: 'datasetKey must match /^[A-Za-z0-9_-]{1,80}$/',
      datasetKey, fetchedAt,
    }, 400);
  }
  if (!ALLOWED_DATASETS.has(datasetKey)) {
    return jsonResp({
      ok: false, error: 'dataset_not_captured',
      detail: `"${datasetKey}" is not in the captured-datasets allow-list. Captured: ${[...ALLOWED_DATASETS].join(', ')}`,
      datasetKey, fetchedAt,
    }, 404);
  }

  // ── Parse + validate query params ─────────────────────────────────
  const metric = (url.searchParams.get('metric') || DEFAULT_METRIC).trim();
  if (!Object.prototype.hasOwnProperty.call(METRIC_UNITS, metric)) {
    return jsonResp({
      ok: false, error: 'invalid_metric',
      detail: `metric must be one of: ${Object.keys(METRIC_UNITS).join(', ')}`,
      metric, fetchedAt,
    }, 400);
  }
  const unit = METRIC_UNITS[metric];

  const geography = (url.searchParams.get('geography') || DEFAULT_GEOGRAPHY).trim();
  const period    = (url.searchParams.get('period')    || DEFAULT_PERIOD).trim();

  const startDate = url.searchParams.get('startDate');
  const endDate   = url.searchParams.get('endDate');
  if (startDate && !DATE_SHAPE.test(startDate)) {
    return jsonResp({ ok: false, error: 'invalid_start_date', detail: 'startDate must be YYYY-MM-DD', startDate, fetchedAt }, 400);
  }
  if (endDate && !DATE_SHAPE.test(endDate)) {
    return jsonResp({ ok: false, error: 'invalid_end_date', detail: 'endDate must be YYYY-MM-DD', endDate, fetchedAt }, 400);
  }

  const topN  = clampInt(url.searchParams.get('topN'),  1, MAX_TOP_N,  DEFAULT_TOP_N);
  const limit = clampInt(url.searchParams.get('limit'), 1, MAX_LIMIT,  DEFAULT_LIMIT);

  const appRaw = url.searchParams.get('app');
  const explicitApps = appRaw
    ? appRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_EXPLICIT_APPS)
    : null;

  // ── D1 binding + table check ──────────────────────────────────────
  if (!env?.EC2_PRICING_DB) {
    return jsonResp({
      ok: false, error: 'd1_binding_missing',
      detail: 'env.EC2_PRICING_DB is not bound on this environment',
      datasetKey, fetchedAt,
    }, 500);
  }
  const db = env.EC2_PRICING_DB;

  const exists = await tableExists(db, 'ubs_dataset_snapshots');
  if (!exists) {
    return jsonResp({
      ok: false, error: 'migration_missing', tableExists: false, migrationMissing: true,
      detail: 'ubs_dataset_snapshots table does not exist. Apply migrations first.',
      datasetKey, fetchedAt,
    }, 500);
  }

  // ── Probe: date range, apps total, and dataset-has-rows guard ─────
  const probeRow = await db.prepare(`
    SELECT
      MIN(snapshot_date) AS minDate,
      MAX(snapshot_date) AS maxDate,
      COUNT(DISTINCT dimension_1) AS appsTotal
    FROM ubs_dataset_snapshots
    WHERE dataset_key = ? AND metric_name = ? AND dimension_2 = ? AND period = ?
  `).bind(datasetKey, metric, geography, period).first();

  const appsTotal = probeRow?.appsTotal || 0;
  const minDate   = probeRow?.minDate || null;
  const maxDate   = probeRow?.maxDate || null;

  if (appsTotal === 0) {
    return jsonResp({
      ok: false, error: 'no_rows_for_filters',
      detail: `No rows for datasetKey=${datasetKey}, metric=${metric}, geography=${geography}, period=${period}`,
      datasetKey,
      ubsDatasetId: UBS_DATASET_IDS[datasetKey] || null,
      metric, unit, geography, period,
      snapshotDateRange: { min: null, max: null },
      appsTotal: 0,
      fetchedAt,
    }, 404);
  }

  // ── Resolve apps to fetch ─────────────────────────────────────────
  let appsToFetch;
  if (explicitApps && explicitApps.length > 0) {
    appsToFetch = explicitApps;
  } else {
    // Top-N by metric_value at MAX(snapshot_date). For unit=rank we
    // want LOWEST values; for share/index/growth we want HIGHEST.
    const sortDir = unit === 'rank' ? 'ASC' : 'DESC';
    const topRes = await db.prepare(`
      SELECT dimension_1 AS app, metric_value AS latestValue
      FROM ubs_dataset_snapshots
      WHERE dataset_key = ?
        AND metric_name = ?
        AND dimension_2 = ?
        AND period = ?
        AND snapshot_date = ?
      ORDER BY metric_value ${sortDir}
      LIMIT ?
    `).bind(datasetKey, metric, geography, period, maxDate, topN).all();
    appsToFetch = (topRes?.results || []).map((r) => r.app);
  }

  if (appsToFetch.length === 0) {
    return jsonResp({
      ok: true,
      datasetKey,
      ubsDatasetId: UBS_DATASET_IDS[datasetKey] || null,
      metric, unit, geography, period,
      snapshotDateRange: { min: minDate, max: maxDate },
      appsTotal,
      appsReturned: 0,
      topApps: [],
      series: [],
      rowsReturned: 0,
      fetchedAt,
    });
  }

  // ── Fetch full series for selected apps ───────────────────────────
  const placeholders = appsToFetch.map(() => '?').join(',');
  const dateClauses  = [];
  const bound        = [datasetKey, metric, geography, period, ...appsToFetch];
  if (startDate) { dateClauses.push('snapshot_date >= ?'); bound.push(startDate); }
  if (endDate)   { dateClauses.push('snapshot_date <= ?'); bound.push(endDate);   }
  bound.push(limit);

  const seriesRes = await db.prepare(`
    SELECT dimension_1 AS app, snapshot_date AS snapshot_date, metric_value AS value
    FROM ubs_dataset_snapshots
    WHERE dataset_key = ?
      AND metric_name = ?
      AND dimension_2 = ?
      AND period = ?
      AND dimension_1 IN (${placeholders})
      ${dateClauses.length > 0 ? ' AND ' + dateClauses.join(' AND ') : ''}
    ORDER BY dimension_1 ASC, snapshot_date ASC
    LIMIT ?
  `).bind(...bound).all();

  const rows = seriesRes?.results || [];
  const series = groupSeries(rows, appsToFetch);

  return jsonResp({
    ok: true,
    datasetKey,
    ubsDatasetId: UBS_DATASET_IDS[datasetKey] || null,
    metric, unit, geography, period,
    snapshotDateRange: { min: minDate, max: maxDate },
    appsTotal,
    appsReturned: series.length,
    topApps: series.map((s) => s.app),
    series,
    rowsReturned: rows.length,
    fetchedAt,
  });
}
