/**
 * UBS Evidence Lab — defensive response parsing helpers.
 *
 * The UBS catalogue shape is undocumented (in this repo) and the
 * upstream returns descriptions but mostly-null mapped fields when
 * probed at the top level only — meaning the fields live under nested
 * keys we haven't probed yet. This module exists so:
 *   - catalogue.js, status.js, and catalogue/debug-fields.js share the
 *     same picker and field-candidate definitions
 *   - the picker can walk an item recursively up to a bounded depth
 *   - debug-mode endpoints can introspect what UBS actually returned
 *     without leaking secrets
 */

/* ──────────────────────── field candidates ──────────────────────── */

export const ID_KEYS = [
  'id', 'uid', 'uuid',
  'assetId', 'asset_id',
  'dataAssetId', 'data_asset_id',
  'dataAssetKey', 'data_asset_key',
  'datasetId', 'dataset_id',
  'productId', 'product_id',
  'slug', 'code', 'key', 'identifier',
];

export const NAME_KEYS = [
  'name', 'title', 'label',
  'displayName', 'display_name',
  'dataAssetName', 'data_asset_name',
  'datasetName', 'dataset_name',
  'productName', 'product_name',
];

export const CATEGORY_KEYS = [
  'category', 'productArea', 'product_area',
  'sector', 'vertical', 'taxonomy',
  'family', 'group', 'theme',
];

export const DESCRIPTION_KEYS = [
  'description', 'summary', 'abstract',
  'longDescription', 'shortDescription',
  'long_description', 'short_description',
];

export const FREQUENCY_KEYS = [
  'frequency', 'cadence',
  'updateFrequency', 'update_frequency',
  'refreshFrequency', 'refresh_frequency',
  'periodicity',
];

export const GEOGRAPHY_KEYS = [
  'geography', 'geo',
  'region', 'country', 'countries',
  'coverage', 'market', 'markets',
];

// Strictly-boolean API access candidates. apiAccessible is set ONLY
// when one of these resolves to a clean tri-bool; anything else
// (delivery-method arrays, entitlement objects, etc.) leaves it null.
export const API_BOOL_KEYS = [
  'apiAccessible', 'api_accessible',
  'apiAvailable',  'api_available',
  'apiEnabled',    'api_enabled',
];

// Anything entitlement/delivery-shaped is lumped into entitlementStatus
// as a free-form string (or compact JSON), so we still surface signal
// without misclaiming a boolean.
export const ENTITLEMENT_KEYS = [
  'entitlementStatus', 'entitlement_status',
  'entitlement', 'entitled',
  'access', 'accessStatus', 'access_status',
  'permission', 'permissions',
  'deliveryMethod',  'delivery_method',
  'deliveryMethods', 'delivery_methods',
  'availableVia',    'available_via',
];

/* ──────────────────────── envelope extraction ──────────────────────── */

/**
 * Walk a parsed UBS response and return the dataset array, regardless
 * of which envelope key UBS used.
 */
export function extractDatasetArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;

  const directKeys = [
    'data', 'items', 'results', 'datasets',
    'dataAssets', 'data_assets', 'assets',
    'catalogue', 'catalog',
  ];
  for (const k of directKeys) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  for (const k of directKeys) {
    if (payload[k] && typeof payload[k] === 'object') {
      const inner = extractDatasetArray(payload[k]);
      if (Array.isArray(inner)) return inner;
    }
  }
  for (const v of Object.values(payload)) {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object')) {
      return v;
    }
  }
  return null;
}

/* ──────────────────────── deep picker ──────────────────────── */

/**
 * BFS for the first occurrence of any of `keys` inside `obj`, up to
 * `maxDepth` levels of nested objects. BFS guarantees that shallower
 * matches win (so a top-level `id` is preferred over `metadata.id`).
 *
 * Arrays are not descended into — UBS items don't typically nest
 * scalars inside per-item arrays, and walking arrays would explode
 * the search space.
 *
 * Returns { value, path } where path is dotted (e.g. 'asset.id').
 */
export function deepPick(obj, keys, maxDepth = 3) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { value: null, path: null };
  }
  const queue = [{ node: obj, path: [], depth: 0 }];
  while (queue.length) {
    const { node, path, depth } = queue.shift();
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;

    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(node, k)) {
        const v = node[k];
        if (v !== undefined && v !== null && v !== '') {
          return { value: v, path: [...path, k].join('.') };
        }
      }
    }
    if (depth < maxDepth) {
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          queue.push({ node: v, path: [...path, k], depth: depth + 1 });
        }
      }
    }
  }
  return { value: null, path: null };
}

/* ──────────────────────── value coercion ──────────────────────── */

export function asTriBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim();
    if (['true', 'yes', 'available', 'enabled', 'on', '1'].includes(s)) return true;
    if (['false', 'no', 'unavailable', 'disabled', 'off', '0'].includes(s)) return false;
  }
  return null;
}

