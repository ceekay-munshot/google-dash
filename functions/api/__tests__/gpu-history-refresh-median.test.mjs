/**
 * The mid-day GPU refresh, against the median-era feed.
 *
 * Since 2026-07-28 the upstream publishes one median per SKU and leaves the
 * min/max range null, so the median is the only price a day has. The refresh
 * kept its own copy of the normalizer and never copied that field through:
 * every day it wrote — or merged into an existing snapshot — went in
 * priceless while coverage still reported the SKU as captured.
 *
 * The store stand-in is shaped like the live one; what the refresh writes is
 * then read back through the history endpoint, because the number a reader
 * sees is the point.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as refreshGet } from '../gpu-hardware-pricing-history-refresh.js';
import { onRequestGet as historyGet } from '../gpu-hardware-pricing-history.js';

const TODAY = new Date().toISOString().slice(0, 10);

// The live median-era upstream payload: a median, no range.
function upstreamPayload(median, providers) {
  return {
    ok: true,
    sourceUrl: 'https://getdeploying.com/gpus',
    sourceUpdatedAt: '2026-09-28',
    fetchedAt: '2026-09-28T09:00:00.000Z',
    rows: [{
      gpuModel: 'Nvidia H100',
      vram: '80GB',
      category: 'flagship',
      minPricePerHour: null,
      maxPricePerHour: null,
      medianPricePerHour: median,
      providerCount: providers,
    }],
  };
}

function envFor(store) {
  return {
    HISTORY_KV: {
      async get(key, type) {
        assert.equal(type, 'json');
        return store.has(key) ? structuredClone(store.get(key)) : null;
      },
      async put(key, value) {
        assert.equal(typeof value, 'string');
        store.set(key, JSON.parse(value));
      },
    },
  };
}

async function refresh(store, payload) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.ok(String(url).endsWith('/api/gpu-hardware-pricing-data'));
    return new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const res = await refreshGet({
      request: new Request('https://example.test/api/gpu-hardware-pricing-history-refresh'),
      env: envFor(store),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function readDaily(store) {
  const res = await historyGet({
    request: new Request('https://example.test/api/gpu-hardware-pricing-history?window=60'),
    env: envFor(store),
  });
  assert.equal(res.status, 200);
  return res.json();
}

test('a refreshed day keeps the median — the only price the feed publishes', async () => {
  const store = new Map();
  const { status, body } = await refresh(store, upstreamPayload(3.39, 53));
  assert.equal(status, 200);
  assert.equal(body.action, 'created-gpu-only');
  assert.equal(body.coverage, 1);

  const model = store.get('day:' + TODAY).gpu.models[0];
  assert.equal(model.medianPricePerHour, 3.39,
    'the median is dropped on the floor if it is not copied through');
  assert.equal(model.minPricePerHour, null);
  assert.equal(model.maxPricePerHour, null);
});

test('the number survives the round trip to the daily view', async () => {
  const store = new Map();
  await refresh(store, upstreamPayload(3.39, 53));
  const j = await readDaily(store);
  const latest = j.latest['Nvidia H100'];
  assert.equal(latest.dailyPrice, 3.39, 'the screen shows the median, not a dash');
  assert.equal(latest.dailyBasis, 'median');
  assert.equal(j.series['Nvidia H100'][0].dailyPrice, 3.39);
});

test('merging into a day whose capture missed the GPU block does not blank the price', async () => {
  // The main capture ran with the GPU parser offline, so the snapshot has
  // everything but a gpu block. The refresh fills it in — the merge at the
  // end of the handler is the only path that writes a price into that day.
  const store = new Map();
  store.set('day:' + TODAY, {
    ts: TODAY + 'T02:00:00.000Z',
    date: TODAY,
    source: 'cron',
    backfill: false,
    version: 3,
    or: [{ model: 'gpt-5' }],
    bots: [],
    trends: [],
    filing: null,
    openrouterSummary: null,
    pricing: { basket: 1 },
    gpu: null,
  });
  store.set('index:days', [TODAY]);

  const { body } = await refresh(store, upstreamPayload(3.55, 54));
  assert.equal(body.action, 'merged');

  const merged = store.get('day:' + TODAY);
  assert.equal(merged.gpu.models[0].medianPricePerHour, 3.55,
    'the merged block replaces the day wholesale, so a missing median is a lost day');
  assert.equal(merged.gpu.models[0].providerCount, 54);
  assert.deepEqual(merged.pricing, { basket: 1 }, 'the rest of the capture is untouched');

  const j = await readDaily(store);
  assert.equal(j.latest['Nvidia H100'].dailyPrice, 3.55);
  assert.equal(j.daysWithGPU, 1);
});
