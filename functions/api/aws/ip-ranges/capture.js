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
 * Auth (optional, reuses the existing HISTORY_CAPTURE_SECRET pattern from
 * /api/history-capture so the same GitHub Actions secret can drive both
 * crons without a second secret to provision):
 *   - If HISTORY_CAPTURE_SECRET is set in the environment, the request must
 *     present it via Authorization: Bearer <secret> (preferred),
 *     x-history-capture-secret header, or ?key=<secret>.
 *   - If the secret is NOT set (e.g. local dev), the endpoint stays open so
 *     curl/preview testing remains friction-free.
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

async function handle({ request, env }) {
  // ── Auth (only enforced when a secret is configured) ──
  const url = new URL(request.url);
  const secret = env?.HISTORY_CAPTURE_SECRET;
  if (secret) {
    const authHeader = request.headers.get('authorization') || '';
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const headerSecret = request.headers.get('x-history-capture-secret') || '';
    const querySecret = url.searchParams.get('key') || '';
    const provided = bearerToken || headerSecret || querySecret;
    if (provided !== secret) {
      return jsonResp({
        success: false,
        error: 'Unauthorized',
        hint: 'Send Authorization: Bearer <HISTORY_CAPTURE_SECRET>, x-history-capture-secret header, or ?key=<SECRET>',
      }, 403);
    }
  }

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
