/**
 * Two guards on the fixes that closed the review's critical finding.
 *
 * 1. A FALLBACK LISTING MUST NEVER BECOME AN OBSERVATION.
 *    /api/gpu-hardware-pricing-data serves the last good listing, marked
 *    `stale: true`, when the upstream is unreachable — so the screen shows
 *    slightly old prices instead of nothing. history-capture.js refuses that
 *    payload. The refresh endpoint keeps its OWN copy of normalizeGPU and its
 *    own write into the same day record, and it did not.
 *
 *    That gap was worse than a duplicated check: the refresh's dedup returns
 *    `skipped` whenever the day already holds a GPU block, so its write fires
 *    precisely when the day is EMPTY — which is exactly an outage day. Without
 *    the guard, a getdeploying 403 meant the main capture correctly stored
 *    `gpu: null` and the refresh then filled that date with yesterday's prices,
 *    permanently, labelled as a real capture. A visible blank replaced by an
 *    invisible wrong number in a store two dashboards read as ground truth.
 *
 * 2. ONE PRICELESS DAY MUST NOT ERASE A DRAWABLE RUN.
 *    The 60-day sparkline picks the trailing run of days sharing one measure.
 *    Seeding that basis from the newest point meant a single unpriced trailing
 *    capture blanked all 59 days behind it — the same class of blank the change
 *    set exists to remove, reintroduced one point later.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { onRequestGet as refreshGet } from '../gpu-hardware-pricing-history-refresh.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TODAY = new Date().toISOString().slice(0, 10);

function envFor(store) {
  return {
    HISTORY_KV: {
      async get(key, type) {
        assert.equal(type, 'json');
        return store.has(key) ? structuredClone(store.get(key)) : null;
      },
      async put(key, value) { store.set(key, JSON.parse(value)); },
    },
  };
}

async function refresh(store, payload) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(payload),
    { headers: { 'Content-Type': 'application/json' } });
  try {
    const res = await refreshGet({
      request: new Request('https://example.test/api/gpu-hardware-pricing-history-refresh'),
      env: envFor(store),
    });
    return { status: res.status, body: await res.json() };
  } finally { globalThis.fetch = realFetch; }
}

const listing = (extra = {}) => ({
  ok: true,
  fetchedAt: '2026-09-27T09:00:00.000Z',
  rows: [{
    gpuModel: 'Nvidia H100', vram: '80GB', category: 'flagship',
    minPricePerHour: null, maxPricePerHour: null,
    medianPricePerHour: 3.39, providerCount: 53,
  }],
  ...extra,
});

test('the refresh refuses a stale listing instead of writing it as today', async () => {
  const store = new Map();
  const { status } = await refresh(store, listing({ stale: true, staleReason: 'upstream_403' }));

  assert.equal(status, 502, 'a fallback listing is not something to persist');
  assert.equal(store.has('day:' + TODAY), false,
    'a cached listing was written into permanent history as an observation of today');
});

test('the refresh still writes a genuinely fresh listing', async () => {
  // The guard must refuse staleness, not refuse everything — otherwise it
  // "passes" by breaking the endpoint.
  const store = new Map();
  const { status, body } = await refresh(store, listing());
  assert.equal(status, 200);
  assert.equal(body.action, 'created-gpu-only');
  assert.equal(store.get('day:' + TODAY).gpu.models[0].medianPricePerHour, 3.39);
});

test('an outage day stays empty rather than gaining invented prices', async () => {
  // The exact sequence: main capture ran during a 403 and stored no gpu block,
  // then the refresh ran while the upstream was still down. This is the path
  // the dedup lets through, so it is the one that must hold.
  const store = new Map();
  store.set('day:' + TODAY, {
    ts: TODAY + 'T02:00:00.000Z', date: TODAY, source: 'cron', version: 4,
    or: [{ model: 'gpt-5' }], bots: [], trends: [], gpu: null,
  });
  await refresh(store, listing({ stale: true, staleReason: 'upstream_403' }));
  assert.equal(store.get('day:' + TODAY).gpu, null,
    'the empty day was backfilled with a cached listing and now reads as a real capture');
});

/* ── the sparkline run ────────────────────────────────────────────────── */

const SRC = readFileSync(resolve(ROOT, 'js/dashboard.jsx'), 'utf8').replace(/\r\n/g, '\n');

function fnSource(name) {
  const head = SRC.indexOf('\nfunction ' + name + '(');
  assert.ok(head >= 0, name + ' is gone from js/dashboard.jsx; move this guard with it');
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

const latestBasisRun = new Function(fnSource('latestBasisRun') + 'return latestBasisRun;')();

const day = (dailyPrice, dailyBasis) => ({ dailyPrice, dailyBasis });
const median = (n, from = 3.0) => Array.from({ length: n }, (_, i) => day(from + i * 0.01, 'median'));

test('a priceless newest capture does not blank the whole line', () => {
  const pts = [...median(60), day(null, null)];
  assert.equal(latestBasisRun(pts).length, 60,
    'one unpriced trailing day discarded 60 drawable days');
});

test('unpriced days inside the window do not end the run', () => {
  const pts = [...median(30), day(null, null), day(null, null), ...median(28, 3.4)];
  assert.equal(latestBasisRun(pts).length, 58);
});

test('a day on the other measure does end the run', () => {
  // Joining a ~$0.40 floor to a ~$3.39 median draws a change of units as a
  // price move. The run must stop at the boundary.
  const pts = [day(0.39, 'floor'), day(0.41, 'floor'), ...median(10)];
  const vals = latestBasisRun(pts);
  assert.equal(vals.length, 10);
  assert.ok(vals.every(v => v >= 3), 'a floor price leaked into a median run: ' + vals.join(','));
});

test('no basis anywhere yields nothing to draw, not a wrong line', () => {
  assert.deepEqual(latestBasisRun([day(null, null), day(null, null)]), []);
  assert.deepEqual(latestBasisRun([]), []);
});
