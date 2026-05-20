/**
 * Cloudflare Pages Function — OpenRouter weekly "Top Models" token series.
 * Route: /api/openrouter-chart-weekly
 *
 *   GET                → weekly model-token series in the dashboard wire shape.
 *   GET  ?full=1       → also include the per-week `allModels` map.
 *   GET  ?debug=1      → internal diagnostics (source, freshness, last error).
 *   POST ?capture=1    → ingest a fresh capture and persist it to HISTORY_KV.
 *                        Auth: Authorization: Bearer <CAPTURE_TOKEN>.
 *
 * Source of truth is HISTORY_KV key `or-chart:series`, refreshed by the
 * scheduled browser capture (.github/workflows/openrouter-capture.yml). The
 * bundled seed (_openrouter-chart-seed.js) is a bootstrap / emergency fallback
 * only — persisted captures always override and extend it.
 *
 * A normal GET ALWAYS responds 200 with a renderable series — it never
 * surfaces an upstream/parser error to the dashboard.
 */

import { SEED_WEEKS, SEED_CAPTURED_AT } from './_openrouter-chart-seed.js';

const KV_SERIES = 'or-chart:series';
const KV_META   = 'or-chart:capture-meta';
const KV_ERROR  = 'or-chart:last-error';
const CACHE_TTL_MS = 5 * 60 * 1000;

// In-isolate memo of the merged series so request bursts don't re-read KV.
let _memo = null; // { at, merged, kvMeta, kvErr, kvCount }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResp(data, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache, ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/* ── date helpers (all UTC) ─────────────────────────────────── */
function parseUTC(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function addDaysISO(s, n) { return new Date(parseUTC(s) + n * 86400000).toISOString().slice(0, 10); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

/** Monday (ISO week start) of the week containing the given epoch ms. */
function isoWeekStartISO(ms) {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * 86400000)
    .toISOString().slice(0, 10);
}

function formatTokens(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2).replace(/\.?0+$/, '') + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  return String(Math.round(n));
}

/* ── payload parser ─────────────────────────────────────────────
   Accepts the OpenRouter chart data in any form a capture may deliver
   it and returns a clean [{ x, ys }] array (or null):
     • RSC stream text   '0:{…}1:{"data":[{x,ys}]}'   (model-level)
     • RSC stream text   '0:{…}1:[{x,ys}]'            (provider-level)
     • JSON  {"data":[{x,ys}]} | {"weeks":[{x,ys}]} | [{x,ys}]
   ──────────────────────────────────────────────────────────────── */
function extractBalanced(str, start) {
  const open = str[start];
  if (open !== '{' && open !== '[') return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return str.slice(start, i + 1); }
  }
  return null;
}

function coerceWeeks(obj) {
  let arr = null;
  if (Array.isArray(obj)) arr = obj;
  else if (obj && Array.isArray(obj.data)) arr = obj.data;
  else if (obj && Array.isArray(obj.weeks)) arr = obj.weeks;
  if (!arr) return null;
  const out = [];
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.x)) continue;
    if (!e.ys || typeof e.ys !== 'object' || Array.isArray(e.ys)) continue;
    const ys = {};
    for (const [k, v] of Object.entries(e.ys)) {
      if (typeof v === 'number' && isFinite(v) && v >= 0) ys[k] = v;
    }
    if (Object.keys(ys).length) out.push({ x: e.x, ys });
  }
  return out.length ? out : null;
}

function parseRSCPayload(input) {
  if (input == null) return null;
  if (typeof input !== 'string') return coerceWeeks(input);
  const t = input.trim();
  if (!t) return null;
  // 1) whole-string JSON
  try {
    const w = coerceWeeks(JSON.parse(t));
    if (w) return w;
  } catch (_) { /* not plain JSON — fall through to the RSC scan */ }
  // 2) RSC stream text — locate the model-level (preferred) or provider-level block
  for (const marker of ['{"data":[', '[{"x":']) {
    let idx = t.indexOf(marker);
    while (idx >= 0) {
      const frag = extractBalanced(t, idx);
      if (frag) {
        try {
          const w = coerceWeeks(JSON.parse(frag));
          if (w) return w;
        } catch (_) { /* keep scanning */ }
      }
      idx = t.indexOf(marker, idx + 1);
    }
  }
  return null;
}

/** True when the series is model-level (slug keys) rather than provider-level. */
function looksModelLevel(weeks) {
  const ys = weeks[weeks.length - 1].ys;
  const keys = Object.keys(ys);
  const slugLike = keys.filter(k => k.includes('/') || k === 'Others').length;
  return slugLike >= keys.length * 0.5;
}

/* ── merge + shape ──────────────────────────────────────────── */
/** Seed first, persisted capture overlaid — captures override & extend. */
function mergeSeries(kvWeeks) {
  const map = new Map();
  for (const w of SEED_WEEKS) if (w && w.x && w.ys) map.set(w.x, w.ys);
  if (Array.isArray(kvWeeks)) for (const w of kvWeeks) if (w && w.x && w.ys) map.set(w.x, w.ys);
  return [...map.keys()].sort().map(x => ({ x, ys: map.get(x) }));
}

