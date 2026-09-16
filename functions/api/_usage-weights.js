/**
 * Usage weights for provider price averages.
 *
 * WHAT THIS IS FOR
 * The provider pricing matrix averages every model in a provider's lineup
 * equally: a model nobody calls counts exactly as much as the one carrying
 * the traffic. That answers "what is on the menu", not "what does the market
 * actually pay". This module supplies the second answer by weighting each
 * model's price by the tokens it actually served.
 *
 * WEIGHT SOURCE
 * /api/openrouter-chart-weekly — the weekly "Top Models" token series
 * captured from openrouter.ai/rankings. Each week carries
 * `allModels: { "<orProvider>/<model>": tokens }`. This is REAL observed
 * volume, not a survey or an estimate.
 *
 * THE FOUR HONESTY LIMITS — every one of them is surfaced in the response,
 * because a weighted average that hides its own coverage is worse than no
 * weighted average at all:
 *
 *   1. OpenRouter is a slice of the market, not the market. First-party API
 *      traffic (most of OpenAI's and Google's real volume) never appears.
 *      Weights describe OpenRouter's mix only.
 *
 *   2. OpenRouter's weekly chart names only its top ~9 models and buckets
 *      everything else into "Others". A provider whose traffic is spread
 *      across many mid-tier models is therefore under-represented, and
 *      "Others" cannot be split back out by provider. This is why coverage
 *      is measured and enforced rather than assumed — see gate below.
 *
 *   3. OpenRouter publishes ONE token count per model, prompt and completion
 *      combined. The same weight is therefore applied to the input average
 *      and the output average. A model whose traffic skews unusually far to
 *      one side is weighted slightly off on both.
 *
 *   4. Coverage needs a denominator — the provider's total OpenRouter
 *      tokens — which comes from a separate capture
 *      (/api/openrouter-chart-weekly?providers=1). A quarter is certifiable
 *      only when EVERY week contributing to it has that denominator. If even
 *      one week is missing it, the quarter's coverage is UNKNOWN and every
 *      cell in it is withheld — a partly-certified quarter would publish a
 *      price computed over more weeks than its coverage figure describes.
 *      It is never assumed to be fine.
 *
 *   5. OpenRouter's `:free` variants serve tokens at no charge. Folding them
 *      into the paid SKU would count free traffic at the paid price and
 *      inflate a metric whose whole claim is "what was paid", so variant
 *      SKUs are excluded from the weights AND from the coverage numerator —
 *      they lower coverage, which is the visible, correct outcome.
 *
 * THE GATE
 * A weighted cell is published only when all three hold:
 *   - at least MIN_WEIGHTED_MODELS priced models carry a weight, so the
 *     number is an average and not one model wearing a provider's name;
 *   - coverage is KNOWN for that provider-quarter; and
 *   - coverage is at least MIN_COVERAGE of the provider's own OpenRouter
 *     tokens.
 * Otherwise the cell is null and carries a `gate` string naming which test
 * it failed, so the UI can say why rather than showing a bare dash.
 *
 * Measured against live data on 2026-09-16, the slug reconciliation below
 * matches 100% of named OpenRouter tokens to a priced model for every week
 * at or after the pricing floor (2025-07-28); earlier weeks predate upstream
 * pricing entirely and match 0% by construction.
 */

/** Minimum priced models carrying a weight before a cell is an "average". */
export const MIN_WEIGHTED_MODELS = 2;
/** Minimum share of a provider's own OpenRouter tokens the weights must cover. */
export const MIN_COVERAGE = 0.40;

/**
 * pricepertoken provider slug → OpenRouter provider slug.
 *
 * Only `xai` actually differs (OpenRouter spells it `x-ai`), but the map is
 * explicit for all eight so a future rename fails loudly here instead of
 * silently zeroing a provider's weights.
 *
 * `cohere` has no OpenRouter presence in any captured week — it is listed so
 * the omission is visibly deliberate rather than an oversight.
 */
export const PPT_TO_OR_PROVIDER = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'x-ai',
  mistralai: 'mistralai',
  deepseek: 'deepseek',
  'meta-llama': 'meta-llama',
  cohere: 'cohere',
};

const OR_TO_PPT_PROVIDER = Object.fromEntries(
  Object.entries(PPT_TO_OR_PROVIDER).map(([ppt, or]) => [or, ppt]),
);

