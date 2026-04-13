/**
 * Cloudflare Pages Function — Google Trends Proxy via Firecrawl
 * Route: /api/trends
 * Method: GET  |  OPTIONS
 *
 * Query params:
 *   terms   (optional) comma-separated, default: Gemini AI,ChatGPT,Claude AI,Perplexity,Copilot
 *   window  (optional) '3m' | '12m', default: '12m'
 *
 * Returns:
 * {
 *   success:   bool,
 *   fetchedAt: ISO string,
 *   window:    '12m',
 *   terms:     string[],
 *   series:    [{ term, data: [{ date:'YYYY-MM-DD', value:0-100 }] }],
 *   summary:   [{ term, latest, windowChangePct, rank }],
 *   errors:    [{ term, error }],
 *   fromCache: bool,
 *   stale:     bool
 * }
 *
 * Design rules
 * ─────────────
 * • 12-second spacing between per-term Firecrawl requests
 * • On 429 returns last cached result with stale:true
 * • Google Trends data is 0–100 normalized and directional only
 * • NEVER used for Search Volume / Demand primary numbers
 * • Methodology note included in every response
 */

const FIRECRAWL_API_KEY = 'fc-203d41c5b1984cdabee2a7564572efea';
const FIRECRAWL_BASE    = 'https://api.firecrawl.dev/v1';

const CACHE_TTL_MS  = 6 * 60 * 60 * 1000;   // 6 hours
const STALE_TTL_MS  = 24 * 60 * 60 * 1000;  // 24 hours (still serve with stale flag)
const REQUEST_DELAY = 12000;                  // 12 s between per-term calls

const DEFAULT_TERMS = ['Gemini AI', 'ChatGPT', 'Claude AI', 'Perplexity', 'Copilot'];

/* Google Trends date-range parameter mapping */
const GT_WINDOW = { '3m': 'today 3-m', '12m': 'today 12-m' };

/* Simple in-process cache (lives for the lifetime of this worker instance) */
const _cache = {};

/* ─── CORS headers ───────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/* ─── Entry: OPTIONS ─────────────────────────────────────────── */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/* ─── Entry: GET ─────────────────────────────────────────────── */
export async function onRequestGet({ request }) {
  try {
  const url    = new URL(request.url);
  const rawT   = url.searchParams.get('terms');
  const terms  = rawT
    ? rawT.split(',').map(t => t.trim()).filter(Boolean)
    : DEFAULT_TERMS;
  const winKey = url.searchParams.get('window') || '12m';
  const gtDate = GT_WINDOW[winKey] || 'today 12-m';

  const cacheKey = terms.join('|') + '|' + winKey;
  const cached   = _cache[cacheKey];
  const now      = Date.now();

  /* ── serve fresh cache immediately ─────────────────────────── */
  if (cached && (now - cached.ts) < CACHE_TTL_MS) {
    return jsonOk({ ...cached.payload, fromCache: true,
                    cacheAge: Math.round((now - cached.ts) / 60000) + 'm' });
  }

  /* ── fetch each term sequentially with spacing ─────────────── */
  const series = [];
  const errors = [];

  for (let i = 0; i < terms.length; i++) {
    if (i > 0) await sleep(REQUEST_DELAY);

    const term   = terms[i];
    const result = await scrapeTerm(term, gtDate);

    if (result.ok) {
      series.push({ term, data: result.data });
    } else {
      errors.push({ term, error: result.error });

      if (result.rateLimited && cached) {
        /* rate-limited — return stale cache immediately */
        return jsonOk({
          ...cached.payload,
          stale:       true,
          staleReason: 'Firecrawl rate-limited (429)'
        });
      }
      /* push empty so downstream doesn't crash */
      series.push({ term, data: [] });
    }
  }

  /* ── compute summary rows ───────────────────────────────────── */
  const summary = buildSummary(series);

  const payload = {
    success:      true,
    fetchedAt:    new Date().toISOString(),
    window:       winKey,
    terms,
    series,
    summary,
    errors,
    fromCache:    false,
    stale:        false,
    methodology:  'Google Trends normalized 0–100, relative interest only. ' +
                  'Directional fallback proxy — not session count, MAU, revenue, or absolute usage.'
  };

  /* ── cache even partial results ─────────────────────────────── */
  if (series.some(s => s.data.length > 0)) {
    _cache[cacheKey] = { payload, ts: now };
  }

  return jsonOk(payload);
}

/* ─── Scrape one term via Firecrawl ─────────────────────────── */
async function scrapeTerm(term, gtDate) {
  /*
   * Strategy:
   *  1. Try Firecrawl /extract with a schema prompt — fastest when it works
   *  2. Fall back to /scrape (rendered markdown) + our multi-format parser
   *
   * Google Trends URLs:
   *   https://trends.google.com/trends/explore?q=<term>&date=<window>&hl=en-US
   */
  const encoded    = encodeURIComponent(term);
  const trendsUrl  = `https://trends.google.com/trends/explore?q=${encoded}&date=${encodeURIComponent(gtDate)}&hl=en-US`;

  /* ── attempt 1: Firecrawl /extract ──────────────────────────── */
  try {
    const extRes = await fetch(FIRECRAWL_BASE + '/extract', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + FIRECRAWL_API_KEY,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        urls: [trendsUrl],
        prompt:
          'Extract the interest-over-time data for "' + term +
          '" from this Google Trends page. ' +
          'Return a JSON array of objects with keys "date" (YYYY-MM-DD or "Mon YYYY") ' +
          'and "value" (integer 0-100). Only include entries from the interest-over-time chart. ' +
          'If the data is weekly, group by month by averaging. ' +
          'Output only the JSON array, no explanation.',
        schema: {
          type: 'object',
          properties: {
            dataPoints: {
              type:  'array',
              items: {
                type:       'object',
                properties: {
                  date:  { type: 'string' },
                  value: { type: 'number' }
                },
                required: ['date', 'value']
              }
            }
          },
          required: ['dataPoints']
        }
      })
    });

    if (extRes.status === 429) {
      return { ok: false, rateLimited: true, error: 'Rate-limited (429)' };
    }

    if (extRes.ok) {
      const extBody = await extRes.json();
      /* Firecrawl extract returns { success, data: { dataPoints: [...] } } */
      const dp = extBody?.data?.dataPoints || extBody?.dataPoints;
      if (Array.isArray(dp) && dp.length >= 3) {
        const cleaned = dp
          .map(row => ({ date: normaliseDate(String(row.date)), value: clampInt(row.value) }))
          .filter(row => row.date && row.value !== null);
        if (cleaned.length >= 3) return { ok: true, data: cleaned };
      }
    }
  } catch (_) { /* fall through to /scrape */ }

  /* ── attempt 2: Firecrawl /scrape + markdown parser ─────────── */
  try {
    const scrRes = await fetch(FIRECRAWL_BASE + '/scrape', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + FIRECRAWL_API_KEY,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        url:             trendsUrl,
        formats:         ['markdown', 'html'],
        onlyMainContent: false,
        waitFor:         6000   // let the JS-rendered chart fully load
      })
    });

    if (scrRes.status === 429) {
      return { ok: false, rateLimited: true, error: 'Rate-limited (429)' };
    }
    if (!scrRes.ok) {
      return { ok: false, error: 'Firecrawl /scrape HTTP ' + scrRes.status };
    }

    const scrBody = await scrRes.json();
    if (!scrBody.success) {
      return { ok: false, error: scrBody.error || 'Firecrawl scrape success:false' };
    }

    const markdown = scrBody?.data?.markdown || scrBody?.markdown || '';
    const html     = scrBody?.data?.html     || scrBody?.html     || '';

    /* Try markdown first, then HTML as fallback source */
    let parsed = parseMarkdown(markdown);
    if (parsed.length < 3) parsed = parseHtml(html);

    return { ok: true, data: parsed };

  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ─── Parse Google Trends markdown output ───────────────────── */
