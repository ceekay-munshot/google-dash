/**
 * Cloudflare Pages Function — TEMPORARY UBS catalogue field inspector.
 * Route: GET /api/ubs/catalogue/debug-fields
 *
 * Purpose:
 *   Make it trivial to confirm which JSON paths UBS actually exposes
 *   for the catalogue items, so we can extend the field candidate
 *   lists in _parser.js to match. Safe to open in the browser:
 *     - never returns UBS_API_KEY
 *     - never returns Authorization headers
 *     - cache-control: no-store
 *
 * Coexists with /api/ubs/catalogue (handled by catalogue.js) — Pages
 * resolves the exact match first, then descends into the directory.
 *
 * Remove this file once the parser is tuned and we no longer need a
 * live introspection surface.
 */

import { fetchUbsCatalogue, UBS_CATALOGUE_URL } from '../_client.js';
import { extractDatasetArray, flattenKeyPaths } from '../_parser.js';

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
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
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

  const payload = result.json;
  const topLevelKeys = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload).slice(0, 50)
    : [];

  const items = extractDatasetArray(payload) || [];
  const sampleCount = Math.min(items.length, 10);

  const itemKeyPathMaps = items.slice(0, sampleCount).map((raw, idx) => {
    const topKeys = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.keys(raw).slice(0, 100)
      : [];
    return {
      itemIndex: idx,
      topLevelItemKeys: topKeys,
      keyPaths: flattenKeyPaths(raw, { maxDepth: 3, maxOut: 200 }),
    };
  });

  return jsonResp({
    success: true,
    catalogueUrl: UBS_CATALOGUE_URL,
    fetchedAt,
    upstreamStatus: result.status,
    totalDatasets: items.length,
    sampleCount,
    topLevelKeys,
    itemKeyPathMaps,
    note: 'Temporary diagnostic endpoint. Used to identify UBS field names so _parser.js candidate lists can be extended.',
  });
}
