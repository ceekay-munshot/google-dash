/**
 * The share half of the read-through: which series it stands on, which stored
 * days it refuses, and how deep it reads.
 *
 * Three faults, all of which produced a number on screen that was wrong rather
 * than missing:
 *
 *   1. Share came from the stored daily snapshots. Those were filtered to paid
 *      traffic on 2026-09-16, and KV history starts 2026-04-21 — so the only
 *      comparison they can support, 2026-Q3 against 2026-Q2, is exactly the one
 *      that straddles the break. The weekly market-share dataset the filter
 *      never touched is one measure across 52 weeks, and it was already
 *      imported elsewhere in this codebase.
 *   2. From 2026-08-18 to 09-15 the stored ranking holds OpenRouter's Top APPS
 *      table — "Kilo Code", "Cline" — and gap-detection re-dates one capture
 *      across up to 90 days. Both were averaged in as ordinary observations.
 *   3. Every day's share was divided by its own row total, so a 10-row day and
 *      a 30-row day were two different measures added together.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../pricing-share-signal.js';

const CELLS = (qoq) => [
  { slug: 'google', avg: 1.25, avgLabel: '$1.25', qoq, modelCount: 12 },
  { slug: 'openai', avg: 2.5, avgLabel: '$2.50', qoq: 0.0, modelCount: 10 },
  { slug: 'anthropic', avg: 3.0, avgLabel: '$3.00', qoq: 0.0, modelCount: 8 },
];

const matrix = (quarters = ['2026-Q2', '2026-Q3']) => ({
  success: true,
  quarters: quarters.map(q => ({ quarter: q, cells: CELLS(-0.05) })),
});

/** Weekly market-share points: google 10% of all traffic in Q2, 30% in Q3. */
const WEEKS = [
  ...['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27', '2026-05-04', '2026-05-11']
    .map(x => ({ x, ys: { google: 10, openai: 50, anthropic: 30, others: 10 } })),
  ...['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10']
    .map(x => ({ x, ys: { google: 30, openai: 40, anthropic: 20, others: 10 } })),
];

/** A day of stored rankings — google at 60% of the listed tokens, throughout. */
const day = (date, extra = {}) => ({
  date,
  source: 'cron',
  or: [
    { rank: 1, model: 'gemini-2.5-pro', provider: 'google', tokRaw: 60 },
    { rank: 2, model: 'gpt-5', provider: 'openai', tokRaw: 25 },
    { rank: 3, model: 'claude-sonnet-4', provider: 'anthropic', tokRaw: 15 },
  ],
  ...extra,
});

/**
 * A day from the Top Apps window. The rows are ATTRIBUTED to real model makers
 * — that is what the window actually stored, one app of which was filed under
 * deepseek — so the >=50% attribution test passes them. Only the app-name test
 * catches these, which is why both run.
 */
const appsDay = (date) => ({
  date,
  source: 'cron',
  or: [
    { rank: 1, model: 'Kilo Code', provider: 'google', tokRaw: 900 },
    { rank: 2, model: 'Cline', provider: 'openai', tokRaw: 70 },
    { rank: 3, model: 'Roo Code', provider: 'anthropic', tokRaw: 30 },
  ],
});

const history = (snapshots) => ({ success: true, snapshots });

async function run({ quarters, snapshots, weeks }) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('rankings/market-share')) {
      return weeks
        ? new Response(JSON.stringify({ data: weeks }), { status: 200 })
        : new Response('upstream down', { status: 500 });
    }
    if (u.includes('provider-pricing-matrix')) {
      return new Response(JSON.stringify(matrix(quarters)), { status: 200 });
    }
    if (u.includes('history')) {
      return new Response(JSON.stringify(history(snapshots)), { status: 200 });
    }
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

const days = (from, n, make = day) =>
  Array.from({ length: n }, (_, i) => make(from.slice(0, 8) + String(+from.slice(8) + i).padStart(2, '0')));

const googleIn = (d, quarter) =>
  (d.quarters.find(x => x.quarter === quarter) || { rows: [] }).rows.find(r => r.slug === 'google');

test('a quarter\'s share comes from the live weekly series, not the stored days', async () => {
  const d = await run({
    weeks: WEEKS,
    snapshots: [...days('2026-05-01', 20), ...days('2026-08-01', 20)],
  });

  assert.equal(d.shareBasis.source, 'live-weekly',
    'share still came from the snapshots the 2026-09-16 filter broke');
  const g = googleIn(d, '2026-Q3');
  assert.ok(g, 'google missing from 2026-Q3');
  assert.ok(Math.abs(g.shareAvg - 30) < 0.01,
    'expected 30% of all weekly traffic, got ' + g.shareAvg);
  assert.ok(Math.abs(g.sharePrev - 10) < 0.01,
    'expected a 10% prior quarter from the weekly series, got ' + g.sharePrev);
  assert.ok(Math.abs(g.shareQoqPP - 20) < 0.02, 'got ' + g.shareQoqLabel);
  assert.equal(g.sharePeriods, 6, 'six weeks stand behind the 2026-Q3 figure');
});

test('the basis the share rests on is published, and named as all traffic', async () => {
  const d = await run({ weeks: WEEKS, snapshots: days('2026-05-01', 20) });

  assert.equal(d.shareBasis.measure, 'all-traffic');
  assert.match(d.shareBasis.label, /all OpenRouter traffic/i,
    'the screen cannot say what the number counts');
  assert.match(d.shareBasis.note, /free/i, 'free traffic is in the number and must be admitted');
  assert.equal(d.shareBasis.fallback, false);
  assert.equal(d.shareBasis.weeks, 12);
  assert.equal(d.shareBasis.firstWeek, '2026-04-06');
  assert.equal(d.shareBasis.lastWeek, '2026-08-10');
  assert.match(d.sourceNote, /weekly market-share/i);
});

