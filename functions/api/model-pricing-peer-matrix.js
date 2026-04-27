/**
 * Cloudflare Pages Function — Model Pricing Peer Matrix
 * Route: /api/model-pricing-peer-matrix
 * Method: GET
 *
 * Powers the "Model Pricing by Provider" finance-model table on the Model
 * Pricing tab. Returns per-(provider × tier) representative-model quarterly
 * input/output pricing using the SAME upstream that provider-pricing-matrix
 * uses, but filtered to specific peer-pair models so QoQ math reflects real
 * provider repricing on the same model rather than a drifting lineup average.
 *
 * Why a separate endpoint (not a new mode on /api/pricing-history):
 *   /api/pricing-history reads from the canonical HISTORY_KV daily snapshots,
 *   which have only existed for as long as the dashboard has been running.
 *   In dev / preview that's just a handful of days; the resulting table only
 *   has one column. This endpoint goes upstream to pricepertoken's own
 *   historical pricing API which has real coverage back to 2025-07-28, giving
 *   us 4+ real quarters of multi-period peer comparison the customer asked
 *   for.
 *
 * Upstream:
 *   https://api.pricepertoken.com/api/provider-pricing-history/?provider=<slug>
 *   Same source provider-pricing-matrix.js uses. Each row is one
 *   (model, day) observation with pricing_prompt + pricing_completion in
 *   $/token (we scale to $/1M for display).
 *
 * Peer-model selection — fixed deterministic mapping. Frontier picks the
 * production flagship the hyperscaler markets first; Fast / Cost-efficient
 * picks the cheap high-volume tier each provider sells. Reasoning specialty
 * (o3, Opus) intentionally NOT included — they're tracked elsewhere and
 * mixing them would muddy the apples-to-apples peer comparison.
 *
 * Model-name matching — upstream casing / punctuation varies. Normalize by
 * lowercasing and stripping [-\s_.] then test:
 *   - exact match against target normalized form
 *   - OR target as a prefix, with a suffix that is NOT a tier marker
 *     (mini / lite / flash / haiku / nano / micro). This catches dated /
 *     preview / exp variants of the same model class while rejecting
 *     same-family-different-tier names.
 *
 * Response shape:
 *   {
 *     success, source, earliestDateObserved,
 *     quarters: [{ id, start, end, partial }, ...],   // chronological
 *     reps: [
 *       {
 *         key, provider, tier, label, slug, modelDisplay,
 *         input:  { '<qid>': avg /1M, ... },
 *         output: { '<qid>': avg /1M, ... },
 *         qoqInput, qoqOutput, yoyInput, yoyOutput,    // ratios (0.05 = +5%)
 *         obsCount: { '<qid>': n, ... },               // diagnostic
 *         matchedModels: [...]                          // diagnostic
 *       }, ...
 *     ],
 *     providerErrors,
 *   }
 */

const UPSTREAM_BASE = 'https://api.pricepertoken.com/api/provider-pricing-history/';
const CACHE_TTL = 21600; // 6 hours

