/**
 * Cloudflare Pages Function — Pricing / Share Read-Through
 * Route: /api/pricing-share-signal
 * Method: GET
 *
 * Joins two EXISTING sources — no new upstream, no duplicated logic:
 *   1. /api/provider-pricing-matrix?metric=input  — per-provider quarterly
 *      average input $/1M token and pre-computed QoQ%. This is the pricing
 *      source of truth.
 *   2. OpenRouter's `market-share` rankings dataset, read live through
 *      _openrouter-rankings.js — a genuine weekly per-provider token series,
 *      52 weeks deep and current. This is the market-share source of truth.
 *      /api/history?view=daily&range=365 (canonical KV daily snapshots, each
 *      with a top-N rankings array of { rank, model, provider, tokRaw } rows)
 *      is the fallback when the live read fails.
 *
 * WHY THE WEEKLY SERIES AND NOT THE STORED SNAPSHOTS
 * The stored daily rankings were filtered to variant === 'standard' (paid) on
 * 2026-09-16. Everything before that date is all traffic, everything after is
 * paid only, and KV history starts 2026-04-21 — so the ONLY share comparison
 * the stored rows can support, 2026-Q3 against 2026-Q2, is exactly the one
 * that straddles the break: ~48 all-traffic days blended with ~13 paid-only
 * days, against a 100% all-traffic quarter. That is a change of measure read
 * as a change of share. The `market-share` dataset was never touched by that
 * filter, so it is one measure across the whole window.
 *
 * The price of that consistency is that the weekly series counts ALL
 * OpenRouter traffic, free included. A paid-only history does not exist and
 * cannot be reconstructed — stored rows carry no variant and openrouter.js
 * strips "(free)" at parse time — so all-traffic is not a preference, it is
 * the only basis with history. `shareBasis` says so on every response, and
 * these shares are NOT the same numbers the stored snapshots produced.
 *
 * Share of a period: provider tokens / the period's whole token total. For a
 * week that denominator is every provider OpenRouter names plus its "others"
 * bucket; for a fallback day it is the tokens of the top `depth` providers in
 * that day's stored list. Share of a quarter is the mean of the period shares
 * in which the provider was observed.
 *
 * The FALLBACK carries the same rule the live series makes unnecessary: a
 * stored day dated on or after 2026-09-16 is not counted (uncountedReason →
 * 'variantFiltered'). Without it the fallback would do exactly what the live
 * series was brought in to stop — average ~48 all-traffic days with ~13
 * paid-only ones and call the difference a share move. So neither path ever
 * spans that break; the fallback simply keeps to the all-traffic days, and
 * shareBasis.excludedDays reports how many it set aside and why. Joining (by normalized provider slug)
 * with the pricing matrix yields per-(provider, quarter) rows with priceQoq
 * and shareQoq in the same period.
 *
 * DEPTH is decided per comparison, from the periods of the two quarters being
 * compared and no others (see comparisonDepth). Share of a 10-row list is
 * structurally larger than share of a 30-row list, so both quarters are read
 * to the same number of providers — but a single global minimum across the
 * whole window would let one short day narrow the measure for every quarter
 * at once, which is a different wrong answer.
 *
 * Classification rules (deliberately simple and transparent):
 *   Price regime:
 *     priceQoq <= -0.02  → "cut"
 *     |priceQoq| <  0.02 → "hold"
 *     priceQoq >=  0.02  → "up"
 *   Share regime (absolute percentage-point delta):
 *     shareQoq >=  0.3 pp → "gain"
 *     |shareQoq| < 0.3 pp → "flat"
 *     shareQoq <= -0.3 pp → "loss"
 *
 * Honesty:
 *   - We only return a row for a provider in a quarter when BOTH its price
 *     and its share are observed. Providers outside the OR top-N on every
 *     captured day of a quarter are omitted — never imputed.
 *   - "latestComparable" is the most recent quarter that has both a real
 *     priceQoq AND a real shareQoq computed from real snapshots.
 *   - Upstream source-floor limitations (pricing: 2025-07-28; market share:
 *     52 weeks live, or whatever the KV index holds on the fallback path)
 *     propagate through without fabrication.
 *   - Days that are not what they claim are not counted (see uncountedReason),
 *     and `shareBasis.excludedDays` names how many and why rather than
 *     quietly shrinking the denominator.
 *   - Directional ecosystem read-through. Not a causal claim.
 */

