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
 *   ?weight=equal   (default) — every model in the lineup counts once
 *   ?weight=usage             — each model counts in proportion to the tokens
 *                               it actually served on OpenRouter, so the cell
 *                               reads as what the market pays rather than what
 *                               the price list says. Coverage is measured per
 *                               provider-quarter and cells that cannot clear
 *                               the gate are withheld with a stated reason —
 *                               see _usage-weights.js for the limits.
 *   ?refresh=1                — bypass edge cache (diagnostic only)
 */

import {
  PPT_TO_OR_PROVIDER,
  MIN_COVERAGE,
  MIN_WEIGHTED_MODELS,
  priceModelCandidates,
  buildUsageWeights,
  weightedAverage,
  gateReason,
} from './_usage-weights.js';

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
 *
 * Default (weighting omitted): the average is equal-weighted across every
 * (model, day) observation in the quarter — i.e., one point per model per day
 * that the upstream recorded a price for. This mirrors how pricepertoken's own
 * chart aggregates the data and avoids collapsing-to-one-model bias when some
 * models have more dated observations than others.
 *
 * With `weighting` supplied, each model's mean price in the quarter is instead
 * weighted by the tokens it served, and cells that cannot clear the coverage
 * gate are withheld. The equal-weighted level is retained on every cell as
 * `equalAvg` so the two are always comparable side by side.
 */
