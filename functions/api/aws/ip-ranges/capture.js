/**
 * Cloudflare Pages Function — AWS Public Network Capacity Proxy: capture
 * Route: POST|GET /api/aws/ip-ranges/capture
 *
 * Idempotency contract (matches the customer-spec UNIQUE(snapshot_date, sync_token)):
 *   - One stored row per UTC day, key = DAY_PREFIX + YYYY-MM-DD.
 *   - If today's stored row already exists with the SAME sync_token as upstream,
 *     this endpoint is a no-op and returns action="skipped".
 *   - If today's stored row exists but the upstream sync_token has changed,
 *     the row is REPLACED with the fresher rollup (action="superseded").
 *   - If no row exists for today, the new rollup is written (action="created").
 *
 * GET is allowed too so a simple cron caller (cron-job.org, GitHub Actions
 * with curl, etc.) can trigger captures without juggling POST. Behavior is
 * identical for both verbs.
 */

import {
  DAY_PREFIX,
  todayUTC,
  fetchIpRanges,
  rollupIpRanges,
  jsonResp,
  corsPreflight,
  bumpIndex,
} from '../_ipr-utils.js';

async function handle({ env }) {
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp({
      success: false,
      error: 'HISTORY_KV not bound. Add [[kv_namespaces]] to wrangler.toml.',
    }, 500);
  }

  let raw;
  try {
    raw = await fetchIpRanges();
  } catch (err) {
    return jsonResp({
      success: false,
      error: 'AWS ip-ranges live fetch failed',
      detail: err && err.message ? err.message : String(err),
    }, 502);
  }

  const today = todayUTC();
  const snapshot = rollupIpRanges(raw, { snapshotDate: today });
  const dayKey = DAY_PREFIX + today;

  const existing = await kv.get(dayKey, 'json');

  // Same-token skip: upstream syncToken hasn't moved since the last capture,
  // and the stored row already represents that state.
  if (existing && existing.sync_token && snapshot.sync_token && existing.sync_token === snapshot.sync_token) {
    return jsonResp({
      success: true,
      action: 'skipped',
      reason: 'Same syncToken already stored for ' + today,
      snapshot: existing,
    });
  }

  await kv.put(dayKey, JSON.stringify(snapshot));
  await bumpIndex(kv, today);

  return jsonResp({
    success: true,
    action: existing ? 'superseded' : 'created',
    snapshot,
  });
}

export const onRequestGet = handle;
export const onRequestPost = handle;
export const onRequestOptions = corsPreflight;