import { isRealSnapshot } from './gpu-hardware-pricing-history.js';
import { fetchMarketShare } from './_openrouter-rankings.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const CACHE_TTL = 600; // 10 min

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=' + CACHE_TTL,
      ...CORS,
    },
  });
}

/**
 * Normalize provider strings between the two sources.
 * Pricing matrix uses: openai, anthropic, google, xai, mistralai, deepseek, meta-llama, cohere.
 * OpenRouter `or[].provider` strings seen historically:
 *   anthropic, google, openai, meta-llama, deepseek, mistralai, x-ai, xai,
 *   cohere, minimax, xiaomi, nvidia, qwen, stepfun, ...
 * We map known aliases and leave others untouched.
 */
function normalizeProviderSlug(s) {
  if (!s) return '';
  const k = String(s).toLowerCase().trim();
  const ALIAS = {
    'x-ai': 'xai',
    'meta': 'meta-llama',
    'mistral-ai': 'mistralai',
    'mistralai': 'mistralai',
    'anthropic': 'anthropic',
    'google': 'google',
    'openai': 'openai',
    'deepseek': 'deepseek',
    'cohere': 'cohere',
    'meta-llama': 'meta-llama',
    'xai': 'xai',
  };
  return ALIAS[k] || k;
}

function quarterOfDate(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return null;
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  if (!y || !m) return null;
  return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
}

function priorQuarterKey(key) {
  const m = key && key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  const y = +m[1], q = +m[2];
  return q === 1 ? (y - 1) + '-Q4' : y + '-Q' + (q - 1);
}

/**
 * Rows whose model name is really an APPLICATION, not a model — the
 * fingerprints of the 2026-08-18 regression, when the extraction drifted to
 * OpenRouter's Top Apps table and the daily history recorded "Kilo Code" and
 * "Cline" as models until 2026-09-15. Held verbatim alongside the capture-path
 * copies in _openrouter-rankings.js (APP_NAME_HINTS) and openrouter.js
 * (assertLooksLikeModels); neither module exports it, and neither is this
 * endpoint's to edit. The capture path refuses these payloads now, but ~29
 * days of them are already stored, so the READ path must refuse them too.
 */
const APP_NAME_HINTS = /^(kilo code|cline|codex|pi|omp|freebuff|roo code|chatwise|sillytavern|openrouter api|janitorai|openwebui)$/i;

/**
 * The day the stored daily capture changed population. From this date
 * openrouter.js:207 filters the ranking to variant === 'standard' (paid), so
 * a day on or after it observes PAID traffic and every day before it observes
 * ALL traffic. The two cannot be averaged into one quarter: that is not a
 * share moving, it is the measure moving underneath it.
 *
 * The rows carry no variant, so the earlier days cannot be re-filtered to
 * match the later ones, and there is no paid-only prior quarter to compare a
 * paid-only 2026-Q3 against. The fallback therefore keeps to the population
 * it has all of — all traffic — and refuses the days that are not on it.
 */
const VARIANT_BREAK_DATE = '2026-09-16';

/** Fewer than half the rows naming a model maker: not a model ranking. */
function isAttributedRanking(rows) {
  const attributed = rows.filter(m => m.provider && m.provider !== 'other').length;
  return attributed >= rows.length * 0.5;
}

/**
 * Why a day's stored ranking is not counted toward market share, or null if
 * it is. Every test reads what the capture itself recorded.
 *
 *   'backfill'        A copy written to fill a gap, by the same rule the GPU
 *                     history reader already applies (isRealSnapshot).
 *   'autofillGap'     Gap-detection re-dated ONE capture across up to
 *                     MAX_AUTOFILL_DAYS (90) days. Counting each as an
 *                     independent observation votes one day ninety times.
 *   'topAppsTable'    A row names an application, not a model.
 *   'notModelRanking' Fewer than half the rows name a model maker. The Top
 *                     Apps window trips this too, but not every row of it
 *                     does — which is why both tests run, not just this one.
 *   'variantFiltered' Dated on or after VARIANT_BREAK_DATE. The day is a sound
 *                     observation of PAID traffic; every day before it
 *                     observes all traffic. Averaging the two into one quarter
 *                     measures nothing — and 2026-Q3 vs 2026-Q2 is the only
 *                     comparison this series can support, so without this test
 *                     the fallback reads a change of measure as a change of
 *                     share. Last, so a day that is ALSO corrupt reports the
 *                     more specific reason.
 */