/*
 * GT markdown can come in multiple formats.  We try them all in order.
 *
 *  A: markdown table  | Jan 2024 | 72 |
 *  B: "Month Year: value" list  (e.g. "Jan 2024: 72" or "Jan 2024 – 72")
 *  C: plain "date\nvalue" pairs
 *  D: JSON-like arrays embedded in the page ("value":[72,68,...])
 *  E: CSV-like "date,value" rows
 */
function parseMarkdown(md) {
  if (!md) return [];
  let results = [];

  // ── Format A: markdown table ──
  const tableRe = /\|\s*([A-Za-z]{3}(?:[a-z]*)\.?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s*\|\s*(\d{1,3})\s*\|/g;
  let m;
  while ((m = tableRe.exec(md)) !== null) {
    const d = normaliseDate(m[1].trim()); const v = clampInt(parseInt(m[2], 10));
    if (d && v !== null) results.push({ date: d, value: v });
  }
  if (results.length >= 3) return dedupeByMonth(results);

  // ── Format B: "Mon Year: value" or "Mon Year – value" ──
  results = [];
  const listRe = /\b([A-Za-z]{3,9}\.?\s+\d{4})\s*[:\–\-]\s*(\d{1,3})\b/g;
  while ((m = listRe.exec(md)) !== null) {
    const d = normaliseDate(m[1].trim()); const v = clampInt(parseInt(m[2], 10));
    if (d && v !== null && v <= 100) results.push({ date: d, value: v });
  }
  if (results.length >= 3) return dedupeByMonth(results);

  // ── Format C: date/value on adjacent lines ──
  results = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const dateLine  = lines[i].trim();
    const valueLine = lines[i + 1].trim();
    const d  = normaliseDate(dateLine);
    const v  = clampInt(parseInt(valueLine, 10));
    if (d && v !== null) { results.push({ date: d, value: v }); i++; }
  }
  if (results.length >= 3) return dedupeByMonth(results);

  // ── Format D: embedded JSON value arrays ──
  results = [];
  const jsonRe = /"value"\s*:\s*\[([^\]]+)\]/g;
  const dateRe = /"formattedAxisTime"\s*:\s*"([^"]+)"/g;
  const vals   = [];
  const dates  = [];
  while ((m = jsonRe.exec(md)) !== null) {
    m[1].split(',').forEach(v => { const n = parseInt(v, 10); if (!isNaN(n)) vals.push(n); });
  }
  while ((m = dateRe.exec(md)) !== null) dates.push(m[1]);
  if (vals.length > 0 && dates.length > 0) {
    const len = Math.min(vals.length, dates.length);
    for (let i = 0; i < len; i++) {
      const d = normaliseDate(dates[i]); const v = clampInt(vals[i]);
      if (d && v !== null) results.push({ date: d, value: v });
    }
    if (results.length >= 3) return dedupeByMonth(results);
  }

  // ── Format E: CSV "date,value" ──
  results = [];
  const csvRe = /^([A-Za-z]{3}(?:[a-z]*)\.?\s+\d{4}|\d{4}-\d{2}-\d{2}),(\d{1,3})$/gm;
  while ((m = csvRe.exec(md)) !== null) {
    const d = normaliseDate(m[1].trim()); const v = clampInt(parseInt(m[2], 10));
    if (d && v !== null) results.push({ date: d, value: v });
  }
  return dedupeByMonth(results);
}

