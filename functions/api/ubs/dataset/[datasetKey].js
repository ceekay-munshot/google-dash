/**
 * Cloudflare Pages Function — UBS Evidence Lab dataset reader.
 * Route: GET /api/ubs/dataset/:datasetKey
 *
 * Flow:
 *   1. Validate :datasetKey against _registry.js. Unknown / unconfigured
 *      keys return 400 so we never silently call UBS for an ambiguous
 *      target.
 *   2. Fetch the UBS catalogue server-side (Bearer auth via _client.js).
 *   3. Match the catalogue item by dataAssetKey === entry.ubsDatasetId.
 *   4. Pick a view: ?viewId=<id> when supplied, otherwise views[0].
 *   5. Resolve the mode URL (mode=data → dataUrl; model → modelUrl;
 *      count → countUrl; distinct → distinctUrl). Default mode=data.
 *   6. Categorise inbound query params:
 *        mode=data     → STATIC_FILTER_ALLOWLIST plus any param whose
 *                        name matches a fieldName in mode=model
 *        mode=model    → limit, offset only
 *        mode=count    → limit, offset only
 *        mode=distinct → distinctField / fieldName / field / column
 *                        (mapped to UBS via fieldName→field→column
 *                        fallback on 400), plus limit, offset
 *      Anything else (incl. dataAssetKey) is dropped and surfaced in
 *      `droppedParams`.
 *   7. Forward to UBS, parse defensively, return rows + diagnostics.
 *
 * UBS_API_KEY never leaves the worker (Authorization header only).
 * `upstreamUrlRedacted` is defensively scrubbed of credential-shaped
 * query params even though we never put any there.
 */

import { fetchUbsCatalogue, ubsGet, UBS_HOST } from '../_client.js';
import { extractDatasetArray, safeViewSubset } from '../_parser.js';
import { getUbsDataset } from '../_registry.js';

const VALID_MODES = new Set(['data', 'model', 'count', 'distinct']);

// Static filter passthrough for mode=data. `dataAssetKey` is deliberately
// absent — caller is never allowed to override the dataset selection.
const STATIC_FILTER_ALLOWLIST = new Set([
  'limit', 'offset',
  'period', 'periodEndDate',
  'sector',
  'compset',
  'appType', 'appName',
  'deviceType',
  'geographyName', 'geographyId',
  'metricType',
  'clientStudyName',
  'aggregate', 'aggregatorValue',
  'primaryTickerIsin', 'primaryExchangeTicker',
  'legalEntityName', 'domesticCountryName',
]);

// Caller may never override these even if the model schema lists them.
const FORBIDDEN_PARAMS = new Set(['dataAssetKey']);

// Consumed by this handler — never forwarded to UBS.
const HANDLER_PARAMS = new Set(['mode', 'viewId', 'debug']);

// Distinct-field aliases accepted on the inbound request.
const DISTINCT_FIELD_ALIASES = ['distinctField', 'fieldName', 'field', 'column'];

// Upstream param-name strategies for mode=distinct, tried in order.
// We continue past a strategy when EITHER UBS returns HTTP 400 OR the
// JSON body contains a logical error (e.g. "Data Field/Column Not Found
// [fieldName]"). Non-400 HTTP errors short-circuit the loop.
const DISTINCT_UPSTREAM_PARAM_ORDER = [
  'fieldName', 'field', 'column',
  'fields', 'columns', 'distinctField',
];