function uncountedReason(snapshot, rows) {
  if (!isRealSnapshot(snapshot)) return 'backfill';
  if (snapshot && snapshot.source === 'autofill-gap') return 'autofillGap';
  if (rows.some(m => APP_NAME_HINTS.test(String(m.model || '').trim()))) return 'topAppsTable';
  if (!isAttributedRanking(rows)) return 'notModelRanking';
  const day = typeof snapshot.date === 'string' ? snapshot.date.slice(0, 10) : '';
  if (day && day >= VARIANT_BREAK_DATE) return 'variantFiltered';
  return null;
}

/** What each exclusion means, so the screen never prints a bare count. */
const EXCLUSION_LABELS = {
  backfill: 'Gap-fill copy of a later capture, not a second observation',
  autofillGap: 'One capture re-dated to fill a gap — not an independent day',
  topAppsTable: 'Stored list is OpenRouter\'s Top Apps table, not Top Models',
  notModelRanking: 'Fewer than half the rows name a model maker',
  variantFiltered: 'Captured on or after 2026-09-16, when the capture began ' +
    'filtering to paid traffic — a different population from the days before it',
};

/**
 * How many providers both quarters can be read to. Computed from the periods
 * of THESE two quarters only: a global minimum over the whole window lets one
 * short day narrow the measure for every quarter at once.
 */
function comparisonDepth(periodsNow, periodsPrior) {
  const all = [...(periodsNow || []), ...(periodsPrior || [])];
  if (!all.length) return 0;
  return Math.min(...all.map(p => p.ranked.length));
}

/**
 * Mean provider share across a quarter's periods, each read to its top
 * `depth` providers.
 *
 * `wholeDenominator` is true for the weekly series, where the period total is
 * every provider plus OpenRouter's "others" bucket — a real marketplace
 * total that depth cannot inflate. It is false for stored days, where the
 * only denominator available is the listed rows themselves, so truncating to
 * `depth` is what makes a 10-row day and a 30-row day the same measure.
 */
function shareAtDepth(periods, depth, wholeDenominator) {
  const acc = new Map(); // slug -> { sum, periods }
  let periodsUsed = 0;
  if (depth > 0) {
    for (const p of periods || []) {
      const top = p.ranked.slice(0, depth);
      const total = wholeDenominator ? p.total : top.reduce((a, r) => a + r.tok, 0);
      if (!(total > 0)) continue;
      periodsUsed++;
      for (const r of top) {
        const cur = acc.get(r.slug) || { sum: 0, periods: 0 };
        cur.sum += (r.tok / total) * 100; // percent
        cur.periods++;
        acc.set(r.slug, cur);
      }
    }
  }
  const byProvider = new Map();
  for (const [slug, v] of acc) byProvider.set(slug, { share: v.sum / v.periods, periods: v.periods });
  return { byProvider, periodsUsed };
}

/** Group periods by calendar quarter, dropping any whose date will not parse. */
function byQuarter(periods) {
  const m = new Map();
  for (const p of periods) {
    const list = m.get(p.q);
    if (list) list.push(p); else m.set(p.q, [p]);
  }
  return m;
}

/**
 * The live weekly series as comparison periods. "others" counts toward the
 * week total — it is traffic that really was served — but is not a provider
 * and never gets a row of its own.
 */
function periodsFromWeeks(weeks) {
  const periods = [];
  for (const w of weeks || []) {
    const q = quarterOfDate(w && w.start);
    if (!q) continue;
    let total = 0;
    const ranked = [];
    for (const [key, tokens] of Object.entries((w && w.providers) || {})) {
      const tok = Number(tokens) || 0;
      if (tok <= 0) continue;
      total += tok;
      if (key === 'others') continue;
      ranked.push({ slug: normalizeProviderSlug(key), tok });
    }
    if (total <= 0 || !ranked.length) continue;
    ranked.sort((a, b) => b.tok - a.tok);
    periods.push({ q, start: w.start, ranked, total });
  }
  return periods;
}

/**
 * Stored daily snapshots as comparison periods, with the days that are not
 * what they claim left out and counted by reason.
 */
