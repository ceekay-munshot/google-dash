/**
 * Cloudflare Pages Function — UBS dataset capture.
 * Route: POST /api/ubs/capture
 *
 * Confirmed scope (hard-coded; caller cannot override):
 *   datasetKey:    global_app_downloads_ai
 *   ubsDatasetId:  10087   (UBS dataAssetKey)
 *   viewId:        share-v3
 *   filter:        compset = "Global AI App Monitor"
 *
 * Auth:
 *   Authorization: Bearer <UBS_CAPTURE_SECRET>
 *   - missing env binding → HTTP 500 { error: "missing_capture_secret" }
 *   - missing / wrong header → HTTP 401 { error: "unauthorized" }
 *   Neither UBS_CAPTURE_SECRET nor UBS_API_KEY is ever surfaced in the
 *   response. UBS_API_KEY only travels in the Authorization header to
 *   UBS via ubsGet().
 *
 * Query params (optional):
 *   ?limit=<n>      UBS page size — default 1000, hard max 1000
 *   ?maxPages=<n>   cap pages fetched — default 10, hard max 50
 *   ?offset=<n>     starting offset — default 0
 *   ?dryRun=1       fetch + normalize but do not write to D1 or KV
 *
 * Writes:
 *   - D1: env.EC2_PRICING_DB → ubs_dataset_snapshots
 *     (the same migrations/ dir already drives EC2 pricing; the UBS
 *     table is independent, scoped by dataset_key.)
 *   - KV: env.HISTORY_KV (when bound) → key
 *     `ubs:latest:global_app_downloads_ai` with a compact summary.
 *
 * Dedupe:
 *   - If UNIQUE INDEX idx_ubs_dataset_snapshots_unique exists (added
 *     by migration 0004): INSERT OR REPLACE.
 *   - Otherwise: scoped DELETE then INSERT, bounded by this capture's
 *     dataset_key, ubs_dataset_id, snapshot_dates, metric_names,
 *     dimension_1s, dimension_2s. Other UBS datasets are not touched.
 */

import { fetchUbsCatalogue, ubsGet, UBS_HOST } from './_client.js';
import { extractDatasetArray } from './_parser.js';
import { summarizeUbsLogicalError } from './dataset/[datasetKey].js';

const DATASET_KEY     = 'global_app_downloads_ai';
const UBS_DATASET_ID  = '10087';
const VIEW_ID         = 'share-v3';
const COMPSET_FILTER  = 'Global AI App Monitor';

const DEFAULT_PAGE_LIMIT = 1000;
const MAX_PAGE_LIMIT     = 1000;
const DEFAULT_MAX_PAGES  = 10;
const HARD_MAX_PAGES     = 50;
const PAGE_TIMEOUT_MS    = 15000;
const CATALOGUE_TIMEOUT_MS = 15000;

// Metric → unit mapping. metric_value is the numeric field from the
// UBS row; metric_name is the original UBS field name preserved as-is.
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

const SNAPSHOT_COLS = [
  'dataset_key', 'ubs_dataset_id', 'snapshot_date', 'period',
  'dimension_1', 'dimension_2', 'metric_name', 'metric_value',
  'unit', 'raw_json', 'source',
];

// D1 limits: ≤100 bound parameters per prepared statement, ≤100KB SQL
// text. 11 cols × 5 rows = 55 bound params per stmt, 20 stmts per
// batch = 100 rows per batch (matches the existing _d1-chunk.js
// pattern). Worst-case raw_json is the bulk of payload size.
const ROWS_PER_STMT   = 5;
const STMTS_PER_BATCH = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS,
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
    const r = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .bind(name).first();
    return !!r;
  } catch {
    return false;
  }
}

async function indexExists(db, name) {
  try {
    const r = await db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
      .bind(name).first();
    return !!r;
  } catch {
    return false;
  }
}

/**
 * Resolve view.dataUrl for the confirmed dataset/view by fetching the
 * UBS catalogue server-side.
 */