/* ─── Parse HTML as supplementary source ─────────────────────── */
function parseHtml(html) {
  if (!html) return [];
  const results = [];

  // Look for Google Trends JSON data embedded in script tags
  // Format: {"default":{"timelineData":[{"time":"...","value":[n]},...]},...}
  const tlRe = /timelineData\s*:\s*(\[[\s\S]{0,8000}?\])/g;
  let m;
  while ((m = tlRe.exec(html)) !== null) {
    try {
      const arr = JSON.parse(m[1]);
      if (Array.isArray(arr)) {
        arr.forEach(item => {
          const timeStr  = item.time || item.formattedAxisTime || '';
          const vals     = item.value || [];
          const v        = Array.isArray(vals) ? vals[0] : vals;
          const d        = normaliseDate(timeStr) || normaliseUnixTs(item.time);
          const n        = clampInt(typeof v === 'number' ? v : parseInt(v, 10));
          if (d && n !== null) results.push({ date: d, value: n });
        });
        if (results.length >= 3) return dedupeByMonth(results);
      }
    } catch (_) { /* malformed JSON — continue */ }
  }

  return results;
}

/* ─── Build summary statistics from series ──────────────────── */
function buildSummary(series) {
  return series
    .map(({ term, data }) => {
      const vals    = (data || []).map(d => d.value).filter(v => typeof v === 'number');
      const latest  = vals.length > 0 ? vals[vals.length - 1] : null;
      const half    = Math.floor(vals.length / 2);
      let   pct     = null;
      if (half >= 2) {
        const first = avg(vals.slice(0, half));
        const last  = avg(vals.slice(half));
        if (first > 0) pct = Math.round(((last - first) / first) * 1000) / 10;
      }
      return { term, latest, windowChangePct: pct };
    })
    .sort((a, b) => (b.latest || 0) - (a.latest || 0))
    .map((item, idx) => ({ ...item, rank: idx + 1 }));
}

/* ─── Date normaliser ────────────────────────────────────────── */
const MONTHS = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  january:1,february:2,march:3,april:4,june:6,july:7,august:8,
  september:9,october:10,november:11,december:12
};

function normaliseDate(str) {
  if (!str) return null;
  str = String(str).trim();

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // "Jan 2024" or "January 2024" or "Jan. 2024"
  const m1 = str.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m1) {
    const mo = MONTHS[m1[1].toLowerCase().slice(0, 9)];
    if (mo) return `${m1[2]}-${String(mo).padStart(2,'0')}-01`;
  }

  // "2024-01" → "2024-01-01"
  const m2 = str.match(/^(\d{4})-(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-01`;

  // "MM/DD/YYYY"
  const m3 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m3) return `${m3[3]}-${String(m3[1]).padStart(2,'0')}-${String(m3[2]).padStart(2,'0')}`;

  // "YYYY-MM-DDTHH:mm:ss..." (ISO with time)
  const m4 = str.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (m4) return m4[1];

  return null;
}

function normaliseUnixTs(ts) {
  const n = parseInt(ts, 10);
  if (isNaN(n) || n < 1000000000) return null;
  // Google Trends uses seconds since epoch
  const d = new Date(n * 1000);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-01';
}

/* ─── Helpers ────────────────────────────────────────────────── */
function clampInt(n) {
  if (isNaN(n) || n === null || n === undefined) return null;
  if (n < 0 || n > 100) return null;
  return Math.round(n);
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Collapse multiple data points in the same month to their average.
 * Google Trends weekly data produces 4–5 rows per month.
 */
function dedupeByMonth(rows) {
  if (!rows.length) return rows;
  const buckets = {};
  rows.forEach(({ date, value }) => {
    const key = date.slice(0, 7); // YYYY-MM
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(value);
  });
  return Object.keys(buckets).sort().map(key => ({
    date:  key + '-01',
    value: Math.round(avg(buckets[key]))
  }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonOk(obj) {
  return new Response(JSON.stringify(obj), {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS }
  });
  } catch (err) {
    return jsonOk({ success: false, error: err.message });
  }
}
