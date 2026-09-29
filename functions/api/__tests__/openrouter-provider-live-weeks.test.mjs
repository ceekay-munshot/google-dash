/**
 * The provider market-share chart must not stop where the capture stopped.
 *
 * `/api/openrouter-chart-weekly?providers=1` served the bundled seed merged
 * with `or-chart:providers`, and that key stopped persisting on 2026-06-09.
 * The endpoint went on answering a clean 200 with a series sixteen weeks
 * short, under a legend that calls its last bar "the most recent week".
 * The feed-health workflow does not alert on the stale key because
 * market-share "is read live and supersedes it" — true of
 * provider-pricing-matrix.js, which was moved onto the live read, and false
 * of this endpoint, which never was.
 *
 * So: read market-share live, merge it OVER the captured copy (the same
 * semantics as mergeProviderWeeks in provider-pricing-matrix.js), keep the
 * older captured history the live window cannot reach, and publish which
 * week is actually being served — plus, when the live read fails, say so on
 * the wire instead of presenting the stored weeks as current.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const RANKINGS = 'openrouter.ai/api/frontend/v1/rankings/market-share';

/** Captured provider weeks, frozen the way KV froze: nothing after 2026-06-08. */
const CAPTURED = [
  { x: '2026-05-25', ys: { google: 1.0e12, openai: 2.0e12, others: 3.0e11 } },
  { x: '2026-06-01', ys: { google: 1.1e12, openai: 2.0e12, others: 3.0e11 } },
  // Overlaps the live window, and disagrees with it on purpose.
  { x: '2026-06-08', ys: { google: 9.9e9,  openai: 9.9e9,  others: 9.9e9  } },
];

/** Ten live weeks from the overlap through 2026-08-10. */
const LIVE_WEEKS = Array.from({ length: 10 }, (_, i) => ({
  start: new Date(Date.UTC(2026, 5, 8) + i * 7 * 86400000).toISOString().slice(0, 10),
  providers: { google: 4.0e12 + i * 1e11, openai: 3.0e12, anthropic: 2.0e12, others: 5.0e11 },
}));
const LIVE_LATEST = LIVE_WEEKS[LIVE_WEEKS.length - 1].start;

function envWithCapture() {
  const store = {
    'or-chart:providers': { capturedAt: '2026-06-09T00:00:00Z', weeks: CAPTURED },
    'or-chart:providers-meta': { capturedAt: '2026-06-09T00:00:00Z', latestWeek: '2026-06-08' },
  };
  return { HISTORY_KV: { get: async (key) => store[key] || null } };
}

/**
 * Fresh module instance per case — the endpoint memoises both the KV read and
 * the live read per isolate, so cases must not share one.
 */
async function loadEndpoint(tag) {
  return import('../openrouter-chart-weekly.js?case=' + tag);
}

async function getProviders(tag, fetchImpl) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const { onRequestGet } = await loadEndpoint(tag);
    const resp = await onRequestGet({
      request: new Request('https://x/api/openrouter-chart-weekly?providers=1'),
      env: envWithCapture(),
    });
    return { status: resp.status, body: await resp.json() };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const liveOkFetch = async (url) => {
  assert.ok(String(url).includes(RANKINGS), 'expected the live market-share read, got ' + url);
  return new Response(JSON.stringify({
    data: LIVE_WEEKS.map(w => ({ x: w.start + ' 00:00:00', ys: w.providers })),
  }), { status: 200 });
};

test('live weeks sit on top of the captured copy', async () => {
  const { status, body } = await getProviders('live-over-captured', liveOkFetch);
  assert.equal(status, 200);
  assert.equal(body.success, true);

  const starts = body.weeks.map(w => w.start);
  // The sixteen-week hole is gone: every live week is served.
  for (const w of LIVE_WEEKS) assert.ok(starts.includes(w.start), 'missing live week ' + w.start);
  assert.equal(starts[starts.length - 1], LIVE_LATEST);

  // Live wins the overlap — the captured 2026-06-08 row is the one replaced.
  const overlap = body.weeks.find(w => w.start === '2026-06-08');
  assert.equal(overlap.providers.google, 4.0e12);
  assert.ok(overlap.providers.anthropic > 0, 'live providers should be the ones served');

  assert.equal(body.live.ok, true);
  assert.equal(body.live.latestWeek, LIVE_LATEST);
});

test('captured history the live window cannot reach survives', async () => {
  const { body } = await getProviders('older-captured-survive', liveOkFetch);
  const older = body.weeks.find(w => w.start === '2026-05-25');
  assert.ok(older, 'captured week before the live window must survive the merge');
  assert.equal(older.providers.google, 1.0e12);
  // …in the same series that carries the live tail: the merge extends the
  // history, it does not swap one source for the other.
  assert.equal(body.weeks[body.weeks.length - 1].start, LIVE_LATEST);
  // Ascending, so the captured head really is underneath the live tail.
  assert.deepEqual([...body.weeks.map(w => w.start)].sort(), body.weeks.map(w => w.start));
});

test('a failed live read still serves the stored weeks, and says it failed', async () => {
  const { status, body } = await getProviders('live-fails', async () => {
    throw new Error('upstream unreachable');
  });
  assert.equal(status, 200);
  assert.equal(body.success, true);

  const starts = body.weeks.map(w => w.start);
  assert.ok(starts.includes('2026-05-25'), 'stored weeks must still be served');
  assert.equal(starts[starts.length - 1], '2026-06-08');

  assert.equal(body.live.ok, false);
  assert.match(String(body.live.error), /unreachable/);
  assert.match(String(body.live.note), /not current/);
  // Nothing months old may be dated as if it were read just now.
  assert.equal(body.updatedAt, '2026-06-09T00:00:00Z');
});

test('the published latest week is the one actually served', async () => {
  const { body } = await getProviders('latest-week-matches', liveOkFetch);
  assert.equal(body.latestWeek, body.weeks[body.weeks.length - 1].start);
  assert.equal(body.latestWeekEnd, body.weeks[body.weeks.length - 1].end);
  assert.equal(body.latestWeek, LIVE_LATEST);
  assert.ok(body.latestWeekBehind >= 0, 'staleness of the served week must be published');
  // The basis is all OpenRouter traffic; a paid-only history does not exist.
  assert.match(String(body.basis), /all OpenRouter traffic/);
});