const PEER_MODELS = [
  { key: 'google-frontier',    provider: 'Google',    tier: 'Frontier',              providerSlug: 'google',    slug: 'google-gemini-2.5-pro',      label: 'Google / Gemini — Frontier',              modelDisplay: 'Gemini 2.5 Pro',     targetNorm: 'gemini25pro' },
  { key: 'openai-frontier',    provider: 'OpenAI',    tier: 'Frontier',              providerSlug: 'openai',    slug: 'openai-gpt-4o',              label: 'OpenAI — Frontier',                       modelDisplay: 'GPT-4o',             targetNorm: 'gpt4o' },
  { key: 'anthropic-frontier', provider: 'Anthropic', tier: 'Frontier',              providerSlug: 'anthropic', slug: 'anthropic-claude-3.5-sonnet',label: 'Anthropic — Frontier',                    modelDisplay: 'Claude 3.5 Sonnet',  targetNorm: 'claude35sonnet' },
  { key: 'google-fast',        provider: 'Google',    tier: 'Fast / Cost-efficient', providerSlug: 'google',    slug: 'google-gemini-2.5-flash',    label: 'Google / Gemini — Fast / Cost-efficient', modelDisplay: 'Gemini 2.5 Flash',   targetNorm: 'gemini25flash' },
  { key: 'openai-fast',        provider: 'OpenAI',    tier: 'Fast / Cost-efficient', providerSlug: 'openai',    slug: 'openai-gpt-4o-mini',         label: 'OpenAI — Fast / Cost-efficient',          modelDisplay: 'GPT-4o mini',        targetNorm: 'gpt4omini' },
  { key: 'anthropic-fast',     provider: 'Anthropic', tier: 'Fast / Cost-efficient', providerSlug: 'anthropic', slug: 'anthropic-claude-3-haiku',   label: 'Anthropic — Fast / Cost-efficient',       modelDisplay: 'Claude 3 Haiku',     targetNorm: 'claude3haiku' },
];

const TIER_REJECT_PREFIXES = /^(mini|lite|flash|haiku|nano|micro)/;

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

function normalizeModel(s) {
  return String(s || '').toLowerCase().replace(/[-\s_.]+/g, '');
}

function modelMatches(modelStr, targetNorm) {
  const n = normalizeModel(modelStr);
  if (n === targetNorm) return true;
  if (!n.startsWith(targetNorm)) return false;
  const suffix = n.slice(targetNorm.length);
  if (TIER_REJECT_PREFIXES.test(suffix)) return false;
  return true;
}

function quarterOf(dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(5, 7), 10);
  return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
}

function priorQuarter(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  const y = +m[1], q = +m[2];
  return q === 1 ? (y - 1) + '-Q4' : y + '-Q' + (q - 1);
}

function yearAgoQuarter(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  return (+m[1] - 1) + '-Q' + m[2];
}

function quarterRange(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  const y = +m[1], q = +m[2];
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(y, startMonth, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, startMonth + 3, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function currentQuarterKey() {
  const d = new Date();
  return d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
}

function round3(n) { return Math.round(n * 1000) / 1000; }

async function fetchProvider(slug) {
  const url = UPSTREAM_BASE + '?provider=' + encodeURIComponent(slug);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'gdash-model-pricing-peer/1.0',
        Accept: 'application/json',
      },
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    });
    if (!r.ok) return { slug, rows: [], error: 'HTTP ' + r.status };
    const j = await r.json();
    return { slug, rows: Array.isArray(j?.results) ? j.results : [] };
  } catch (e) {
    return { slug, rows: [], error: e.message };
  }
}