/**
 * Coerce a raw picked value to a compact, JSON-safe display form.
 *  - strings → trimmed
 *  - scalars → stringified
 *  - string/number arrays → comma-joined
 *  - objects → preferred label key (label|name|...) or compact JSON, capped at 200 chars
 */
export function formatFieldValue(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return v.join(', ');
    }
    return JSON.stringify(v).slice(0, 200);
  }
  if (typeof v === 'object') {
    const labelKey = ['label', 'displayName', 'display_name', 'name', 'title', 'value', 'code']
      .find((k) => v[k] != null);
    if (labelKey) return formatFieldValue(v[labelKey]);
    return JSON.stringify(v).slice(0, 200);
  }
  return String(v);
}

/* ──────────────────────── per-item mapping ──────────────────────── */

/**
 * Map one raw UBS catalogue entry to the safe metadata shape we expose
 * to the dashboard backend. Recursively searches up to depth 3 for each
 * field.
 *
 * @param {*} raw                       raw UBS item
 * @param {{ includeTrace?: boolean }} [opts]
 *   includeTrace: when true, attaches a `_trace` object with the
 *   resolved path (or null) for each mapped field.
 */
export function mapCatalogueItem(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') {
    const empty = {
      id: null, name: null, category: null, description: null,
      frequency: null, geography: null,
      apiAccessible: null, entitlementStatus: null,
    };
    if (opts.includeTrace) empty._trace = {};
    return empty;
  }

  const fields = [
    ['id',          ID_KEYS],
    ['name',        NAME_KEYS],
    ['category',    CATEGORY_KEYS],
    ['description', DESCRIPTION_KEYS],
    ['frequency',   FREQUENCY_KEYS],
    ['geography',   GEOGRAPHY_KEYS],
  ];

  const out = {};
  const trace = {};

  for (const [name, keys] of fields) {
    const { value, path } = deepPick(raw, keys, 3);
    out[name] = formatFieldValue(value);
    trace[name] = { found: value != null, path };
  }

  // Strict tri-bool only for apiAccessible.
  const apiHit = deepPick(raw, API_BOOL_KEYS, 3);
  const apiBool = asTriBool(apiHit.value);
  out.apiAccessible = apiBool;
  trace.apiAccessible = { found: apiBool !== null, path: apiHit.path };

  // Free-form entitlement / delivery / permission.
  const entHit = deepPick(raw, ENTITLEMENT_KEYS, 3);
  out.entitlementStatus = formatFieldValue(entHit.value);
  trace.entitlementStatus = { found: out.entitlementStatus != null, path: entHit.path };

  if (opts.includeTrace) out._trace = trace;
  return out;
}

/* ──────────────────────── debug introspection ──────────────────────── */

/**
 * Flatten an object's key paths up to maxDepth, recording the leaf
 * type at each path. Used by debug endpoints to expose the actual
 * shape of UBS items without echoing values (avoids any chance of
 * secret/PII leakage).
 *
 * Output is an array of strings like:
 *   'name: string'
 *   'asset.id: string'
 *   'tags: array[3]'
 *   'metadata.region.code: string'
 */
export function flattenKeyPaths(obj, { maxDepth = 3, maxOut = 200 } = {}) {
  const out = [];
  function walk(node, prefix, depth) {
    if (out.length >= maxOut) return;
    if (node === null) {
      out.push(`${prefix}: null`);
      return;
    }
    if (typeof node !== 'object') {
      out.push(`${prefix}: ${typeof node}`);
      return;
    }
    if (Array.isArray(node)) {
      out.push(`${prefix}: array[${node.length}]`);
      return;
    }
    if (depth >= maxDepth) {
      out.push(`${prefix}: object{${Object.keys(node).length}}`);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (out.length >= maxOut) return;
      const p = prefix ? `${prefix}.${k}` : k;
      walk(v, p, depth + 1);
    }
  }
  walk(obj, '', 0);
  return out;
}

/**
 * Aggregate per-item _trace records into a parser-notes summary.
 *
 * @param {Array<{ _trace?: Record<string, {found: boolean, path: string|null}> }>} mappedItemsWithTrace
 * @returns {Record<string, { foundCount: number, missingCount: number, pathHistogram: Record<string, number> }>}
 */
export function summariseParserTraces(mappedItemsWithTrace) {
  const fieldNames = [
    'id', 'name', 'category', 'description',
    'frequency', 'geography',
    'apiAccessible', 'entitlementStatus',
  ];
  const summary = {};
  for (const f of fieldNames) {
    summary[f] = { foundCount: 0, missingCount: 0, pathHistogram: {} };
  }
  for (const item of mappedItemsWithTrace) {
    const trace = item?._trace || {};
    for (const f of fieldNames) {
      const t = trace[f];
      if (t && t.found) {
        summary[f].foundCount += 1;
        const key = t.path || '<root>';
        summary[f].pathHistogram[key] = (summary[f].pathHistogram[key] || 0) + 1;
      } else {
        summary[f].missingCount += 1;
      }
    }
  }
  return summary;
}
