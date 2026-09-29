/**
 * QoQ / YoY are filled wherever there is something honest to compare, and say
 * why where there is not.
 *
 * The report that started this: in the usage-weighted view the Avg $/1M
 * matrix had every one of its cells filled while QoQ and YoY were almost
 * entirely blank. Most of those cells were estimates — the measured value was
 * withheld on coverage, and the Avg view showed its estimate — but growth was
 * taken only between two MEASURED levels, so every change touching an
 * estimate was dropped, and two views of one series disagreed on screen.
 * Growth now follows the figure the Avg view shows.
 *
 * Alongside it: changes across the source's 2026-07-10 change of measure,
 * linked at its exact factor so both quarters stand on one measure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as providerMatrix, buildMatrix } from '../provider-pricing-matrix.js';

const DAY = 86400000;
const days = (f, t) => {
  const o = [];
  for (let x = Date.parse(f + 'T00:00:00Z'); x <= Date.parse(t + 'T00:00:00Z'); x += DAY) o.push(new Date(x).toISOString().slice(0, 10));
  return o;
};
/** Upstream rows for one model: spans of [from, to, $/token input]. */
const hist = (model, spans) => spans.flatMap(([f, t, p]) =>
  days(f, t).map(d => ({ model, date: d + 'T00:00:00+00:00', pricing_prompt: p, pricing_completion: p * 4 })));

const S = '2026-04-01', E = '2026-09-20';
const Q2_END = '2026-06-30', Q3_START = '2026-07-01';
const round3 = (n) => Math.round(n * 1000) / 1000;

async function matrix(qs, upstream, seen = []) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname.includes('pricepertoken')) {
      const slug = u.searchParams.get('provider');
      seen.push(slug);
      // Every provider carries one row, so none is retried as empty; dated a
      // year early so it never enters the quarters under test.
      const rows = upstream[slug] || hist(slug + '-filler', [['2025-04-01', '2025-04-01', 1e-6]]);
      return new Response(JSON.stringify({ results: rows }), { status: 200 });
    }
    return new Response('null', { status: 404 });
  };
  try {
    const res = await providerMatrix({ request: new Request('https://x.test/api/provider-pricing-matrix?' + qs), env: {}, waitUntil() {} });
    return { status: res.status, body: await res.json() };
  } finally { globalThis.fetch = realFetch; }
}
const cellsOf = (d, quarter) => Object.fromEntries(d.quarters.find(q => q.quarter === quarter).cells.map(c => [c.slug, c]));

/* ── Across a change of measure, linked at its exact factor ─────────── */

test('a change across the source\'s change of measure is linked, and a real cut still shows', async () => {
  const halve = (m, p) => hist(m, [[S, '2026-07-09', p], ['2026-07-10', E, p / 2]]);
  const { body: d } = await matrix('metric=input', {
    // Five models halve on 2026-07-10 — the change of measure — and six do
    // not; one of those six is genuinely cut at the quarter boundary.
    openai: [
      ...['t1', 't2', 't3', 't4', 't5'].map((m, i) => halve('gpt-' + m, (i + 1) * 4e-7)).flat(),
      ...['u1', 'u2', 'u3', 'u4', 'u5'].map(m => hist('gpt-' + m, [[S, E, 1e-6]])).flat(),
      ...hist('gpt-u6', [[S, Q2_END, 2.5e-6], [Q3_START, E, 2e-6]]),
    ],
    // Five halve and one does not: all six link, and nothing moved.
    google: [
      ...['a', 'b', 'c', 'd', 'e'].map((m, i) => halve('gemini-' + m, (i + 1) * 2e-7)).flat(),
      ...hist('gemma-x', [[S, E, 3e-8]]),
    ],
  });
  assert.deepEqual(d.measureBreaks.events.map(e => e.effectiveDate), ['2026-07-10']);
  assert.ok(d.measureBreaks.summary, 'the break has a caption the screen can show');
  const q3 = cellsOf(d, '2026-Q3');
  // Halved models enter at their Q2 prices ($0.4 + 0.8 + 1.2 + 1.6 + 2.0 = 6.0
  // per 1M); the untouched five at $1 and the real cut $2.50 -> $2.00.
  assert.equal(q3.openai.qoq, round3((6 + 5 + 2) / (6 + 5 + 2.5) - 1));
  assert.equal(q3.openai.qoqLinked, true);
  assert.equal(q3.openai.qoqMatchedModels, 11);
  assert.equal(q3.openai.qoqMeasureChanged, undefined);
  assert.match(q3.openai.qoqNote, /the 5 models it moved are compared at the price they would have been reported at before it/);

  // The defect this exists to prevent: Google's phantom cut.
  assert.equal(q3.google.qoq, 0);
  assert.equal(q3.google.qoqLinked, true);
  assert.equal(q3.google.qoqMatchedModels, 6);

  // The level itself is still what the source reports: the halved figures.
  assert.ok(q3.google.avg < cellsOf(d, '2026-Q2').google.avg * 0.6);
  assert.equal(q3.google.basis, '2026-07-10');
});

