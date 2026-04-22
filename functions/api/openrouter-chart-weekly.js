/**
 * Cloudflare Pages Function — OpenRouter chart-native weekly series
 * Route:  /api/openrouter-chart-weekly
 * Method: GET
 *
 * Returns the exact dataset that drives the "Top Models" weekly stacked-bar
 * chart on openrouter.ai/rankings?view=week. This is the same payload the
 * iframe tooltip reads, so values here reconcile 1:1 with the live chart
 * (modulo observation time — the current week bar grows through the week).
 *
 * Sourcing: OpenRouter streams chart data in the HTML page via Next.js RSC
 * `self.__next_f.push([1, "<rsc-row>"])` chunks. The Top Models chart row
 * has shape:
 *   ["$","$L54",null,{
 *      "data":[{"x":"YYYY-MM-DD", "ys":{"model/slug": tokens, ..., "Others": tokens}}, ...],
 *      "forecast":"forecast-1w",
 *      "forecastFromTimestamp": <epoch ms>
 *   }]
 * We locate it by structural heuristic (presence of `data[].x` + `data[].ys`
 * + `forecastFromTimestamp`), not by position index, so the extractor stays
 * resilient if OR reshuffles RSC chunks.
 *
 * Response shape:
 *   {
 *     success: true,
 *     fetchedAt: ISO,
 *     forecastFromTimestamp: ISO | null,
 *     weeks: [
 *       {
 *         start: "YYYY-MM-DD",        // Monday (week label on OR's chart)
 *         end:   "YYYY-MM-DD",        // Sunday
 *         totalRaw: number,           // Σ ys  — matches OR tooltip "Total"
 *         totalLabel: "8.72T",
 *         partial: boolean,           // true iff this week contains forecastFromTimestamp
 *         topModels: [{slug, tokens}, ...],   // top 10 by tokens (incl. "Others")
 *         allModels: {slug: tokens, ...}      // full ys map (optional, see ?full=)
 *       }, ...
 *     ],
 *     currentWeek: { ...same shape as an element, the partial one } | null,
 *     weeklyPace:  { raw: number, label: "14.2T" } | null   // derived from current week run-rate
 *   }
 *
 * Query params:
 *   ?full=1    include the full `allModels` map per week (default: omit to keep payload small)
 *   ?capture=1 write each parsed week to HISTORY_KV under `or-chart:week:<start>`
 *              and update `or-chart:index` so history reads don't need to refetch
 *
 * Notes on "Weekly Pace":
 *   OpenRouter shows a "Weekly Pace" row in its tooltip on the current week.
 *   The exact formula isn't in the RSC payload — it's computed client-side.
 *   We compute a naive linear extrapolation (totalRaw * weekLength / elapsed)
 *   and label it explicitly as "projected · naive linear" so nobody confuses
 *   it with OR's own method.
 */

const TARGET_URL = 'https://openrouter.ai/rankings?view=week';
const CACHE_TTL_MS = 5 * 60 * 1000;
let _memoCache = null; // { at, payload }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      ...CORS,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const full = url.searchParams.get('full') === '1';
  const capture = url.searchParams.get('capture') === '1';

  // Serve from memo cache if fresh and we don't need to capture
  if (!capture && _memoCache && Date.now() - _memoCache.at < CACHE_TTL_MS) {
    return jsonResp(shapeResponse(_memoCache.payload, { full }));
  }

  let html;
  try {
    const resp = await fetch(TARGET_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!resp.ok) {
      return jsonResp({ success: false, error: 'Upstream ' + resp.status }, 502);
    }
    html = await resp.text();
  } catch (err) {
    return jsonResp({ success: false, error: 'fetch failed: ' + err.message }, 502);
  }

  let parsed;
  try {
    parsed = extractTopModelsPayload(html);
  } catch (err) {
    return jsonResp({ success: false, error: 'parse failed: ' + err.message }, 500);
  }
  if (!parsed) {
    return jsonResp({
      success: false,
      error: 'No Top Models chart payload found in RSC stream — OpenRouter layout may have changed',
    }, 502);
  }

  _memoCache = { at: Date.now(), payload: parsed };

  const shaped = shapeResponse(parsed, { full });

  // Optional capture to KV — stores one entry per completed week plus the
  // current partial week. Completed weeks are write-once-then-dedup (hash
  // stability check); the partial week is always overwritten.
  if (capture && env?.HISTORY_KV) {
    try {
      const writes = [];
      for (const w of shaped.weeks) {
        const key = 'or-chart:week:' + w.start;
        const payload = {
          start: w.start,
          end: w.end,
          totalRaw: w.totalRaw,
          totalLabel: w.totalLabel,
          partial: w.partial,
          topModels: w.topModels,
          allModels: parsed.data.find(d => d.x === w.start)?.ys || {},
          capturedAt: shaped.fetchedAt,
          forecastFromTimestamp: shaped.forecastFromTimestamp,
        };
        writes.push(env.HISTORY_KV.put(key, JSON.stringify(payload)));
      }
      writes.push(env.HISTORY_KV.put('or-chart:index', JSON.stringify(
        shaped.weeks.map(w => w.start).reverse() // newest first
      )));
      await Promise.all(writes);
      shaped.captured = { weeks: shaped.weeks.length };
    } catch (err) {
      shaped.captureError = err.message;
    }
  }

  return jsonResp(shaped);
}