function periodsFromSnapshots(snapshots) {
  const periods = [];
  const excludedDays = {};
  let countedDays = 0;
  for (const s of snapshots || []) {
    const rows = Array.isArray(s && s.or) ? s.or : [];
    if (!rows.length) continue;
    const q = quarterOfDate(s.date);
    if (!q) continue;
    const why = uncountedReason(s, rows);
    if (why) { excludedDays[why] = (excludedDays[why] || 0) + 1; continue; }
    // Sum tokRaw per provider (the same provider can hold several models)
    const perProv = new Map();
    for (const m of rows) {
      const slug = normalizeProviderSlug(m.provider);
      if (!slug) continue;
      perProv.set(slug, (perProv.get(slug) || 0) + (+m.tokRaw || 0));
    }
    const ranked = [...perProv].map(([slug, tok]) => ({ slug, tok })).sort((a, b) => b.tok - a.tok);
    if (!ranked.length) continue;
    countedDays++;
    periods.push({ q, ranked, total: 0 });
  }
  return { periods, countedDays, excludedDays };
}

function classifyPrice(qoq) {
  if (typeof qoq !== 'number' || !isFinite(qoq)) return 'unknown';
  if (qoq <= -0.02) return 'cut';
  if (qoq >= 0.02) return 'up';
  return 'hold';
}

function classifyShare(deltaPP) {
  if (typeof deltaPP !== 'number' || !isFinite(deltaPP)) return 'unknown';
  if (deltaPP >= 0.3) return 'gain';
  if (deltaPP <= -0.3) return 'loss';
  return 'flat';
}

// A provider whose price change the matrix declined to compute. Deliberately
// outside the 3x3 table: no price regime applies, so no read-through is
// claimed. "Insufficient data" would be the wrong words — the data is there
// and the matrix said exactly why it would not divide one figure by the other.
const TOO_FEW_MATCHED_REGIME = {
  label: 'Too few models to compare',
  note: 'The provider\'s lineup changed too much between the two quarters for a like-for-like price change, so none is computed and no price read is made.',
};

const MEASURE_CHANGED_REGIME = {
  label: 'Price measure changed',
  note: 'The source changed how it reports this provider\'s prices between the two quarters, so the price change is not computed and no price read is made.',
};

/** Human-readable regime label + short interpretation. */
function regimeFor(priceReg, shareReg) {
  const key = priceReg + '|' + shareReg;
  const table = {
    'cut|gain':   { label: 'Price cut → share gain',         note: 'Cut appears to be translating into volume pickup.' },
    'cut|flat':   { label: 'Price cut · no share response',  note: 'Cut not yet converting into share — elasticity weak.' },
    'cut|loss':   { label: 'Price cut + share loss',         note: 'Anomaly — cut did not defend share.' },
    'hold|gain':  { label: 'Price resilient · share gain',   note: 'Pricing power — gaining without cutting.' },
    'hold|flat':  { label: 'Stable price · stable share',    note: 'Status quo; neither side moving.' },
    'hold|loss':  { label: 'Price held · share loss',        note: 'Losing ground without defending on price.' },
    'up|gain':    { label: 'Price up · share gain',          note: 'Strong pricing power — raising and still gaining.' },
    'up|flat':    { label: 'Price up · share flat',          note: 'Price increase absorbed; watch next quarter.' },
    'up|loss':    { label: 'Price up · share loss',          note: 'Weak position — market pushed back on price.' },
  };
  return table[key] || { label: 'Insufficient data', note: '' };
}