/**
 * Candidate pricepertoken model names for one OpenRouter model name, most
 * specific first. The caller takes the first candidate that exists in the
 * price catalog, so a more specific SKU always wins over its base model.
 *
 * Every rule here was derived from observed mismatches, not guessed:
 *
 *   gpt-5.6-luna-20260709      → gpt-5.6-luna        (trailing -YYYYMMDD)
 *   deepseek-v4-flash-20260731 → deepseek-v4-flash-0731, then -flash
 *                                (upstream keeps some dated SKUs as -MMDD)
 *   gpt-4.1-mini-2025-04-14    → gpt-4.1-mini        (trailing -YYYY-MM-DD)
 *   claude-3-7-sonnet-…        → claude-3.7-sonnet   (dashed version number)
 *   claude-4.5-sonnet-…        → claude-sonnet-4.5   (tier/version swapped)
 *
 * Kept deliberately narrow: exact matching after these rewrites, never fuzzy
 * or prefix matching. A model we cannot name exactly is reported as unpriced
 * and drags coverage down — which is the correct, visible outcome. Guessing
 * would silently attach a wrong price to real volume.
 */
export function priceModelCandidates(orModel) {
  const out = [];
  const push = (s) => { if (s && !out.includes(s)) out.push(s); };

  push(orModel);

  const dated = orModel.match(/^(.*)-(\d{8})$/);            // -YYYYMMDD
  if (dated) { push(dated[1] + '-' + dated[2].slice(4)); push(dated[1]); }

  const hyphenDated = orModel.match(/^(.*)-(\d{4})-(\d{2})-(\d{2})$/); // -YYYY-MM-DD
  if (hyphenDated) { push(hyphenDated[1] + '-' + hyphenDated[3] + hyphenDated[4]); push(hyphenDated[1]); }

  for (const base of [...out]) {                            // claude-3-7-x → claude-3.7-x
    const m = base.match(/^claude-(\d+)-(\d+)-(.*)$/);
    if (m) push('claude-' + m[1] + '.' + m[2] + '-' + m[3]);
  }
  for (const base of [...out]) {                            // claude-<ver>-<tier> → claude-<tier>-<ver>
    const m = base.match(/^claude-(\d+(?:\.\d+)?)-(opus|sonnet|haiku)(.*)$/);
    if (m) push('claude-' + m[2] + '-' + m[1] + m[3]);
  }
  return out;
}

/** "2026-05-04" → "2026-Q2" */
function quarterOf(dateStr) {
  const m = parseInt(dateStr.slice(5, 7), 10);
  return dateStr.slice(0, 4) + '-Q' + (Math.floor((m - 1) / 3) + 1);
}

/**
 * Split one ISO week's tokens across the calendar quarters it touches,
 * pro-rata by day. Four weeks a year straddle a quarter boundary; assigning
 * such a week wholly to its start quarter would misplace up to six days of
 * volume, which is exactly the kind of quiet error a quarterly comparison
 * then reports as a trend.
 *
 * Returns [{ quarter, fraction }] summing to 1.
 */
function quarterSplit(startStr, endStr) {
  const start = Date.parse(startStr + 'T00:00:00Z');
  const end = Date.parse((endStr || startStr) + 'T00:00:00Z');
  if (!isFinite(start)) return [];
  const days = isFinite(end) && end >= start
    ? Math.round((end - start) / 86400000) + 1
    : 7;
  const counts = new Map();
  for (let i = 0; i < days; i++) {
    const q = quarterOf(new Date(start + i * 86400000).toISOString().slice(0, 10));
    counts.set(q, (counts.get(q) || 0) + 1);
  }
  return Array.from(counts, ([quarter, n]) => ({ quarter, fraction: n / days }));
}

/**
 * Whether an OpenRouter model name carries a variant suffix (":free" and any
 * future sibling).
 *
 * These are excluded from the weights entirely rather than folded into the
 * base SKU. `:free` is the one that appears in the captured series today and
 * it serves tokens at no charge — mapping `x-ai/grok-4.1-fast:free` onto the
 * paid `grok-4.1-fast` price would count free traffic at the paid rate. It is
 * not a rounding error: measured across the captured weeks, `:free` is 9.2% of
 * all named tokens and 11.9% of xAI's, a provider that publishes weighted
 * cells.
 *
 * Any other suffix that appears later is excluded too. A paid routing variant
 * would only lose us a little coverage, which is visible; guessing that it
 * prices like the base SKU would silently corrupt the average, which is not.
 */
