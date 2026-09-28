/**
 * A refused PRICE must not delete a known SHARE.
 *
 * The provider matrix now declines to compute a price change when the source
 * changed what it reports, or when too few models are priced in both quarters.
 * That is correct. What followed from it was not.
 *
 * The read-through filtered its callout pool on `typeof x.priceQoq === 'number'`
 * and ranked EVERY callout off that one pool — including "strongest share
 * gainer", which needs no price at all. So a provider whose price comparison
 * was refused vanished from the share callouts too, and a fully-known share
 * move disappeared from the page for a reason that had nothing to do with it.
 *
 * The row also fell through regimeFor()'s table to "Insufficient data". The
 * data was not insufficient: the matrix published exactly why it withheld the
 * figure. Saying "insufficient data" while holding the reason is the dash with
 * a wrong label on top.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../pricing-share-signal.js';

/** One quarter of matrix cells, with google's price change refused. */
const matrix = () => ({
  success: true,
  quarters: [
    {
      quarter: '2026-Q2',
      cells: [
        { slug: 'google', avg: 1.25, avgLabel: '$1.25', qoq: 0.02, modelCount: 12 },
        { slug: 'openai', avg: 2.5, avgLabel: '$2.50', qoq: 0.01, modelCount: 10 },
        { slug: 'anthropic', avg: 3.0, avgLabel: '$3.00', qoq: 0.0, modelCount: 8 },
      ],
    },
    {
      quarter: '2026-Q3',
      cells: [
        // Refused: the source changed how it reports this provider's prices.
        // qoq carries a number so the test proves the FLAG wins, not absence.
        { slug: 'google', avg: 0.625, avgLabel: '$0.63', qoq: -0.195,
          qoqMeasureChanged: true, qoqReason: 'The source halved its reported figure on 2026-07-10.',
          modelCount: 13 },
        { slug: 'openai', avg: 2.5, avgLabel: '$2.50', qoq: 0.0, modelCount: 10 },
        { slug: 'anthropic', avg: 3.0, avgLabel: '$3.00', qoq: 0.0, modelCount: 8 },
      ],
    },
  ],
});

/** Share rises sharply for google across the two quarters. */
const share = () => ({
  success: true,
  snapshots: [
    ...Array.from({ length: 40 }, (_, i) => ({
      date: '2026-05-' + String((i % 28) + 1).padStart(2, '0'),
      or: [
        { rank: 1, provider: 'google', tokRaw: 20 },
        { rank: 2, provider: 'openai', tokRaw: 50 },
        { rank: 3, provider: 'anthropic', tokRaw: 30 },
      ],
    })),
    ...Array.from({ length: 40 }, (_, i) => ({
      date: '2026-08-' + String((i % 28) + 1).padStart(2, '0'),
      or: [
        { rank: 1, provider: 'google', tokRaw: 45 },
        { rank: 2, provider: 'openai', tokRaw: 30 },
        { rank: 3, provider: 'anthropic', tokRaw: 25 },
      ],
    })),
  ],
});

async function run() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('provider-pricing-matrix')) return new Response(JSON.stringify(matrix()), { status: 200 });
    if (u.includes('history')) return new Response(JSON.stringify(share()), { status: 200 });
    return new Response('null', { status: 404 });
  };
  try {
    const res = await onRequestGet({
      request: new Request('https://x.test/api/pricing-share-signal'),
      env: {},
    });
    return await res.json();
  } finally { globalThis.fetch = realFetch; }
}

test('a refused price change is not read as a number', async () => {
  const d = await run();
  const q = (d.quarters || []).find(x => x.quarter === '2026-Q3');
  assert.ok(q, 'expected a 2026-Q3 row set');
  const g = q.rows.find(r => r.slug === 'google');
  assert.ok(g, 'google missing from the rows');

  assert.equal(g.priceQoq, null, 'the refused -19.5% was read as a real price move');
  assert.equal(g.priceRefused, true);
  assert.equal(g.priceRefusedKind, 'measure_changed');
});

test('the refusal is stated in words, not as "Insufficient data"', async () => {
  const d = await run();
  const g = d.quarters.find(x => x.quarter === '2026-Q3').rows.find(r => r.slug === 'google');

  assert.notEqual(g.regimeLabel, 'Insufficient data',
    'the reason was published by the matrix and thrown away here');
  assert.match(g.regimeLabel, /measure changed/i);
  assert.equal(g.priceQoqLabel, 'measure changed', 'a bare dash says nothing');
  assert.ok(g.priceQoqReason && g.priceQoqReason.length > 10,
    'the matrix\'s own reason must reach the row');
});

test('a known share gain survives a refused price', async () => {
  // The whole point: google\'s share move is fully observed. Dropping it from
  // the share callout because its PRICE could not be compared discards a
  // correct number for an unrelated reason.
  const d = await run();
  const gainer = (d.callouts || []).find(c => c.kind === 'strongest_share_gain');

  assert.ok(gainer, 'the strongest share gainer callout disappeared entirely');
  assert.equal(gainer.slug, 'google',
    'google had the largest share gain but was dropped because its price was refused');
});

test('price-vs-share callouts still exclude the refused provider', async () => {
  // The converse must hold: a callout that READS price against share may not
  // include a provider whose price change does not exist.
  const d = await run();
  for (const c of d.callouts || []) {
    if (c.kind === 'biggest_price_cut' || c.kind === 'weak_conversion') {
      assert.notEqual(c.slug, 'google',
        c.kind + ' used a price change the matrix refused to compute');
    }
  }
});
