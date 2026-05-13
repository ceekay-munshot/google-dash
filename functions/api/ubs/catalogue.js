/**
 * Cloudflare Pages Function — UBS Evidence Lab catalogue listing.
 * Route: GET /api/ubs/catalogue
 *
 * Query params:
 *   ?q=<substring>   case-insensitive filter across mapped (id, name,
 *                    category, description) AND the JSON-stringified
 *                    raw item — so a search still hits when UBS's
 *                    field naming doesn't match our candidate keys yet.
 *   ?debug=1         include envelopeKeys, sampleRawItems (≤5),
 *                    sampleRawItemKeys (first 50 top-level keys each),
 *                    nestedKeyMap (≤3 items, depth-3 path inventory),
 *                    parserNotes (per-field foundCount, missingCount,
 *                    and pathHistogram across matched items).
 *
 * Returns only safe mapped metadata in the non-debug path. The debug
 * envelope echoes raw UBS items because they're already safe (no
 * secrets — UBS_API_KEY is sent in headers, not the body) and the
 * user needs to see them to diagnose field-name mapping.
 */

import { fetchUbsCatalogue, UBS_CATALOGUE_URL } from './_client.js';
import {
  extractDatasetArray,
  mapCatalogueItem,
  flattenKeyPaths,
  summariseParserTraces,
} from './_parser.js';

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
      'Cache-Control': 'private, max-age=60',
      ...CORS,
      ...extraHeaders,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const debug = url.searchParams.get('debug') === '1';
  const fetchedAt = new Date().toISOString();

  if (!env?.UBS_API_KEY) {
    return jsonResp({
      success: false,
      error: 'UBS_API_KEY is not bound on this environment',
      catalogueUrl: UBS_CATALOGUE_URL,
      fetchedAt,
    }, 500);
  }

  const result = await fetchUbsCatalogue(env, { timeoutMs: 15000 });
  if (!result.ok) {
    return jsonResp({
      success: false,
      error: result.error,
      errorCode: result.code,
      upstreamStatus: result.status || null,
      ...(result.errorBody ? { errorBody: result.errorBody } : {}),
      catalogueUrl: UBS_CATALOGUE_URL,
      fetchedAt,
    }, 502);
  }

  const items = extractDatasetArray(result.json);
  if (!Array.isArray(items)) {
    return jsonResp({
      success: false,
      error: 'UBS catalogue returned an unrecognised envelope; no dataset array could be located',
      errorCode: 'unparseable_envelope',
      upstreamStatus: result.status,
      envelopeKeys: result.json && typeof result.json === 'object' ? Object.keys(result.json).slice(0, 20) : [],
      catalogueUrl: UBS_CATALOGUE_URL,
      fetchedAt,
    }, 502);
  }

  // Map every item with trace data so we can both filter by `q` and
  // summarise parser hits/misses for debug mode.
  const traced = items.map((raw) => ({
    raw,
    mapped: mapCatalogueItem(raw, { includeTrace: true }),
  }));

  const needle = q ? q.toLowerCase() : '';
  const filteredTraced = needle
    ? traced.filter(({ raw, mapped }) => {
        const corpus = [
          mapped.id, mapped.name, mapped.category, mapped.description,
          mapped.frequency, mapped.geography, mapped.entitlementStatus,
        ].filter(Boolean).join('\n');
        if (corpus.toLowerCase().includes(needle)) return true;
        try {
          return JSON.stringify(raw).toLowerCase().includes(needle);
        } catch {
          return false;
        }
      })
    : traced;

  const mapped = filteredTraced.map(({ mapped: m }) => {
    // Strip the internal _trace field from the publicly returned items
    // — it's an implementation detail, summarised separately in debug.
    const { _trace, ...rest } = m;
    return rest;
  });

  const apiAccessibleCount = mapped.reduce(
    (acc, m) => acc + (m.apiAccessible === true ? 1 : 0),
    0
  );
  const apiAccessibleUnknownCount = mapped.reduce(
    (acc, m) => acc + (m.apiAccessible === null ? 1 : 0),
    0
  );

  const body = {
    success: true,
    catalogueUrl: UBS_CATALOGUE_URL,
    fetchedAt,
    upstreamStatus: result.status,
    query: q || null,
    totalDatasets: items.length,
    matchedDatasets: mapped.length,
    datasetCount: mapped.length,
    apiAccessibleCount,
    apiAccessibleUnknownCount,
    datasets: mapped,
    source: 'UBS Evidence Lab',
  };

  if (debug) {
    const envelopeKeys = result.json && typeof result.json === 'object' && !Array.isArray(result.json)
      ? Object.keys(result.json).slice(0, 50)
      : null;

    const sampleTraced = filteredTraced.slice(0, 5);
    const sampleRawItems = sampleTraced.map(({ raw }) => raw);
    const sampleRawItemKeys = sampleTraced.map(({ raw }) =>
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.keys(raw).slice(0, 50)
        : []
    );
    const nestedKeyMap = filteredTraced.slice(0, 3).map(({ raw }, idx) => ({
      itemIndex: idx,
      paths: flattenKeyPaths(raw, { maxDepth: 3, maxOut: 200 }),
    }));
    const parserNotes = summariseParserTraces(filteredTraced.map(({ mapped: m }) => m));

    body.debug = {
      envelopeKeys,
      sampleRawItems,
      sampleRawItemKeys,
      nestedKeyMap,
      parserNotes,
    };
  }

  return jsonResp(body);
}

// Backwards-compat re-export: status.js previously imported this from
// catalogue.js. Keep the export so any external caller that adopted the
// shim doesn't break — the canonical home is now _parser.js.
export { extractDatasetArray } from './_parser.js';
