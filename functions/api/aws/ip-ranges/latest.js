/**
 * Cloudflare Pages Function — AWS Public Network Capacity Proxy: latest snapshot
 * Route: GET /api/aws/ip-ranges/latest
 *
 * Read-through pattern:
 *   1. If today's snapshot exists in KV (key DAY_PREFIX + today UTC), return it.
 *   2. Otherwise, fetch the upstream JSON live, compute the rollup, and return
 *      it WITHOUT writing to KV (writes are reserved for /capture so unauth'd
 *      page loads can never thrash KV writes). The response is identical in
 *      shape either way; a `served_from` field tells the client which path
 *      produced the result.
 *
 * Cache-Control on the response is short (60s) so the dashboard can refresh
 * without aggressive edge caching masking a fresh capture.
 */

import {
  AWS_IPR_URL,
  DAY_PREFIX,
  INDEX_KEY,
  todayUTC,
  fetchIpRanges,
  rollupIpRanges,
  jsonResp,
  corsPreflight,
} from '../_ipr-utils.js';

export async function onRequestGet({ env }) {
  const kv = env?.HISTORY_KV; // shared KV namespace — see wrangler.toml

  const today = todayUTC();

  // 1. Try today's stored snapshot first.
  if (kv) {
    const stored = await kv.get(DAY_PREFIX + today, 'json');
    if (stored) {
      return jsonResp(
        { success: true, served_from: 'kv', snapshot: stored },
        200,
        { 'Cache-Control': 'public, max-age=60' }
      );
    }

    // 2. Fall back to the most-recent stored snapshot (any date) so the UI
    //    never goes blank on a day where capture hasn't happened yet but
    //    history exists. Live fetch is still the next fallback below.
    const index = (await kv.get(INDEX_KEY, 'json')) || [];
    if (index.length) {
      const stored = await kv.get(DAY_PREFIX + index[0], 'json');
      if (stored) {
        return jsonResp(
          { success: true, served_from: 'kv-prior', snapshot: stored },
          200,
          { 'Cache-Control': 'public, max-age=60' }
        );
      }
    }
  }

  // 3. No KV hit — fetch upstream live, compute rollup, return it.
  try {
    const raw = await fetchIpRanges();
    const snapshot = rollupIpRanges(raw, { snapshotDate: today });
    return jsonResp(
      { success: true, served_from: 'upstream-live', snapshot },
      200,
      { 'Cache-Control': 'public, max-age=60' }
    );
  } catch (err) {
    return jsonResp({
      success: false,
      error: 'AWS ip-ranges live fetch failed',
      detail: err && err.message ? err.message : String(err),
      source_url: AWS_IPR_URL,
    }, 502);
  }
}

export const onRequestOptions = corsPreflight;