async function resolveDataUrl(env) {
  const cat = await fetchUbsCatalogue(env, { timeoutMs: CATALOGUE_TIMEOUT_MS });
  if (!cat.ok) {
    return {
      ok: false,
      error: 'catalogue_fetch_failed',
      detail: cat.error,
      errorCode: cat.code,
      upstreamStatus: cat.status || null,
      ...(cat.errorBody ? { errorBody: cat.errorBody } : {}),
    };
  }
  const items = extractDatasetArray(cat.json);
  if (!Array.isArray(items)) {
    return { ok: false, error: 'unparseable_catalogue', detail: 'UBS catalogue did not return a dataset array' };
  }
  const item = items.find((it) => String(it?.dataAssetKey || '') === UBS_DATASET_ID);
  if (!item) {
    return { ok: false, error: 'dataset_not_in_catalogue', detail: `dataAssetKey=${UBS_DATASET_ID} not found in UBS catalogue` };
  }
  const views = Array.isArray(item.views) ? item.views : [];
  const view = views.find((v) => String(v?.id) === VIEW_ID);
  if (!view) {
    return {
      ok: false,
      error: 'view_not_found',
      detail: `viewId=${VIEW_ID} not in catalogue item's views`,
      availableViewIds: views.map((v) => v?.id ?? null),
    };
  }
  const raw = view.dataUrl;
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'data_url_missing' };
  }
  let abs = raw.trim();
  if (!/^https?:\/\//i.test(abs)) {
    try { abs = new URL(abs, UBS_HOST).toString(); }
    catch { return { ok: false, error: 'data_url_invalid' }; }
  }
  return { ok: true, dataUrl: abs };
}

async function fetchPage(env, dataUrl, { limit, offset, compset }) {
  let u;
  try { u = new URL(dataUrl); }
  catch { return { ok: false, error: 'invalid_data_url', status: 0 }; }
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('compset', compset);
  const urlStr = u.toString();
  const res = await ubsGet(env, urlStr, { timeoutMs: PAGE_TIMEOUT_MS });
  return { ...res, upstreamUrl: urlStr };
}

/**
 * Pull the rows array out of a UBS data response. Mirrors the defensive
 * extractor used by mode=data/search (array | data | items | results |
 * rows). Returns null when no array could be found.
 */
function extractRowArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const k of ['data', 'items', 'results', 'rows']) {
      if (Array.isArray(payload[k])) return payload[k];
    }
  }
  return null;
}

/**
 * Normalise one raw UBS row into 0..N D1-shaped snapshot rows (one per
 * non-null numeric metric). Returns [] when the row is unusable.
 *
 * Skip rules:
 *   - periodEndDate missing / non-string / empty
 *   - both appName and aggregatorValue missing / empty
 *   - per-metric: value missing / non-numeric / non-finite
 *
 * Normalisation rules (to make the unique index dedupe correctly):
 *   - period         → '' when missing (NULLs are distinct in SQLite uniq indexes)
 *   - dimension_2    → '' when geographyName missing
 *   - dimension_1    → appName, falling back to aggregatorValue (required)
 */
export function normalizeRow(raw) {
  if (!raw || typeof raw !== 'object') return [];

  const periodEndDateRaw = raw.periodEndDate;
  if (typeof periodEndDateRaw !== 'string' || !periodEndDateRaw.trim()) return [];

  const appName         = typeof raw.appName === 'string' ? raw.appName.trim() : '';
  const aggregatorValue = typeof raw.aggregatorValue === 'string' ? raw.aggregatorValue.trim() : '';
  const dim1 = appName || aggregatorValue;
  if (!dim1) return [];

  const period = (typeof raw.period === 'string' && raw.period.trim()) ? raw.period.trim() : '';
  const dim2   = (typeof raw.geographyName === 'string' && raw.geographyName.trim()) ? raw.geographyName.trim() : '';
  const snapshotDate = periodEndDateRaw.trim();

  // Serialise once per source row; reused across each metric row so the
  // raw_json column always carries the full underlying observation.
  const rawJson = JSON.stringify(raw);

  const out = [];
  for (const [metricName, unit] of Object.entries(METRIC_UNITS)) {
    const v = raw[metricName];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out.push({
      dataset_key:    DATASET_KEY,
      ubs_dataset_id: UBS_DATASET_ID,
      snapshot_date:  snapshotDate,
      period,
      dimension_1:    dim1,
      dimension_2:    dim2,
      metric_name:    metricName,
      metric_value:   v,
      unit,
      raw_json:       rawJson,
      source:         'UBS Evidence Lab',
    });
  }
  return out;
}

/**
 * Scoped delete-then-insert fallback (used when the unique index is not
 * present yet). Deletes only rows where:
 *   dataset_key   = global_app_downloads_ai  AND
 *   ubs_dataset_id = 10087                   AND
 *   snapshot_date IN {dates in this capture} AND
 *   metric_name   IN {metrics in this capture} AND
 *   dimension_1   IN {dims1 in this capture}   AND
 *   dimension_2   IN {dims2 in this capture}
 *
 * D1 has a 100-bound-param-per-stmt limit; we chunk distinct values
 * 20-at-a-time so each DELETE stays well under the cap.
 */
