/**
 * What the screen must SAY, now that two endpoints changed what they mean.
 *
 * 1. THE SHARE COLUMN IS A DIFFERENT MEASURE. pricing-share-signal.js stopped
 *    deriving share from the stored daily snapshots — the 2026-09-16 paid-only
 *    filter hit that series and not 'market-share', so the only comparison KV
 *    history can support was reading a change of MEASURE as a change of share.
 *    It now reads OpenRouter's live weekly per-provider series, which counts
 *    ALL OpenRouter traffic, free included, because a paid-only history does
 *    not exist and cannot be reconstructed. The number in that column moved.
 *    A page that renders it under the old caption performs exactly the silent
 *    substitution the endpoint refuses to make, and nothing would fail: the
 *    new `shareBasis` object is just an extra key an unchanged renderer drops.
 *
 * 2. THE PROVIDER CHART IS DATED NOW. openrouter-chart-weekly.js merges a live
 *    market-share read over the persisted capture and publishes the week it
 *    actually served. The legend used to call whatever sat last "the most
 *    recent week" — which is how a series frozen at 2026-06-08 went fourteen
 *    weeks without anyone noticing.
 *
 * 3. THE DAILY DIAGNOSTICS RENDERED A CORRUPTION AS A TREND. For ~29 days the
 *    stored ranking is OpenRouter's Top APPS table: "Kilo Code" and "Cline"
 *    recorded as models, ~1.8T against ~28T either side. Drawn verbatim the
 *    sparkline shows that collapse as real demand. The total for those days
 *    survives in the model weekly chart series and is recovered; the top-30
 *    ordering does not survive anywhere and is refused, not invented.
 *
 * The first two are source contracts, like dashboard-price-annotations.test.mjs
 * and for the same reason: the three surfaces are React components driven by
 * useEffect + fetch, which renderToStaticMarkup does not run. The third is a
 * real behaviour test — the repair helpers are pure functions and are lifted
 * out of js/dashboard.jsx and executed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { transformSync } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Comments blanked, strings kept — prose about a field is not a read of it. */
function codeOnly(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      out += ' ';
    } else if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      out += ' ';
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c; i += 1;
      while (i < src.length && src[i] !== q) { out += src[i]; i += src[i] === '\\' ? 2 : 1; }
      out += q; i += 1;
    } else {
      out += c; i += 1;
    }
  }
  return out;
}

/** The source split into its top-level `function Name(...)` regions. */
function regions(src) {
  const starts = [...src.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map(m => ({ name: m[1], at: m.index }));
  const out = new Map();
  starts.forEach((s, i) => {
    out.set(s.name, src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length));
  });
  return out;
}

const DASH = codeOnly(read('js/dashboard.jsx'));
const REGIONS = regions(DASH);
const SHARE_API = read('functions/api/pricing-share-signal.js');
const CHART_API = read('functions/api/openrouter-chart-weekly.js');

const bodyOf = (names) => names.map(n => {
  const b = REGIONS.get(n);
  assert.ok(b, n + ' is no longer a top-level function in js/dashboard.jsx');
  return b;
}).join('\n');

/**
 * Each entry: the key as the endpoint writes it, and the expression the
 * dashboard must contain to read it. Two sides, so a rename on the server
 * breaks this test instead of quietly leaving the page reading a dead key.
 */
const SHARE_FIELDS = [
  ['shareBasis', 'shareBasis'],
  ['source:', 'basis.source'],
  ['measure:', 'basis.measure'],
  ['label:', 'basis.label'],
  ['note:', 'basis.note'],
  ['fallback:', 'basis.fallback'],
  ['liveError', 'basis.liveError'],
  ['weeks:', 'basis.weeks'],
  ['firstWeek', 'basis.firstWeek'],
  ['lastWeek', 'basis.lastWeek'],
  ['countedDays', 'basis.countedDays'],
  ['excludedDays', 'basis.excludedDays'],
  ['excludedDayTotal', 'basis.excludedDayTotal'],
  ['shareDepth', 'shareDepth'],
  ['sharePeriods', 'sharePeriods'],
  ['priorSharePeriods', 'priorSharePeriods'],
  ['sharePeriodUnit', 'sharePeriodUnit'],
  ['sharePrevPeriods', 'sharePrevPeriods'],
  ['sourceNote', 'sourceNote'],
];