test('a model first listed after the change cannot be linked, and too few linkable models say so', async () => {
  const { body: d } = await matrix('metric=input', {
    google: [
      // Five halve (the change), and three are listed after it: Q3's lineup is
      // 8, of which 5 are priced in both quarters — enough, and linked.
      ...['a', 'b', 'c', 'd', 'e'].map((m, i) => hist('gemini-' + m, [[S, '2026-07-09', (i + 1) * 2e-7], ['2026-07-10', E, (i + 1) * 1e-7]])).flat(),
      ...['n1', 'n2', 'n3'].map(m => hist('gemini-' + m, [['2026-07-15', E, 3e-7]])).flat(),
    ],
    openai: [
      // Only one model is priced in both quarters and linkable: below the
      // hard floor of two, so refused whatever the measure.
      ...hist('gpt-a', [[S, '2026-07-09', 4e-7], ['2026-07-10', E, 2e-7]]),
      ...['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'].map(m => hist('gpt-' + m, [['2026-07-15', E, 1e-6]])).flat(),
    ],
  });
  const q3 = cellsOf(d, '2026-Q3');
  assert.equal(q3.google.qoq, 0);
  assert.equal(q3.google.qoqMatchedModels, 5);
  assert.equal(q3.google.qoqLineupModels, 8);
  assert.match(q3.google.qoqNote, /3 models priced only in Q3 2026/);
  assert.equal(q3.openai.qoq, null);
  assert.equal(q3.openai.qoqTooFewMatched, true);
  assert.equal(q3.openai.qoqMatchedModels, 1);
  assert.ok(q3.openai.qoqReason, 'a blank change is never a bare dash');
  assert.match(q3.openai.qoqReason, /only 1 of the 8 models priced in Q3 2026 was also priced in Q2 2026/);
});

test('a change with nothing to compare against says so', async () => {
  const { body: d } = await matrix('metric=input', {
    anthropic: [...hist('claude-a', [[S, E, 3e-6]]), ...hist('claude-b', [[S, E, 1.5e-5]])],
  });
  // The other providers' filler rows sit in 2025-Q2, so the history reaches
  // back past these quarters: the gap is this provider's, and says so.
  const q2 = cellsOf(d, '2026-Q2').anthropic, q3 = cellsOf(d, '2026-Q3').anthropic;
  assert.equal(q2.qoq, null);
  assert.equal(q2.qoqReason, 'Not computed: Q1 2026 has no price for this provider to compare against.');
  assert.equal(q3.yoyReason, 'Not computed: Q3 2025 has no price for this provider to compare against.');
  assert.equal(q3.qoq, 0);
  assert.equal(q3.qoqReason, undefined, 'a computed change carries no reason');
});

/* ── Usage-weighted: growth follows the figure the Avg view shows ────── */

/**
 * One provider-quarter's model-day level, as providerQuarterLevels builds it.
 * On a changed measure every model here is one the change halved, so its
 * earlier-measure level is twice the reported one.
 */
function level(models, basis = 'origin') {
  const modelLevels = new Map(Object.entries(models));
  const prices = [...modelLevels.values()];
  const modelLinked = new Map([...modelLevels].map(([m, v]) => [m, basis === 'origin' ? v : v * 2]));
  return {
    mean: prices.reduce((a, b) => a + b, 0) / prices.length,
    n: prices.length * 90, basis, models: new Set(modelLevels.keys()),
    excludedN: 0, modelLevels, modelLinked,
  };
}
const weights = (entries) => new Map(Object.entries(entries).map(([m, [tokens, price]]) => [m, { tokens, cost: tokens * price }]));

