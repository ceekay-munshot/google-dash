/**
 * Cloudflare Pages Function — Canonical History Health Check
 * Route: /api/history-health
 * Method: GET
 *
 * Independent, out-of-band health surface for canonical history. Reads the
 * `index:days` key directly from KV (no chain of HTTP self-calls), computes
 * freshness + recent-window gap state, and returns a compact JSON summary.
 *
 * Designed for external uptime/cron monitors (UptimeRobot, Better Uptime,
 * cron-job.org, etc.) so the system is not relying entirely on GitHub
 * Actions to detect history-system regressions.
 *
 * Query params:
 *   ?strict=true   — when set, return HTTP 503 if status != 'healthy'.
 *                    Default behavior always returns HTTP 200 with the
 *                    status field describing the actual state.
 *   ?window=N      — recent-window length in days for gap detection.
 *                    Default 14, range 2..365.
 *
 * Response shape (always returned):
 *   {
 *     status: 'healthy' | 'stale' | 'gapped' | 'broken',
 *     todayUtc:           'YYYY-MM-DD',
 *     latest:             'YYYY-MM-DD' | null,
 *     earliest:           'YYYY-MM-DD' | null,
 *     count:              <number of canonical snapshots in KV>,
 *     fresh:              <boolean — latest === todayUtc>,
 *     gapCount:           <number of missing UTC dates in checked window>,
 *     missingDates:       [...up to 20 missing dates],
 *     missingDatesTruncated: <boolean>,
 *     checkedWindowStart: 'YYYY-MM-DD',
 *     checkedWindowEnd:   'YYYY-MM-DD',
 *     checkedWindowDays:  <effective number of days in the window>,
 *     checkedAt:          ISO 8601 timestamp,
 *     reason:             <human-readable explanation when status != healthy>
 *   }
 *
 * Status hierarchy (mutually exclusive):
 *   broken  — KV unbound, KV read failed, no snapshots at all
 *   stale   — latest snapshot date != today UTC
 *   gapped  — latest is fresh, but recent window has at least one gap
 *   healthy — latest is fresh AND zero gaps in window
 */

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
      // Always fresh — monitors should see real state, not edge-cached state
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

/** Today's date in UTC as YYYY-MM-DD */
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/** Date offset by N days from base (YYYY-MM-DD), as YYYY-MM-DD */
function dateAtOffset(base, days) {
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Clamp an integer to [min, max], with fallback if NaN */
function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

const MAX_MISSING_RETURNED = 20;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const strict = url.searchParams.get('strict') === 'true';
  const windowDays = clampInt(url.searchParams.get('window'), 2, 365, 14);

  const now = new Date();
  const today = todayUTC();
  const checkedAt = now.toISOString();

  // Base envelope shared across all responses
  const base = {
    todayUtc: today,
    checkedAt,
    checkedWindowDays: windowDays,
  };

  const broken = (reason, extra = {}) =>
    jsonResp(
      {
        status: 'broken',
        latest: null,
        earliest: null,
        count: 0,
        fresh: false,
        gapCount: 0,
        missingDates: [],
        missingDatesTruncated: false,
        checkedWindowStart: null,
        checkedWindowEnd: today,
        ...base,
        ...extra,
        reason,
      },
      strict ? 503 : 200
    );

  // ── KV binding check ──
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return broken('HISTORY_KV not bound to this Pages project');
  }

  // ── Read days index ──
  let index;
  try {
    index = (await kv.get('index:days', 'json')) || [];
  } catch (err) {
    return broken('KV read failed: ' + (err?.message || 'unknown error'));
  }

  if (!Array.isArray(index) || index.length === 0) {
    return broken('No canonical snapshots in KV (index:days is empty)');
  }

  // index is maintained in descending order by history-capture.js
  const latest = index[0];
  const earliest = index[index.length - 1];
  const count = index.length;

  // ── Compute the effective window ──
  // Naive: today - (window-1) ... today inclusive
  // Effective: clamp start to `earliest` so we never expect history that
  // predates the tracking-start date.
  const naiveStart = dateAtOffset(today, -(windowDays - 1));
  const effectiveStart = earliest > naiveStart ? earliest : naiveStart;

  const expected = [];
  for (let d = effectiveStart; d <= today; d = dateAtOffset(d, 1)) {
    expected.push(d);
  }

  const presentSet = new Set(index);
  const missingAll = expected.filter((d) => !presentSet.has(d));

  const fresh = latest === today;
  const gapCount = missingAll.length;

  // ── Status decision ──
  let status;
  let reason;
  if (!fresh) {
    status = 'stale';
    reason = `Latest snapshot is ${latest} but today UTC is ${today}`;
  } else if (gapCount > 0) {
    status = 'gapped';
    reason = `${gapCount} missing date(s) in window ${effectiveStart}..${today}`;
  } else {
    status = 'healthy';
    reason = `Latest snapshot matches today UTC; ${expected.length}-day window has no gaps`;
  }

  const missingDates = missingAll.slice(0, MAX_MISSING_RETURNED);
  const missingDatesTruncated = missingAll.length > MAX_MISSING_RETURNED;

  const httpStatus = strict && status !== 'healthy' ? 503 : 200;

  return jsonResp(
    {
      status,
      latest,
      earliest,
      count,
      fresh,
      gapCount,
      missingDates,
      missingDatesTruncated,
      checkedWindowStart: effectiveStart,
      checkedWindowEnd: today,
      ...base,
      reason,
    },
    httpStatus
  );
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