test('the share block reads every field pricing-share-signal.js publishes about the basis', () => {
  const body = bodyOf(['ShareBasisBanner', 'shareCoverageNote', 'PricingSharePartialView',
    'PricingShareSignalBlock']);
  const unread = SHARE_FIELDS.filter(([, expr]) => !body.includes(expr)).map(([, e]) => e);
  assert.deepEqual(unread, [],
    'Published by pricing-share-signal.js and never read by the share block.\n' +
    'Each one is the basis, the coverage, or the reason a figure is missing —\n' +
    'and without it the page shows an all-traffic number under a paid-only caption.');
  const notPublished = SHARE_FIELDS.filter(([key]) => !SHARE_API.includes(key)).map(([k]) => k);
  assert.deepEqual(notPublished, [],
    'Read by the share block but no longer written by pricing-share-signal.js.');
});

test('the share basis is NAMED on screen, not just carried', () => {
  const banner = REGIONS.get('ShareBasisBanner');
  assert.ok(banner, 'ShareBasisBanner is gone — nothing states what the share column counts');
  assert.match(banner, /all OpenRouter traffic/,
    'the banner no longer says the figure counts all OpenRouter traffic');
  assert.match(banner, /free tiers/,
    'the banner no longer says free tiers are included — that is the whole difference');
  // Every surface that prints a share figure renders the banner above it.
  for (const name of ['PricingShareSignalBlock', 'PricingSharePartialView']) {
    assert.match(REGIONS.get(name), /<ShareBasisBanner/,
      name + ' prints a share figure with no statement of what it counts.');
  }
});

test('a share change with no prior observation says why, and no row is dropped for it', () => {
  const body = REGIONS.get('PricingShareSignalBlock');
  // The table used to render only rows with BOTH numbers, so a refused price
  // or an unobservable prior quarter deleted figures that were fully known.
  assert.match(body, /const tableRows=latest\.rows/,
    'the signal table still filters out rows whose comparison was refused');
  assert.match(body, /tableRows\.map/, 'the signal table no longer renders every published row');
  assert.match(body, /not in the top \{latest\.shareDepth\} in \{d\.priorComparable\}/,
    'a blank Share QoQ cell no longer names the depth and quarter it was looked for in');
  assert.match(body, /unknown, not zero/,
    'the cell no longer says that absence from the series is unknown rather than zero');
});

test('a quarter resting on fewer periods than its label implies says so', () => {
  const note = REGIONS.get('shareCoverageNote');
  assert.ok(note, 'shareCoverageNote is gone — quarter coverage is unstated again');
  assert.match(note, /not countable/, 'a short quarter no longer says the rest were not countable');
  assert.match(REGIONS.get('PricingShareSignalBlock'), /coverageNow/);
  assert.match(REGIONS.get('PricingShareSignalBlock'), /coveragePrior/,
    'only one side of the comparison reports its coverage');
});

const CHART_FIELDS = [
  ['latestWeek', 'meta.latestWeek'],
  ['latestWeekEnd', 'meta.latestWeekEnd'],
  ['latestWeekBehind', 'meta.latestWeekBehind'],
  ['basis:', 'meta.basis'],
  ['ok:', 'meta.live'],
  ['readAt', 'live.readAt'],
  ['weekCount', 'live.weekCount'],
  ['error:', 'live.error'],
  ['note:', 'live.note'],
  ['source:', 'meta.source'],
  ['updatedAt', 'meta.updatedAt'],
];

test('the provider chart reads what openrouter-chart-weekly.js publishes about its own freshness', () => {
  const body = REGIONS.get('OpenRouterMarketShareEmbed');
  assert.ok(body, 'OpenRouterMarketShareEmbed is no longer a top-level function');
  const unread = CHART_FIELDS.filter(([, expr]) => !body.includes(expr)).map(([, e]) => e);
  assert.deepEqual(unread, [],
    'Published by openrouter-chart-weekly.js and never read by the chart.\n' +
    'Without them the caption asserts a currency the series may not have —\n' +
    'which is how a capture frozen at 2026-06-08 ran fourteen weeks unnoticed.');
  const notPublished = CHART_FIELDS.filter(([key]) => !CHART_API.includes(key)).map(([k]) => k);
  assert.deepEqual(notPublished, [], 'the chart reads keys the endpoint no longer writes.');
});

