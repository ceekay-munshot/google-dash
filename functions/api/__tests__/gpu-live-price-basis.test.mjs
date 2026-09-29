/**
 * The GPU panels must show the price that is in the API response.
 *
 * The bug these exist to prevent: on 2026-07-28 the upstream replaced its
 * per-vendor min-max range with a single median. Both endpoints carry that
 * median — the live listing in `medianPricePerHour`, the history endpoint in
 * the normalized `dailyPrice` / `dailyBasis` / `priceDeltaPct` fields — but the
 * dashboard kept reading the floor-era `minPricePerHour` / `maxPricePerHour` /
 * `minDeltaPct`, which are null on every row since that date. Every live KPI
 * card disappeared and every price cell rendered "—" while the correct figure
 * sat in the same HTTP response.
 *
 * js/dashboard.jsx is JSX and cannot be rendered here, so the pure helpers are
 * lifted out of the source and exercised, and the JSX that reads them is
 * guarded by reading the source — the same split gpu-resilience-parity uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = readFileSync(resolve(ROOT, 'js/dashboard.jsx'), 'utf8').replace(/\r\n/g, '\n');

/** The source of one top-level `function name(…){…}`, by brace matching. */
function fnSource(name) {
  const head = SRC.indexOf('\nfunction ' + name + '(');
  assert.ok(head >= 0, name + ' is gone from js/dashboard.jsx; move this guard with it');
  // The parameter list can itself be destructured, so walk past it before
  // brace matching the body.
  let k = SRC.indexOf('(', head), parens = 0;
  for (; k < SRC.length; k++) {
    if (SRC[k] === '(') parens++;
    else if (SRC[k] === ')' && --parens === 0) break;
  }
  let depth = 0;
  for (let j = SRC.indexOf('{', k); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(head + 1, j + 1);
  }
  throw new Error('unbalanced braces in ' + name);
}

/** A region of the source, so a guard cannot pass on a match somewhere else. */
function region(from, to) {
  const a = SRC.indexOf(from);
  assert.ok(a >= 0, 'anchor gone: ' + from);
  const b = SRC.indexOf(to, a);
  assert.ok(b > a, 'anchor gone: ' + to);
  return SRC.slice(a, b);
}

/** Comments say what the old fields were; only the code may not read them. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');
}

// The two pure helpers, run for real. Lifted lazily so a missing helper fails
// the tests that need it rather than the whole file.
let _live = null;
function live() {
  if (!_live) _live = new Function(fnSource('liveBasis') + fnSource('livePrice') +
    'return {liveBasis, livePrice};')();
  return _live;
}

// ── Real captured row shapes from /api/gpu-hardware-pricing-data ──────────
// era 1: legacy table row, "$min - $max" (2026-07-27, Nvidia H100)
const ERA1_ROW = { gpuModel: 'Nvidia H100', minPricePerHour: 0.3478, maxPricePerHour: 14.9, medianPricePerHour: null, providerCount: 48 };
// era 3: card layout, one median and no range (current)
const ERA3_ROW = { gpuModel: 'Nvidia H100', minPricePerHour: null, maxPricePerHour: null, medianPricePerHour: 3.3819, providerCount: 53 };
// a row the source lists without any price at all
const UNPRICED_ROW = { gpuModel: 'Nvidia RTX 5090', minPricePerHour: null, maxPricePerHour: null, medianPricePerHour: null, providerCount: 4 };

/* ─── (A) the live listing's own measure ───────────────────────────────── */

test('a median-only row resolves to the median, not to nothing', () => {
  assert.equal(live().liveBasis(ERA3_ROW), 'median');
  assert.equal(live().livePrice(ERA3_ROW), 3.3819);
});

test('a legacy range row still resolves to its floor', () => {
  assert.equal(live().liveBasis(ERA1_ROW), 'floor');
  assert.equal(live().livePrice(ERA1_ROW), 0.3478);
});

