/**
 * What a failed GPU fetch is allowed to do to a day that already has one.
 *
 * The daily capture fetches /api/gpu-hardware-pricing-data, normalizes it, and
 * writes a FRESH snapshot object for the day. localFetch returns null on any
 * non-2xx and normalizeGPU(null) returns null, and nothing stopped that null
 * from being written: a 403 at the 21:31 cron erased the 09:07 observation for
 * that day, permanently, since no repair job rebuilds a stored day.
 *
 * The second half of the same problem is the live endpoint's last-good
 * fallback, which answers 200 with OLD prices when the source refuses. Right
 * for the screen, wrong for history — stored, it turns a visible blank into an
 * invisible wrong number that both dashboards read as ground truth. It carries
 * `stale: true` and normalizeGPU refuses it.
 *
 * The handler is driven against in-memory stand-ins for KV and for the
 * same-origin endpoints; no network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../history-capture.js';

const ORIGIN = 'https://example.test';
const TODAY = new Date().toISOString().slice(0, 10);

/* ── Stand-ins ────────────────────────────────────────────────────────── */

function kvStore() {
  const store = new Map();
  return {
    store,
    kv: {
      async get(key, type) {
        assert.equal(type, 'json');
        return store.has(key) ? structuredClone(store.get(key)) : null;
      },
      async put(key, value) {
        store.set(key, JSON.parse(value));
      },
    },
  };
}

// The smallest OpenRouter payload that clears the `if (!or.length)` guard.
// `n` varies the row count so two runs can differ in something other than GPU,
// which is what puts the capture on the write path rather than the skip path.
const orPayload = (n = 1) => ({
  success: true,
  models: Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    model: 'Model ' + (i + 1),
    provider: 'Google',
    tokens: 1.2e12,
    isGemini: true,
    wowPct: 3,
  })),
  summary: { totalTokensRaw: 1.2e12, totalTokensLabel: '1.2T' },
});

// The live median-era listing row: one median, no range.
const gpuRow = (median, providers) => ({
  gpuModel: 'Nvidia H100',
  vram: '80GB HBM3',
  category: 'Data Center',
  providerCount: providers,
  minPricePerHour: null,
  maxPricePerHour: null,
  medianPricePerHour: median,
});

const healthyGPU = (median = 3.36, providers = 54) => ({
  ok: true,
  sourceUrl: 'https://getdeploying.com/gpus',
  fetchedAt: '2026-09-28T09:07:00.000Z',
  rows: [gpuRow(median, providers)],
});

// What the live endpoint serves while getdeploying is refusing it: HTTP 200,
// ok:true, real-looking rows — and the staleness marker.
const staleGPU = (median = 3.36) => ({
  ...healthyGPU(median),
  stale: true,
  staleReason: 'upstream_403',
  servedAt: new Date().toISOString(),
});

/**
 * Run one capture. `gpu` is what /api/gpu-hardware-pricing-data answers: an
 * object (200) or null (non-2xx, which localFetch turns into null). `orRows`
 * varies the rest of the payload so a run can be forced onto the write path.
 */