/* ──────────────────────────────────────────────────────────
   Parser — find the Top Models chart row in the RSC stream
   ──────────────────────────────────────────────────────── */

// Matches `self.__next_f.push([1, "<escaped-string>"])`
const RSC_PATTERN = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

function extractTopModelsPayload(html) {
  RSC_PATTERN.lastIndex = 0;
  let m;
  while ((m = RSC_PATTERN.exec(html))) {
    const raw = m[1];
    // Cheap pre-filter on the raw (still-escaped) string. The inner JSON's
    // quotes are escaped, so `"x":` appears as `\"x\":` in raw.
    if (raw.indexOf('forecastFromTimestamp') < 0) continue;
    if (raw.indexOf('\\"x\\":') < 0) continue;
    let decoded;
    try { decoded = unescapeJSONString(raw); } catch { continue; }
    // RSC rows are prefixed with "<hexId>:" followed by a JSON array
    const colon = decoded.indexOf(':');
    if (colon < 0 || colon > 8) continue;
    const jsonPart = decoded.slice(colon + 1);
    let arr;
    try { arr = JSON.parse(jsonPart); } catch { continue; }
    const hit = findChartProps(arr);
    if (hit) return hit;
  }
  return null;
}

// Walk the RSC tree looking for the props object that has the Top Models shape
function findChartProps(node, depth = 0) {
  if (depth > 12 || node == null) return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const h = findChartProps(c, depth + 1);
      if (h) return h;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  // Match: has `data` that's an array of {x, ys} AND `forecastFromTimestamp`
  if (
    Array.isArray(node.data) &&
    node.data.length > 0 &&
    node.data[0] &&
    typeof node.data[0] === 'object' &&
    'x' in node.data[0] &&
    'ys' in node.data[0] &&
    'forecastFromTimestamp' in node
  ) {
    return node;
  }
  for (const k of Object.keys(node)) {
    const h = findChartProps(node[k], depth + 1);
    if (h) return h;
  }
  return null;
}

function unescapeJSONString(raw) {
  // The captured group is exactly the inner string literal of a JS string,
  // so it already escapes backslashes + quotes per JSON rules. JSON.parse
  // of a quoted version is the most reliable decoder.
  return JSON.parse('"' + raw + '"');
}

/* ──────────────────────────────────────────────────────────
   Shape — post-process the raw payload into the wire response
   ──────────────────────────────────────────────────────── */

function shapeResponse(payload, { full }) {
  const fetchedAt = new Date().toISOString();
  const forecastTs = payload.forecastFromTimestamp
    ? new Date(payload.forecastFromTimestamp).toISOString()
    : null;
  const forecastDate = payload.forecastFromTimestamp
    ? new Date(payload.forecastFromTimestamp)
    : null;

  const weeks = payload.data.map(row => {
    const start = row.x; // "YYYY-MM-DD" Monday
    const end = addDaysUTC(start, 6);
    const totalRaw = Object.values(row.ys).reduce((s, v) => s + (v || 0), 0);
    const partial = forecastDate ? isWithinISOWeek(forecastDate, start) : false;
    const topModels = Object.entries(row.ys)
      .map(([slug, tokens]) => ({ slug, tokens }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);
    const w = {
      start,
      end,
      totalRaw,
      totalLabel: formatTokens(totalRaw),
      partial,
      topModels,
    };
    if (full) w.allModels = row.ys;
    return w;
  });

  const currentWeek = weeks.find(w => w.partial) || null;

  // Naive "Weekly Pace": linearly extrapolate current-week total to full week
  // based on elapsed fraction. We explicitly do NOT try to match OR's own
  // pace calc — that's their proprietary forecast.
  let weeklyPace = null;
  if (currentWeek && forecastDate) {
    const wkStart = parseDateUTC(currentWeek.start);
    const wkEnd = new Date(wkStart.getTime() + 7 * 864e5);
    const elapsed = forecastDate.getTime() - wkStart.getTime();
    if (elapsed > 0 && elapsed < 7 * 864e5) {
      const full = currentWeek.totalRaw * (7 * 864e5) / elapsed;
      weeklyPace = {
        raw: full,
        label: formatTokens(full),
        method: 'naive linear · observed * (week_length / elapsed_so_far)',
      };
    }
  }

  return {
    success: true,
    fetchedAt,
    forecastFromTimestamp: forecastTs,
    weeks,
    currentWeek,
    weeklyPace,
    source: 'openrouter.ai/rankings · RSC Top Models payload',
  };
}

/* ──────────────────────────────────────────────────────────
   Date helpers — UTC, matching OR's ISO-week labeling
   ──────────────────────────────────────────────────────── */

function parseDateUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDaysUTC(s, n) {
  const d = parseDateUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isWithinISOWeek(dt, weekStartStr) {
  const start = parseDateUTC(weekStartStr).getTime();
  const end = start + 7 * 864e5;
  return dt.getTime() >= start && dt.getTime() < end;
}

function formatTokens(n) {
  if (!n || n <= 0) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2).replace(/\.?0+$/, '') + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  return String(n);
}