test('a row with no price anywhere resolves to nothing, and is not invented', () => {
  assert.equal(live().liveBasis(UNPRICED_ROW), null);
  assert.equal(live().livePrice(UNPRICED_ROW), null);
  assert.equal(live().liveBasis(undefined), null);
  assert.equal(live().livePrice(undefined), null);
});

test('the median wins over a floor when a row somehow carries both', () => {
  // Never conflate the two: the median is what the source publishes now.
  assert.equal(live().liveBasis({ ...ERA1_ROW, medianPricePerHour: 3.3819 }), 'median');
});

/* ─── (A) the cards and the comparison table read it ───────────────────── */

const INFRA = region('function GPUInfraMonitoringSubtab(', '\nconst gpuTh=');

test('a live KPI card survives a SKU that only has a median', () => {
  const c = code(INFRA);
  assert.doesNotMatch(c, /r\.minPricePerHour==null/, 'the cards still drop every SKU without a floor');
  // This once asserted the `return null` that DELETED an unpriced card. That
  // line was the narrower form of the same bug: the card survived a
  // median-only SKU but vanished when neither field resolved. The intent —
  // a median-only SKU keeps its card and shows the median — is what is pinned.
  assert.doesNotMatch(c, /if\(!r\|\|livePrice\(r\)==null\)return null;/,
    'an unpriced SKU is deleted from the grid again');
  assert.match(c, /value:fmtUSD\(livePrice\(r\)\)/);
});

test('the card label names the measure instead of claiming "cheapest"', () => {
  assert.doesNotMatch(code(INFRA), /Live cheapest /, 'a median is still labelled the cheapest listing');
  assert.match(code(INFRA), /FIN_BASIS_SHORT\[liveBasis\(r\)\]\+" \$\/hr"/);
});

test('the comparison table prints the resolved price under a basis-named heading', () => {
  const c = code(INFRA);
  // The defect was a MEDIAN printed under a heading that said "lowest" — a
  // wrong label on a real number. The ceiling column was never wrong; it is a
  // separate figure that the source simply stopped publishing. Removing it was
  // an overreach: the table's shape is not something an upstream change of
  // measure gets to decide, and a reader who knows a ceiling belonged there
  // should find it empty, not find it gone.
  assert.doesNotMatch(c, /Live&nbsp;lowest&nbsp;\$\/hr/,
    'a median is still printed under a column headed "lowest"');
  assert.doesNotMatch(c, /fmtUSD\(r\.minPricePerHour\)/,
    'the headline price column still reads the floor-era field');
  assert.match(c, /Live&nbsp;highest&nbsp;\$\/hr/,
    'the ceiling column was dropped from the table instead of left empty');
  assert.match(c, /r\.maxPricePerHour==null/,
    'the ceiling cell does not distinguish "no range published" from "no data"');
  assert.match(c, /const tableBasisHeading="Live "\+\(tableBasis\?FIN_BASIS_SHORT\[tableBasis\]\+" ":""\)\+"\$\/hr";/);
  assert.match(c, /\{tableBasisHeading\}<\/th>/);
  assert.match(c, /\{fmtUSD\(livePrice\(r\)\)\}/);
});

/* ─── (D) the provider count is named for what it is ───────────────────── */

test('the provider card describes the widest single listing, not a total', () => {
  const c = code(INFRA);
  assert.doesNotMatch(c, /Providers tracked|across all SKUs/,
    'a per-SKU maximum is still labelled a total across SKUs');
  assert.match(c, /label="Most providers on one GPU"/);
  assert.match(c, /sub=\{widest\?widest\.gpuModel\+" · not a total across GPUs":null\}/,
    'the card no longer names the SKU the count belongs to');
  assert.doesNotMatch(c, /across 42\+ providers/, 'the subtitle still asserts a provider total');
});

/* ─── (B) the daily history block ──────────────────────────────────────── */

const HIST = region('function GPUHistoryBlock(', '\nfunction DeltaCell(');