async function deleteScoped(db, normalizedRows) {
  if (normalizedRows.length === 0) return;
  const dates   = new Set();
  const metrics = new Set();
  const dim1s   = new Set();
  const dim2s   = new Set();
  for (const r of normalizedRows) {
    dates.add(r.snapshot_date);
    metrics.add(r.metric_name);
    dim1s.add(r.dimension_1);
    dim2s.add(r.dimension_2);
  }
  const dateArr   = [...dates];
  const metricArr = [...metrics];
  const dim1Arr   = [...dim1s];
  const dim2Arr   = [...dim2s];
  const CHUNK = 20;

  const stmts = [];
  for (let i = 0; i < dateArr.length;   i += CHUNK)
  for (let j = 0; j < metricArr.length; j += CHUNK)
  for (let k = 0; k < dim1Arr.length;   k += CHUNK)
  for (let l = 0; l < dim2Arr.length;   l += CHUNK) {
    const dCh  = dateArr.slice(i, i + CHUNK);
    const mCh  = metricArr.slice(j, j + CHUNK);
    const d1Ch = dim1Arr.slice(k, k + CHUNK);
    const d2Ch = dim2Arr.slice(l, l + CHUNK);
    const ph = (n) => Array.from({ length: n }, () => '?').join(',');
    const sql =
      `DELETE FROM ubs_dataset_snapshots WHERE dataset_key = ? AND ubs_dataset_id = ?
       AND snapshot_date IN (${ph(dCh.length)})
       AND metric_name   IN (${ph(mCh.length)})
       AND dimension_1   IN (${ph(d1Ch.length)})
       AND dimension_2   IN (${ph(d2Ch.length)})`;
    const params = [DATASET_KEY, UBS_DATASET_ID, ...dCh, ...mCh, ...d1Ch, ...d2Ch];
    stmts.push(db.prepare(sql).bind(...params));
  }
  if (stmts.length > 0) await db.batch(stmts);
}

async function upsertChunked(db, rows, strategy /* 'INSERT OR REPLACE' | 'INSERT' */) {
  let written = 0;
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT * STMTS_PER_BATCH) {
    const slice = rows.slice(i, i + ROWS_PER_STMT * STMTS_PER_BATCH);
    const stmts = [];
    for (let j = 0; j < slice.length; j += ROWS_PER_STMT) {
      const chunk = slice.slice(j, j + ROWS_PER_STMT);
      const placeholders = chunk.map(() => '(' + SNAPSHOT_COLS.map(() => '?').join(',') + ')').join(',');
      const sql = `${strategy} INTO ubs_dataset_snapshots (${SNAPSHOT_COLS.join(',')}) VALUES ${placeholders}`;
      const params = chunk.flatMap((r) => SNAPSHOT_COLS.map((c) => r[c]));
      stmts.push(db.prepare(sql).bind(...params));
    }
    await db.batch(stmts);
    written += slice.length;
  }
  return written;
}

