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
 *   6. Forward safe pagination params (limit, offset) onto the UBS
 *      view URL. Anything else from the request query string is
 *      dropped — UBS_API_KEY only travels in the Authorization header.
 *   7. Parse the UBS data response defensively:
 *        array | { data: [] } | { items: [] } | { results: [] } | { rows: [] }
 *      Non-array responses (e.g. count) are preserved in metadata +
 *      rawShape rather than crashing.
 *
 * UBS_API_KEY is never returned, never logged. Pages caches lightly
 * (max-age=60) so a transient miss doesn't trigger an upstream storm.
 */

import { fetchUbsCatalogue, ubsGet, UBS_HOST } from '../_client.js';
import { extractDatasetArray, safeViewSubset } from '../_parser.js';
import { getUbsDataset } from '../_registry.js';

const VALID_MODES = new Set(['data', 'model', 'count', 'distinct']);

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
 * Defensive row extractor for UBS data responses. Handles the five
 * envelope shapes the user spec called out plus a non-array fallback.
 *
 * Returns { rows, metadata, rawShape }:
 *   rows     — array (possibly empty); always an array for caller simplicity
 *   metadata — sibling fields from the response envelope (or the whole
 *              payload when no array could be located)
 *   rawShape — null when an array was found; otherwise describes the
 *              actual payload type/keys so the caller can diagnose
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

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const datasetKey = (params?.datasetKey || '').toString();
  const mode = (url.searchParams.get('mode') || 'data').toLowerCase();
  const viewIdParam = url.searchParams.get('viewId');
  const limit = url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');
  const fetchedAt = new Date().toISOString();

  if (!VALID_MODES.has(mode)) {
    return jsonResp({
      ok: false,
      error: 'invalid_mode',
      detail: `mode must be one of: ${[...VALID_MODES].join(', ')}`,
      datasetKey, fetchedAt,
    }, 400);
  }

  if (!env?.UBS_API_KEY) {
    return jsonResp({
      ok: false,
      error: 'missing_api_key',
      detail: 'UBS_API_KEY is not bound on this environment',
      datasetKey, fetchedAt,
    }, 500);
  }

  const entry = getUbsDataset(datasetKey);
  if (!entry) {
    return jsonResp({
      ok: false,
      error: 'unknown_dataset_key',
      detail: `No registry entry for "${datasetKey}"`,
      datasetKey, fetchedAt,
    }, 400);
  }
  if (!entry.ubsDatasetId) {
    return jsonResp({
      ok: false,
      error: 'missing_ubs_dataset_id',
      detail: `Registry entry "${datasetKey}" has no ubsDatasetId yet — populate it from /api/ubs/catalogue first`,
      datasetKey,
      label: entry.label,
      fetchedAt,
    }, 400);
  }

  // Step 1 — pull the catalogue, find the matching item by dataAssetKey.
  const cat = await fetchUbsCatalogue(env, { timeoutMs: 15000 });
  if (!cat.ok) {
    return jsonResp({
      ok: false,
      error: 'catalogue_fetch_failed',
      detail: cat.error,
      errorCode: cat.code,
      ...(cat.errorBody ? { errorBody: cat.errorBody } : {}),
      upstreamStatus: cat.status || null,
      datasetKey, ubsDatasetId: entry.ubsDatasetId, label: entry.label, fetchedAt,
    }, 502);
  }

  const items = extractDatasetArray(cat.json);
  if (!Array.isArray(items)) {
    return jsonResp({
      ok: false,
      error: 'unparseable_catalogue',
      detail: 'UBS catalogue did not return a recognised dataset array',
      datasetKey, ubsDatasetId: entry.ubsDatasetId, label: entry.label, fetchedAt,
    }, 502);
  }

  const matchKey = String(entry.ubsDatasetId);
  const item = items.find((it) => String(it?.dataAssetKey || '') === matchKey);
  if (!item) {
    return jsonResp({
      ok: false,
      error: 'dataset_not_in_catalogue',
      detail: `No catalogue item with dataAssetKey="${matchKey}"`,
      datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
    }, 404);
  }

  // Step 2 — view pick.
  const views = Array.isArray(item.views) ? item.views : [];
  if (views.length === 0) {
    return jsonResp({
      ok: false,
      error: 'no_views',
      detail: 'Catalogue item has no views',
      datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
    }, 502);
  }

  let view;
  if (viewIdParam) {
    view = views.find((v) => String(v?.id) === String(viewIdParam));
    if (!view) {
      return jsonResp({
        ok: false,
        error: 'view_not_found',
        detail: `viewId="${viewIdParam}" not in catalogue item's views`,
        availableViewIds: views.map((v) => v?.id ?? null),
        datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
      }, 400);
    }
  } else {
    view = views[0];
  }

  // Step 3 — resolve mode URL.
  const modeUrlKey = `${mode}Url`;
  const modeUrl = resolveUbsUrl(view?.[modeUrlKey]);
  if (!modeUrl) {
    return jsonResp({
      ok: false,
      error: 'mode_url_missing',
      detail: `View "${view?.id || '(unnamed)'}" has no usable ${modeUrlKey}`,
      mode,
      view: safeViewSubset(view),
      datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
    }, 502);
  }

  // Step 4 — append safe pagination params to the upstream URL.
  let upstreamUrl = modeUrl;
  if (limit != null || offset != null) {
    try {
      const u = new URL(modeUrl);
      if (limit != null)  u.searchParams.set('limit', String(limit));
      if (offset != null) u.searchParams.set('offset', String(offset));
      upstreamUrl = u.toString();
    } catch {
      // malformed UBS URL — fall back to the raw value
    }
  }

  // Step 5 — fetch + defensive parse.
  const dataRes = await ubsGet(env, upstreamUrl, { timeoutMs: 30000 });
  if (!dataRes.ok) {
    return jsonResp({
      ok: false,
      error: 'upstream_fetch_failed',
      detail: dataRes.error,
      errorCode: dataRes.code,
      ...(dataRes.errorBody ? { errorBody: dataRes.errorBody } : {}),
      upstreamStatus: dataRes.status || null,
      mode,
      view: safeViewSubset(view),
      datasetKey, ubsDatasetId: matchKey, label: entry.label, fetchedAt,
    }, 502);
  }

  const parsed = extractDataRows(dataRes.json);

  return jsonResp({
    ok: true,
    datasetKey,
    label: entry.label,
    ubsDatasetId: matchKey,
    mode,
    view: safeViewSubset(view),
    fetchedAt,
    upstreamStatus: dataRes.status,
    rowCount: parsed.rows.length,
    rows: parsed.rows,
    metadata: parsed.metadata,
    ...(parsed.rawShape ? { rawShape: parsed.rawShape } : {}),
  });
}
