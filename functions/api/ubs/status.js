/**
 * Cloudflare Pages Function — UBS Evidence Lab status probe.
 * Route: GET /api/ubs/status
 *
 * Safe to open in the browser. Never returns or echoes UBS_API_KEY.
 * Reports whether the catalogue endpoint is reachable and (when the
 * response can be parsed) a rough dataset count.
 */

import { fetchUbsCatalogue, UBS_CATALOGUE_URL } from './_client.js';
import { extractDatasetArray } from './catalogue.js';

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

  // 2xx — derive a dataset count + API-accessible count defensively.
  let datasetCount = null;
  let apiAccessibleCount = null;
  try {
    const items = extractDatasetArray(result.json);
    if (Array.isArray(items)) {
      datasetCount = items.length;
      apiAccessibleCount = items.reduce((acc, it) => {
        const flag = pickApiAccessFlag(it);
        return acc + (flag === true ? 1 : 0);
      }, 0);
    }
  } catch {
    // Parser failures here are non-fatal for a status probe — the
    // catalogue is reachable; the count just couldn't be derived.
  }

  return jsonResp({
    ok: true,
    catalogueReachable: true,
    upstreamStatus: result.status,
    ...base,
    ...(datasetCount != null ? { datasetCount } : {}),
    ...(apiAccessibleCount != null ? { apiAccessibleCount } : {}),
  });
}

// Local copy of the API-accessibility heuristic so /status doesn't import
// internals from /catalogue. Kept aligned with mapCatalogueItem().
function pickApiAccessFlag(it) {
  if (!it || typeof it !== 'object') return null;
  const candidates = [
    it.apiAccessible, it.api_accessible,
    it.apiAvailable, it.api_available,
    it.hasApi, it.has_api,
    it.api,
  ];
  for (const c of candidates) {
    if (typeof c === 'boolean') return c;
    if (typeof c === 'string') {
      const v = c.toLowerCase();
      if (v === 'true' || v === 'yes' || v === 'available') return true;
      if (v === 'false' || v === 'no' || v === 'unavailable') return false;
    }
  }
  return null;
}