async function capture(kv, gpu, orRows = 1) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/openrouter') return Response.json(orPayload(orRows));
    if (path === '/api/gpu-hardware-pricing-data') {
      return gpu ? Response.json(gpu) : new Response('refused', { status: 403 });
    }
    return new Response('not found', { status: 404 });
  };
  try {
    const res = await onRequestGet({
      request: new Request(ORIGIN + '/api/history-capture'),
      env: { HISTORY_KV: kv },
    });
    assert.equal(res.status, 200);
    return res.json();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const today = (store) => store.get('day:' + TODAY);

/* ── A bad minute must not erase a good day ───────────────────────────── */

test('a GPU fetch that fails does not erase the block already stored for the day', async () => {
  const { store, kv } = kvStore();

  await capture(kv, healthyGPU());
  const morning = today(store);
  assert.equal(morning.gpu.models[0].medianPricePerHour, 3.36);

  // The rest of the payload moved, so this run really does rewrite the day —
  // exactly the path that used to drop the GPU block on the floor.
  const evening = await capture(kv, null, 2);
  assert.equal(evening.results[0].action, 'superseded');
  assert.equal(evening.results[0].gpuCarriedForward, true);

  const stored = today(store);
  assert.equal(stored.gpu?.models?.length, 1, 'the good morning observation was overwritten with null');
  assert.equal(stored.gpu.models[0].medianPricePerHour, 3.36);
  assert.equal(stored.gpu.fetchedAt, morning.gpu.fetchedAt, 'the carried block must keep its own capture time');
  assert.equal(stored.or.length, 2, 'everything else in the snapshot is still this run\'s');
});

test('the rewritten day carries a hash computed from the block it actually stores', async () => {
  const { store, kv } = kvStore();
  await capture(kv, healthyGPU());
  const withGPU = today(store).hash;

  await capture(kv, null, 2);
  const carried = today(store).hash;
  assert.notEqual(carried, withGPU, 'the rest of the payload changed, so the hash must too');

  // Same run again: nothing has moved, so the day must now dedup against
  // itself rather than churn — which only holds if the stored hash describes
  // the carried block and not the null that was fetched.
  const again = await capture(kv, null, 2);
  assert.equal(again.results[0].action, 'skipped');
  assert.equal(again.results[0].gpuCarriedForward, true);
  assert.equal(today(store).gpu.models[0].medianPricePerHour, 3.36);
});

test('a day with no GPU block yet is still stored as a coverage miss', async () => {
  const { store, kv } = kvStore();
  const res = await capture(kv, null);
  assert.equal(today(store).gpu, null);
  assert.equal(res.results[0].gpuCarriedForward, false);
  assert.equal(res.sources.gpu, 'unavailable');
});

test('a GPU block that parsed to zero tracked SKUs does not erase a good one either', async () => {
  const { store, kv } = kvStore();
  await capture(kv, healthyGPU());

  // ok:true, rows present, but none of them a tracked SKU — normalizeGPU
  // returns a block with models: [], which is no observation at all.
  const empty = { ...healthyGPU(), rows: [{ ...gpuRow(1.1, 3), gpuModel: 'Nvidia T4' }] };
  const res = await capture(kv, empty, 2);
  assert.equal(res.results[0].gpuCarriedForward, true);
  assert.equal(today(store).gpu.models[0].medianPricePerHour, 3.36);
});

/* ── A healthy capture still wins ─────────────────────────────────────── */

test('a healthy GPU capture overwrites the stored block normally', async () => {
  const { store, kv } = kvStore();
  await capture(kv, healthyGPU(3.36, 54));

  const res = await capture(kv, healthyGPU(3.09, 57), 2);
  const stored = today(store);
  assert.equal(res.results[0].action, 'superseded');
  assert.equal(res.results[0].gpuCarriedForward, false);
  assert.equal(stored.gpu.models[0].medianPricePerHour, 3.09);
  assert.equal(stored.gpu.models[0].providerCount, 57);
  assert.equal(res.sources.gpu, '1/6 strategic SKUs');
});

/* ── The fallback's staleness marker is honoured ──────────────────────── */

test('a stale fallback listing is refused rather than written as today\'s observation', async () => {
  const { store, kv } = kvStore();

  const res = await capture(kv, staleGPU(9.99));
  assert.equal(today(store).gpu, null,
    'old prices served during an outage were written into permanent history');
  assert.equal(res.sources.gpu, 'unavailable');
});

test('a stale fallback does not overwrite the good block captured earlier that day', async () => {
  const { store, kv } = kvStore();
  await capture(kv, healthyGPU(3.36));

  const res = await capture(kv, staleGPU(9.99), 2);
  assert.equal(res.results[0].gpuCarriedForward, true);
  assert.equal(today(store).gpu.models[0].medianPricePerHour, 3.36);
});