test('usage-weighted QoQ/YoY are taken from the level shown, estimates included', () => {
  const levels = new Map([
    // List prices: $5 then $6 per 1M.
    ['anthropic', new Map([['2026-Q2', level({ a: 2e-6, b: 8e-6 })], ['2026-Q3', level({ a: 2.4e-6, b: 9.6e-6 })]])],
    ['cohere', new Map([['2026-Q2', level({ c: 1e-6, d: 1e-6 })], ['2026-Q3', level({ c: 1.1e-6, d: 1.1e-6 })]])],
    // Every model on the changed measure in Q3: the change is linked, not read.
    ['google', new Map([['2026-Q2', level({ g: 1e-6, h: 1e-6 })], ['2026-Q3', level({ g: 5e-7, h: 5e-7 }, '2026-07-10')]])],
  ]);
  const weighting = {
    seriesAvailable: true,
    weights: new Map([
      // Q2 measured: an even blend paying $3 per 1M, 0.6 of the $5 list.
      ['2026-Q2', new Map([['anthropic', weights({ a: [50, 2e-6], b: [50, 4e-6] })]])],
      // Q3 withheld: one model carries 95% of the weight.
      ['2026-Q3', new Map([['anthropic', weights({ a: [95, 2.4e-6], b: [5, 9.6e-6] })]])],
    ]),
    coverage: new Map([['2026-Q2', new Map([['anthropic', 0.9]])], ['2026-Q3', new Map([['anthropic', 0.9]])]]),
  };
  const { quarters } = buildMatrix(levels, weighting, []);
  const q3 = Object.fromEntries(quarters.find(q => q.quarter === '2026-Q3').cells.map(c => [c.slug, c]));
  const q2 = Object.fromEntries(quarters.find(q => q.quarter === '2026-Q2').cells.map(c => [c.slug, c]));

  // Measured Q2, estimated Q3 ($6 list x 0.6 = $3.60): +20%, and says which.
  assert.equal(q2.anthropic.avg, 3);
  assert.equal(q3.anthropic.avg, null);
  assert.equal(q3.anthropic.gate, 'single-model-dominated');
  assert.equal(q3.anthropic.estimateAvg, 3.6);
  assert.equal(q3.anthropic.qoq, 0.2);
  assert.equal(q3.anthropic.qoqLabel, '+20.0%');
  assert.equal(q3.anthropic.qoqEstimated, true);
  assert.match(q3.anthropic.qoqNote, /Q3 2026 is an estimate/);
  assert.match(q3.anthropic.qoqNote, /list prices of the 2 models priced in both quarters moved \+20\.0% like-for-like/);

  // No usage at all, both quarters estimated on the peer ratio: the change is
  // the list-price average's, and the note says so.
  assert.equal(q3.cohere.qoq, 0.1);
  assert.equal(q3.cohere.qoqEstimated, true);
  assert.match(q3.cohere.qoqNote, /Both are estimates/);
  assert.match(q3.cohere.qoqNote, /the same ratio in both/);

  // Across a change of measure the weighted levels cannot be compared, so the
  // change is the linked like-for-like list-price one, and says so.
  assert.equal(q3.google.qoq, 0);
  assert.equal(q3.google.qoqLinked, true);
  assert.equal(q3.google.qoqMeasureChanged, undefined);
  assert.match(q3.google.qoqNote, /stand on different measures, so this is the like-for-like list-price change instead/);

  // Q2 has nothing before it, and says which kind of nothing.
  assert.equal(q2.anthropic.qoq, null);
  assert.equal(q2.anthropic.qoqReason,
    'Not computed: there is no Q1 2026 to compare against — the source\'s price history starts in Q2 2026.');
});

