/**
 * Cloudflare Pages Function — Canonical History Capture
 * Route: /api/history-capture
 * Method: GET
 *
 * Calls the existing /api/openrouter, /api/radar/..., /api/trends, and
 * /api/google-filings endpoints internally (via fetch to the same origin),
 * normalizes the results into a canonical snapshot, computes a content hash,
 * and writes one daily entry to Cloudflare KV.
 *
 * Protected by HISTORY_CAPTURE_SECRET env var — the request must include
 * Bearer header (preferred), x-history-capture-secret header, or ?key=<secret>
 * to authorize. This makes it safe for external cron callers (GitHub Actions,
 * cron-job.org, etc.) without exposing write access.
 *
 * Optional query params:
 *   ?date=YYYY-MM-DD — Backfill mode. Stores the captured snapshot under the
 *                      given UTC date instead of today. Used to fill gaps when
 *                      a scheduled run was missed. Strict validation: must be
 *                      YYYY-MM-DD, a real calendar date, and not in the future.
 *
 * Canonical rules:
 *   - One entry per calendar day (UTC): key = "day:YYYY-MM-DD"
 *   - Content-hash dedup: if the target day's data matches the day-before's
 *     hash, the entry is stored with dedup:true and a pointer to the prior day
 *   - If called twice for the same date with different data, last write wins
 *     (supersession for that date)
 *   - Only this endpoint writes canonical history — browser refresh does NOT
 *   - Backfilled entries are tagged source="backfill" and carry a note that
 *     the data was captured later than the target date represents
 */

