/**
 * Shared helpers for the AWS Public Network Capacity Proxy module.
 *
 * Source of truth: https://ip-ranges.amazonaws.com/ip-ranges.json
 *
 * What this module provides:
 *   - AWS_IPR_URL                 — canonical clean source URL (no UTM, no tracking)
 *   - fetchIpRanges()             — fetch and parse the upstream JSON
 *   - rollupIpRanges(raw)         — compute totals + by-service / by-region /
 *                                   by-network-border-group rollups for the
 *                                   *latest* snapshot. IPv4 address counts
 *                                   are derived from CIDR prefix lengths
 *                                   (address_count = 2 ** (32 - prefix)).
 *                                   IPv6 totals are intentionally NOT
 *                                   computed — only prefix counts.
 *   - KV key conventions          — DAY_PREFIX / INDEX_KEY for the daily
 *                                   snapshot store, mirroring the
 *                                   existing canonical history pattern.
 *
 * This module is intentionally I/O-light: rollupIpRanges() is pure and
 * deterministic, so the same upstream JSON always produces the same
 * stored snapshot — the basis for our (snapshot_date, sync_token)
 * idempotency check.
 */

export const AWS_IPR_URL = 'https://ip-ranges.amazonaws.com/ip-ranges.json';

export const DAY_PREFIX = 'aws-ipr:day:';        // aws-ipr:day:YYYY-MM-DD → snapshot
export const INDEX_KEY = 'aws-ipr:index:days';   // sorted-desc array of YYYY-MM-DD strings, capped

/** Today's date in UTC as YYYY-MM-DD. */
export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse a CIDR prefix length out of "a.b.c.d/N".
 * Returns the integer prefix length, or null if the input is malformed.
 * We do NOT validate the IP portion here — that's AWS's job. The only
 * thing we trust from the row is the suffix after "/".
 */
function parseCidrPrefixLength(cidr) {
  if (typeof cidr !== 'string') return null;
  const idx = cidr.lastIndexOf('/');
  if (idx === -1) return null;
  const n = parseInt(cidr.slice(idx + 1), 10);
  if (!Number.isFinite(n) || n < 0 || n > 32) return null;
  return n;
}

/**
 * IPv4 address count for a CIDR. /32 → 1, /24 → 256, /0 → 2^32.
 * Returned as a regular Number — a /0 row is 2^32 ≈ 4.3B, and the sum
 * across the entire AWS file is well under Number.MAX_SAFE_INTEGER
 * (2^53), so BigInt is unnecessary here.
 */
function ipv4AddressCount(prefixLength) {
  return 2 ** (32 - prefixLength);
}

/**
 * Fetch the upstream AWS ip-ranges.json file. Returns the parsed JSON
 * payload on success, or throws on network / shape failures so callers
 * can surface a clean error state to the UI.
 */
export async function fetchIpRanges() {
  const resp = await fetch(AWS_IPR_URL, {
    // The file is plain JSON, no auth, served over a CloudFront edge.
    // Pass a UA so the request is identifiable in upstream logs in the
    // unlikely case AWS ever wants to throttle us.
    headers: { 'User-Agent': 'gdash-aws-ipr/1.0' },
    cf: {
      // Cache at Cloudflare's edge for 5 minutes — capture cron + UI
      // both poll well under the upstream change rate (typically multiple
      // updates per day, but we only need daily granularity), so this
      // shaves origin hits without hiding genuine refreshes.
      cacheTtl: 300,
      cacheEverything: true,
    },
  });
  if (!resp.ok) {
    throw new Error('AWS ip-ranges.json fetch failed: HTTP ' + resp.status);
  }
  const json = await resp.json();
  if (!json || typeof json !== 'object') {
    throw new Error('AWS ip-ranges.json: empty or non-object payload');
  }
  if (!Array.isArray(json.prefixes)) {
    throw new Error('AWS ip-ranges.json: missing "prefixes" array');
  }
  return json;
}

/**
 * Compute a rollup snapshot from an upstream AWS ip-ranges.json payload.
 *
 * Returned shape (stored verbatim in KV under aws-ipr:day:YYYY-MM-DD):
 *   {
 *     snapshot_date,                     // YYYY-MM-DD UTC, the storage day
 *     captured_at,                       // ISO timestamp the rollup was built
 *     aws_create_date,                   // upstream createDate (string, AWS-formatted)
 *     sync_token,                        // upstream syncToken
 *     total_ipv4_prefixes,
 *     total_ipv4_addresses,
 *     total_ipv6_prefixes,
 *     total_services,
 *     total_regions,
 *     total_network_border_groups,
 *     by_service:                [{ service, ipv4_prefixes, ipv4_addresses, ipv6_prefixes }, ...],
 *     by_region:                 [{ region,  ipv4_prefixes, ipv4_addresses, ipv6_prefixes }, ...],
 *     by_network_border_group:   [{ network_border_group, ipv4_prefixes, ipv4_addresses, ipv6_prefixes }, ...],
 *     source_url:                AWS_IPR_URL
 *   }
 *
 * Rows with a malformed / missing CIDR are silently skipped — the upstream
 * file has been malformed exactly zero times in production memory, but the
 * guard means a single bad entry can't crash the rollup.
 */