test('a weighted change divides unrounded levels, so a sub-cent move survives', () => {
  // Mistral-scale weighted prices: $0.04944 -> $0.04941 per 1M, a fall of
  // -0.06%. $0.001 is 2% of $0.049, so both cells publish the same $0.049 and
  // a change divided from the PUBLISHED levels reads exactly 0 — a real move
  // erased, and near zero a sign inverted.
  const levels = new Map([
    ['mistralai', new Map([
      ['2026-Q2', level({ m: 5e-8, n: 5e-8 })],
      ['2026-Q3', level({ m: 5e-8, n: 5e-8 })],
    ])],
  ]);
  const weighting = {
    seriesAvailable: true,
    weights: new Map([
      ['2026-Q2', new Map([['mistralai', weights({ m: [50, 4.944e-8], n: [50, 4.944e-8] })]])],
      ['2026-Q3', new Map([['mistralai', weights({ m: [50, 4.941e-8], n: [50, 4.941e-8] })]])],
    ]),
    coverage: new Map([['2026-Q2', new Map([['mistralai', 0.9]])], ['2026-Q3', new Map([['mistralai', 0.9]])]]),
  };
  const { quarters } = buildMatrix(levels, weighting, []);
  const at = (q) => quarters.find(r => r.quarter === q).cells.find(c => c.slug === 'mistralai');
  const q2 = at('2026-Q2'), q3 = at('2026-Q3');
  assert.equal(q2.avg, 0.049, 'the published level is still rounded');
  assert.equal(q3.avg, 0.049);
  assert.equal(round3(q3.avg / q2.avg - 1), 0, 'the published levels alone say nothing moved');
  assert.equal(q3.qoq, round3(4.941 / 4.944 - 1));
  assert.ok(q3.qoq < 0, 'the fall survives; dividing the rounded levels gave 0');
});

/* ── The weighted resolver prices a week on the quarter's own measure ── */

test('a usage week straddling the change is priced on one measure, not a blend', async () => {
  // The week 2026-07-06..12 spans the source's 2026-07-10 change: four days
  // reported the old way, three the new. Averaging all seven gives a price
  // that is neither measure, and it feeds every weighted cell AND its
  // coverage %. 2026-Q3 resolves to the new measure, so only its days count.
  const halve = (m, p) => hist(m, [[S, '2026-07-09', p], ['2026-07-10', E, p / 2]]);
  const upstream = {
    google: [
      ...[['g-1', 2e-6], ['g-2', 4e-7], ['g-3', 1e-7], ['g-4', 3e-7], ['g-5', 5e-7]]
        .flatMap(([m, p]) => halve(m, p)),
      ...hist('gemma-x', [[S, E, 3e-8]]),
    ],
  };
  const week = { start: '2026-07-06', end: '2026-07-12', partial: false };
  const modelSeries = {
    updatedAt: '2026-09-20',
    weeks: [{ ...week, allModels: { 'google/g-1': 100, 'google/g-2': 100 }, totalRaw: 250 }],
  };
  // Aligned week-for-week, so the quarter certifies and coverage is knowable.
  const providerSeries = { weeks: [{ ...week, providers: { google: 250 } }] };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname.includes('pricepertoken')) {
      const slug = u.searchParams.get('provider');
      return new Response(JSON.stringify({
        results: upstream[slug] || hist(slug + '-filler', [['2025-04-01', '2025-04-01', 1e-6]]),
      }), { status: 200 });
    }
    if (u.pathname === '/api/openrouter-chart-weekly') {
      return new Response(JSON.stringify(u.searchParams.has('providers') ? providerSeries : modelSeries), { status: 200 });
    }
    return new Response('null', { status: 404 });     // model-usage, live rankings
  };
  let d;
  try {
    const res = await providerMatrix({
      request: new Request('https://x.test/api/provider-pricing-matrix?metric=input&weight=usage'),
      env: {}, waitUntil() {},
    });
    d = await res.json();
  } finally { globalThis.fetch = realFetch; }

  const g = cellsOf(d, '2026-Q3').google;
  // g-1 at $1.00 and g-2 at $0.20 per 1M — the prices on 2026-Q3's measure —
  // carrying equal tokens. Blending the week's four pre-change days in gives
  // $0.943, a figure the source never reported on either measure.
  assert.equal(g.avg, 0.6);
  assert.equal(g.weightedModelCount, 2);
  assert.equal(g.coverageLabel, '80%');
  assert.equal(g.gate, null);
});