test('the daily history block reads the resolved headline, never the floor', () => {
  const c = code(HIST);
  assert.doesNotMatch(c, /minDeltaPct/, 'the delta cells still read the legacy floor delta');
  assert.doesNotMatch(c, /latestPt\?\.minPricePerHour|latestPt\.minPricePerHour/,
    'the latest-price cells still read minPricePerHour');
  assert.match(c, /const pct=c\.priceDeltaPct;/);
  assert.match(c, /latestPt\?\.dailyPrice!=null\?"\$"\+latestPt\.dailyPrice\.toFixed\(2\)/);
  assert.equal((c.match(/field="priceDeltaPct"/g) || []).length, 2, '7D and 30D both read priceDeltaPct');
});

test('the latest-price column is named from the basis the points carry', () => {
  const c = code(HIST);
  assert.doesNotMatch(c, /Latest&nbsp;min&nbsp;\$\/hr/, 'a median is still headed "Latest min $/hr"');
  assert.match(c, /const latestPriceHeading="Latest "\+\(latestBasis\?FIN_BASIS_SHORT\[latestBasis\]\+" ":""\)\+"\$\/hr";/);
  assert.match(c, /\{latestPriceHeading\}<\/th>/);
});

test('the signal sentence names the measure instead of saying "min"', () => {
  const c = code(HIST);
  assert.doesNotMatch(c, /parts\.push\("min /, 'a median move is still reported as a move in the min');
  assert.match(c, /\(FIN_BASIS_SHORT\[c\.priceBasis\]\|\|"price"\)/);
  assert.doesNotMatch(c, /loosening = more providers or lower floor/,
    'the table still explains loosening in terms of a floor the source no longer publishes');
});

test('the sparkline plots the headline price, on one measure only', () => {
  // The run selection now lives in latestBasisRun, which gpu-stale-and-runs
  // exercises for real rather than by regex. What stays here is the guard that
  // the DRAWING half never goes back to the floor-era field.
  const c = code(fnSource('Sparkline'));
  assert.doesNotMatch(c, /minPricePerHour/, 'the trend line still plots the floor-era field');
  assert.match(c, /const vals=latestBasisRun\(pts\)/);

  const run = code(fnSource('latestBasisRun'));
  assert.doesNotMatch(run, /minPricePerHour/);
  assert.match(run, /p=>p\.dailyPrice/);
  // Joining a ~$0.40 floor to a ~$3.39 median would draw a change of units as
  // a price move, so the run stops where the measure changes.
  assert.match(run, /p\.dailyBasis===basis/);
  // The seed must NOT be the newest point: an unpriced trailing capture then
  // blanks every drawable day behind it. It walks back to the newest point
  // that actually carries a basis.
  assert.doesNotMatch(run, /const basis=pts\[pts\.length-1\]\.dailyBasis;/,
    'the seed is back on the last point — one priceless day will blank the line');
  assert.match(run, /while\(end>=0&&!pts\[end\]\.dailyBasis\)end--;/);
});

/* ─── (C) the spread is refused in words, never faked ──────────────────── */

test('the spread cell states why it is empty instead of printing a dash', () => {
  const c = code(HIST);
  assert.match(c, /const spreadBlank="no range published"\+\(rangeEndedOn\?" since "\+monthIdToLabel/);
  assert.match(c, /:<span style=\{\{fontSize:10,color:"#9ca3af"\}\}>\{spreadBlank\}<\/span>\}/);
  const cell = c.slice(c.indexOf('latestPt?.spreadMultiple'));
  assert.doesNotMatch(cell.slice(0, 260), /:"—"/, 'the spread still falls back to a bare dash');
});

test('a spread is never synthesised from the single published figure', () => {
  const c = code(HIST);
  assert.doesNotMatch(c, /dailyPrice[^\n]*spread|spread[^\n]*dailyPrice/i,
    'a spread is being derived from the median');
});

/* ─── (E) the banners no longer blame the source for this file's bug ───── */

test('the feed-integrity banner does not name a field the dashboard stopped needing', () => {
  const banner = fnSource('GPUFeedIntegrityBanner');
  assert.doesNotMatch(banner, /minPricePerHour came back empty/,
    'the banner still tells the reader minPricePerHour is why the cells are blank');
  assert.match(banner, /no price in any field the parser reads/);
  // The era-2 remap note is about a real reclassification and stays.
  assert.match(banner, /landed with the price in maxPricePerHour/);
});

test('the unpriced-period badge says "no price", not "no minPricePerHour"', () => {
  assert.doesNotMatch(SRC, /returned no minPricePerHour/);
  assert.match(SRC, /was captured but the feed returned no price, so every price cell is blank\./);
});

/* ── A tracked SKU is never silently removed ──────────────────────────────
   Two versions of the same mistake shipped here. The first guarded the card on
   minPricePerHour and emptied all four when the source stopped publishing a
   range. The fix resolved the median correctly but still returned null — and
   so deleted the tile — when neither field resolved. The grid is auto-fit, so
   the gap closes: a reader looking at three cards has no way to know a fourth
   SKU is tracked at all. Against "no number should be missing since dashboard
   has all data", silently dropping the subject is the worst available answer.
   The card stays and says what is missing. */
test('a tracked SKU with no price keeps its card and states why', () => {
  const src = code(region('const kpiCards=', 'const widest='));
  assert.doesNotMatch(src, /if\(!r\|\|livePrice\(r\)==null\)return null;/,
    'an unpriced SKU is deleted from the grid again, taking any sign it is tracked with it');
  assert.match(src, /missing:true/, 'nothing marks the card as unpriced');
  assert.match(src, /no price in this listing/, 'the card does not say what is missing');
  assert.match(src, /not in this listing/, 'a SKU absent from the feed is not distinguished');
});

/* ── A restated growth figure must be marked, and the marker explained ────
   _gpu-price-basis.js compares two differently-measured periods on the basis
   they share, via the period that straddles the change. That is a real
   like-for-like number and it is shown — but it is not a headline-to-headline
   move, so it carries a ‡ and the server's note saying which days it rests on.

   Two ways this goes wrong, and both have happened in this codebase:
     - the number shows with no marker, reading as a plain comparison
     - the marker shows with no legend, leaving a symbol nobody can decode
   Both halves are pinned here, so removing either fails until both go. */
test('a restated growth cell is marked and the mark is explained', () => {
  const rows = code(fnSource('renderFinGrowthRows'));
  assert.match(rows, /notes/, 'renderFinGrowthRows no longer receives the notes the API publishes');
  assert.match(rows, /Dagger/, 'a restated figure renders with no marker distinguishing it');

  // The legend lives in the Methodology note under the table.
  assert.match(SRC, /Dagger;<\/sup> with its tooltip naming the days it rests on/,
    'the ‡ marker has no legend on screen');
});

test('the tooltip never claims a shared basis the two sides do not have', () => {
  // It read "both on the <cur> basis" from the CURRENT period alone, without
  // looking at the prior one — so a restated cell asserted a provenance that
  // was false. Saying nothing would have been better than saying that.
  const rows = code(fnSource('renderFinGrowthRows'));
  assert.match(rows, /sameBasis=curBasis&&priorBasis&&curBasis===priorBasis/,
    'the shared-basis claim is made without comparing both sides again');
  assert.doesNotMatch(rows, /\(curBasis\?" · both on the "/,
    'the unconditional "both on the X basis" claim is back');
});

test('the methodology note does not promise a refusal that no longer happens', () => {
  assert.doesNotMatch(SRC, /a cell spanning the change reads <span[^>]*>measure&nbsp;changed<\/span> rather than a fabricated percentage/,
    'the note still says every cell spanning the change is refused; linked cells now show a figure');
});
