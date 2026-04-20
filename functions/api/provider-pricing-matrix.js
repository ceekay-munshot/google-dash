/**
 * Cloudflare Pages Function — Provider-Grouped Quarterly Pricing Matrix
 * Route: /api/provider-pricing-matrix
 * Method: GET
 *
 * Fan-out proxy against pricepertoken.com's public historical pricing API:
 *     https://api.pricepertoken.com/api/provider-pricing-history/?provider=<slug>
 *
 * That upstream endpoint returns ONE row per (model, day) with fields:
 *     provider, model, date, pricing_prompt, pricing_completion, ...
 *
 * We call it once per configured provider in parallel, aggregate into a
 * quarter-by-provider matrix of equal-weighted average input (or output)
 * price per 1M tokens, and return the matrix plus per-cell model counts
 * for transparency (so the reader can see how coverage shifts over time).
 *
 * This is DERIVED from a real live upstream — not local captured snapshots.
 * The matrix is cached at the CF edge for CACHE_TTL seconds.
 *
 * Honesty rules — the whole reason this exists:
 *   - No synthetic backfill. Quarters prior to the upstream's depth simply
 *     don't appear in the response.
 *   - Upstream's earliest date observed is 2025-07-28, so the historical
 *     floor is 2025-Q3 (partial). Client asked for 2023+; we do not fake it.
 *   - YoY is only returned when a same-quarter one year earlier row exists
 *     with real data.
 *
 * Query params:
 *   ?metric=input   (default) — pricing_prompt, scaled to per 1M tokens
 *   ?metric=output            — pricing_completion, scaled to per 1M tokens
 *   ?refresh=1                — bypass edge cache (diagnostic only)
 */

const UPSTREAM_BASE = 'https://api.pricepertoken.com/api/provider-pricing-history/';
const CACHE_TTL = 21600; // 6 hours

/**
 * Provider families we render as columns. Slugs match upstream's provider
 * query parameter exactly (verified live — do not translate without checking).
 * `label` is the human column header. Order here controls column order in UI.
 */
const PROVIDERS = [
  { slug: 'openai',     label: 'OpenAI' },
  { slug: 'anthropic',  label: 'Anthropic' },
  { slug: 'google',     label: 'Google' },
  { slug: 'xai',        label: 'xAI' },
  { slug: 'mistralai',  label: 'Mistral AI' },
  { slug: 'deepseek',   label: 'DeepSeek' },
  { slug: 'meta-llama', label: 'Meta' },
  { slug: 'cohere',     label: 'Cohere' },
];

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
      'Cache-Control': 'public, max-age=' + CACHE_TTL + ', s-maxage=' + CACHE_TTL,
      ...CORS,
      ...extraHeaders,
    },
  });
}

function quarterOf(dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(5, 7), 10);
  const q = Math.floor((m - 1) / 3) + 1;
  return y + '-Q' + q;
}

/** "2026-Q2" → "2026-Q1"; "2026-Q1" → "2025-Q4" */
function priorQuarter(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  const y = +m[1], q = +m[2];
  return q === 1 ? (y - 1) + '-Q4' : y + '-Q' + (q - 1);
}

/** "2026-Q2" → "2025-Q2" */
function yearAgoQuarter(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  return (+m[1] - 1) + '-Q' + m[2];
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

function formatPrice(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 10) return '$' + n.toFixed(2);
  if (n >= 1)  return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toFixed(4);
}

function formatPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const sign = n > 0 ? '+' : '';
  return sign + (n * 100).toFixed(1) + '%';
}

/** Fetch one provider's full history; returns { rows, error? }. */
async function fetchProvider(slug) {
  const url = UPSTREAM_BASE + '?provider=' + encodeURIComponent(slug);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'gdash-provider-pricing/1.0',
        Accept: 'application/json',
      },
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    });
    if (!r.ok) return { slug, rows: [], error: 'HTTP ' + r.status };
    const j = await r.json();
    const rows = Array.isArray(j?.results) ? j.results : [];
    return { slug, rows };
  } catch (e) {
    return { slug, rows: [], error: e.message };
  }
}

/**
 * Build the matrix from a list of provider rowsets.
 * Average is equal-weighted across every (model, day) observation
 * in the quarter — i.e., one point per model per day that the upstream
 * recorded a price for. This mirrors how pricepertoken's own chart
 * aggregates the data and avoids collapsing-to-one-model bias when some
 * models have more dated observations than others.
 */
