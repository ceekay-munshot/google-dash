/**
 * Cloudflare Pages Function — UBS Evidence Lab status probe.
 * Route: GET /api/ubs/status
 *
 * Safe to open in the browser. Never returns or echoes UBS_API_KEY.
 *
 * Returns:
 *   {
 *     ok, catalogueReachable, checkedAt, catalogueUrl, source,
 *     upstreamStatus?,
 *     datasetCount?,                 — total items in the catalogue
 *     apiAccessibleCount?,           — items with strict apiAccessible === true
 *     apiAccessibleUnknownCount?,    — items with apiAccessible === null
 *                                     (i.e. no boolean signal found)
 *     error?, errorCode?, errorBody?
 *   }
 *
 * `ok` is driven solely by catalogue reachability. Zero apiAccessible
 * hits is NOT a failure — UBS may not expose a direct API boolean, in
 * which case every item flows into apiAccessibleUnknownCount instead.
 */

import { fetchUbsCatalogue, UBS_CATALOGUE_URL } from './_client.js';
import { extractDatasetArray, mapCatalogueItem } from './_parser.js';

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
      'Cache-Control': 'no-store',
      ...CORS,
      ...extraHeaders,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const checkedAt = new Date().toISOString();
  const base = {
    checkedAt,
    catalogueUrl: UBS_CATALOGUE_URL,
    source: 'UBS Evidence Lab',
  };

  if (!env?.UBS_API_KEY) {
    return jsonResp({
      ok: false,
      catalogueReachable: false,
      ...base,
      error: 'UBS_API_KEY is not bound on this environment',
    });
  }

  const result = await fetchUbsCatalogue(env, { timeoutMs: 12000 });

  if (!result.ok) {
    return jsonResp({
      ok: false,
      catalogueReachable: false,
      upstreamStatus: result.status || null,
      ...base,
      error: result.error,
      errorCode: result.code,
      ...(result.errorBody ? { errorBody: result.errorBody } : {}),
    });
  }

  let datasetCount = null;
  let apiAccessibleCount = null;
  let apiAccessibleUnknownCount = null;
  try {
    const items = extractDatasetArray(result.json);
    if (Array.isArray(items)) {
      datasetCount = items.length;
      let trueCount = 0;
      let unknownCount = 0;
      for (const it of items) {
        const m = mapCatalogueItem(it);
        if (m.apiAccessible === true) trueCount += 1;
        else if (m.apiAccessible === null) unknownCount += 1;
      }
      apiAccessibleCount = trueCount;
      apiAccessibleUnknownCount = unknownCount;
    }
  } catch {
    // Non-fatal — catalogue is reachable; counts just couldn't be derived.
  }

  return jsonResp({
    ok: true,
    catalogueReachable: true,
    upstreamStatus: result.status,
    ...base,
    ...(datasetCount != null ? { datasetCount } : {}),
    ...(apiAccessibleCount != null ? { apiAccessibleCount } : {}),
    ...(apiAccessibleUnknownCount != null ? { apiAccessibleUnknownCount } : {}),
  });
}