export function rollupIpRanges(raw, { snapshotDate = todayUTC(), capturedAt = new Date().toISOString() } = {}) {
  const prefixes = Array.isArray(raw.prefixes) ? raw.prefixes : [];
  const ipv6Prefixes = Array.isArray(raw.ipv6_prefixes) ? raw.ipv6_prefixes : [];

  // Group accumulators. Map<key, { ipv4_prefixes, ipv4_addresses, ipv6_prefixes }>
  const byService = new Map();
  const byRegion = new Map();
  const byNbg = new Map();

  let total_ipv4_prefixes = 0;
  let total_ipv4_addresses = 0;

  function bump(map, key, field, by = 1) {
    if (!key) return;
    let row = map.get(key);
    if (!row) {
      row = { ipv4_prefixes: 0, ipv4_addresses: 0, ipv6_prefixes: 0 };
      map.set(key, row);
    }
    row[field] += by;
  }

  for (const row of prefixes) {
    const plen = parseCidrPrefixLength(row?.ip_prefix);
    if (plen == null) continue; // skip malformed rows
    const addrs = ipv4AddressCount(plen);
    total_ipv4_prefixes += 1;
    total_ipv4_addresses += addrs;

    const service = row.service || 'UNKNOWN';
    const region = row.region || 'UNKNOWN';
    const nbg = row.network_border_group || 'UNKNOWN';

    bump(byService, service, 'ipv4_prefixes');
    bump(byService, service, 'ipv4_addresses', addrs);
    bump(byRegion, region, 'ipv4_prefixes');
    bump(byRegion, region, 'ipv4_addresses', addrs);
    bump(byNbg, nbg, 'ipv4_prefixes');
    bump(byNbg, nbg, 'ipv4_addresses', addrs);
  }

  let total_ipv6_prefixes = 0;
  for (const row of ipv6Prefixes) {
    if (typeof row?.ipv6_prefix !== 'string') continue;
    total_ipv6_prefixes += 1;

    const service = row.service || 'UNKNOWN';
    const region = row.region || 'UNKNOWN';
    const nbg = row.network_border_group || 'UNKNOWN';

    bump(byService, service, 'ipv6_prefixes');
    bump(byRegion, region, 'ipv6_prefixes');
    bump(byNbg, nbg, 'ipv6_prefixes');
  }

  // Convert maps to arrays sorted by IPv4 address capacity (desc) so the
  // UI can take the top-N without resorting client-side. Rows that are
  // IPv6-only (zero IPv4 capacity) sort to the bottom alphabetically.
  function toSortedArray(map, keyName) {
    return Array.from(map.entries())
      .map(([k, v]) => ({ [keyName]: k, ...v }))
      .sort((a, b) => {
        if (b.ipv4_addresses !== a.ipv4_addresses) return b.ipv4_addresses - a.ipv4_addresses;
        return a[keyName].localeCompare(b[keyName]);
      });
  }

  const by_service = toSortedArray(byService, 'service');
  const by_region = toSortedArray(byRegion, 'region');
  const by_network_border_group = toSortedArray(byNbg, 'network_border_group');

  return {
    snapshot_date: snapshotDate,
    captured_at: capturedAt,
    aws_create_date: typeof raw.createDate === 'string' ? raw.createDate : null,
    sync_token: typeof raw.syncToken === 'string' ? raw.syncToken : null,
    total_ipv4_prefixes,
    total_ipv4_addresses,
    total_ipv6_prefixes,
    total_services: by_service.length,
    total_regions: by_region.length,
    total_network_border_groups: by_network_border_group.length,
    by_service,
    by_region,
    by_network_border_group,
    source_url: AWS_IPR_URL,
  };
}

/**
 * Standard JSON response with permissive CORS — the dashboard hits these
 * endpoints from the same origin in production, but during local dev the
 * preview server may proxy through a different origin.
 */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function jsonResp(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS,
      ...extraHeaders,
    },
  });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Append a date to the index-of-days, sorted desc, capped at 400 entries.
 * Mirrors the cap used by the canonical history index so the AWS module
 * can never balloon KV usage on its own.
 */
export async function bumpIndex(kv, date) {
  let index = (await kv.get(INDEX_KEY, 'json')) || [];
  if (!index.includes(date)) {
    index.push(date);
    index.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    index = index.slice(0, 400);
    await kv.put(INDEX_KEY, JSON.stringify(index));
  }
}