async function localFetch(request, path) {
  const origin = new URL(request.url).origin;
  try {
    const r = await fetch(origin + path, {
      headers: { 'User-Agent': 'gdash-pricing-share/1.0' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

export async function onRequestGet({ request }) {
  const [pricing, history, live] = await Promise.all([
    localFetch(request, '/api/provider-pricing-matrix?metric=input'),
    localFetch(request, '/api/history?view=daily&range=365'),
    // Same house pattern as provider-pricing-matrix.js: the live read is
    // allowed to fail and says why, rather than taking the endpoint down.
    fetchMarketShare('week').catch(e => ({ error: (e && e.message) || String(e) })),
  ]);

  if (!pricing || !pricing.success) {
    return jsonResp({ success: false, error: 'pricing matrix unavailable' }, 502);
  }

  // ── Choose ONE share series ──
  // The stored days are read either way, so the response can say how many
  // there were and how many were refused — but only one series ever feeds a
  // comparison. Blending a weekly all-traffic quarter with a daily
  // as-captured one would compare two different measures and call the
  // difference a share move.
  const stored = history && history.success
    ? periodsFromSnapshots(history.snapshots)
    : { periods: [], countedDays: 0, excludedDays: {} };
  const liveWeeks = (live && Array.isArray(live.weeks)) ? periodsFromWeeks(live.weeks) : [];
  const liveError = liveWeeks.length ? null : ((live && live.error) || 'no weekly points returned');

  if (!liveWeeks.length && !stored.periods.length) {
    return jsonResp({
      success: false,
      error: 'market share unavailable — live weekly series failed (' + liveError +
        ') and no stored day could be counted',
    }, 502);
  }

  const useLive = liveWeeks.length > 0;
  const series = {
    periodsByQuarter: byQuarter(useLive ? liveWeeks : stored.periods),
    wholeDenominator: useLive,
  };

  const excludedByReason = Object.entries(stored.excludedDays)
    .map(([reason, days]) => ({ reason, days, label: EXCLUSION_LABELS[reason] || reason }))
    .sort((a, b) => b.days - a.days);

  // One shape either way, so the screen has one thing to read.
  const shareBasis = {
    source: useLive ? 'live-weekly' : 'stored-daily',
    measure: useLive ? 'all-traffic' : 'as-captured',
    label: useLive
      ? 'all OpenRouter traffic, paid and free'
      : 'all OpenRouter traffic, paid and free — stored daily top-N captures before 2026-09-16',
    note: useLive
      ? 'Weekly per-provider tokens from OpenRouter\'s market-share dataset. ' +
        'A paid-only history does not exist — the stored daily rankings were filtered to ' +
        'paid traffic on 2026-09-16 and carry no variant before that — so this counts all ' +
        'traffic, free included, and is NOT the same number the stored snapshots produced.'
      : 'The live weekly series could not be read, so share falls back to the stored daily ' +
        'top-N captures. Their population changed on 2026-09-16, when the capture began ' +
        'filtering to paid traffic, so days from that date are NOT counted and no comparison ' +
        'spans it: what is left is all-traffic days only, measured as share of the top ' +
        'providers each day listed rather than of the whole marketplace.',
    fallback: !useLive,
    liveError: useLive ? null : liveError,
    // The live weekly series, when it is the one in use.
    weeks: useLive ? liveWeeks.length : 0,
    firstWeek: useLive ? liveWeeks[0].start : null,
    lastWeek: useLive ? liveWeeks[liveWeeks.length - 1].start : null,
    // The stored days, reported either way: on the fallback path they ARE the
    // series, and on the live path they still say how much of the capture is
    // unusable — "Q3 rests on 61 of 90 days" rather than an implied 90.
    countedDays: stored.countedDays,
    excludedDays: excludedByReason,
    excludedDayTotal: excludedByReason.reduce((a, x) => a + x.days, 0),
  };

  // ── Walk pricing matrix quarters — pair with share quarters ──
  const pricingProviders = pricing.providers || [];
  const slugToLabel = {};
  for (const p of pricingProviders) slugToLabel[p.slug] = p.label;

  // Find the latest quarter for which we can compute BOTH priceQoq and shareQoq.
  let latestComparable = null;
  const allQuarterRows = []; // { quarter, rows: [...] } newest first

  for (const q of pricing.quarters || []) {
    const prior = priorQuarterKey(q.quarter);
    const priorQuarter = (pricing.quarters || []).find(x => x.quarter === prior);
    // Depth for THIS comparison only — see comparisonDepth.
    const periodsNow = series.periodsByQuarter.get(q.quarter) || [];
    const periodsPrior = series.periodsByQuarter.get(prior) || [];
    const depth = comparisonDepth(periodsNow, periodsPrior);
    const now = shareAtDepth(periodsNow, depth, series.wholeDenominator);
    const prev = shareAtDepth(periodsPrior, depth, series.wholeDenominator);
    const shareNow = now.byProvider;
    const sharePrior = prev.byProvider;

    const rows = [];
    for (const c of q.cells || []) {
      const slug = c.slug;
      if (typeof c.avg !== 'number') continue;
      const priorCell = (priorQuarter && priorQuarter.cells.find(x => x.slug === slug)) || null;
      // The matrix now publishes WHY it withheld a change. Reading only c.qoq
      // loses that: a refused cell and a cell with no prior quarter look
      // identical, and both end up labelled "Insufficient data".
      const measureChanged = c.qoqMeasureChanged === true;
      const tooFewMatched  = c.qoqTooFewMatched === true;
      const priceRefused   = measureChanged || tooFewMatched;
      const priceQoq = (!priceRefused && typeof c.qoq === 'number') ? c.qoq : null;

      const nowObs = shareNow.get(slug) || null;
      const prevObs = sharePrior.get(slug) || null;
      const shareAvg = nowObs ? nowObs.share : null;
      const sharePrev = prevObs ? prevObs.share : null;
      const shareQoqPP = (typeof shareAvg === 'number' && typeof sharePrev === 'number')
        ? (shareAvg - sharePrev) : null;

      // We include a provider only if we can characterize BOTH dimensions
      // for THIS quarter. Pure pricing rows (no share observation in this
      // quarter) are skipped — being explicit about what we don't know.
      if (typeof shareAvg !== 'number') continue;

      const priceReg = priceRefused
        ? (measureChanged ? 'measure_changed' : 'too_few_matched')
        : classifyPrice(priceQoq);
      const shareReg = classifyShare(shareQoqPP);
      const regime   = priceRefused
        ? (measureChanged ? MEASURE_CHANGED_REGIME : TOO_FEW_MATCHED_REGIME)
        : regimeFor(priceReg, shareReg);

      rows.push({
        slug,
        label: slugToLabel[slug] || slug,
        avg: c.avg,
        avgLabel: c.avgLabel,
        priceQoq,
        // Never a bare dash. A refused comparison says which refusal; an
        // absent one says the prior quarter held no comparable figure. Both
        // carry priceQoqReason, so the cell has its reason on hover too.
        priceQoqLabel: (typeof priceQoq === 'number')
          ? ((priceQoq >= 0 ? '+' : '') + (priceQoq * 100).toFixed(1) + '%')
          : measureChanged ? 'measure changed'
          : tooFewMatched ? 'too few models'
          : 'no prior quarter',
        priceReg,
        priceRefused,
        priceRefusedKind: measureChanged ? 'measure_changed' : tooFewMatched ? 'too_few_matched' : null,
        priceMeasureChanged: measureChanged,
        priceQoqReason: priceRefused
          ? (c.qoqReason || null)
          : (typeof priceQoq === 'number' ? null
            : 'The pricing matrix published no comparable average for ' + (slugToLabel[slug] || slug) +
              ' in ' + (prior || 'the prior quarter') + ', so no price change can be computed. None is imputed.'),
        shareAvg,
        // Two decimals under 1%: a provider with a small but real share must
        // not be rounded to "0.0%", which reads as absent.
        shareAvgLabel: shareAvg.toFixed(shareAvg < 1 ? 2 : 1) + '%',
        sharePrev: (typeof sharePrev === 'number') ? sharePrev : null,
        // How many of the quarter's periods actually observed this provider.
        sharePeriods: nowObs ? nowObs.periods : 0,
        sharePrevPeriods: prevObs ? prevObs.periods : 0,
        shareQoqPP,
        shareQoqLabel: (typeof shareQoqPP === 'number') ? ((shareQoqPP >= 0 ? '+' : '') + shareQoqPP.toFixed(2) + 'pp') : '—',
        shareReg,
        regimeLabel: regime.label,
        note: regime.note,
        modelCount: c.modelCount || 0,
      });
    }
    if (rows.length) {
      allQuarterRows.push({
        quarter: q.quarter,
        partial: q.partial,
        // Published so the screen can say what the comparison was read to,
        // and how much of each quarter stands behind it.
        shareDepth: depth,
        sharePeriods: now.periodsUsed,
        priorSharePeriods: prev.periodsUsed,
        sharePeriodUnit: series.wholeDenominator ? 'week' : 'day',
        rows,
      });
      if (!latestComparable && rows.some(r => typeof r.priceQoq === 'number' && typeof r.shareQoqPP === 'number')) {
        latestComparable = q.quarter;
      }
    }
  }

  // ── Derive ranked callouts for the latest comparable quarter ──
  let callouts = [];
  const latestObj = allQuarterRows.find(x => x.quarter === latestComparable);
  if (latestObj) {
    // Callouts that read price AGAINST share need both. Callouts that read
    // share alone need only share — dropping a provider from those because its
    // PRICE comparison was refused throws away a figure that is fully known.
    const r = latestObj.rows.filter(x =>
      !x.priceRefused && typeof x.priceQoq === 'number' && typeof x.shareQoqPP === 'number');
    const shareRows = latestObj.rows.filter(x =>
      typeof x.shareQoqPP === 'number' && (typeof x.priceQoq === 'number' || x.priceRefused));

    const by = (fn) => [...r].sort(fn);

    const biggestCut = by((a,b) => a.priceQoq - b.priceQoq)[0];
    if (biggestCut && biggestCut.priceQoq < 0) callouts.push({
      kind: 'biggest_price_cut',
      title: 'Biggest price cut',
      provider: biggestCut.label, slug: biggestCut.slug,
      detail: biggestCut.priceQoqLabel + ' input · share ' + biggestCut.shareQoqLabel,
    });

    const strongestGainer = [...shareRows].sort((a,b) => b.shareQoqPP - a.shareQoqPP)[0];
    if (strongestGainer && strongestGainer.shareQoqPP > 0) callouts.push({
      kind: 'strongest_share_gain',
      title: 'Strongest share gainer',
      provider: strongestGainer.label, slug: strongestGainer.slug,
      detail: strongestGainer.shareQoqLabel + ' share · price ' + strongestGainer.priceQoqLabel,
    });

    const pricingPower = r
      .filter(x => x.priceReg !== 'cut' && x.shareReg === 'gain')
      .sort((a, b) => b.shareQoqPP - a.shareQoqPP)[0];
    if (pricingPower) callouts.push({
      kind: 'pricing_power',
      title: 'Strongest pricing power',
      provider: pricingPower.label, slug: pricingPower.slug,
      detail: 'Price ' + pricingPower.priceReg + ' (' + pricingPower.priceQoqLabel + '), share ' + pricingPower.shareQoqLabel,
    });

    const weakConv = r
      .filter(x => x.priceReg === 'cut' && x.shareReg !== 'gain')
      .sort((a, b) => a.priceQoq - b.priceQoq)[0];
    if (weakConv) callouts.push({
      kind: 'weak_conversion',
      title: 'Weakest conversion',
      provider: weakConv.label, slug: weakConv.slug,
      detail: 'Cut ' + weakConv.priceQoqLabel + ' · share only ' + weakConv.shareQoqLabel,
    });

    const disconnect = r
      .filter(x => (x.priceReg === 'up' && x.shareReg === 'gain') || (x.priceReg === 'cut' && x.shareReg === 'loss'))
      .sort((a, b) => Math.abs(b.shareQoqPP) - Math.abs(a.shareQoqPP))[0];
    if (disconnect) callouts.push({
      kind: 'anomaly',
      title: 'Biggest disconnect',
      provider: disconnect.label, slug: disconnect.slug,
      detail: 'Price ' + disconnect.priceQoqLabel + ' but share ' + disconnect.shareQoqLabel,
    });

    callouts = callouts.slice(0, 5);
  }

  return jsonResp({
    success: true,
    latestComparable,
    priorComparable: priorQuarterKey(latestComparable),
    quarters: allQuarterRows,
    callouts,
    thresholds: {
      priceCutPct: -2, priceUpPct: 2,
      shareGainPP: 0.3, shareLossPP: -0.3,
    },
    // What the share numbers rest on, and — on the fallback path — which
    // stored days were refused and why.
    shareBasis,
    providers: pricingProviders,
    sourceNote:
      'Directional ecosystem read-through · not a causal claim. ' +
      'Pricing QoQ: api.pricepertoken.com provider pricing history (equal-weighted, quarterly). ' +
      (useLive
        ? 'Market share: OpenRouter\'s weekly market-share series — all traffic, free included, ' +
          'since no paid-only history exists — averaged over the weeks of each quarter. ' +
          'Each week\'s denominator is every provider OpenRouter names plus its "others" bucket.'
        : 'Market share: canonical HISTORY_KV daily snapshots of OpenRouter top-N by weekly tokens ' +
          '— all traffic, free included — averaged over the counted days of each quarter. The live ' +
          'weekly series was unavailable (' + liveError + '). Gap-fill copies, re-dated autofill ' +
          'days, days holding the Top Apps table and days from 2026-09-16 on (when the capture ' +
          'began filtering to paid traffic, a different population) are not counted, so no ' +
          'comparison spans that change; shareBasis.excludedDays says how many and why.') + ' ' +
      'Both quarters of a comparison are read to the same number of providers (quarters[].shareDepth), ' +
      'decided from those two quarters alone. ' +
      'Providers outside that depth during a quarter are omitted, never imputed.',
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
