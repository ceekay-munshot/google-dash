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
const HANDLER_PARAMS = new Set(['mode', 'viewId']);

// Distinct-field aliases accepted on the inbound request.
const DISTINCT_FIELD_ALIASES = ['distinctField', 'fieldName', 'field', 'column'];

// Upstream param name order — try fieldName first, then field, then
// column on 400. Matches the spec.
const DISTINCT_UPSTREAM_PARAM_ORDER = ['fieldName', 'field', 'column'];

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

/**
 * Call UBS distinct URL with fieldName → field → column fallback on
 * HTTP 400. Returns the first 2xx response, or the last response when
 * all three variants fail.
 *
 * Non-400 errors short-circuit (we treat 4xx-not-400 / 5xx / network
 * errors as "the field name isn't the problem" and stop retrying).
 */
async function callDistinctWithFallback(env, distinctUrl, fieldValue, extraParams) {
  const attempted = [];
  let lastResult = null;
  let lastUrl = distinctUrl;

  for (const paramName of DISTINCT_UPSTREAM_PARAM_ORDER) {
    attempted.push(paramName);
    let u;
    try {
      u = new URL(distinctUrl);
    } catch {
      return {
        ok: false, status: 0, code: 'invalid_distinct_url',
        error: 'Catalogue distinctUrl is not a valid URL',
        usedDistinctParam: paramName, attempted, upstreamUrl: distinctUrl,
      };
    }
    u.searchParams.set(paramName, fieldValue);
    for (const [ek, ev] of Object.entries(extraParams || {})) {
      u.searchParams.set(ek, ev);
    }
    lastUrl = u.toString();

    const res = await ubsGet(env, lastUrl, { timeoutMs: 30000 });
    if (res.ok) {
      return { ...res, usedDistinctParam: paramName, attempted, upstreamUrl: lastUrl };
    }
    lastResult = { ...res, usedDistinctParam: paramName, upstreamUrl: lastUrl };
    if (res.status !== 400) {
      return { ...lastResult, attempted, shortCircuitedOnNon400: true };
    }
  }
  return { ...lastResult, attempted, allFailed: true };
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

    if (distinctReq) {
      const r = await callDistinctWithFallback(env, modeUrl, distinctReq.value, distinctForwarded);
      dataRes = r;
      upstreamUrlUsed = r.upstreamUrl || modeUrl;
      usedDistinctParam = r.usedDistinctParam || null;
      attempted = r.attempted || [];
    } else {
      // No field requested — call distinctUrl with whatever passthrough
      // we have. If UBS requires a field, it will 400 and surface here.
      try {
        const u = new URL(modeUrl);
        for (const [k, v] of Object.entries(distinctForwarded)) u.searchParams.set(k, v);
        upstreamUrlUsed = u.toString();
      } catch {
        upstreamUrlUsed = modeUrl;
      }
      dataRes = await ubsGet(env, upstreamUrlUsed, { timeoutMs: 30000 });
    }

    const distinctForwardedFinal = {
      ...(usedDistinctParam && distinctReq ? { [usedDistinctParam]: distinctReq.value } : {}),
      ...distinctForwarded,
    };

    if (!dataRes.ok) {
      return jsonResp({
        ok: false, error: 'upstream_fetch_failed',
        detail: dataRes.error, errorCode: dataRes.code,
        ...(dataRes.errorBody ? { errorBody: dataRes.errorBody } : {}),
        upstreamStatus: dataRes.status || null,
        mode, view: safeView,
        datasetKey, ubsDatasetId: matchKey, label: entry.label,
        fetchedAt,
        forwardedParams: distinctForwardedFinal,
        droppedParams,
        upstreamUrlRedacted: redactUrlSecrets(upstreamUrlUsed),
        ...(usedDistinctParam || attempted.length > 0 ? { usedDistinctParam, attempted } : {}),
        ...(distinctReq ? { distinctFieldRequested: distinctReq.value, distinctFieldSource: distinctReq.source } : {}),
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
      ...(usedDistinctParam || attempted.length > 0 ? { usedDistinctParam, attempted } : {}),
      ...(distinctReq ? { distinctFieldRequested: distinctReq.value, distinctFieldSource: distinctReq.source } : {}),
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
