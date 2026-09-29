/**
 * The dashboard must RENDER what the pricing endpoints now publish.
 *
 * provider-pricing-matrix.js and model-pricing-peer-matrix.js were changed to
 * compute measure-aware, like-for-like growth and — where no correct figure
 * can exist — to publish the REASON instead of nothing. Those reasons arrive
 * as ordinary extra keys. A renderer that reads only the number ignores them
 * silently: no error, no failing build, no missing import. The page simply
 * goes on collapsing four different situations onto one grey em dash — no
 * prior period, no rows at all, a weighted cell the coverage gate withheld,
 * and a comparison the server deliberately refused — while the Avg cell one
 * row up explains itself. That is the state this file exists to prevent.
 *
 * It is a source contract, not a render test: the three tables are React
 * components driven by useEffect + fetch, which renderToStaticMarkup does not
 * run, so there is no rendered output to assert against without a DOM and a
 * mocked network for each. What CAN be checked statically is exactly the
 * failure that shipped — a published field nothing reads — and it is checked
 * against the endpoint sources too, so a rename on the server breaks this test
 * rather than quietly leaving the dashboard reading a key that no longer
 * exists.
 *
 * Comments are stripped first so that prose ABOUT a field cannot stand in for
 * code that reads it; string literals are kept, because the provider matrix
 * builds its keys by concatenation (c[key + 'MeasureChanged']) and the names
 * live in the strings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Comments blanked, strings and JSX left alone.
 *
 * One left-to-right scan, not a pair of regex replaces: stripping comments
 * with a regex lets a `//` inside a string open a phantom line comment that
 * swallows the rest of the line, and the check then reports fields that are
 * plainly read.
 */
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
const PROVIDER_API = read('functions/api/provider-pricing-matrix.js');
const PEER_API = read('functions/api/model-pricing-peer-matrix.js');

/**
 * Per surface: the component, the endpoint it renders, and every annotation
 * the endpoint publishes for it. Each entry must appear on BOTH sides — the
 * endpoint that writes it and the component that reads it.
 */
const SURFACES = [
  {
    component: 'ModelPricingHistoryBlock',
    api: PROVIDER_API,
    apiName: 'provider-pricing-matrix.js',
    // The provider matrix keys these per view: qoq… / yoy…
    fields: ['MeasureChanged', 'TooFewMatched', 'MatchedModels', 'LineupModels',
      'LowMatchedShare', 'Linked', 'Estimated', 'Reason', 'Note',
      'basisExcludedObs', 'measureBreaks'],
  },
  {
    component: 'ModelPricingMatrixTable',
    api: PEER_API,
    apiName: 'model-pricing-peer-matrix.js',
    fields: ['measureChanged', 'listingChanged', 'linkedChange', 'priceBasis',
      'basisExcludedObs', 'setAsideModels', 'measureBreaks'],
  },
  {
    component: 'GoogleGeminiPricingTable',
    api: PEER_API,
    apiName: 'model-pricing-peer-matrix.js',
    fields: ['measureChanged', 'listingChanged', 'linkedChange', 'priceBasis',
      'basisExcludedObs', 'measureBreaks'],
  },
];

for (const s of SURFACES) {
  test(`${s.component} reads every annotation ${s.apiName} publishes for it`, () => {
    const body = REGIONS.get(s.component);
    assert.ok(body, s.component + ' is no longer a top-level function in js/dashboard.jsx');
    const unread = s.fields.filter(f => !body.includes(f));
    assert.deepEqual(unread, [],
      'These are published by ' + s.apiName + ' and never read by ' + s.component + '.\n' +
      'Each one is a figure withheld, or a figure resting on a restatement, that the\n' +
      'screen shows as a bare dash or an unqualified number with no reason given.');
    const notPublished = s.fields.filter(f => !s.api.includes(f));
    assert.deepEqual(notPublished, [],
      'These are read by ' + s.component + ' but no longer written by ' + s.apiName + ' —\n' +
      'the dashboard is reading a key that does not arrive, which renders as a silent dash.');
  });
}