test('a failed live fetch falls back to the stored series and says so', async () => {
  const d = await run({
    weeks: null, // upstream 500
    snapshots: [...days('2026-05-01', 20), ...days('2026-08-01', 20)],
  });

  assert.equal(d.shareBasis.source, 'stored-daily');
  assert.equal(d.shareBasis.fallback, true, 'a fallback that does not announce itself is a lie');
  assert.ok(d.shareBasis.liveError && d.shareBasis.liveError.length > 3,
    'the reason the live read failed was swallowed');
  assert.match(d.shareBasis.note, /2026-09-16/,
    'the fallback series has a measure break and must say so');

  // And it is really the stored number, not a blend of the two.
  const g = googleIn(d, '2026-Q3');
  assert.ok(Math.abs(g.shareAvg - 60) < 0.01, 'expected the stored 60%, got ' + g.shareAvg);
});

test('a Top Apps day is excluded, and the reason is named', async () => {
  const d = await run({
    weeks: null,
    snapshots: [
      ...days('2026-05-01', 20),
      ...days('2026-08-01', 20),
      // The 2026-08-18 → 09-15 window, attributed to real makers.
      ...days('2026-08-21', 8, appsDay),
    ],
  });

  const apps = d.shareBasis.excludedDays.find(x => x.reason === 'topAppsTable');
  assert.ok(apps, 'the Top Apps days were counted as ordinary observations');
  assert.equal(apps.days, 8);
  assert.match(apps.label, /Top Apps/i, 'a bare count explains nothing');

  const g = googleIn(d, '2026-Q3');
  assert.ok(Math.abs(g.shareAvg - 60) < 0.01,
    'the Top Apps days moved the 2026-Q3 share to ' + g.shareAvg);
  assert.equal(d.shareBasis.countedDays, 40, 'only the 40 real days may count');
});

test('an autofill-gap day is not counted as an independent observation', async () => {
  const gapDay = (date) => ({
    date,
    source: 'autofill-gap',
    backfill: false,
    or: [
      { rank: 1, model: 'gemini-2.5-pro', provider: 'google', tokRaw: 90 },
      { rank: 2, model: 'gpt-5', provider: 'openai', tokRaw: 6 },
      { rank: 3, model: 'claude-sonnet-4', provider: 'anthropic', tokRaw: 4 },
    ],
  });

  const d = await run({
    weeks: null,
    snapshots: [
      ...days('2026-05-01', 5),
      // One capture re-dated across the rest of the month.
      ...days('2026-05-10', 20, gapDay),
      ...days('2026-08-01', 20),
    ],
  });

  const gaps = d.shareBasis.excludedDays.find(x => x.reason === 'autofillGap');
  assert.ok(gaps, 'the re-dated copies were averaged in as 20 separate days');
  assert.equal(gaps.days, 20);

  const g = googleIn(d, '2026-Q3');
  assert.ok(Math.abs(g.sharePrev - 60) < 0.01,
    'one capture voted twenty times: 2026-Q2 google reads ' + g.sharePrev + '% instead of 60%');
});

test('depth is decided per comparison, not once across the whole window', async () => {
  // 2026-Q1 lists three providers a day; Q2 and Q3 list eight. A single global
  // minimum would read every quarter to three — one short quarter narrowing the
  // measure for all of them.
  const wide = (date) => ({
    date,
    source: 'cron',
    or: [
      { rank: 1, model: 'gemini-2.5-pro', provider: 'google', tokRaw: 40 },
      { rank: 2, model: 'gpt-5', provider: 'openai', tokRaw: 25 },
      { rank: 3, model: 'claude-sonnet-4', provider: 'anthropic', tokRaw: 15 },
      { rank: 4, model: 'deepseek-v3', provider: 'deepseek', tokRaw: 8 },
      { rank: 5, model: 'mistral-large', provider: 'mistralai', tokRaw: 5 },
      { rank: 6, model: 'grok-4', provider: 'x-ai', tokRaw: 4 },
      { rank: 7, model: 'llama-4', provider: 'meta-llama', tokRaw: 2 },
      { rank: 8, model: 'command-r', provider: 'cohere', tokRaw: 1 },
    ],
  });

  const d = await run({
    quarters: ['2026-Q1', '2026-Q2', '2026-Q3'],
    weeks: null,
    snapshots: [
      ...days('2026-02-01', 10),          // three providers
      ...days('2026-05-01', 10, wide),    // eight
      ...days('2026-08-01', 10, wide),    // eight
    ],
  });

  const q2 = d.quarters.find(x => x.quarter === '2026-Q2');
  const q3 = d.quarters.find(x => x.quarter === '2026-Q3');
  assert.equal(q2.shareDepth, 3, '2026-Q2 vs 2026-Q1 can only be read three deep');
  assert.equal(q3.shareDepth, 8,
    '2026-Q3 vs 2026-Q2 was narrowed to ' + q3.shareDepth + ' by a quarter it is not compared against');
  assert.equal(q3.sharePeriodUnit, 'day');

  // Read eight deep, google is 40 of 100; read three deep it would be 50 of 80.
  assert.ok(Math.abs(googleIn(d, '2026-Q3').shareAvg - 40) < 0.01,
    'got ' + googleIn(d, '2026-Q3').shareAvg);
});