export async function onRequestGet({ request }) {
  // Fetch each unique provider once even if multiple reps share it
  const providerSlugs = Array.from(new Set(PEER_MODELS.map(r => r.providerSlug)));
  const fetched = await Promise.all(providerSlugs.map(s => fetchProvider(s)));
  const byProvider = new Map(fetched.map(f => [f.slug, f]));

  if (![...byProvider.values()].some(f => f.rows.length)) {
    return jsonResp({
      success: false,
      error: 'Upstream returned no rows for any provider',
      providerErrors: fetched.map(f => ({ slug: f.slug, error: f.error })),
    }, 502, { 'Cache-Control': 'no-store' });
  }

  const allQuarters = new Set();
  let earliestDate = null;

  // For each rep model, filter the provider's rows to that model and bucket
  // observations by quarter. Average input/output per quarter.
  const reps = PEER_MODELS.map(rep => {
    const provider = byProvider.get(rep.providerSlug);
    const matched = (provider?.rows || []).filter(row => {
      const m = row?.model;
      return typeof m === 'string' && modelMatches(m, rep.targetNorm);
    });

    const matchedModelSet = new Set();
    const buckets = new Map(); // qid -> { sumIn, sumOut, n }
    for (const row of matched) {
      const dateStr = row?.date;
      if (typeof dateStr !== 'string' || dateStr.length < 10) continue;
      if (!earliestDate || dateStr < earliestDate) earliestDate = dateStr;
      const qid = quarterOf(dateStr);
      allQuarters.add(qid);
      if (!buckets.has(qid)) buckets.set(qid, { sumIn: 0, nIn: 0, sumOut: 0, nOut: 0 });
      const b = buckets.get(qid);
      const inP  = row?.pricing_prompt;
      const outP = row?.pricing_completion;
      if (typeof inP  === 'number' && isFinite(inP)  && inP  >= 0) { b.sumIn  += inP;  b.nIn  += 1; }
      if (typeof outP === 'number' && isFinite(outP) && outP >= 0) { b.sumOut += outP; b.nOut += 1; }
      if (row.model) matchedModelSet.add(row.model);
    }

    const input = {}, output = {}, obsCount = {};
    for (const [qid, b] of buckets) {
      // Upstream is $/token; scale to $/1M for display parity with the rest
      // of the dashboard's pricing surfaces.
      input[qid]  = b.nIn  ? round3((b.sumIn  / b.nIn)  * 1_000_000) : null;
      output[qid] = b.nOut ? round3((b.sumOut / b.nOut) * 1_000_000) : null;
      obsCount[qid] = b.nIn || b.nOut;
    }

    return {
      key: rep.key,
      provider: rep.provider,
      tier: rep.tier,
      label: rep.label,
      slug: rep.slug,
      modelDisplay: rep.modelDisplay,
      input,
      output,
      obsCount,
      matchedModels: Array.from(matchedModelSet).sort(),
      _buckets: buckets, // stripped before send
    };
  });

  const todayQ = currentQuarterKey();

  // Compute QoQ / YoY for input + output. Suppress for the QTD quarter so
  // partial-quarter averages don't get compared against full quarters.
  for (const rep of reps) {
    rep.qoqInput = {};
    rep.qoqOutput = {};
    rep.yoyInput = {};
    rep.yoyOutput = {};
    for (const qid of Object.keys(rep.input)) {
      if (qid === todayQ) continue;
      const pq = priorQuarter(qid);
      const yq = yearAgoQuarter(qid);
      const inCur = rep.input[qid],  outCur = rep.output[qid];
      const inPri = rep.input[pq],   outPri = rep.output[pq];
      const inYa  = rep.input[yq],   outYa  = rep.output[yq];
      if (inCur  != null && inPri  != null && inPri  > 0) rep.qoqInput[qid]  = round3((inCur  - inPri)  / inPri);
      if (inCur  != null && inYa   != null && inYa   > 0) rep.yoyInput[qid]  = round3((inCur  - inYa)   / inYa);
      if (outCur != null && outPri != null && outPri > 0) rep.qoqOutput[qid] = round3((outCur - outPri) / outPri);
      if (outCur != null && outYa  != null && outYa  > 0) rep.yoyOutput[qid] = round3((outCur - outYa)  / outYa);
    }
    delete rep._buckets;
  }

  // Quarters chronological so the renderer reads left → right
  const quarters = Array.from(allQuarters).sort().map(qid => {
    const range = quarterRange(qid);
    return { id: qid, start: range.start, end: range.end, partial: qid === todayQ };
  });

  const providerErrors = fetched.filter(f => f.error).map(f => ({ slug: f.slug, error: f.error }));

  return jsonResp({
    success: true,
    source: UPSTREAM_BASE,
    sourceNote:
      'Per-model arithmetic mean of daily pricepertoken.com observations within each ' +
      'calendar quarter, filtered to a fixed peer-pair set so QoQ math reflects real ' +
      'provider repricing on the same model. No synthetic backfill — pre-upstream ' +
      'quarters simply do not appear.',
    earliestDateObserved: earliestDate ? earliestDate.slice(0, 10) : null,
    quarters,
    reps,
    providerErrors,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