test('no change cell renders a bare dash with nothing to hover', () => {
  // The shape this replaced, in all three tables: <td style={tdDim}>{fmtChange(v)}</td>.
  // fmtChange returns a grey em dash for null and the cell carried no title, so
  // a refusal, a missing comparator and an absent price were one pixel-identical
  // dash. Every change cell now decides between a named refusal, a linked number
  // and an explained dash, and every one of them carries its reason.
  const bare = [...DASH.matchAll(/style=\{tdDim\}>\s*\{fmtChange\(/g)];
  assert.equal(bare.length, 0,
    'A change cell still renders fmtChange() straight into a <td> with no title.\n' +
    'Four different situations print the same dash there and the reader cannot tell them apart.');
  for (const name of ['ModelPricingMatrixTable', 'GoogleGeminiPricingTable']) {
    assert.match(REGIONS.get(name), /explainedDash\(\)/,
      name + ' has no explained dash: a blank change cell there says nothing.');
  }
});

test('every marker on screen has its legend on the same screen', () => {
  // The lesson from ACP, where the caption was removed and the dagger kept:
  // a symbol whose key is missing is worse than no symbol at all. Any table
  // that prints a marker must render MeasureBreakCaption, which is the key.
  for (const [name, body] of REGIONS) {
    if (name === 'afterChangeMark' || name === 'linkedMark' || name === 'MeasureBreakCaption') continue;
    if (!/afterChangeMark\(\)|linkedMark\(\)/.test(body)) continue;
    assert.match(body, /<MeasureBreakCaption/,
      name + ' prints a measure-break marker but renders no legend for it.');
  }
  const caption = REGIONS.get('MeasureBreakCaption');
  assert.ok(caption, 'MeasureBreakCaption is gone while its markers are still drawn');
  assert.match(caption, /&dagger;/, 'the legend no longer explains the post-change price marker');
  assert.match(caption, /&Dagger;/, 'the legend no longer explains the linked-change marker');
});

test('the legend explains the halved price beside a flat percentage', () => {
  // The one thing a reader cannot reconcile unaided: across the change the
  // LEVEL is still what the source reports today, so a touched model shows a
  // halved dollar amount next to a roughly flat percentage. Correct, and it
  // reads as a bug unless the caption says so.
  const caption = REGIONS.get('MeasureBreakCaption');
  assert.match(caption, /halved/i);
  assert.match(caption, /flat percentage/i);
});

test('a low-match figure is shown, weakened, and states its own coverage', () => {
  // The server now publishes a change computed on under half the lineup rather
  // than withholding it, marked <key>LowMatchedShare with the counts. Showing
  // the number without the counts would overstate it; withholding it would be
  // the dash the owner asked not to see.
  const body = REGIONS.get('ModelPricingHistoryBlock');
  assert.match(body, /LowMatchedShare/);
  assert.match(body, /models like-for-like/,
    'the low-match sub-label no longer says "N of M models like-for-like"');
  assert.match(body, /weak/,
    'a figure resting on under half the lineup is no longer drawn back from a full-strength one');
});

/**
 * The shared helpers, actually rendered.
 *
 * The three tables cannot be rendered here — they are driven by useEffect +
 * fetch, which renderToStaticMarkup does not run — but the helpers they all
 * route through are ordinary pure functions at the top of the file, and those
 * CAN be. This lifts that one block out of js/dashboard.jsx into a temporary
 * module beside this test (inside the repo, so react resolves) and renders it,
 * so the markers and the legend are checked as output rather than as source.
 */
const HELPERS_FROM = 'const BREAK_AMBER=';
const HELPERS_TO = '\nfunction ModelPricingHistoryBlock(';

test('the markers and the legend render what they claim to', async () => {
  const { transformSync } = await import('esbuild');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const raw = read('js/dashboard.jsx');
  const from = raw.indexOf(HELPERS_FROM), to = raw.indexOf(HELPERS_TO);
  assert.ok(from > 0 && to > from, 'the shared annotation helpers block has moved or been renamed');
  const block = raw.slice(from, to) +
    '\nexport { measureChangedTag, listingChangedTag, tooFewModelsTag, explainedDash,' +
    ' afterChangeMark, linkedMark, afterChangeTitle, MeasureBreakCaption };\n';
  const js = transformSync(block, { loader: 'jsx', jsx: 'automatic' }).code;
  // Dot-prefixed so the suite's own `*.test.mjs` glob cannot pick it up.
  const tmp = join(ROOT, 'functions/api/__tests__/.dashboard-helpers.mjs');
  let mod;
  try {
    writeFileSync(tmp, js);
    mod = await import('file://' + tmp + '?v=' + Date.now());
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
  const { renderToStaticMarkup } = await import('react-dom/server');

  assert.match(renderToStaticMarkup(mod.measureChangedTag()), /measure.changed/);
  assert.match(renderToStaticMarkup(mod.listingChangedTag()), /listing.changed/);
  assert.match(renderToStaticMarkup(mod.tooFewModelsTag()), /too.few.models/);
  assert.match(renderToStaticMarkup(mod.afterChangeMark()), /†/);
  assert.match(renderToStaticMarkup(mod.linkedMark()), /‡/);
  assert.match(renderToStaticMarkup(mod.explainedDash()), /—/);

  // A level on the original measure carries no note; one reported after the
  // change says so, and says how many observations it left off the other side.
  assert.equal(mod.afterChangeTitle('origin', 0), null);
  assert.equal(mod.afterChangeTitle(null, 0), null);
  assert.match(mod.afterChangeTitle('2026-07-10', 4), /2026-07-10/);
  assert.match(mod.afterChangeTitle('2026-07-10', 4), /4 daily observations .* are left out/);

  // No detected change: no caption, and therefore no markers to explain.
  assert.equal(renderToStaticMarkup(mod.MeasureBreakCaption({ mb: null })), '');
  assert.equal(renderToStaticMarkup(mod.MeasureBreakCaption({ mb: { summary: null } })), '');

  // A detected change: the server's own words, both markers keyed, and the
  // halved-level / flat-percentage pair accounted for.
  const html = renderToStaticMarkup(mod.MeasureBreakCaption({
    mb: { summary: {
      headline: 'The source changed how it reports prices on 2026-07-10.',
      detail: 'On 2026-07-10 its figure for 13 Google and 10 OpenAI models fell to exactly half of the day before.',
    } },
  }));
  assert.match(html, /2026-07-10/);
  assert.match(html, /13 Google and 10 OpenAI models/);
  assert.match(html, /†/, 'the caption does not key the post-change price marker');
  assert.match(html, /‡/, 'the caption does not key the linked-change marker');
  assert.match(html, /halved dollar figure beside a roughly flat percentage/);
});