function hasVariantSuffix(model) {
  return model.indexOf(':') >= 0;
}

/**
 * Build per-(provider, quarter) usage weights and coverage.
 *
 * @param {object} modelSeries    /api/openrouter-chart-weekly?full=1 payload
 * @param {object} providerSeries /api/openrouter-chart-weekly?providers=1 payload
 * @param {(pptSlug: string, model: string, quarter: string) => string|null} resolveModel
 *        Returns the price-catalog model name for an OpenRouter model name AS
 *        PRICED IN THAT QUARTER, or null otherwise. The quarter argument is
 *        load-bearing: a catalog spanning all history would count a model as
 *        covered in a quarter where it has traffic but no price row, while the
 *        weighted average correctly skips it for want of a price — coverage
 *        would then advertise volume that contributes nothing. Supplied by the
 *        caller so this module never needs the pricing payload itself.
 *
 * @returns {{
 *   weights: Map<string, Map<string, Map<string, number>>>,  // quarter → pptSlug → priceModel → tokens
 *   coverage: Map<string, Map<string, number>>,              // quarter → pptSlug → 0..1 (known only)
 *   providerSeriesLatestWeek: string|null,
 *   modelSeriesLatestWeek: string|null,
 * }}
 */
export function buildUsageWeights(modelSeries, providerSeries, resolveModel) {
  const modelWeeks = Array.isArray(modelSeries?.weeks) ? modelSeries.weeks : [];
  const providerWeeks = Array.isArray(providerSeries?.weeks) ? providerSeries.weeks : [];

  // Coverage is only meaningful where BOTH captures cover the same week.
  // Comparing a numerator from 69 captured weeks against a denominator from
  // 55 produced coverage above 100% in testing — i.e. a silently wrong
  // number. Restricting both sides to the intersection is what makes the
  // ratio mean what it claims.
  const providerByWeek = new Map(providerWeeks.map((w) => [w.start, w]));

  const weights = new Map();          // quarter → pptSlug → priceModel → tokens
  const covNumerator = new Map();     // quarter → pptSlug → priced+named tokens (aligned weeks only)
  const covDenominator = new Map();   // quarter → pptSlug → provider total tokens (aligned weeks only)

  const bump = (map, quarter, slug, key, value) => {
    if (!map.has(quarter)) map.set(quarter, new Map());
    const byProvider = map.get(quarter);
    if (key === null) {
      byProvider.set(slug, (byProvider.get(slug) || 0) + value);
      return;
    }
    if (!byProvider.has(slug)) byProvider.set(slug, new Map());
    const byModel = byProvider.get(slug);
    byModel.set(key, (byModel.get(key) || 0) + value);
  };

  // Quarters touched by at least one model week that has no provider-total
  // counterpart. Their coverage cannot be certified, so no cell in them may
  // publish — see limit 4 above.
  const uncertifiedQuarters = new Set();

  for (const week of modelWeeks) {
    if (typeof week?.start !== 'string') continue;
    const split = quarterSplit(week.start, week.end);
    if (!split.length) continue;
    const aligned = providerByWeek.has(week.start);

    if (!aligned) {
      for (const { quarter } of split) uncertifiedQuarters.add(quarter);
    }

    for (const [slug, tokens] of Object.entries(week.allModels || {})) {
      if (slug === 'Others' || !(tokens > 0)) continue;
      const sep = slug.indexOf('/');
      if (sep <= 0) continue;
      const pptSlug = OR_TO_PPT_PROVIDER[slug.slice(0, sep)];
      if (!pptSlug) continue;                       // provider we do not price
      const orModel = slug.slice(sep + 1);
      if (hasVariantSuffix(orModel)) continue;      // free/variant SKU — not paid volume

      for (const { quarter, fraction } of split) {
        // Resolved per quarter: a model priced in one quarter but not another
        // must not count as covered in the quarter where it has no price.
        const priceModel = resolveModel(pptSlug, orModel, quarter);
        if (!priceModel) continue;                  // named but unpriced — lowers coverage
        bump(weights, quarter, pptSlug, priceModel, tokens * fraction);
        if (aligned) bump(covNumerator, quarter, pptSlug, null, tokens * fraction);
      }
    }

    if (!aligned) continue;
    for (const [orSlug, total] of Object.entries(providerByWeek.get(week.start).providers || {})) {
      const pptSlug = OR_TO_PPT_PROVIDER[orSlug];
      if (!pptSlug || !(total > 0)) continue;
      for (const { quarter, fraction } of split) {
        bump(covDenominator, quarter, pptSlug, null, total * fraction);
      }
    }
  }

  const coverage = new Map();
  for (const [quarter, byProvider] of covDenominator) {
    if (uncertifiedQuarters.has(quarter)) continue; // partly-measured: leave unknown
    const out = new Map();
    for (const [slug, total] of byProvider) {
      if (!(total > 0)) continue;
      const named = covNumerator.get(quarter)?.get(slug) || 0;
      // Clamp at 1: OpenRouter's model chart and provider chart classify a
      // small number of community-hosted models differently, which can put
      // the ratio a few points over 100%. Clamping keeps the published
      // number honest without inventing a reconciliation we cannot verify.
      out.set(slug, Math.min(named / total, 1));
    }
    coverage.set(quarter, out);
  }

  const lastWeek = (arr) => (arr.length ? arr[arr.length - 1].start || null : null);
  return {
    weights,
    coverage,
    uncertifiedQuarters,
    providerSeriesLatestWeek: lastWeek(providerWeeks),
    modelSeriesLatestWeek: lastWeek(modelWeeks),
  };
}

