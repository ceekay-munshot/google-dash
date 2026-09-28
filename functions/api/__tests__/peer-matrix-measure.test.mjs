import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as peerMatrix } from '../model-pricing-peer-matrix.js';

/* The 2026-07-10 change of measure, at the model level.

   On that day the source's figure for 13 Google and 10 OpenAI models fell to
   exactly half at once. No vendor repriced — the source changed which price
   it reports. Averaging a month that straddles it produced a July price no
   SKU was ever sold at (~9 days at $1.25 and ~22 at $0.625 ≈ $0.806) and a
   MoM of about -50%, and it ranked the frontier picker on that blend.

   Upstream prices are $/token; the matrix shows $/1M. Today is inside
   2026-Q3 / 2026-09, so both are in progress and never compared. */

const DAY = 86400000;
const days = (f, t) => { const o = []; for (let x = Date.parse(f + 'T00:00:00Z'); x <= Date.parse(t + 'T00:00:00Z'); x += DAY) o.push(new Date(x).toISOString().slice(0, 10)); return o; };
// spans: [[from, to, input $/1M, output $/1M], ...]
const hist = (model, spans) => spans.flatMap(([f, t, i, o]) => days(f, t).map(d => ({
  model, date: d + 'T00:00:00+00:00', pricing_prompt: i / 1e6, pricing_completion: o / 1e6,
})));

async function peer(upstream) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname.includes('pricepertoken')) return new Response(JSON.stringify({ results: upstream[u.searchParams.get('provider')] || [] }), { status: 200 });
    return new Response('null', { status: 404 });
  };
  try {
    const d = await (await peerMatrix({ request: new Request('https://x.test/api/model-pricing-peer-matrix'), env: {}, waitUntil() {} })).json();
    return { d, rep: key => d.reps.find(r => r.key === key) };
  } finally { globalThis.fetch = realFetch; }
}

const INTERNAL = /pricing_|original_|BASIS_|basisOf|tally|\/api\//;

/* Six Google models halve on 2026-07-10 — enough, and uniform enough, for the
   change to be found from the rows alone. Anthropic is untouched by it and
   cuts Opus genuinely, in half, on 2026-08-14. */
const HALVE = (m, hi, lo) => hist(m, [['2026-04-01', '2026-07-09', hi, hi * 8], ['2026-07-10', '2026-09-20', lo, lo * 8]]);
const UPSTREAM = {
  google: [
    ...HALVE('gemini-2.5-pro', 1.25, 0.625),
    ...HALVE('gemini-2.5-flash', 0.3, 0.15),
    ...HALVE('gemini-2.5-flash-lite', 0.1, 0.05),
    ...HALVE('gemini-3.1-pro-preview', 2, 1),
    ...HALVE('gemini-3-flash-preview', 0.5, 0.25),
    ...HALVE('gemini-pro-1.5', 1.25, 0.625),
  ],
  anthropic: [
    ...hist('claude-opus-4',   [['2026-04-01', '2026-08-13', 15, 75], ['2026-08-14', '2026-09-20', 7.5, 37.5]]),
    ...hist('claude-sonnet-4', [['2026-04-01', '2026-09-20', 3, 15]]),
  ],
};

test('a month straddling the change is priced on one measure, not blended across it', async () => {
  const { d, rep } = await peer(UPSTREAM);
  const r = rep('google-frontier-prev');
  // June and August are whole months on one measure either side of it.
  assert.equal(r.inputMonthly['2026-06'], 1.25);
  assert.equal(r.inputMonthly['2026-08'], 0.625);
  // July straddles it. The blend was $0.806 — a price Gemini 2.5 Pro never
  // carried. The 22 days on the new measure outnumber the 9 on the old, so
  // July is the new measure's $0.625 and says how many rows it left out.
  assert.equal(r.inputMonthly['2026-07'], 0.625);
  assert.equal(r.outputMonthly['2026-07'], 5);
  assert.equal(r.priceBasis.inputMonthly['2026-07'], '2026-07-10');
  assert.equal(r.basisExcludedObs.inputMonthly['2026-07'], 9);
  // Whole months on the original measure carry no annotation at all.
  assert.equal(r.priceBasis.inputMonthly['2026-06'], undefined);
  // And the quarter that straddles it, likewise.
  assert.equal(r.input['2026-Q3'], 0.625);
  assert.equal(r.priceBasis.input['2026-Q3'], '2026-07-10');
  assert.equal(d.measureBreaks.input[0].effectiveDate, '2026-07-10');
});

test('the change is linked across, not read as a 50% cut, and leaves no second false cut behind', async () => {
  const { rep } = await peer(UPSTREAM);
  const r = rep('google-frontier-prev');
  // Jun -> Jul read -50% on the raw levels, and Jul -> Aug a further -22%
  // off the blend. Linked at the change's exact factor, neither moved.
  assert.equal(r.momInput['2026-07'], 0);
  assert.equal(r.momOutput['2026-07'], 0);
  assert.equal(r.momInput['2026-08'], 0);
  assert.equal(r.measureChanged?.momInput?.['2026-07'], undefined, 'it can be linked, so it is not refused');
  const note = r.linkedChange.momInput['2026-07'];
  assert.match(note, /2026-07-10/);
  assert.match(note, /cut the figure it reports to exactly half: compared at twice the reported price/);
  assert.doesNotMatch(note, INTERNAL);
  // A month on one side of it still computes, and shows the price flat.
  assert.equal(r.momInput['2026-06'], 0);
});