import { PRICING_BASKET, BASKET_BY_SLUG, BASKET_SIZE } from './_pricing-basket.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ── Helpers ─────────────────────────────────────────────── */

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/** Stable content hash using Web Crypto (available in Workers runtime) */
async function contentHash(payload) {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  const buf = new TextEncoder().encode(sorted);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const arr = Array.from(new Uint8Array(hashBuf));
  return arr.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Today's date in UTC as YYYY-MM-DD */
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/** Day before the given YYYY-MM-DD UTC date, as YYYY-MM-DD */
function dayBeforeUTC(dateStr) {
  const t = Date.parse(dateStr + 'T00:00:00Z');
  return new Date(t - 86400000).toISOString().slice(0, 10);
}

/**
 * Strictly validate a YYYY-MM-DD date string for backfill use.
 * Rejects: bad format, invalid calendar dates (e.g. 2026-02-30), future dates.
 * Returns { ok: true, date } or { ok: false, error }.
 */
function validateBackfillDate(input) {
  if (typeof input !== 'string') {
    return { ok: false, error: 'date must be a string' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return { ok: false, error: 'date must match YYYY-MM-DD format' };
  }
  const t = Date.parse(input + 'T00:00:00Z');
  if (Number.isNaN(t)) {
    return { ok: false, error: 'date is not a valid calendar date' };
  }
  // Check that the parsed date round-trips identically — guards against
  // JS leniency like "2026-02-30" being silently coerced to "2026-03-02".
  const roundTrip = new Date(t).toISOString().slice(0, 10);
  if (roundTrip !== input) {
    return { ok: false, error: 'date is not a real calendar date' };
  }
  // Reject future dates — backfill is for past gaps only.
  // Allow today (so the endpoint is callable explicitly with today's date).
  if (input > todayUTC()) {
    return { ok: false, error: 'date cannot be in the future' };
  }
  return { ok: true, date: input };
}

/** Fetch a local API endpoint (same origin). Works both in dev and production. */
async function localFetch(request, path) {
  const origin = new URL(request.url).origin;
  try {
    const resp = await fetch(origin + path, {
      headers: { 'User-Agent': 'gdash-history-capture/1.0' },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) {
    return null;
  }
}

/* ── Normalize fetched data into canonical snapshot shape ── */

function normalizeOR(raw) {
  if (!raw || !raw.success || !raw.models?.length) return [];
  return raw.models.slice(0, 30).map(m => {
    const name = (m.model || '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^by\s+/i, '')
      .trim();
    const tokRaw = m.tokens > 0 ? m.tokens : parseTokLabel(m.tokensLabel);
    return {
      rank: m.rank,
      model: name,
      provider: m.provider,
      tokRaw,
      isGemini: m.isGemini || /gemini/i.test(name),
      wowN: m.wowPct || 0,
    };
  });
}

/**
 * Extract canonical OpenRouter summary fields. Prefer the summary block
 * computed by /api/openrouter (authoritative — sums raw token integers
 * before label rounding). Fall back to summing normalized rows only if the
 * upstream summary is unavailable, so historical entries don't lose this
 * metric just because the upstream shape changed.
 */
function extractOpenRouterSummary(raw, normalized) {
  if (raw?.summary?.totalTokensRaw && raw.summary.totalTokensLabel) {
    return {
      totalTokensRaw: raw.summary.totalTokensRaw,
      totalTokensLabel: raw.summary.totalTokensLabel,
    };
  }
  // Fallback: derive from normalized rows. Less precise (label rounding
  // already applied to upstream rows in some scrape paths) but always works.
  if (!normalized?.length) return null;
  const totalTokensRaw = normalized.reduce((s, m) => s + (m.tokRaw || 0), 0);
  return {
    totalTokensRaw,
    totalTokensLabel: formatTotalTokens(totalTokensRaw),
  };
}

function formatTotalTokens(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2).replace(/\.?0+$/, '') + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  return String(n);
}

function parseTokLabel(lbl) {
  if (!lbl) return 0;
  const m = lbl.match(/([\d.]+)\s*([BTMKbtmk])/);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  if (u === 'T') return v * 1e12;
  if (u === 'B') return v * 1e9;
  if (u === 'M') return v * 1e6;
  if (u === 'K') return v * 1e3;
  return v;
}

function normalizeBots(raw) {
  if (!raw?.result?.summary_0) return [];
  const summary = raw.result.summary_0;
  return Object.entries(summary)
    .filter(([k]) => k !== 'timestamps')
    .map(([name, val]) => ({ name, pct: Math.round(parseFloat(val) * 10) / 10 }))
    .filter(b => b.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 10);
}

function normalizeTrends(raw) {
  if (!raw?.success || !raw.summary?.length) return [];
  return raw.summary
    .filter(s => s.latest !== null)
    .map(s => ({ term: s.term, score: Math.round(s.latest || 0) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Normalize the pricepertoken.com structured payload into the subset we
 * persist daily. We store ONLY basket members (keyed by stable slug) to
 * keep the snapshot small and focused — the live embed below still shows
 * the full 530-model table to users, so we're not losing user-visible
 * data. For each basket member we record input/output price per 1M
 * tokens at the moment of capture.
 *
 * If a basket member isn't present in the upstream response, it simply
 * doesn't appear in the `models` array — the pricing-history reader will
 * see a missing slug and count it as a coverage miss for that day.
 */
function normalizePricing(raw) {
  if (!raw || !raw.success || !Array.isArray(raw.rows)) return null;
  const models = [];
  for (const r of raw.rows) {
    const basket = BASKET_BY_SLUG[r.slug];
    if (!basket) continue;
    if (typeof r.inputPricePer1M !== 'number') continue;
    models.push({
      slug: r.slug,
      provider: r.provider || basket.provider,
      modelName: r.modelName || r.model || basket.label,
      input: r.inputPricePer1M,
      output: typeof r.outputPricePer1M === 'number' ? r.outputPricePer1M : null,
      updatedAt: r.updatedAt || null,
    });
  }
  // Sort deterministic so the content hash is stable across runs
  models.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return {
    models,
    basketSize: BASKET_SIZE,
    coverage: models.length,
    sourceUpdatedAt: raw.sourceUpdatedAt || null,
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
  };
}

/**
 * Normalize the getdeploying.com GPU pricing payload into the small
 * per-day block we persist. We filter to a stable strategic SKU set so
 * the daily snapshot stays focused on decision-weight accelerators —
 * the live reverse-proxy embed in the GPU tab still shows the full 91
 * rows to users, so we're not losing user-visible data.
 *
 * Stored per tracked SKU:
 *   gpuModel, vram, category, providerCount,
 *   minPricePerHour, maxPricePerHour,
 *   spreadAbsolute, spreadMultiple, priceMidpoint
 *
 * If the parser is offline the block is `null` — readers count it as a
 * coverage miss for that day rather than failing the snapshot.
 */
const GPU_TRACKED_SKUS = [
  'Nvidia H100',
  'Nvidia H200',
  'Nvidia B200',
  'Nvidia GB200',
  'Nvidia A100',
  'Nvidia L40S',
];

function normalizeGPU(raw) {
  if (!raw || !raw.ok || !Array.isArray(raw.rows)) return null;
  const trackedSet = new Set(GPU_TRACKED_SKUS);
  const models = [];
  for (const r of raw.rows) {
    if (!trackedSet.has(r.gpuModel)) continue;
    const min = typeof r.minPricePerHour === 'number' ? r.minPricePerHour : null;
    const max = typeof r.maxPricePerHour === 'number' ? r.maxPricePerHour : null;
    const spreadAbsolute = (min != null && max != null) ? +(max - min).toFixed(4) : null;
    const spreadMultiple = (min != null && max != null && min > 0) ? +(max / min).toFixed(3) : null;
    const priceMidpoint = (min != null && max != null) ? +((min + max) / 2).toFixed(4) : null;
    models.push({
      gpuModel: r.gpuModel,
      vram: r.vram || null,
      category: r.category || null,
      providerCount: typeof r.providerCount === 'number' ? r.providerCount : null,
      minPricePerHour: min,
      maxPricePerHour: max,
      spreadAbsolute,
      spreadMultiple,
      priceMidpoint,
    });
  }
  // Deterministic ordering for stable content hashes
  models.sort((a, b) => (a.gpuModel < b.gpuModel ? -1 : a.gpuModel > b.gpuModel ? 1 : 0));
  return {
    models,
    trackedSKUs: GPU_TRACKED_SKUS,
    coverage: models.length,
    sourceUpdatedAt: raw.sourceUpdatedAt || null,
    sourceUrl: raw.sourceUrl || null,
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
  };
}

function normalizeFiling(raw) {
  if (!raw?.success) return null;
  return {
    period: raw.period,
    searchRevenue: raw.searchRevenue,
    searchRevenueGrowth: raw.searchRevenueGrowth,
    paidClicksGrowth: raw.paidClicksGrowth,
    cpcGrowth: raw.cpcGrowth,
    totalRevenue: raw.totalRevenue,
    totalRevenueGrowth: raw.totalRevenueGrowth,
  };
}

/* ── Main handler ────────────────────────────────────────── */

export async function onRequestGet({ request, env }) {
  // ── Auth check ──
  // Primary: Authorization: Bearer <secret>
  // Also accepted: x-history-capture-secret header
  // Fallback (for simple cron tools): ?key=<secret>
  const url = new URL(request.url);
  const secret = env?.HISTORY_CAPTURE_SECRET;

  const authHeader = request.headers.get('authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = request.headers.get('x-history-capture-secret') || '';
  const querySecret = url.searchParams.get('key') || '';

  const provided = bearerToken || headerSecret || querySecret;
  const authMethod = bearerToken
    ? 'bearer'
    : headerSecret
      ? 'header'
      : querySecret
        ? 'query'
        : 'none';

  // If a secret is configured, require it. If not configured (dev), allow.
  if (secret && provided !== secret) {
    return jsonResp(
      {
        success: false,
        error: 'Unauthorized',
        hint: 'Send Authorization: Bearer <HISTORY_CAPTURE_SECRET> (preferred), x-history-capture-secret header, or ?key=<SECRET> query param',
      },
      403
    );
  }

  // ── KV check ──
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp({
      success: false,
      error: 'HISTORY_KV not bound. Add [[kv_namespaces]] to wrangler.toml and create the namespace.',
    }, 500);
  }

  // ── Resolve target date (backfill vs today) ──
  const today = todayUTC();
  const dateParam = url.searchParams.get('date');
  let targetDate = today;
  let isBackfill = false;
  if (dateParam !== null) {
    const v = validateBackfillDate(dateParam);
    if (!v.ok) {
      return jsonResp({
        success: false,
        error: 'Invalid date parameter: ' + v.error,
        hint: 'Use ?date=YYYY-MM-DD with a real past or current UTC date',
      }, 400);
    }
    targetDate = v.date;
    isBackfill = targetDate !== today;
  }

  // ── Fetch all data sources in parallel ──
  const [orRaw, botsRaw, trendsRaw, filingRaw, pricingRaw, gpuRaw] = await Promise.all([
    localFetch(request, '/api/openrouter?view=week&top=30'),
    localFetch(request, '/api/radar/ai/bots/summary/user_agent?dateRange=28d'),
    localFetch(request, '/api/trends?window=12m'),
    localFetch(request, '/api/google-filings'),
    localFetch(request, '/api/pricepertoken-data'),
    localFetch(request, '/api/gpu-hardware-pricing-data'),
  ]);

  // ── Normalize ──
  const or = normalizeOR(orRaw);
  const bots = normalizeBots(botsRaw);
  const trends = normalizeTrends(trendsRaw);
  const filing = normalizeFiling(filingRaw);
  const pricing = normalizePricing(pricingRaw);
  const gpu = normalizeGPU(gpuRaw);
  const openrouterSummary = extractOpenRouterSummary(orRaw, or);

  // Must have at least OR data to create a valid snapshot
  if (!or.length) {
    return jsonResp({
      success: false,
      error: 'OpenRouter data unavailable — cannot create snapshot',
      details: {
        or: !!orRaw?.success,
        bots: bots.length > 0,
        trends: trends.length > 0,
        filing: !!filing,
      },
    }, 502);
  }

  // ── Build canonical payload (used for hashing) ──
  // openrouterSummary is included so a change in totalTokensRaw forces a
  // new hash even when ranking row order is unchanged.
  // pricing is included so a price change on any basket member forces
  // a new snapshot on that day.
  // gpu is included so a change in any strategic GPU min/max price or
  // provider count forces a new snapshot on that day.
  const canonicalPayload = { or, bots, trends, filing, openrouterSummary, pricing, gpu };
  const hash = await contentHash(canonicalPayload);

  const dayKey = 'day:' + targetDate;
  const capturedAt = new Date().toISOString();

  // Check if the target day already has a snapshot with the same hash
  const existing = await kv.get(dayKey, 'json');
  if (existing && existing.hash === hash) {
    return jsonResp({
      success: true,
      action: 'skipped',
      reason: 'Target day already has a snapshot with identical content',
      date: targetDate,
      hash,
      backfill: isBackfill,
    });
  }

  // Cross-day dedup against the day BEFORE the target (relative, not "yesterday")
  const priorDate = dayBeforeUTC(targetDate);
  const prevSnap = await kv.get('day:' + priorDate, 'json');
  const dedup = !!(prevSnap && prevSnap.hash === hash);

  // ── Build snapshot ──
  const snapshot = {
    ts: capturedAt,
    date: targetDate,
    capturedAt,
    hash,
    version: 4, // bumped: now stores gpu (strategic SKUs) alongside pricing + openrouterSummary
    source: isBackfill ? 'backfill' : (authMethod === 'none' ? 'manual' : 'cron'),
    authMethod,
    dedup,
    sameAs: dedup ? ('day:' + priorDate) : null,
    backfill: isBackfill,
    backfillNote: isBackfill
      ? 'Captured ' + capturedAt + ' and stored under target date ' + targetDate +
        '. Upstream values reflect their state at capture time, not necessarily the original missed day.'
      : null,
    or,
    bots,
    trends,
    filing,
    openrouterSummary,
    pricing,
    gpu,
  };

  // ── Write to KV ──
  await kv.put(dayKey, JSON.stringify(snapshot));

  // ── Update days index ──
  // Existing today-only path: unshift. Backfill path: insert+sort+cap.
  let index = await kv.get('index:days', 'json') || [];
  if (!index.includes(targetDate)) {
    if (isBackfill) {
      index.push(targetDate);
      index.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // desc
      index = index.slice(0, 400);
    } else {
      index.unshift(targetDate);
      index = index.slice(0, 400);
    }
    await kv.put('index:days', JSON.stringify(index));
  }

  return jsonResp({
    success: true,
    action: existing ? 'superseded' : 'created',
    date: targetDate,
    hash,
    dedup,
    backfill: isBackfill,
    sources: {
      or: or.length + ' models',
      bots: bots.length + ' crawlers',
      trends: trends.length + ' terms',
      filing: filing ? filing.period : 'unavailable',
      openrouterTotal: openrouterSummary?.totalTokensLabel || 'n/a',
      pricing: pricing
        ? pricing.coverage + '/' + pricing.basketSize + ' basket members'
        : 'unavailable',
      gpu: gpu
        ? gpu.coverage + '/' + gpu.trackedSKUs.length + ' strategic SKUs'
        : 'unavailable',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