function buildMatrix(providerResults, metric) {
  const priceField = metric === 'output' ? 'pricing_completion' : 'pricing_prompt';

  // Collect the union of quarter keys across providers
  const allQuarters = new Set();
  const perProvider = new Map();

  for (const pr of providerResults) {
    // quarter -> { sum, count, modelSet }
    const buckets = new Map();
    for (const row of pr.rows) {
      const v = row?.[priceField];
      if (typeof v !== 'number' || !isFinite(v) || v < 0) continue;
      const dateStr = row?.date;
      if (typeof dateStr !== 'string' || dateStr.length < 10) continue;
      const q = quarterOf(dateStr);
      allQuarters.add(q);
      if (!buckets.has(q)) buckets.set(q, { sum: 0, count: 0, models: new Set() });
      const b = buckets.get(q);
      b.sum += v;
      b.count += 1;
      if (row.model) b.models.add(row.model);
    }
    perProvider.set(pr.slug, buckets);
  }

  // Sort quarters newest first
  const quarters = Array.from(allQuarters).sort().reverse();

  // Build output rows (one row per quarter)
  const rows = quarters.map(q => {
    const cells = PROVIDERS.map(p => {
      const b = perProvider.get(p.slug);
      const stat = b && b.get(q);
      if (!stat) {
        return { slug: p.slug, avg: null, avgLabel: '—', obsCount: 0, modelCount: 0 };
      }
      // Upstream values are $/token; scale to $/1M tokens
      const avg = (stat.sum / stat.count) * 1_000_000;
      return {
        slug: p.slug,
        avg: round3(avg),
        avgLabel: formatPrice(avg),
        obsCount: stat.count,
        modelCount: stat.models.size,
      };
    });
    return { quarter: q, cells };
  });

  // Attach QoQ / YoY per cell (against same provider, adjacent periods).
  // Null-safe: if the comparison quarter is absent or has null avg, leave null.
  const rowByQuarter = new Map(rows.map(r => [r.quarter, r]));
  for (const row of rows) {
    row.cells.forEach((cell, idx) => {
      const priorRow = rowByQuarter.get(priorQuarter(row.quarter));
      const yearRow  = rowByQuarter.get(yearAgoQuarter(row.quarter));
      const priorCell = priorRow?.cells?.[idx];
      const yearCell  = yearRow?.cells?.[idx];
      cell.qoq = (cell.avg !== null && priorCell?.avg && priorCell.avg > 0)
        ? round3((cell.avg - priorCell.avg) / priorCell.avg) : null;
      cell.qoqLabel = formatPct(cell.qoq);
      cell.yoy = (cell.avg !== null && yearCell?.avg && yearCell.avg > 0)
        ? round3((cell.avg - yearCell.avg) / yearCell.avg) : null;
      cell.yoyLabel = formatPct(cell.yoy);
    });
  }

  return { quarters: rows };
}

/** Mark the current calendar quarter (UTC) as partial in the response. */
function currentQuarterKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  return y + '-Q' + (Math.floor(m / 3) + 1);
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const metric = (url.searchParams.get('metric') || 'input').toLowerCase();
  if (metric !== 'input' && metric !== 'output') {
    return jsonResp({ success: false, error: 'metric must be "input" or "output"' }, 400);
  }

  const results = await Promise.all(PROVIDERS.map(p => fetchProvider(p.slug)));
  const anyRows = results.some(r => r.rows.length);
  if (!anyRows) {
    return jsonResp({
      success: false,
      error: 'Upstream returned no rows for any provider',
      errors: results.map(r => ({ slug: r.slug, error: r.error })),
    }, 502, { 'Cache-Control': 'no-store' });
  }

  const { quarters } = buildMatrix(results, metric);
  const currentQ = currentQuarterKey();
  quarters.forEach(q => { q.partial = q.quarter === currentQ; });

  // Figure out earliest date observed across all providers (honest floor)
  let earliestDate = null;
  for (const r of results) {
    for (const row of r.rows) {
      if (typeof row.date === 'string' && (!earliestDate || row.date < earliestDate)) {
        earliestDate = row.date;
      }
    }
  }

  return jsonResp({
    success: true,
    metric,
    source: UPSTREAM_BASE,
    sourceNote:
      'Upstream is pricepertoken.com\'s own historical pricing API. ' +
      'Per-provider daily model prices are averaged equal-weighted across ' +
      'every (model, day) observation in each calendar quarter. No synthetic ' +
      'backfill — pre-upstream quarters simply do not appear.',
    earliestDateObserved: earliestDate ? earliestDate.slice(0, 10) : null,
    providers: PROVIDERS,
    quarters,
    providerErrors: results.filter(r => r.error).map(r => ({ slug: r.slug, error: r.error })),
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
