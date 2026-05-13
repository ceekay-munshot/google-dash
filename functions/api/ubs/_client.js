/**
 * UBS Evidence Lab — server-side HTTP client helper.
 *
 * SECURITY:
 *   - UBS_API_KEY is read from env on each call. It must never be embedded
 *     in source, returned to the browser, or logged. The error-body
 *     truncation below also redacts any string that looks like a bearer
 *     credential before it is surfaced to callers.
 *   - This file is only ever imported by other Pages Functions (server-
 *     side). It must never be referenced from anything under /js or /css.
 *
 * AUTH FORMAT:
 *   We try `Authorization: Bearer <key>` first. The repo contains no UBS
 *   docs/user guide that would indicate otherwise; if UBS expects a
 *   different scheme (e.g. an `apikey:` header), flip AUTH_MODE here.
 */

export const UBS_BASE = 'https://neo.ubs.com/api/evidence-lab/api-framework';
export const UBS_CATALOGUE_URL = `${UBS_BASE}/catalogue/data-asset/v2`;

// 'bearer' → Authorization: Bearer <key>
// 'apikey' → apikey: <key>  (alternative scheme — only flip after
//   confirming Bearer fails with a 401/403 and UBS docs call for it)
const AUTH_MODE = 'bearer';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_ERROR_BODY_CHARS = 400;

/** Build the request headers for a UBS call. Never returns the key value. */
function buildAuthHeaders(apiKey) {
  if (AUTH_MODE === 'apikey') {
    return { apikey: apiKey, Accept: 'application/json' };
  }
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
}

/**
 * Redact anything that looks like a credential from a string so we can
 * safely return UBS error bodies to the browser. Belt-and-braces — the
 * key is not in the response path by design, but UBS could echo headers
 * back in a malformed-request response.
 */
function redactSecrets(s, apiKey) {
  if (typeof s !== 'string' || !s) return s;
  let out = s;
  if (apiKey && apiKey.length >= 8) {
    // Direct match — replace every occurrence of the literal key.
    out = out.split(apiKey).join('[REDACTED]');
  }
  // Generic bearer redaction in case UBS echoes a tweaked variant.
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
  return out;
}

/** Truncate a possibly-large error body to a bounded string. */
function truncateBody(body, apiKey) {
  if (body == null) return null;
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  const redacted = redactSecrets(s, apiKey);
  return redacted.length > MAX_ERROR_BODY_CHARS
    ? redacted.slice(0, MAX_ERROR_BODY_CHARS) + '…[truncated]'
    : redacted;
}

/** Compose an AbortController + timeout so a hung UBS call can't pin the worker. */
function withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

/**
 * Generic UBS GET. Returns a discriminated result:
 *   { ok: true,  status, json }                    — 2xx with parsed JSON
 *   { ok: false, status, error, errorBody?, code } — non-2xx or transport failure
 *
 * NEVER returns the raw response or headers — those could carry sensitive data.
 *
 * @param {{ UBS_API_KEY?: string }} env
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function ubsGet(env, url, opts = {}) {
  const apiKey = env?.UBS_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      code: 'missing_api_key',
      error: 'UBS_API_KEY is not bound to this environment',
    };
  }

  const t = withTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: buildAuthHeaders(apiKey),
      signal: t.signal,
    });
  } catch (err) {
    t.clear();
    const msg = err?.name === 'AbortError'
      ? `UBS request timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
      : `UBS fetch failed: ${err?.message || 'unknown error'}`;
    return { ok: false, status: 0, code: 'transport_error', error: redactSecrets(msg, apiKey) };
  }
  t.clear();

  const rawText = await resp.text().catch(() => '');

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      code: 'upstream_non_2xx',
      error: `UBS responded ${resp.status} ${resp.statusText || ''}`.trim(),
      errorBody: truncateBody(rawText, apiKey),
    };
  }

  if (!rawText) {
    return { ok: true, status: resp.status, json: null };
  }

  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      status: resp.status,
      code: 'invalid_json',
      error: 'UBS returned 2xx with a non-JSON body',
      errorBody: truncateBody(rawText, apiKey),
    };
  }

  return { ok: true, status: resp.status, json };
}

/** Convenience wrapper for the catalogue endpoint. */
export function fetchUbsCatalogue(env, opts) {
  return ubsGet(env, UBS_CATALOGUE_URL, opts);
}
