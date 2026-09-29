/**
 * The content hash must be able to see a price change.
 *
 * Both writers deduplicated with:
 *     JSON.stringify(payload, Object.keys(payload).sort())
 * That second argument is a REPLACER ARRAY, not a key ordering, and JSON
 * applies it at every nesting level. Any nested key not named in the
 * top-level list was dropped, so `{gpu:{models:[…]}}` serialised to
 * `{"gpu":{}}` regardless of what was inside it.
 *
 * Consequence, measured against the real handler: a day holding H100 at $3.36
 * and a fresh listing at $9.99 produced the SAME hash, so the mid-day refresh
 * answered `skipped` with "gpu block unchanged vs existing snapshot" — a
 * reason that was not true — and threw the new price away. A GPU price that
 * moved during the day was lost for that date, on both dashboards, with no
 * operator action able to recover it.
 *
 * It also quietly neutralised this branch's own fix: carrying medianPricePerHour
 * through the refresh only matters if the merge that writes it can ever run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { onRequestGet as refreshGet } from '../gpu-hardware-pricing-history-refresh.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TODAY = new Date().toISOString().slice(0, 10);

const envFor = (store) => ({
  HISTORY_KV: {
    async get(key, type) { assert.equal(type, 'json'); return store.has(key) ? structuredClone(store.get(key)) : null; },
    async put(key, value) { store.set(key, JSON.parse(value)); },
  },
});

const listing = (median) => ({
  ok: true, fetchedAt: '2026-09-28T15:00:00.000Z',
  rows: [{ gpuModel: 'Nvidia H100', vram: '80GB', category: 'flagship',
    minPricePerHour: null, maxPricePerHour: null, medianPricePerHour: median, providerCount: 53 }],
});

async function refresh(store, payload) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
  try {
    const res = await refreshGet({
      request: new Request('https://x.test/api/gpu-hardware-pricing-history-refresh'),
      env: envFor(store),
    });
    return { status: res.status, body: await res.json() };
  } finally { globalThis.fetch = real; }
}

test('a price move during the day is written, not deduplicated away', async () => {
  const store = new Map();
  await refresh(store, listing(3.36));
  assert.equal(store.get('day:' + TODAY).gpu.models[0].medianPricePerHour, 3.36);

  // Same SKU, same day, genuinely different price. The old hash could not
  // tell these apart, so this second write never happened.
  const { body } = await refresh(store, listing(9.99));
  assert.notEqual(body.action, 'skipped',
    'the refresh reported the block unchanged when its price had tripled');
  assert.equal(store.get('day:' + TODAY).gpu.models[0].medianPricePerHour, 9.99,
    'the new price was discarded and the stale one left in permanent history');
});

test('an unchanged listing is still deduplicated', async () => {
  // The guard must distinguish, not simply always write — otherwise it
  // "passes" by making every run rewrite the day.
  const store = new Map();
  await refresh(store, listing(3.36));
  const { body } = await refresh(store, listing(3.36));
  assert.equal(body.action, 'skipped', 'an identical listing rewrote the day');
});

test('both writers hash nested content, not just top-level keys', () => {
  // A source guard, because the defect is a silent one: the old form is valid
  // JS that returns a plausible string, so nothing fails loudly if it returns.
  for (const f of ['functions/api/history-capture.js',
                   'functions/api/gpu-hardware-pricing-history-refresh.js']) {
    const raw = readFileSync(resolve(ROOT, '..', f), 'utf8');
    // The comment above each hash quotes the broken form deliberately, so the
    // check has to look at code rather than prose.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(src, /JSON\.stringify\(payload,\s*Object\.keys\(payload\)\.sort\(\)\)/,
      f + ' is back on the replacer-array form, which drops every nested key');
    assert.match(src, /stableStringify\(payload\)/, f + ' no longer hashes deterministically');
  }
});

test('the stable form actually distinguishes nested values', async () => {
  const { default: _ } = { default: null };
  // Exercised through the handler above; this pins the primitive directly so a
  // future refactor of stableStringify cannot regress silently.
  const src = readFileSync(resolve(ROOT, 'api/history-capture.js'), 'utf8');
  const body = src.slice(src.indexOf('function stableStringify'));
  const fn = new Function(body.slice(0, body.indexOf('\n}\n') + 3) + '\nreturn stableStringify;')();
  assert.notEqual(fn({ gpu: { models: [{ p: 3.36 }] } }), fn({ gpu: { models: [{ p: 9.99 }] } }));
  assert.equal(fn({ a: 1, b: 2 }), fn({ b: 2, a: 1 }), 'key order must not change the hash');
});
