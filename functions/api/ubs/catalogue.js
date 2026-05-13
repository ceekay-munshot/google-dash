/**
 * Cloudflare Pages Function — UBS Evidence Lab catalogue listing.
 * Route: GET /api/ubs/catalogue
 *
 * Calls the UBS catalogue endpoint server-side, parses it defensively,
 * and returns only safe metadata fields (never the raw upstream body).
 *
 * The UBS response shape is not documented inside this repo, so the
 * parser tolerates several common envelopes:
 *   - bare array:          [ {...}, {...} ]
 *   - { data: [...] }
 *   - { items: [...] }
 *   - { results: [...] }
 *   - nested catalogue-like response (e.g. { catalogue: { items: [...] } })
 *
 * Per-item field names are also probed across a list of likely keys so
 * that a single rename on UBS's side doesn't blank the whole listing.
 */

import { fetchUbsCatalogue, UBS_CATALOGUE_URL } from './_client.js';

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

  const mapped = items.map(mapCatalogueItem);
  const apiAccessibleCount = mapped.reduce(
    (acc, m) => acc + (m.apiAccessible === true ? 1 : 0),
    0
  );

  return jsonResp({
    success: true,
    catalogueUrl: UBS_CATALOGUE_URL,
    fetchedAt,
    upstreamStatus: result.status,
    datasetCount: mapped.length,
    apiAccessibleCount,
    datasets: mapped,
    source: 'UBS Evidence Lab',
  });
}

/* ──────────────────────── defensive parsing ──────────────────────── */

/**
 * Walk a parsed UBS response and return the dataset array, regardless of
 * which envelope key UBS used. Falls back to a small recursive search so
 * that mildly-nested catalogues (e.g. { catalogue: { items: [...] } })
 * still resolve.
 */
export function extractDatasetArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;

  const directKeys = ['data', 'items', 'results', 'datasets', 'dataAssets', 'assets', 'catalogue', 'catalog'];
  for (const k of directKeys) {
    const v = payload[k];
    if (Array.isArray(v)) return v;
  }
  // One level of nesting (e.g. { catalogue: { items: [...] } })
  for (const k of directKeys) {
    const v = payload[k];
    if (v && typeof v === 'object') {
      const inner = extractDatasetArray(v);
      if (Array.isArray(inner)) return inner;
    }
  }
  // Last-resort: pick the first array-valued property whose elements
  // look like dataset records (objects, not primitives).
  for (const v of Object.values(payload)) {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object')) {
      return v;
    }
  }
  return null;
}

/** Pick the first defined / non-empty value from a list of candidate keys. */
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

/** Normalise a free-form boolean/string into a strict tri-state boolean. */
function asTriBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    if (['true', 'yes', 'available', 'enabled', 'on'].includes(s)) return true;
    if (['false', 'no', 'unavailable', 'disabled', 'off'].includes(s)) return false;
  }
  return null;
}

/**
 * Map one raw UBS catalogue entry to the safe metadata shape we expose
 * to the dashboard backend. Returns nulls for anything we couldn't
 * resolve so the consumer can detect mapping drift without us guessing.
 */
function mapCatalogueItem(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      id: null, name: null, category: null, description: null,
      frequency: null, geography: null,
      apiAccessible: null, entitlementStatus: null,
    };
  }

  const id          = pick(raw, ['id', 'datasetId', 'dataset_id', 'assetId', 'asset_id', 'code', 'key']);
  const name        = pick(raw, ['name', 'displayName', 'display_name', 'title', 'label', 'datasetName', 'dataset_name']);
  const category    = pick(raw, ['category', 'productArea', 'product_area', 'product', 'area', 'dataAsset', 'data_asset', 'taxonomy']);
  const description = pick(raw, ['description', 'summary', 'abstract', 'longDescription', 'shortDescription']);
  const frequency   = pick(raw, ['frequency', 'refreshFrequency', 'refresh_frequency', 'refreshRate', 'cadence', 'schedule', 'updateFrequency']);
  const geography   = pick(raw, ['geography', 'region', 'country', 'coverage', 'geo']);

  const apiAccessRaw = pick(raw, [
    'apiAccessible', 'api_accessible',
    'apiAvailable',  'api_available',
    'hasApi',        'has_api',
    'api',
  ]);
  const apiAccessible = asTriBool(apiAccessRaw);

  const entitlementStatus = pick(raw, [
    'entitlementStatus', 'entitlement_status',
    'entitlement', 'access', 'accessStatus', 'access_status',
    'entitled', 'permission', 'permissions',
  ]);

  return {
    id:                id == null ? null : String(id),
    name:              name == null ? null : String(name),
    category:          category == null ? null : (typeof category === 'string' ? category : JSON.stringify(category)),
    description:       description == null ? null : String(description),
    frequency:         frequency == null ? null : String(frequency),
    geography:         geography == null ? null : (typeof geography === 'string' ? geography : JSON.stringify(geography)),
    apiAccessible,
    entitlementStatus: entitlementStatus == null ? null : (typeof entitlementStatus === 'string' || typeof entitlementStatus === 'boolean' ? String(entitlementStatus) : JSON.stringify(entitlementStatus)),
  };
}