/**
 * Apply weights to one provider-quarter.
 *
 * @param {Map<string, {sum:number,count:number}>} modelMeans
 *        priceModel → running sum/count of that model's daily prices in the
 *        quarter. The per-model mean is taken first so a model priced on 90
 *        days does not outvote one priced on 30; the usage weight is then
 *        the only thing that decides a model's influence.
 * @param {Map<string, number>|undefined} modelWeights priceModel → tokens
 * @param {number|null} coverage 0..1, or null when unknown
 *
 * @returns {{avg:number|null, models:number, coverage:number|null,
 *            topShare:number|null, gate:string|null}}
 *          avg is in the upstream's native $/token unit; the caller scales.
 *          topShare is the largest single model's share of the weight, so a
 *          reader can tell a genuine blend from a number one model dominates —
 *          "4 models" alone does not distinguish the two.
 */
export function weightedAverage(modelMeans, modelWeights, coverage) {
  let numerator = 0;
  let denominator = 0;
  let models = 0;
  let topTokens = 0;

  for (const [model, tokens] of modelWeights || []) {
    const stat = modelMeans.get(model);
    if (!stat || !(tokens > 0)) continue;
    numerator += (stat.sum / stat.count) * tokens;
    denominator += tokens;
    models += 1;
    if (tokens > topTokens) topTokens = tokens;
  }
  const topShare = denominator > 0 ? topTokens / denominator : null;

  if (denominator <= 0) {
    return { avg: null, models: 0, coverage, topShare: null, gate: 'no-usage' };
  }
  if (models < MIN_WEIGHTED_MODELS) {
    return { avg: null, models, coverage, topShare, gate: 'too-few-models' };
  }
  if (coverage === null || coverage === undefined) {
    return { avg: null, models, coverage: null, topShare, gate: 'coverage-unknown' };
  }
  if (coverage < MIN_COVERAGE) {
    return { avg: null, models, coverage, topShare, gate: 'low-coverage' };
  }
  return { avg: numerator / denominator, models, coverage, topShare, gate: null };
}

/** Human-readable reason a weighted cell was withheld. */
export function gateReason(gate, coverage, models) {
  const pct = coverage === null || coverage === undefined
    ? null
    : (coverage * 100).toFixed(0) + '%';
  switch (gate) {
    case 'no-usage':
      return 'No paid OpenRouter token volume recorded for this provider in this quarter ' +
        '(free-tier variants are excluded from paid weights).';
    case 'too-few-models':
      return 'Only ' + models + ' priced model' + (models === 1 ? '' : 's') +
        ' carried volume — one model is not a provider average.';
    case 'coverage-unknown':
      return 'The provider-total capture does not cover every week of this quarter, so the ' +
        'share of volume these weights represent cannot be measured for the whole quarter.';
    case 'low-coverage':
      return 'Weights cover only ' + pct + ' of this provider\'s OpenRouter tokens — ' +
        'below the ' + (MIN_COVERAGE * 100).toFixed(0) + '% needed to call it an average.';
    default:
      return null;
  }
}