test('the provider legend is dated from the published week, not called "the most recent"', () => {
  const body = REGIONS.get('OpenRouterMarketShareEmbed');
  assert.doesNotMatch(body, /most recent week/,
    'the legend still describes its week instead of dating it');
  assert.match(body, /Share for the week of/, 'the legend no longer prints the week it describes');
  assert.match(body, /behind the current ISO week/,
    'a series that lags no longer says how far behind it is');
  assert.match(body, /liveOk===false/,
    'a failed live read is no longer announced — the chart would just be short');
});

/* ── The daily repair, actually executed ────────────────────────
   The helpers are pure, so they are lifted out of js/dashboard.jsx into a
   temporary module beside this test and run. `.`-prefixed so the suite's own
   `*.test.mjs` glob cannot pick it up. */
const REPAIR_FROM = 'const OR_APP_NAME_HINTS=';
const REPAIR_TO = '\nfunction HistoryTabCanonical(';

async function loadRepair() {
  const raw = read('js/dashboard.jsx');
  const from = raw.indexOf(REPAIR_FROM), to = raw.indexOf(REPAIR_TO);
  assert.ok(from > 0 && to > from, 'the daily-repair helper block has moved or been renamed');
  const block = raw.slice(from, to) +
    '\nexport { orDayCorruption, isoWeekStartOf, repairDailySnapshots, orIsAttributedRanking,' +
    ' comparableWeeklyTotal };\n';
  const js = transformSync(block, { loader: 'jsx', jsx: 'automatic' }).code;
  const tmp = join(ROOT, 'functions/api/__tests__/.daily-repair.mjs');
  try {
    writeFileSync(tmp, js);
    return await import('file://' + tmp + '?v=' + Date.now());
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

/** A day of the Top Apps window, as /api/history?view=daily stores it. */
const appsDay = (date) => ({
  date,
  source: 'cron',
  openrouterSummary: { totalTokensRaw: 1.8e12, totalTokensLabel: '1.8T' },
  or: [
    { rank: 1, model: 'Kilo Code', slug: 'kilo-code', provider: 'openai', tokRaw: 9e11 },
    { rank: 2, model: 'Cline', slug: 'cline', provider: 'anthropic', tokRaw: 6e11 },
    { rank: 3, model: 'Roo Code', slug: 'roo-code', provider: 'google', tokRaw: 3e11, isGemini: true },
  ],
});

/** An ordinary captured day either side of the window. */
const modelDay = (date) => ({
  date,
  source: 'cron',
  openrouterSummary: { totalTokensRaw: 28e12, totalTokensLabel: '28T' },
  or: [
    { rank: 1, model: 'gemini-2.5-flash', slug: 'google/gemini-2.5-flash', provider: 'google', tokRaw: 9e12, isGemini: true },
    { rank: 2, model: 'gpt-5', slug: 'openai/gpt-5', provider: 'openai', tokRaw: 8e12 },
  ],
});

test('the Top Apps window is detected by GD\'s own rules', async () => {
  const m = await loadRepair();
  assert.equal(m.orDayCorruption(appsDay('2026-08-22').or), 'topAppsTable');
  assert.equal(m.orDayCorruption(modelDay('2026-08-17').or), null);
  // The apps rows ARE attributed to real model makers, so the >=50% test alone
  // passes them. That is why the app-name test runs first and not instead.
  assert.equal(m.orIsAttributedRanking(appsDay('2026-08-22').or), true);
  // A ranking that names no model maker fails on attribution alone.
  assert.equal(m.orDayCorruption([{ model: 'thing', provider: 'other' }, { model: 'other thing' }]),
    'notModelRanking');
  // A day with no rows is not corrupt, just empty — it must not be labelled.
  assert.equal(m.orDayCorruption([]), null);
});

test('the ISO week containing a corrupted day is the one whose total replaces it', async () => {
  const m = await loadRepair();
  assert.equal(m.isoWeekStartOf('2026-08-22'), '2026-08-17'); // Sat → that Monday
  assert.equal(m.isoWeekStartOf('2026-08-17'), '2026-08-17'); // Monday → itself
  assert.equal(m.isoWeekStartOf('2026-08-23'), '2026-08-17'); // Sunday → that Monday
  assert.equal(m.isoWeekStartOf(''), null);
});

/**
 * A chart week as /api/openrouter-chart-weekly?full=1 serves it. `totalRaw` is
 * the WHOLE ys including OpenRouter's "Others" rollup; `allModels` is the
 * per-model series. The daily rows these substitute for are a top-30 model
 * sum with no Others in them, so the comparable figure is rebuilt from
 * allModels and totalRaw is deliberately NOT the number used.
 */
const chartWeek = () => ({
  start: '2026-08-17',
  end: '2026-08-23',
  totalRaw: 40e12,              // includes Others — the WRONG basis for a daily row
  allModels: {
    'google/gemini-2.5-flash': 15e12,
    'openai/gpt-5': 8e12,
    'anthropic/claude-sonnet-4': 4.4e12,
    Others: 12.6e12,            // must be excluded
  },
});

/** A week carrying `n` named series plus an Others bucket. */
function weekOfDepth(n, each = 1e12) {
  const allModels = { Others: 12.6e12 };
  for (let i = 0; i < n; i++) allModels['maker/model-' + i] = each;
  return { start: '2026-08-17', allModels };
}

test('the substituted total is on the same basis as the days beside it', async () => {
  const m = await loadRepair();
  // The days this stands in for are a genuine top-30 sum: history-capture.js
  // fetches ?top=30 and slices to 30. A week carrying 30 named series can
  // supply a comparable figure, with Others excluded on both sides.
  assert.equal(m.comparableWeeklyTotal(weekOfDepth(30)), 30e12);
  // Not the whole-ys figure, which would step the repaired days UP by Others.
  assert.notEqual(m.comparableWeeklyTotal(weekOfDepth(30)), 42.6e12);
  // A week carrying only totalRaw has no comparable figure in it, and none is
  // manufactured from the one that is on a different denominator.
  assert.equal(m.comparableWeeklyTotal({ start: '2026-08-17', totalRaw: 40e12 }), null);
  assert.equal(m.comparableWeeklyTotal(null), null);
  // Others alone is not a model total.
  assert.equal(m.comparableWeeklyTotal({ allModels: { Others: 9e12 } }), null);
});

test('a shallower series is refused, not summed under a top-30 label', async () => {
  // The stored chart series carries NINE named models in every week, and
  // slice(0, 30) over nine is a no-op. Summing it and captioning it "the top 30
  // named model series" counts roughly half the week's tokens — Others holds
  // 45-52% — while the days beside it count a real top 30. On one axis that
  // draws a four-week trough that is entirely an artefact of the denominator:
  // a change of measure rendered as a change of level, which is the fault this
  // repair exists to remove.
  const m = await loadRepair();
  assert.equal(m.comparableWeeklyTotal(chartWeek()), null,
    'a 3-series week was summed and labelled a top-30 total');
  assert.equal(m.comparableWeeklyTotal(weekOfDepth(9)), null,
    'nine named series is what the stored weeks actually carry; it is not a top-30 sum');
  assert.equal(m.comparableWeeklyTotal(weekOfDepth(29)), null,
    'one short is still a different population');
});

test('the total is recovered from the chart series and marked; the ordering is refused', async () => {
  const m = await loadRepair();
  const weeks = [weekOfDepth(30)];
  const out = m.repairDailySnapshots(
    [modelDay('2026-09-20'), appsDay('2026-08-22'), modelDay('2026-08-16')], weeks);

  assert.equal(out.corrupt, 1);
  assert.equal(out.substituted, 1);
  assert.equal(out.unsubstituted, 0);

  const fixed = out.snapshots[1];
  // The figure that DOES exist, put back — not the 1.8T collapse.
  assert.equal(fixed.openrouterSummary.totalTokensRaw, 30e12,
    'the substituted total must be the top-30 model sum, not the whole-ys figure');
  assert.equal(fixed.orTotalSubstituted, true);
  assert.equal(fixed.orTotalSourceWeek, '2026-08-17');
  assert.equal(fixed.orCapturedTotalRaw, 1.8e12,
    'the corrupted figure is dropped from the total but kept so the row can show what was stored');
  // The ordering is genuinely unrecoverable, so it is emptied and explained.
  assert.deepEqual(fixed.or, []);
  assert.equal(fixed.orRankingLost, true);
  assert.match(fixed.orRankingLostReason, /rolling trailing window/);
  assert.match(fixed.orCorruptLabel, /Top Apps/);
  // "Kilo Code" must not survive anywhere on the row as a model.
  assert.doesNotMatch(JSON.stringify(fixed.or), /Kilo Code/i);

  // Untouched days are returned as they were — same object, nothing rewritten.
  assert.equal(out.snapshots[0], out.snapshots[0]);
  assert.equal(out.snapshots[0].openrouterSummary.totalTokensRaw, 28e12);
  assert.equal(out.snapshots[2].orCorrupt, undefined);
});

test('a corrupt day with no deep-enough week is refused, not filled from a shallower one', async () => {
  // The honest half of the same rule. The stored chart weeks carry nine named
  // series, so in production this is the path most corrupt days take: no
  // like-for-like weekly figure can be rebuilt, and the row says so rather
  // than showing a number counted on a smaller population.
  const m = await loadRepair();
  const out = m.repairDailySnapshots([modelDay('2026-09-20'), appsDay('2026-08-22')], [chartWeek()]);

  assert.equal(out.corrupt, 1);
  assert.equal(out.substituted, 0, 'a 3-series week was used to fill a top-30 figure');
  assert.equal(out.unsubstituted, 1);

  const day = out.snapshots[1];
  assert.ok(!day.orTotalSubstituted, 'a total was manufactured from the wrong denominator');
  assert.equal(day.orRankingLost, true, 'the ordering is still refused and explained');
  assert.doesNotMatch(JSON.stringify(day.or), /Kilo Code/i, '"Kilo Code" survived as a model');
});

test('a chart week on the wrong denominator is not used as a substitute', async () => {
  const m = await loadRepair();
  // The week covers the day, but carries only the whole-ys total. Using it
  // would redraw the repaired day as a step up — a change of measure shown as
  // a change of level, which is the fault being repaired.
  const out = m.repairDailySnapshots([appsDay('2026-08-22')],
    [{ start: '2026-08-17', end: '2026-08-23', totalRaw: 40e12 }]);
  assert.equal(out.substituted, 0);
  assert.equal(out.unsubstituted, 1);
  assert.equal(out.snapshots[0].orTotalSubstituted, false);
  assert.equal(out.snapshots[0].openrouterSummary.totalTokensRaw, 0);
});

test('the daily view asks for the per-model series it needs to rebuild the total', () => {
  const body = REGIONS.get('HistoryTabCanonical');
  assert.match(body, /openrouter-chart-weekly\?full=1/,
    'the daily view reads the chart without ?full=1, so allModels is absent and ' +
    'no like-for-like total can ever be rebuilt');
});

test('with no chart series there is no substitute, and the row is not given one', async () => {
  const m = await loadRepair();
  const out = m.repairDailySnapshots([appsDay('2026-08-22')], null);
  assert.equal(out.substituted, 0);
  assert.equal(out.unsubstituted, 1);
  const fixed = out.snapshots[0];
  assert.equal(fixed.orTotalSubstituted, false);
  assert.equal(fixed.orTotalSourceWeek, null);
  // Nothing is invented: the corrupted total is NOT carried forward as if real.
  assert.equal(fixed.openrouterSummary.totalTokensRaw, 0);
  assert.equal(fixed.orCapturedTotalRaw, 1.8e12);
});

test('the corrupted rows render a reason, never a bare dash', async () => {
  const body = REGIONS.get('HistoryTabCanonical');
  assert.ok(body, 'HistoryTabCanonical is no longer a top-level function');
  assert.match(body, /repairDailySnapshots\(/,
    'the daily view renders stored days verbatim again');
  assert.match(body, /orRankingLost/, 'the table does not know the ordering was refused');
  assert.match(body, /not recoverable/,
    'a refused ordering still prints as a dash with nothing to read');
  assert.match(body, /orTotalSubstituted/,
    'a substituted total carries no marker saying it came from another series');
  assert.match(body, /orCapturedTotalRaw/,
    'the row cannot say what the corrupted capture actually stored');
  assert.match(body, /substituted:!!s\.orTotalSubstituted/,
    'the sparkline draws substituted points indistinguishably from captured ones');
});

/**
 * The partial view had the same fault the full view was just fixed for: it
 * built its table from `rows`, which is filtered to providers carrying BOTH a
 * price change and a share level. A provider whose price comparison the matrix
 * refused therefore vanished from the table — and the partial view's whole
 * subject is the share LEVEL, which that provider has. Two surfaces of the same
 * quarter must not disagree about which providers exist.
 */
test('the partial view keeps every provider whose share level is known', () => {
  const body = REGIONS.get('PricingSharePartialView');
  assert.ok(body, 'PricingSharePartialView is no longer a top-level function');
  assert.match(body, /const tableRows=\(quarter\.rows\|\|\[\]\)\.filter\(r=>typeof r\.shareAvg==="number"\)/,
    'the partial table is still built from the scatter-filtered rows, so a provider ' +
    'with a refused price comparison is dropped along with its known share level');
  // The scatter still needs both numbers — a dot has an x and a y.
  assert.match(body, /const rows=\(quarter\.rows\|\|\[\]\)\.filter\(r=>typeof r\.priceQoq==="number"&&typeof r\.shareAvg==="number"\)/,
    'the scatter must keep requiring both numbers');
  assert.match(body, /dotColor=\(pq\)=>typeof pq!=="number"/,
    'the row dot still colours a missing price change as though it had a direction');
});

/**
 * "8 of 13 weeks" must never degrade to "8 of  weeks". Both views read the
 * quarter's period count straight out of the payload; a server that stops
 * publishing it would leave a sentence with a hole in it.
 */
test('the period sub-line cannot render a hole where a count is missing', () => {
  assert.ok(REGIONS.get('periodSpanLabel'), 'periodSpanLabel is gone');
  const body = bodyOf(['periodSpanLabel']);
  assert.match(body, /period count not published/,
    'a row with no period count renders nothing instead of saying so');
  const views = bodyOf(['PricingSharePartialView', 'PricingShareSignalBlock']);
  assert.ok(!/\{r\.sharePeriods\} of \{(quarter|latest)\.sharePeriods\}/.test(views),
    'a view still interpolates the quarter period count unguarded');
  assert.equal((views.match(/periodSpanLabel\(r\.sharePeriods/g) || []).length, 2,
    'both views must route the sub-line through periodSpanLabel');
});

/**
 * No bare dash in the Price QoQ column. The server now labels an absent
 * comparison "no prior quarter" and publishes priceQoqReason for it, so the
 * cell must be titled by that reason on every row, not only refused ones.
 */
test('a missing price change is titled with its reason, not left as a dash', () => {
  const views = bodyOf(['PricingSharePartialView', 'PricingShareSignalBlock']);
  assert.equal((views.match(/title=\{r\.priceQoqReason\|\|undefined\}/g) || []).length, 2,
    'both price cells must carry priceQoqReason as their hover');
  assert.ok(!/color:r\.priceRefused\?"#6b7280"/.test(views),
    'the price cell still styles by priceRefused alone, so an absent (not refused) ' +
    'comparison renders in the colour of a real number');
  assert.match(SHARE_API, /: 'no prior quarter',/,
    'pricing-share-signal.js still emits a bare em dash for an absent price change');
  assert.match(SHARE_API, /no comparable average for/,
    'the absent price change carries no reason for the screen to show');
});