function shapeResponse(merged, { full, updatedAt }) {
  const todayTs = parseUTC(todayISO());
  const weeks = merged.map(({ x, ys }) => {
    const startTs = parseUTC(x);
    const totalRaw = Object.values(ys).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    const partial = todayTs >= startTs && todayTs < startTs + 7 * 86400000;
    const topModels = Object.entries(ys)
      .filter(([slug]) => slug !== 'Others')
      .map(([slug, tokens]) => ({ slug, tokens }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);
    const w = {
      start: x,
      end: addDaysISO(x, 6),
      totalRaw,
      totalLabel: formatTokens(totalRaw),
      partial,
      topModels,
    };
    if (full) w.allModels = ys;
    return w;
  });

  const currentWeek = weeks.find(w => w.partial) || null;
  let weeklyPace = null;
  if (currentWeek) {
    const elapsedMs = Date.now() - parseUTC(currentWeek.start);
    if (elapsedMs > 0 && elapsedMs < 7 * 86400000) {
      const projected = currentWeek.totalRaw * (7 * 86400000) / elapsedMs;
      weeklyPace = {
        raw: projected,
        label: formatTokens(projected),
        method: 'naive linear · observed * (week_length / elapsed_so_far)',
      };
    }
  }

  return {
    success: true,
    fetchedAt: new Date().toISOString(),
    forecastFromTimestamp: new Date().toISOString(),
    updatedAt: updatedAt || null,
    weeks,
    currentWeek,
    weeklyPace,
    source: 'openrouter.ai/rankings · weekly Top Models token series',
  };
}

/* ── KV read (memoised per isolate) ─────────────────────────── */
async function loadState(env) {
  if (_memo && Date.now() - _memo.at < CACHE_TTL_MS) return _memo;
  const kv = env && env.HISTORY_KV;
  let kvWeeks = null, kvMeta = null, kvErr = null;
  if (kv) {
    try {
      const series = await kv.get(KV_SERIES, 'json');
      if (series) kvWeeks = Array.isArray(series) ? series : series.weeks;
      kvMeta = await kv.get(KV_META, 'json');
      kvErr = await kv.get(KV_ERROR, 'json');
    } catch (_) { /* fall back to the bundled seed */ }
  }
  _memo = {
    at: Date.now(),
    merged: mergeSeries(kvWeeks),
    kvMeta,
    kvErr,
    kvCount: Array.isArray(kvWeeks) ? kvWeeks.length : 0,
  };
  return _memo;
}

/* ── GET — series + diagnostics ─────────────────────────────── */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const full = url.searchParams.get('full') === '1';
  const debug = url.searchParams.get('debug') === '1';

  const state = await loadState(env);
  const merged = state.merged;
  const latestWeek = merged.length ? merged[merged.length - 1].x : null;

  if (debug) {
    const currentIsoWeek = isoWeekStartISO(Date.now());
    const weeksBehind = latestWeek
      ? Math.round((parseUTC(currentIsoWeek) - parseUTC(latestWeek)) / (7 * 86400000))
      : null;
    return jsonResp({
      success: true,
      diagnostics: true,
      source: state.kvCount > 0 ? 'persisted-capture' : 'seed',
      kvBound: !!(env && env.HISTORY_KV),
      weeksCount: merged.length,
      latestStoredWeek: latestWeek,
      firstStoredWeek: merged.length ? merged[0].x : null,
      currentIsoWeek,
      weeksBehind,
      isFresh: weeksBehind === 0,
      seed: { capturedAt: SEED_CAPTURED_AT, weeks: SEED_WEEKS.length },
      persisted: { weeks: state.kvCount, lastCapture: state.kvMeta || null },
      lastCaptureError: state.kvErr || null,
    });
  }

  const updatedAt = (state.kvMeta && state.kvMeta.capturedAt) || SEED_CAPTURED_AT;
  return jsonResp(shapeResponse(merged, { full, updatedAt }), 200, 'public, max-age=300');
}

/* ── POST ?capture=1 — ingest a fresh capture ───────────────── */
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('capture') !== '1') {
    return jsonResp({ success: false, error: 'Not found' }, 404);
  }

  // Auth — required whenever CAPTURE_TOKEN is configured (always, in production).
  const token = env && env.CAPTURE_TOKEN;
  if (token) {
    const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (provided !== token) {
      return jsonResp({ success: false, error: 'Unauthorized' }, 401);
    }
  }

  const kv = env && env.HISTORY_KV;
  if (!kv) return jsonResp({ success: false, error: 'HISTORY_KV not bound' }, 500);

  let raw = '';
  try { raw = await request.text(); } catch (_) { /* empty body */ }
  const weeks = parseRSCPayload(raw);

  const recordError = async (msg) => {
    const errRec = { at: new Date().toISOString(), error: msg, receivedBytes: raw.length };
    try { await kv.put(KV_ERROR, JSON.stringify(errRec)); } catch (_) {}
    return jsonResp({ success: false, error: msg }, 422);
  };

  if (!weeks || !weeks.length) {
    return recordError('No valid {x,ys} weekly rows found in posted payload');
  }
  if (!looksModelLevel(weeks)) {
    return recordError('Posted payload looks provider-level, not model-level (ys keys are not model slugs)');
  }

  weeks.sort((a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0));
  const capturedAt = new Date().toISOString();
  const latestWeek = weeks[weeks.length - 1].x;
  await kv.put(KV_SERIES, JSON.stringify({ capturedAt, count: weeks.length, weeks }));
  await kv.put(KV_META, JSON.stringify({
    capturedAt, count: weeks.length, latestWeek, firstWeek: weeks[0].x,
  }));
  try { await kv.delete(KV_ERROR); } catch (_) {}
  _memo = null; // bust the read memo so the next GET reflects this capture

  return jsonResp({
    success: true,
    action: 'captured',
    capturedAt,
    weeks: weeks.length,
    firstWeek: weeks[0].x,
    latestWeek,
  });
}
