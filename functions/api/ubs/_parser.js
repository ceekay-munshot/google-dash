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

// Live UBS catalogue items expose dataAssetKey as the canonical id and
// heading as the canonical display name, so those lead each list.
export const ID_KEYS = [
  'dataAssetKey', 'data_asset_key',
  'id', 'uid', 'uuid',
  'assetId', 'asset_id',
  'dataAssetId', 'data_asset_id',
  'datasetId', 'dataset_id',
  'productId', 'product_id',
  'slug', 'code', 'key', 'identifier',
];

export const NAME_KEYS = [
  'heading',
  'name', 'title', 'label',
  'displayName', 'display_name',
  'dataAssetName', 'data_asset_name',
  'datasetName', 'dataset_name',
  'productName', 'product_name',
];

export const CATEGORY_KEYS = [
  'frameworkName', 'apiFrameworkName',
  'category', 'productArea', 'product_area',
  'sector', 'vertical', 'taxonomy',
  'family', 'group', 'theme',
];

export const DESCRIPTION_KEYS = [
  'shortDescription', 'short_description',
  'description', 'summary', 'abstract',
  'longDescription', 'long_description',
];

export const FREQUENCY_KEYS = [
  'dataFrequencyCode', 'deliveryFrequencyCode',
  'frequency', 'cadence',
  'updateFrequency', 'update_frequency',
  'refreshFrequency', 'refresh_frequency',
  'periodicity',
];

export const GEOGRAPHY_KEYS = [
  'countryIsoAlpha3List',
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

/* ──────────────────────── view helpers ──────────────────────── */

const VIEW_URL_KEYS = ['dataUrl', 'modelUrl', 'countUrl', 'distinctUrl'];

/**
 * Reduce one UBS catalogue view to the safe subset we expose.
 * Anything else on the raw view (entitlement metadata, etc.) is
 * intentionally dropped so we never surface unknown UBS fields to
 * downstream consumers without review.
 */
export function safeViewSubset(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    id:               v.id ?? null,
    name:             v.name ?? null,
    version:          v.version ?? null,
    dataLastUpdated:  v.dataLastUpdated ?? null,
    modelUrl:         v.modelUrl ?? null,
    dataUrl:          v.dataUrl ?? null,
    countUrl:         v.countUrl ?? null,
    distinctUrl:      v.distinctUrl ?? null,
  };
}

/**
 * Apply the API-accessibility rule:
 *   - true  if any view in the item carries a usable view URL
 *           (dataUrl|modelUrl|countUrl|distinctUrl)
 *   - false ONLY if UBS explicitly returned a boolean-false signal
 *   - null  otherwise (no signal — never inferred)
 */
export function inferApiAccessible(raw) {
  const views = raw && Array.isArray(raw.views) ? raw.views : null;
  if (views) {
    for (const v of views) {
      if (v && typeof v === 'object') {
        for (const k of VIEW_URL_KEYS) {
          const u = v[k];
          if (typeof u === 'string' && u.trim()) return true;
        }
      }
    }
  }
  const explicit = asTriBool(deepPick(raw, API_BOOL_KEYS, 3).value);
  if (explicit === true) return true;
  if (explicit === false) return false;
  return null;
}

/* ──────────────────────── per-item mapping ──────────────────────── */

// Raw UBS keys that we pass straight through to the API consumer.
// Read at the top level only — these are documented UBS fields, so we
// don't want to accidentally pick up a same-named key from a deeper
// nested object.
const PASSTHROUGH_KEYS = [
  'apiFrameworkName',
  'frameworkKey',
  'frameworkName',
  'dataAssetKey',
  'publicationId',
  'dataStartDate',
  'dataEndDate',
  'dataFrequencyCode',
  'deliveryFrequencyCode',
  'tickerList',
  'countryIsoAlpha3List',
];

function emptyMapped() {
  return {
    id: null, name: null, category: null, description: null,
    frequency: null, geography: null,
    apiAccessible: null, entitlementStatus: null,
    apiFrameworkName: null, frameworkKey: null, frameworkName: null,
    dataAssetKey: null, publicationId: null,
    dataStartDate: null, dataEndDate: null,
    dataFrequencyCode: null, deliveryFrequencyCode: null,
    tickerList: null, countryIsoAlpha3List: null,
    views: null,
  };
}

/**
 * Map one raw UBS catalogue entry to the safe metadata shape we expose
 * to the dashboard backend.
 *
 * Output:
 *   - id / name / category / description / frequency / geography
 *       Resolved via deepPick over their candidate lists (depth ≤ 3),
 *       formatted to a compact display value.
 *   - apiAccessible
 *       Strict — true only if views carry a usable URL or UBS gives
 *       an explicit boolean. Otherwise null.
 *   - entitlementStatus
 *       Free-form entitlement/delivery/permission, deepPicked.
 *   - apiFrameworkName / frameworkKey / frameworkName / dataAssetKey /
 *     publicationId / dataStartDate / dataEndDate / dataFrequencyCode /
 *     deliveryFrequencyCode / tickerList / countryIsoAlpha3List
 *       Raw passthrough from the UBS item top level — preserved as-is
 *       (arrays stay as arrays, strings stay as strings).
 *   - views
 *       Sanitized to the safe per-view subset (id, name, version,
 *       dataLastUpdated, modelUrl, dataUrl, countUrl, distinctUrl).
 *
 * @param {*} raw                       raw UBS item
 * @param {{ includeTrace?: boolean }} [opts]
 *   includeTrace: when true, attaches a `_trace` object with the
 *   resolved path (or null) for each mapped field.
 */
export function mapCatalogueItem(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') {
    const empty = emptyMapped();
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

  const out = emptyMapped();
  const trace = {};

  for (const [name, keys] of fields) {
    const { value, path } = deepPick(raw, keys, 3);
    out[name] = formatFieldValue(value);
    trace[name] = { found: value != null, path };
  }

  // apiAccessible: view URLs first, then explicit boolean, else null.
  const apiBool = inferApiAccessible(raw);
  out.apiAccessible = apiBool;
  trace.apiAccessible = {
    found: apiBool !== null,
    path: apiBool === null ? null : (Array.isArray(raw.views) && raw.views.some((v) => v && VIEW_URL_KEYS.some((k) => typeof v[k] === 'string' && v[k].trim()))
      ? 'views[].url'
      : deepPick(raw, API_BOOL_KEYS, 3).path),
  };

  // entitlementStatus — free-form delivery/permission signal.
  const entHit = deepPick(raw, ENTITLEMENT_KEYS, 3);
  out.entitlementStatus = formatFieldValue(entHit.value);
  trace.entitlementStatus = { found: out.entitlementStatus != null, path: entHit.path };

  // Raw passthrough — top-level only.
  for (const k of PASSTHROUGH_KEYS) {
    const v = raw[k];
    out[k] = v === undefined ? null : v;
  }

  // views — sanitized.
  out.views = Array.isArray(raw.views) ? raw.views.map(safeViewSubset) : null;

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