test('a provider the change did not touch keeps its real cut', async () => {
  const { d, rep } = await peer(UPSTREAM);
  // The change is judged per provider: Anthropic halving one model the same
  // week is an ordinary repricing, and does not join it.
  assert.deepEqual(d.measureBreaks.input[0].providers, ['google']);
  const r = rep('anthropic-frontier');
  assert.deepEqual(r.chosenCandidateNorms, ['claudeopus4']);
  assert.equal(r.inputMonthly['2026-07'], 15, 'not touched by the 2026-07-10 change');
  assert.equal(r.momInput['2026-07'], 0);
  // 13 days at $15 and 18 at $7.50 — August is a genuine, partial-month cut.
  assert.ok(r.momInput['2026-08'] < 0, 'the real August cut is still reported');
  assert.equal(r.measureChanged, undefined);
  assert.equal(r.priceBasis, undefined, 'an untouched row carries no basis annotation');
});

test('the frontier picker ranks on one measure, so it names the model the period actually charged most for', async () => {
  // Priced from 2026-07-10 the source reports gemini-3.1-pro-preview at $1 and
  // gemini-2.5-pro at $0.625. Blended over July, 2.5 Pro reads $0.806 and 3.1
  // Pro $1.29 — but in a month with only 9 pre-change days the blend can and
  // does invert the order; here it is checked on the level itself.
  const { d } = await peer(UPSTREAM);
  const g = d.frontierReference.find(f => f.providerSlug === 'google');
  assert.equal(g.cellsMonthly['2026-07'].model, 'gemini-3.1-pro-preview');
  assert.equal(g.inputMonthly['2026-07'], 1, 'the frontier level is on one measure too, not the $1.29 blend');
  assert.equal(g.priceBasis.inputMonthly['2026-07'], '2026-07-10');
  assert.equal(g.momInput['2026-07'], 0, 'linked, not a 50% cut');
  assert.match(g.linkedChange.momInput['2026-07'], /exact factor of that change/);
});

test('the per-model history carries the same measure rule and the same annotations', async () => {
  const { d } = await peer(UPSTREAM);
  const m = d.googleModels.find(x => x.model === 'gemini-2.5-pro');
  assert.equal(m.inputMonthly['2026-07'], 0.625, 'not the $0.806 blend');
  assert.equal(m.priceBasis.inputMonthly['2026-07'], '2026-07-10');
  assert.equal(m.basisExcludedObs.inputMonthly['2026-07'], 9);
  assert.equal(m.momInput['2026-07'], 0);
  assert.match(m.linkedChange.momInput['2026-07'], /2026-07-10/);
});

test('the matrix says, in plain words, that the source changed what it reports', async () => {
  const { d } = await peer(UPSTREAM);
  const s = d.measureBreaks.summary;
  assert.match(s.headline, /The source changed how it reports prices on 2026-07-10\./);
  assert.match(s.detail, /6 Google models fell to exactly half/);
  assert.doesNotMatch(s.headline + ' ' + s.detail, INTERNAL);
  assert.equal(d.measureBreaks.output[0].effectiveDate, '2026-07-10', 'input and output are detected separately');
});

test('a year-ago comparator that existed but was refused is not reported as no comparator yet', async () => {
  // One row's worth of Google: the gen-3 Pro lineage hands over on 2026-01-01.
  // Every monthly YoY that has a year-ago month — Jul and Aug 2026 — compares
  // two different listings, so each is refused with its reason. The old flag
  // read "has a number", so it went false and the UI printed "No comparator
  // yet — upstream history starts …" on top of the refusal.
  const { d, rep } = await peer({ google: [
    ...hist('gemini-3-pro-preview',   [['2025-07-01', '2025-12-31', 2, 12]]),
    ...hist('gemini-3.1-pro-preview', [['2026-01-01', '2026-08-31', 2, 12]]),
  ] });
  const r = rep('google-frontier');
  assert.deepEqual(r.yoyInputMonthly, {}, 'no monthly YoY computes on this fixture');
  for (const mid of ['2026-07', '2026-08']) {
    assert.match(r.listingChanged.yoyInputMonthly[mid],
      /^Not comparable: the source lists this model as gemini-3\.1-pro-preview here and as gemini-3-pro-preview in Jul 2025\.|^Not comparable: the source lists this model as gemini-3\.1-pro-preview here and as gemini-3-pro-preview in Aug 2025\./);
    assert.doesNotMatch(r.listingChanged.yoyInputMonthly[mid], INTERNAL);
  }
  assert.equal(d.coverage.monthlyYoYAvailable, true, 'it had its year-ago month — it was refused, not missing');
});