function buildMatrix(providerResults, metric, weighting) {
  const priceField = metric === 'output' ? 'pricing_completion' : 'pricing_prompt';

  // Collect the union of quarter keys across providers
  const allQuarters = new Set();
  const perProvider = new Map();
  // slug -> quarter -> model -> { sum, count } — per-model price means, used
  // only by the usage-weighted path. Built in the same pass as the equal
  // -weighted buckets so the two views can never diverge on which rows they
  // consider valid.
  const perProviderModels = new Map();

  for (const pr of providerResults) {
    // quarter -> { sum, count, modelSet }
    const buckets = new Map();
    const modelBuckets = new Map();
    for (const row of pr.rows) {
      // Alternate-billing SKUs are the same model sold on different terms —
      // ':batch' is ~50% off async, plus ':beta', ':thinking', ':free',
      // ':extended', ':exacto'. They are not a repricing of the standard SKU,
      // so they must not move a provider's average.
      //
      // pricepertoken began cataloguing ':batch' rows for every provider on
      // 2026-07-29. Including them made Q3-26 look like a synchronized
      // industry-wide price cut: Anthropic read as -21.8% (actually -8.0%)
      // and OpenAI as -18.3% (actually -11.9%), while Google's real cut was
      // understated at -13.5% (actually -18.8%). That inverted the ranking
      // the read-through panel headlines — it named Anthropic the biggest
      // price cutter when Anthropic had in fact cut the least and Google the
      // most. No provider's list price changed on that date; the upstream
      // catalog just grew a column.
      if (typeof row?.model === 'string' && row.model.includes(':')) continue;
      const v = row?.[priceField];
      // Strictly > 0: $0.00 rows are free/experimental SKUs (Google's
      // gemini-2.5-pro-exp-*, lyria-*) and drag a paid-lineup average down.
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) continue;
      const dateStr = row?.date;
      if (typeof dateStr !== 'string' || dateStr.length < 10) continue;
      const q = quarterOf(dateStr);
      allQuarters.add(q);
      if (!buckets.has(q)) buckets.set(q, { sum: 0, count: 0, models: new Set() });
      const b = buckets.get(q);
      b.sum += v;
      b.count += 1;
      if (row.model) b.models.add(row.model);

      if (row.model) {
        if (!modelBuckets.has(q)) modelBuckets.set(q, new Map());
        const byModel = modelBuckets.get(q);
        if (!byModel.has(row.model)) byModel.set(row.model, { sum: 0, count: 0 });
        const ms = byModel.get(row.model);
        ms.sum += v;
        ms.count += 1;
      }
    }
    perProvider.set(pr.slug, buckets);
    perProviderModels.set(pr.slug, modelBuckets);
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
      const equalAvg = (stat.sum / stat.count) * 1_000_000;
      const cell = {
        slug: p.slug,
        avg: round3(equalAvg),
        avgLabel: formatPrice(equalAvg),
        obsCount: stat.count,
        modelCount: stat.models.size,
      };
      if (!weighting) return cell;

      // Usage-weighted view. `avg` is deliberately REPLACED rather than added
      // alongside, so every downstream consumer — the QoQ/YoY pass below, the
      // trend chart, the matrix — reads one consistent series and cannot mix
      // a weighted level with an equal-weighted change. The equal-weighted
      // level stays available as `equalAvg` for tooltips.
      const modelMeans = perProviderModels.get(p.slug)?.get(q) || new Map();
      const modelWeights = weighting.weights.get(q)?.get(p.slug);
      const coverage = weighting.coverage.get(q)?.has(p.slug)
        ? weighting.coverage.get(q).get(p.slug)
        : null;
      const w = weightedAverage(modelMeans, modelWeights, coverage);
      const weightedAvg = w.avg === null ? null : w.avg * 1_000_000;

      cell.equalAvg = cell.avg;
      cell.equalAvgLabel = cell.avgLabel;
      cell.avg = weightedAvg === null ? null : round3(weightedAvg);
      cell.avgLabel = weightedAvg === null ? '—' : formatPrice(weightedAvg);
      cell.weightedModelCount = w.models;
      cell.coverage = w.coverage === null ? null : round3(w.coverage);
      cell.coverageLabel = w.coverage === null ? null : (w.coverage * 100).toFixed(0) + '%';
      cell.topWeightShare = w.topShare === null ? null : round3(w.topShare);
      cell.topWeightShareLabel = w.topShare === null ? null : (w.topShare * 100).toFixed(0) + '%';
      cell.gate = w.gate;
      cell.gateReason = gateReason(w.gate, w.coverage, w.models);
      return cell;
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

/**
 * Fetch one of this origin's own endpoints. The weekly OpenRouter series
 * already lives behind /api/openrouter-chart-weekly with its own KV-backed
 * capture and fallback handling; re-reading KV here would duplicate that
 * logic and let the two drift.
 */
async function fetchSameOrigin(request, path) {
  try {
    const r = await fetch(new URL(request.url).origin + path, {
      headers: { 'User-Agent': 'gdash-provider-pricing/1.0', Accept: 'application/json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

/**
 * Build the resolver that maps an OpenRouter model name to a model name that
 * actually carries a price, using only names present in THIS request's
 * upstream payload. Deriving it from live data rather than a hardcoded table
 * means a renamed or delisted model degrades into "unpriced" — visibly
 * lowering coverage — instead of silently matching the wrong price.
 *
 * The catalog is indexed PER QUARTER, not across all history. A model priced
 * in one quarter and absent in another contributes no weight in the quarter
 * where it has no price, so counting it as covered there would advertise
 * volume that never reaches the average. Scoping resolution to the quarter
 * keeps the coverage figure describing exactly the models that contribute.
 */
function makeModelResolver(providerResults, priceField) {
  const catalog = new Map();                       // slug -> quarter -> Set(model)
  for (const pr of providerResults) {
    const byQuarter = new Map();
    for (const row of pr.rows) {
      if (typeof row?.model !== 'string' || row.model.includes(':')) continue;
      const v = row?.[priceField];
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) continue;
      const date = row?.date;
      if (typeof date !== 'string' || date.length < 10) continue;
      const q = quarterOf(date);
      if (!byQuarter.has(q)) byQuarter.set(q, new Set());
      byQuarter.get(q).add(row.model);
    }
    catalog.set(pr.slug, byQuarter);
  }
  return (pptSlug, orModel, quarter) => {
    const names = catalog.get(pptSlug)?.get(quarter);
    if (!names) return null;
    for (const candidate of priceModelCandidates(orModel)) {
      if (names.has(candidate)) return candidate;
    }
    return null;
  };
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const metric = (url.searchParams.get('metric') || 'input').toLowerCase();
  if (metric !== 'input' && metric !== 'output') {
    return jsonResp({ success: false, error: 'metric must be "input" or "output"' }, 400);
  }
  const weight = (url.searchParams.get('weight') || 'equal').toLowerCase();
  if (weight !== 'equal' && weight !== 'usage') {
    return jsonResp({ success: false, error: 'weight must be "equal" or "usage"' }, 400);
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

  // Usage weighting needs two separate captures: per-model tokens for the
  // weights, and per-provider totals for the coverage denominator. If either
  // is missing the request does NOT silently fall back to equal weighting —
  // that would answer a different question than the one asked — it returns
  // the matrix with every weighted cell withheld and says why.
  let weighting = null;
  let weightMeta = null;
  if (weight === 'usage') {
    const [modelSeries, providerSeries] = await Promise.all([
      fetchSameOrigin(request, '/api/openrouter-chart-weekly?full=1'),
      fetchSameOrigin(request, '/api/openrouter-chart-weekly?providers=1'),
    ]);
    const priceField = metric === 'output' ? 'pricing_completion' : 'pricing_prompt';
    const built = buildUsageWeights(
      modelSeries, providerSeries, makeModelResolver(results, priceField),
    );
    weighting = { weights: built.weights, coverage: built.coverage };
    weightMeta = {
      source: 'openrouter.ai/rankings weekly token series, via /api/openrouter-chart-weekly',
      modelSeriesAvailable: !!modelSeries,
      providerSeriesAvailable: !!providerSeries,
      modelSeriesLatestWeek: built.modelSeriesLatestWeek,
      providerSeriesLatestWeek: built.providerSeriesLatestWeek,
      uncertifiedQuarters: Array.from(built.uncertifiedQuarters).sort().reverse(),
      minCoverage: MIN_COVERAGE,
      minWeightedModels: MIN_WEIGHTED_MODELS,
      providerSlugMap: PPT_TO_OR_PROVIDER,
      caveats: [
        'OpenRouter is one marketplace, not the whole market — first-party API traffic is not represented.',
        'OpenRouter names only its top models each week and buckets the rest as "Others", which caps measurable coverage.',
        'Token counts combine prompt and completion, so the same weight applies to the input and output averages.',
        'A quarter publishes only when every week in it has a provider-total denominator; a partly-measured quarter is withheld.',
        '":free" and other variant SKUs are excluded from the weights — folding them into the paid model would price free traffic as paid.',
      ],
    };
  }

  const { quarters } = buildMatrix(results, metric, weighting);
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
    weight,
    weighting: weightMeta,
    source: UPSTREAM_BASE,
    sourceNote: weight === 'usage'
      ? 'Prices come from pricepertoken.com\'s historical pricing API; weights ' +
        'come from OpenRouter\'s weekly per-model token volumes. Each model\'s ' +
        'mean price in the quarter is weighted by the tokens it served, so the ' +
        'cell reads as what was actually paid rather than a list-price mean. ' +
        'Cells whose weights do not cover enough of a provider\'s volume are ' +
        'withheld with a stated reason, never estimated.'
      : 'Upstream is pricepertoken.com\'s own historical pricing API. ' +
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