// Defensive redaction list for upstreamUrlRedacted. UBS_API_KEY only
// ever travels in the Authorization header so this is belt-and-braces.
const SENSITIVE_QUERY_PARAMS_LC = new Set([
  'key', 'apikey', 'api_key',
  'token', 'auth', 'authtoken', 'auth_token',
  'apitoken', 'api_token',
  'bearer',
]);

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
      'Cache-Control': 'private, max-age=60',
      ...CORS,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Resolve a UBS view URL. Accepts absolute (https://...) URLs as-is;
 * resolves relative paths against UBS_HOST.
 */
function resolveUbsUrl(maybeUrl) {
  if (typeof maybeUrl !== 'string' || !maybeUrl.trim()) return null;
  const u = maybeUrl.trim();
  if (/^https?:\/\//i.test(u)) return u;
  try {
    return new URL(u, UBS_HOST).toString();
  } catch {
    return null;
  }
}

/**
 * Replace the value of any credential-shaped query param with [REDACTED]
 * before returning the URL string. Used for upstreamUrlRedacted and for
 * any pagination links we surface from UBS.
 */
export function redactUrlSecrets(urlString) {
  if (typeof urlString !== 'string' || !urlString) return urlString;
  try {
    const u = new URL(urlString);
    const keysToRedact = [];
    for (const [k] of u.searchParams) {
      if (SENSITIVE_QUERY_PARAMS_LC.has(k.toLowerCase())) {
        keysToRedact.push(k);
      }
    }
    for (const k of keysToRedact) {
      u.searchParams.set(k, '[REDACTED]');
    }
    return u.toString();
  } catch {
    return urlString.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
  }
}

/**
 * Defensive row extractor for UBS data responses. Handles array, data,
 * items, results, rows envelopes; non-array responses preserved in
 * metadata with a rawShape diagnostic.
 */
export function extractDataRows(payload) {
  if (Array.isArray(payload)) {
    return { rows: payload, metadata: null, rawShape: null };
  }
  if (payload && typeof payload === 'object') {
    for (const k of ['data', 'items', 'results', 'rows']) {
      if (Array.isArray(payload[k])) {
        const rest = { ...payload };
        delete rest[k];
        return { rows: payload[k], metadata: rest, rawShape: null };
      }
    }
    return {
      rows: [],
      metadata: payload,
      rawShape: {
        type: 'object',
        keys: Object.keys(payload).slice(0, 50),
        note: 'UBS response was not an array shape; full payload preserved in metadata.',
      },
    };
  }
  if (payload === null) {
    return {
      rows: [],
      metadata: null,
      rawShape: { type: 'null', note: 'UBS returned null body.' },
    };
  }
  return {
    rows: [],
    metadata: { value: payload },
    rawShape: { type: typeof payload, note: 'UBS returned a primitive scalar.' },
  };
}

/**
 * Recursively walk a UBS model payload and collect candidate field
 * names. Prefers `fieldName`; falls back to `name` / `field` / `column`
 * for non-standard model shapes.
 *
 * When a node has a usable key, it is treated as a field-definition
 * leaf and we stop descending — that prevents nested metadata like
 * `{ fieldName: 'a', extras: { name: 'internal' } }` from leaking
 * 'internal' into the allow-list.
 */
export function extractFieldNames(modelPayload) {
  const out = new Set();
  function walk(node) {
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (node && typeof node === 'object') {
      for (const k of ['fieldName', 'name', 'field', 'column']) {
        const v = node[k];
        if (typeof v === 'string' && v.trim()) {
          out.add(v.trim());
          return;  // leaf — don't descend into siblings
        }
      }
      // No field-name key at this level — recurse to find arrays of
      // field-definition objects (e.g. { schema: { fields: [...] } }).
      for (const v of Object.values(node)) walk(v);
    }
  }
  walk(modelPayload);
  return out;
}

/** Surface next/prev pagination metadata if UBS provided it. */
export function extractPagination(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  let next = null;
  let prev = null;
  const nextKeys = ['next', 'nextUrl', 'nextLink', 'nextPage', 'nextOffset'];
  const prevKeys = ['prev', 'previous', 'prevUrl', 'prevLink', 'prevPage', 'prevOffset', 'previousLink'];
  for (const k of nextKeys) {
    if (metadata[k] != null) { next = metadata[k]; break; }
  }
  for (const k of prevKeys) {
    if (metadata[k] != null) { prev = metadata[k]; break; }
  }
  const links = metadata._links;
  if (links && typeof links === 'object') {
    if (next == null && links.next) next = typeof links.next === 'object' ? links.next.href : links.next;
    if (prev == null && links.prev) prev = typeof links.prev === 'object' ? links.prev.href : links.prev;
  }
  if (next == null && prev == null) return null;
  return {
    next: typeof next === 'string' ? redactUrlSecrets(next) : next,
    prev: typeof prev === 'string' ? redactUrlSecrets(prev) : prev,
  };
}

/** Pick the first non-empty distinct-field alias from the request query. */
function getDistinctFieldRequested(searchParams) {
  for (const k of DISTINCT_FIELD_ALIASES) {
    const v = searchParams.get(k);
    if (v && v.trim()) return { value: v.trim(), source: k };
  }
  return null;
}

/* ──────────────────────── logical-error detection ──────────────────────── */

function isNonEmptyErrorValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

/**
 * Detect a UBS-embedded logical error in a 2xx response. UBS returns
 * HTTP 200 with messages like
 *   "Data Field/Column Not Found [fieldName] for table ..."
 * placed at one of several locations in the payload.
 */
export function hasUbsLogicalError(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return [
    payload.errors,
    payload.error,
    payload.meta && payload.meta.errors,
    payload.metadata && payload.metadata.errors,
    payload.data && payload.data.errors,
  ].some(isNonEmptyErrorValue);
}

function stringifyErrorItem(item) {
  if (item == null) return null;
  if (typeof item === 'string') return item.slice(0, 300);
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (typeof item === 'object') {
    const msg = item.message ?? item.detail ?? item.error ?? item.text ?? item.description ?? null;
    if (msg != null) return String(msg).slice(0, 300);
    try { return JSON.stringify(item).slice(0, 300); }
    catch { return '[unstringifiable error]'; }
  }
  return String(item).slice(0, 300);
}

/**
 * Compact { at, message } list for the embedded-error locations.
 * Caps each location at 5 items, each message at 300 chars. Returns
 * null when nothing was found.
 */
export function summarizeUbsLogicalError(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const out = [];
  const candidates = [
    ['errors',          payload.errors],
    ['error',           payload.error],
    ['meta.errors',     payload.meta && payload.meta.errors],
    ['metadata.errors', payload.metadata && payload.metadata.errors],
    ['data.errors',     payload.data && payload.data.errors],
  ];
  for (const [at, val] of candidates) {
    if (val == null) continue;
    if (typeof val === 'string' && val.trim()) {
      out.push({ at, message: val.trim().slice(0, 300) });
    } else if (Array.isArray(val) && val.length > 0) {
      for (const item of val.slice(0, 5)) {
        const msg = stringifyErrorItem(item);
        if (msg) out.push({ at, message: msg });
      }
      if (val.length > 5) out.push({ at, message: `…(${val.length - 5} more)` });
    } else if (typeof val === 'object' && Object.keys(val).length > 0) {
      const msg = stringifyErrorItem(val);
      if (msg) out.push({ at, message: msg });
    }
  }
  return out.length > 0 ? out : null;
}

/* ──────────────────────── distinct call helpers ──────────────────────── */

/**
 * Make one UBS distinct call and return both the raw result and a
 * structured summary. A 2xx response with embedded errors is NOT
 * considered a success here — the caller (callDistinctWithFallback)
 * inspects summary.hadLogicalError to decide whether to continue.
 */
async function callDistinctAttempt(env, urlStr) {
  const res = await ubsGet(env, urlStr, { timeoutMs: 30000 });
  const summary = {
    paramName: null,
    upstreamStatus: res.status || 0,
    hadLogicalError: false,
    logicalErrorSummary: null,
    rowCount: null,
    upstreamUrlRedacted: redactUrlSecrets(urlStr),
  };
  if (res.ok) {
    try {
      const parsed = extractDataRows(res.json);
      summary.rowCount = parsed.rows.length;
    } catch { /* leave null */ }
    const logical = summarizeUbsLogicalError(res.json);
    if (logical && logical.length > 0) {
      summary.hadLogicalError = true;
      summary.logicalErrorSummary = logical;
    }
  }
  return { res, summary };
}

/**
 * Call UBS distinct URL with the configured param-name strategies
 * (fieldName → field → column → fields → columns → distinctField).
 *
 * A strategy counts as a CONTINUATION condition (i.e. try the next
 * one) when:
 *   - UBS returns HTTP 400, OR
 *   - UBS returns 2xx but the body carries an embedded logical error
 *     (UBS does this when the field name isn't recognised; the body
 *     looks like { errors: ["Data Field/Column Not Found [fieldName]"] }).
 *
 * A strategy counts as a HARD STOP (return immediately) when:
 *   - UBS returns 2xx with no logical errors → success
 *   - UBS returns a non-400 HTTP error → short-circuit (the param name
 *     isn't the problem; further retries would be noise)
 *
 * Returns either a successful UBS response augmented with attempted[]
 * and usedDistinctParam, or an error object with allFailed: true and
 * allLogicalErrors: true|false.
 */
async function callDistinctWithFallback(env, distinctUrl, fieldValue, extraParams) {
  const attempted = [];
  let lastRes = null;
  let lastUrl = distinctUrl;

  for (const paramName of DISTINCT_UPSTREAM_PARAM_ORDER) {
    let urlStr = distinctUrl;
    try {
      const u = new URL(distinctUrl);
      u.searchParams.set(paramName, fieldValue);
      for (const [ek, ev] of Object.entries(extraParams || {})) {
        u.searchParams.set(ek, ev);
      }
      urlStr = u.toString();
    } catch {
      attempted.push({
        paramName, upstreamStatus: 0,
        hadLogicalError: false, logicalErrorSummary: null,
        rowCount: null,
        upstreamUrlRedacted: redactUrlSecrets(distinctUrl),
      });
      return {
        ok: false, status: 0, code: 'invalid_distinct_url',
        error: 'Catalogue distinctUrl is not a valid URL',
        usedDistinctParam: paramName,
        attempted, upstreamUrl: distinctUrl,
        allFailed: true, allLogicalErrors: false,
      };
    }
    lastUrl = urlStr;

    const { res, summary } = await callDistinctAttempt(env, urlStr);
    summary.paramName = paramName;
    attempted.push(summary);
    lastRes = res;

    if (res.ok && !summary.hadLogicalError) {
      // True success — 2xx and no embedded errors.
      return { ...res, usedDistinctParam: paramName, attempted, upstreamUrl: urlStr };
    }
    if (!res.ok && res.status !== 400) {
      // Non-400 HTTP — short-circuit. Param name isn't the issue.
      return {
        ...res, usedDistinctParam: paramName,
        attempted, upstreamUrl: urlStr,
        shortCircuitedOnNon400: true,
      };
    }
    // HTTP 400 OR 2xx-with-logical-error — continue to the next strategy.
  }

  // Every strategy failed. Decide which kind of failure dominates.
  const allLogical = attempted.length > 0 && attempted.every((a) => a.hadLogicalError);
  return {
    ok: false,
    status: lastRes && lastRes.status ? lastRes.status : 0,
    code: 'distinct_lookup_failed',
    error: allLogical
      ? 'All distinct strategies returned UBS logical errors — field name not recognised under any param alias'
      : 'All distinct strategies failed (mixed HTTP errors and/or UBS logical errors)',
    errorBody: lastRes ? lastRes.errorBody : undefined,
    usedDistinctParam: DISTINCT_UPSTREAM_PARAM_ORDER[DISTINCT_UPSTREAM_PARAM_ORDER.length - 1],
    attempted,
    upstreamUrl: lastUrl,
    allFailed: true,
    allLogicalErrors: allLogical,
  };
}

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const datasetKey = (params?.datasetKey || '').toString();
  const mode = (url.searchParams.get('mode') || 'data').toLowerCase();
  const viewIdParam = url.searchParams.get('viewId');
  const fetchedAt = new Date().toISOString();

  if (!VALID_MODES.has(mode)) {
    return jsonResp({
      ok: false, error: 'invalid_mode',
      detail: `mode must be one of: ${[...VALID_MODES].join(', ')}`,
      datasetKey, fetchedAt,
    }, 400);
  }

  if (!env?.UBS_API_KEY) {
    return jsonResp({
      ok: false, error: 'missing_api_key',
      detail: 'UBS_API_KEY is not bound on this environment',
      datasetKey, fetchedAt,
    }, 500);
  }

  const entry = getUbsDataset(datasetKey);
  if (!entry) {
    return jsonResp({
      ok: false, error: 'unknown_dataset_key',
      detail: `No registry entry for "${datasetKey}"`,
      datasetKey, fetchedAt,
    }, 400);
  }
  if (!entry.ubsDatasetId) {
    return jsonResp({
      ok: false, error: 'missing_ubs_dataset_id',
      detail: `Registry entry "${datasetKey}" has no ubsDatasetId yet — populate it from /api/ubs/catalogue first`,
      datasetKey, label: entry.label, fetchedAt,
    }, 400);
  }

  // ── catalogue → item → view ───────────────────────────────────────
  const cat = await fetchUbsCatalogue(env, { timeoutMs: 15000 });
  if (!cat.ok) {
    return jsonResp({
      ok: false, error: 'catalogue_fetch_failed',
      detail: cat.error, errorCode: cat.code,
      ...(cat.errorBody ? { errorBody: cat.errorBody } : {}),
      upstreamStatus: cat.status || null,
      datasetKey, ubsDatasetId: entry.ubsDatasetId, label: entry.label, fetchedAt,
    }, 502);
  }
  const items = extractDatasetArray(cat.json);
  if (!Array.isArray(items)) {
    return jsonResp({
      ok: false, error: 'unparseable_catalogue',
      detail: 'UBS catalogue did not return a recognised dataset array',
      datasetKey, ubsDatasetId: entry.ubsDatasetId, label: entry.label, fetchedAt,
    }, 502);
  }
  const matchKey = String(entry.ubsDatasetId);
  const item = items.find((it) => String(it?.dataAssetKey || '') === matchKey);
  if (!item) {
    return jsonResp({
      ok: false, error: 'dataset_not_in_catalogue',
      detail: `No catalogue item with dataAssetKey="${matchKey}"`,
      datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
    }, 404);
  }
  const views = Array.isArray(item.views) ? item.views : [];
  if (views.length === 0) {
    return jsonResp({
      ok: false, error: 'no_views',
      detail: 'Catalogue item has no views',
      datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
    }, 502);
  }
  let view;
  if (viewIdParam) {
    view = views.find((v) => String(v?.id) === String(viewIdParam));
    if (!view) {
      return jsonResp({
        ok: false, error: 'view_not_found',
        detail: `viewId="${viewIdParam}" not in catalogue item's views`,
        availableViewIds: views.map((v) => v?.id ?? null),
        datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
      }, 400);
    }
  } else {
    view = views[0];
  }
  const safeView = safeViewSubset(view);
  const modeUrl = resolveUbsUrl(view?.[`${mode}Url`]);
  if (!modeUrl) {
    return jsonResp({
      ok: false, error: 'mode_url_missing',
      detail: `View "${view?.id || '(unnamed)'}" has no usable ${mode}Url`,
      mode, view: safeView,
      datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
    }, 502);
  }

  // ── Categorise inbound query params ───────────────────────────────
  const droppedParams = [];
  const candidateFilters = {};   // non-reserved inbound params
  for (const [k, v] of url.searchParams) {
    if (HANDLER_PARAMS.has(k)) continue;
    if (FORBIDDEN_PARAMS.has(k)) { droppedParams.push(k); continue; }
    if (mode === 'distinct' && DISTINCT_FIELD_ALIASES.includes(k)) continue;
    candidateFilters[k] = v;
  }

  // ── mode=distinct branch ──────────────────────────────────────────
  if (mode === 'distinct') {
    const distinctReq = getDistinctFieldRequested(url.searchParams);
    const debug = url.searchParams.get('debug') === '1';

    // Forward only limit/offset; everything else is dropped for distinct.
    const distinctForwarded = {};
    for (const [k, v] of Object.entries(candidateFilters)) {
      if (k === 'limit' || k === 'offset') distinctForwarded[k] = v;
      else droppedParams.push(k);
    }

    let dataRes;
    let upstreamUrlUsed = modeUrl;
    let usedDistinctParam = null;
    let attempted = [];
    let allFailed = false;
    let allLogicalErrors = false;
    let shortCircuitedOnNon400 = false;

    if (distinctReq) {
      const r = await callDistinctWithFallback(env, modeUrl, distinctReq.value, distinctForwarded);
      dataRes = r;
      upstreamUrlUsed = r.upstreamUrl || modeUrl;
      usedDistinctParam = r.usedDistinctParam || null;
      attempted = r.attempted || [];
      allFailed = !!r.allFailed;
      allLogicalErrors = !!r.allLogicalErrors;
      shortCircuitedOnNon400 = !!r.shortCircuitedOnNon400;
    } else {
      // No field requested — single call to distinctUrl. Still validate
      // the 2xx body for embedded UBS logical errors before declaring
      // success.
      try {
        const u = new URL(modeUrl);
        for (const [k, v] of Object.entries(distinctForwarded)) u.searchParams.set(k, v);
        upstreamUrlUsed = u.toString();
      } catch {
        upstreamUrlUsed = modeUrl;
      }
      const single = await callDistinctAttempt(env, upstreamUrlUsed);
      attempted = [single.summary];
      if (single.res.ok && !single.summary.hadLogicalError) {
        dataRes = single.res;
      } else if (single.res.ok && single.summary.hadLogicalError) {
        dataRes = {
          ok: false, status: 200,
          code: 'distinct_lookup_failed',
          error: 'UBS returned an embedded logical error and no distinct field was specified',
        };
        allFailed = true;
        allLogicalErrors = true;
      } else {
        dataRes = single.res;
      }
    }

    // On true success we report the param-name UBS accepted; on failure
    // we don't pretend a "used" param exists.
    const distinctForwardedFinal = dataRes.ok && usedDistinctParam && distinctReq
      ? { [usedDistinctParam]: distinctReq.value, ...distinctForwarded }
      : { ...distinctForwarded };

    // attempted shape gating:
    //   debug=1  → full structured summaries (paramName, upstreamStatus,
    //              hadLogicalError, logicalErrorSummary, rowCount,
    //              upstreamUrlRedacted)
    //   default  → slim records (no logicalErrorSummary, no per-attempt
    //              upstreamUrlRedacted) to keep payloads tight in the
    //              success path. The failure path always carries the
    //              full summaries regardless of debug so the caller can
    //              diagnose without re-requesting.
    const slimAttempted = (a) => ({
      paramName: a.paramName,
      upstreamStatus: a.upstreamStatus,
      hadLogicalError: a.hadLogicalError,
      rowCount: a.rowCount,
    });
    const attemptedOutput = (debug || !dataRes.ok)
      ? attempted
      : attempted.map(slimAttempted);

    if (!dataRes.ok) {
      const isLogicalFailure = (dataRes.code === 'distinct_lookup_failed') || allLogicalErrors;
      return jsonResp({
        ok: false,
        error: isLogicalFailure ? 'distinct_lookup_failed' : 'upstream_fetch_failed',
        detail: dataRes.error,
        errorCode: dataRes.code,
        ...(dataRes.errorBody ? { errorBody: dataRes.errorBody } : {}),
        upstreamStatus: dataRes.status || null,
        mode, view: safeView,
        datasetKey, ubsDatasetId: matchKey, label: entry.label,
        fetchedAt,
        forwardedParams: distinctForwardedFinal,
        droppedParams,
        upstreamUrlRedacted: redactUrlSecrets(upstreamUrlUsed),
        ...(attempted.length > 0 ? { attempted: attemptedOutput } : {}),
        ...(distinctReq ? {
          distinctFieldRequested: distinctReq.value,
          distinctFieldSource: distinctReq.source,
        } : {}),
        ...(allFailed ? { allFailed: true } : {}),
        ...(allLogicalErrors ? { allLogicalErrors: true } : {}),
        ...(shortCircuitedOnNon400 ? { shortCircuitedOnNon400: true } : {}),
      }, 502);
    }

    const parsed = extractDataRows(dataRes.json);
    const pagination = extractPagination(parsed.metadata);

    return jsonResp({
      ok: true,
      datasetKey, label: entry.label, ubsDatasetId: matchKey,
      mode, view: safeView,
      fetchedAt, upstreamStatus: dataRes.status,
      rowCount: parsed.rows.length, rows: parsed.rows,
      metadata: parsed.metadata,
      ...(parsed.rawShape ? { rawShape: parsed.rawShape } : {}),
      forwardedParams: distinctForwardedFinal,
      droppedParams,
      upstreamUrlRedacted: redactUrlSecrets(upstreamUrlUsed),
      ...(usedDistinctParam ? { usedDistinctParam } : {}),
      ...(attempted.length > 0 ? { attempted: attemptedOutput } : {}),
      ...(distinctReq ? {
        distinctFieldRequested: distinctReq.value,
        distinctFieldSource: distinctReq.source,
      } : {}),
      ...(pagination ? { pagination } : {}),
    });
  }

  // ── mode=data / mode=model / mode=count ───────────────────────────
  const forwardedParams = {};
  let modelFieldNames = null;
  let modelFetchError = null;

  if (mode === 'data') {
    const needsModelCheck = [];
    for (const [k, v] of Object.entries(candidateFilters)) {
      if (STATIC_FILTER_ALLOWLIST.has(k)) forwardedParams[k] = v;
      else needsModelCheck.push(k);
    }
    if (needsModelCheck.length > 0) {
      const modelUrlResolved = resolveUbsUrl(view?.modelUrl);
      if (modelUrlResolved) {
        const modelRes = await ubsGet(env, modelUrlResolved, { timeoutMs: 15000 });
        if (modelRes.ok) {
          modelFieldNames = extractFieldNames(modelRes.json);
          for (const k of needsModelCheck) {
            if (modelFieldNames.has(k)) forwardedParams[k] = candidateFilters[k];
            else droppedParams.push(k);
          }
        } else {
          modelFetchError = {
            status: modelRes.status || null,
            code: modelRes.code,
            error: modelRes.error,
            ...(modelRes.errorBody ? { errorBody: modelRes.errorBody } : {}),
          };
          for (const k of needsModelCheck) droppedParams.push(k);
        }
      } else {
        for (const k of needsModelCheck) droppedParams.push(k);
      }
    }
  } else {
    // mode=model or mode=count — only limit/offset are forwarded.
    for (const [k, v] of Object.entries(candidateFilters)) {
      if (k === 'limit' || k === 'offset') forwardedParams[k] = v;
      else droppedParams.push(k);
    }
  }

  // ── Build upstream URL ────────────────────────────────────────────
  let upstreamUrl = modeUrl;
  try {
    const u = new URL(modeUrl);
    for (const [k, v] of Object.entries(forwardedParams)) {
      u.searchParams.set(k, String(v));
    }
    upstreamUrl = u.toString();
  } catch {
    // unparseable modeUrl — call as-is
  }

  // ── Call UBS ──────────────────────────────────────────────────────
  const dataRes = await ubsGet(env, upstreamUrl, { timeoutMs: 30000 });
  if (!dataRes.ok) {
    return jsonResp({
      ok: false, error: 'upstream_fetch_failed',
      detail: dataRes.error, errorCode: dataRes.code,
      ...(dataRes.errorBody ? { errorBody: dataRes.errorBody } : {}),
      upstreamStatus: dataRes.status || null,
      mode, view: safeView,
      datasetKey, ubsDatasetId: matchKey, label: entry.label,
      fetchedAt,
      forwardedParams, droppedParams,
      upstreamUrlRedacted: redactUrlSecrets(upstreamUrl),
      ...(modelFieldNames ? { availableFields: [...modelFieldNames].sort() } : {}),
      ...(modelFetchError ? { modelFetchError } : {}),
    }, 502);
  }

  // availableFields: from prior model fetch (mode=data) or from the
  // response itself (mode=model, where the body IS the schema).
  let availableFields = null;
  if (modelFieldNames) {
    availableFields = [...modelFieldNames].sort();
  } else if (mode === 'model') {
    const fromResponse = extractFieldNames(dataRes.json);
    if (fromResponse.size > 0) availableFields = [...fromResponse].sort();
  }

  const parsed = extractDataRows(dataRes.json);
  const pagination = extractPagination(parsed.metadata);

  return jsonResp({
    ok: true,
    datasetKey, label: entry.label, ubsDatasetId: matchKey,
    mode, view: safeView,
    fetchedAt, upstreamStatus: dataRes.status,
    rowCount: parsed.rows.length, rows: parsed.rows,
    metadata: parsed.metadata,
    ...(parsed.rawShape ? { rawShape: parsed.rawShape } : {}),
    forwardedParams, droppedParams,
    upstreamUrlRedacted: redactUrlSecrets(upstreamUrl),
    ...(availableFields ? { availableFields } : {}),
    ...(modelFetchError ? { modelFetchError } : {}),
    ...(pagination ? { pagination } : {}),
  });
}