export async function onRequestPost({ request, env }) {
  const fetchedAt = new Date().toISOString();

  // ── Auth ──────────────────────────────────────────────────────────
  if (!env?.UBS_CAPTURE_SECRET) {
    return jsonResp({
      ok: false,
      error: 'missing_capture_secret',
      detail: 'UBS_CAPTURE_SECRET is not bound on this environment',
    }, 500);
  }
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  if (!bearer || bearer !== env.UBS_CAPTURE_SECRET) {
    return jsonResp({ ok: false, error: 'unauthorized' }, 401);
  }

  if (!env?.UBS_API_KEY) {
    return jsonResp({
      ok: false,
      error: 'missing_api_key',
      detail: 'UBS_API_KEY is not bound on this environment',
    }, 500);
  }
  if (!env?.EC2_PRICING_DB) {
    return jsonResp({
      ok: false,
      error: 'd1_binding_missing',
      detail: 'env.EC2_PRICING_DB is not bound on this environment',
    }, 500);
  }
  const db = env.EC2_PRICING_DB;

  // ── Migration check ───────────────────────────────────────────────
  const exists = await tableExists(db, 'ubs_dataset_snapshots');
  if (!exists) {
    return jsonResp({
      ok: false,
      error: 'migration_missing',
      detail: 'ubs_dataset_snapshots table does not exist. Apply migrations: npx wrangler d1 migrations apply gdash-aws-ec2-pricing --remote',
    }, 500);
  }

  // ── Parse params ──────────────────────────────────────────────────
  const url      = new URL(request.url);
  const limit    = clampInt(url.searchParams.get('limit'),    1, MAX_PAGE_LIMIT,  DEFAULT_PAGE_LIMIT);
  const maxPages = clampInt(url.searchParams.get('maxPages'), 1, HARD_MAX_PAGES,  DEFAULT_MAX_PAGES);
  const offset   = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const dryRun   = url.searchParams.get('dryRun') === '1';

  // ── Resolve catalogue → view.dataUrl ──────────────────────────────
  const resolved = await resolveDataUrl(env);
  if (!resolved.ok) {
    return jsonResp({
      ok: false,
      ...resolved,
      datasetKey: DATASET_KEY,
      ubsDatasetId: UBS_DATASET_ID,
      viewId: VIEW_ID,
      fetchedAt,
    }, 502);
  }
  const dataUrl = resolved.dataUrl;

  // ── Paginated fetch ───────────────────────────────────────────────
  const rawRows = [];
  const pageErrors = [];
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page++) {
    const pageOffset = offset + page * limit;
    const res = await fetchPage(env, dataUrl, { limit, offset: pageOffset, compset: COMPSET_FILTER });
    pagesFetched += 1;

    if (!res.ok) {
      pageErrors.push({
        page, offset: pageOffset,
        error: res.error, errorCode: res.code,
        upstreamStatus: res.status || null,
        ...(res.errorBody ? { errorBody: res.errorBody } : {}),
      });
      break;
    }
    const logical = summarizeUbsLogicalError(res.json);
    if (logical) {
      pageErrors.push({
        page, offset: pageOffset,
        error: 'upstream_logical_error',
        logicalErrorSummary: logical,
      });
      break;
    }
    const rows = extractRowArray(res.json);
    if (!Array.isArray(rows)) {
      pageErrors.push({ page, offset: pageOffset, error: 'unparseable_page' });
      break;
    }
    if (rows.length === 0) break;
    for (const r of rows) rawRows.push(r);
  }

  // ── Normalise ─────────────────────────────────────────────────────
  const normalizedRows = [];
  for (const raw of rawRows) {
    const out = normalizeRow(raw);
    for (const r of out) normalizedRows.push(r);
  }

  // Stats
  const metricCounts = {};
  const apps = new Set();
  const geos = new Set();
  let minDate = null;
  let maxDate = null;
  for (const r of normalizedRows) {
    metricCounts[r.metric_name] = (metricCounts[r.metric_name] || 0) + 1;
    apps.add(r.dimension_1);
    geos.add(r.dimension_2);
    if (minDate == null || r.snapshot_date < minDate) minDate = r.snapshot_date;
    if (maxDate == null || r.snapshot_date > maxDate) maxDate = r.snapshot_date;
  }

  // ── Write to D1 (skipped on dryRun) ───────────────────────────────
  let rowsInsertedOrUpdated = 0;
  let usedStrategy = 'none';
  if (!dryRun && normalizedRows.length > 0) {
    const hasUniq = await indexExists(db, 'idx_ubs_dataset_snapshots_unique');
    if (hasUniq) {
      usedStrategy = 'insert_or_replace';
      rowsInsertedOrUpdated = await upsertChunked(db, normalizedRows, 'INSERT OR REPLACE');
    } else {
      usedStrategy = 'delete_then_insert';
      await deleteScoped(db, normalizedRows);
      rowsInsertedOrUpdated = await upsertChunked(db, normalizedRows, 'INSERT');
    }

    // KV latest summary — best-effort, non-fatal.
    if (env?.HISTORY_KV) {
      try {
        await env.HISTORY_KV.put(
          'ubs:latest:global_app_downloads_ai',
          JSON.stringify({
            lastUpdated: new Date().toISOString(),
            rowsInsertedOrUpdated,
            maxPeriodEndDate: maxDate,
            appCount: apps.size,
            geographyCount: geos.size,
            metricCounts,
          })
        );
      } catch { /* swallow KV errors — capture succeeded */ }
    }
  }

  return jsonResp({
    ok: true,
    dryRun,
    datasetKey: DATASET_KEY,
    ubsDatasetId: UBS_DATASET_ID,
    viewId: VIEW_ID,
    filter: { compset: COMPSET_FILTER },
    pagesFetched,
    rawRowsFetched: rawRows.length,
    normalizedRowsPrepared: normalizedRows.length,
    rowsInsertedOrUpdated,
    minPeriodEndDate: minDate,
    maxPeriodEndDate: maxDate,
    appCount: apps.size,
    geographyCount: geos.size,
    metricCounts,
    pageErrors,
    sampleRawRows: rawRows.slice(0, 3),
    sampleNormalizedRows: normalizedRows.slice(0, 3),
    usedStrategy,
    fetchedAt,
  });
}
