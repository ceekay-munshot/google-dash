/**
 * Guards for the GPU listing's last-good fallback.
 *
 * getdeploying rate-limits by answering 403 to everything, and the endpoint
 * answered that with a 502 — a brief blip took every GPU number off the tab
 * instead of showing prices a few minutes old. It now serves the last listing
 * that parsed.
 *
 * Two things that must hold, because a fallback is only safe if both do:
 *  - it is labelled `stale: true`, which is what /api/history-capture checks
 *    before it will write a GPU block into permanent history;
 *  - it is `private`, so it cannot be replayed from a shared cache after the
 *    source recovers, and it never becomes the next fallback itself.
 *
 * No network and no Workers runtime: fetch and caches.default are stand-ins,
 * and the cache stand-in does the one thing that matters — what put() stores,
 * match() hands back.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../gpu-hardware-pricing-data.js';

const ORIGIN = 'https://example.test';
const API_PATH = '/api/gpu-hardware-pricing-data';
const FALLBACK_PATH = '/__gpu-listing-last-good';

// The current card layout: one median price per model, no range.
const listingHtml = (price) =>
  '<html><body>' +
  '<article data-gpu data-name="Nvidia H100" data-price="' + price + '" ' +
  'data-providers="54" data-segment="DATACENTER" data-vram="80">' +
  '<a href="/gpus/nvidia-h100">Nvidia H100</a></article>' +
  '</body></html>';

function memoryCache() {
  const store = new Map();
  return {
    store,
    async match(req) {
      const e = store.get(req.url);
      return e ? new Response(e.body, { status: e.status, headers: e.headers }) : undefined;
    },
    async put(req, resp) {
      store.set(req.url, { status: resp.status, headers: [...resp.headers], body: await resp.text() });
    },
  };
}

let cache;
let upstream;
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;

beforeEach(() => {
  cache = memoryCache();
  globalThis.caches = { default: cache };
  upstream = { status: 200, price: '3.36', throws: false };
  globalThis.fetch = async (url) => {
    if (String(url) !== 'https://getdeploying.com/gpus') return new Response('', { status: 404 });
    if (upstream.throws) throw new Error('network_down');
    return upstream.status === 200
      ? new Response(listingHtml(upstream.price), { status: 200 })
      : new Response('refused', { status: upstream.status });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;
});

// One reader request, with every waitUntil() settled before returning, so the
// next request sees whatever this one stored.
async function get() {
  const pending = [];
  const context = {
    request: new Request(ORIGIN + API_PATH + '?b=abc12345'),
    waitUntil: (p) => pending.push(p),
  };
  const resp = await onRequestGet(context);
  const body = await resp.json();
  await Promise.all(pending);
  return { resp, body };
}

const fallbackKeys = () => [...cache.store.keys()].filter((k) => new URL(k).pathname === FALLBACK_PATH);

test('a refused listing falls back to the last good one, marked stale, with its capture time', async () => {
  const first = await get();
  assert.equal(first.body.ok, true);
  assert.equal(first.body.stale, undefined);

  upstream.status = 403;
  const second = await get();

  assert.equal(second.resp.status, 200, 'a 403 from the source used to take the whole tab down');
  assert.equal(second.body.stale, true);
  assert.equal(second.body.staleReason, 'upstream_403');
  assert.equal(second.body.rows[0].medianPricePerHour, 3.36);
  // The capture time is the original listing's, not the time of this request.
  assert.equal(second.body.fetchedAt, first.body.fetchedAt);
  assert.ok(second.body.servedAt > second.body.fetchedAt);
});

test('a thrown fetch falls back the same way', async () => {
  await get();
  upstream.throws = true;
  const { resp, body } = await get();
  assert.equal(resp.status, 200);
  assert.equal(body.stale, true);
  assert.equal(body.staleReason, 'network_down');
});

test('a fallback response is private, so no shared cache can replay it', async () => {
  await get();
  upstream.status = 403;
  const { resp } = await get();
  assert.equal(resp.headers.get('Cache-Control'), 'private, max-age=60');
});

test('a fallback response never becomes the fallback itself', async () => {
  const first = await get();
  upstream.status = 403;
  await get();

  assert.equal(fallbackKeys().length, 1);
  const stored = JSON.parse(cache.store.get(fallbackKeys()[0]).body);
  assert.equal(stored.stale, undefined, 'a stale serve was stored back as the last good listing');
  assert.equal(stored.fetchedAt, first.body.fetchedAt);
});

test('the first request after the source recovers gets current prices, not the fallback', async () => {
  await get();
  upstream.status = 403;
  assert.equal((await get()).body.stale, true);

  upstream.status = 200;
  upstream.price = '3.09';
  const recovered = await get();
  assert.equal(recovered.body.stale, undefined);
  assert.equal(recovered.body.rows[0].medianPricePerHour, 3.09);
  assert.equal(recovered.resp.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=600');
});

test('with no fallback to give, a refusal is still an error', async () => {
  upstream.status = 403;
  const { resp, body } = await get();
  assert.equal(resp.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'upstream_403');
  assert.deepEqual(fallbackKeys(), []);
});

test('a listing that parses to nothing is not kept as the fallback', async () => {
  upstream.price = '3.36';
  globalThis.fetch = async () => new Response('<html><body>no rows here</body></html>', { status: 200 });
  const { body } = await get();
  assert.equal(body.count, 0);
  assert.deepEqual(fallbackKeys(), [], 'an empty parse must never become the thing we fall back to');
});

test('the fallback copy is keyed by a schema version, so a bump abandons it', async () => {
  await get();
  assert.equal(fallbackKeys().length, 1);
  assert.match(new URL(fallbackKeys()[0]).searchParams.get('__schema'), /^v\d+$/);
});

test('a runtime with no cache still serves a fresh listing', async () => {
  delete globalThis.caches;
  const { resp, body } = await get();
  assert.equal(resp.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.rows[0].medianPricePerHour, 3.36);
});
