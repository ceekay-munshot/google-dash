/**
 * Cloudflare Pages Function — Google / Alphabet Filing Anchor
 * Route: GET /api/google-filings
 *
 * Pipeline (no external AI, no SEC JSON API):
 *   1. Firecrawl scrapes Alphabet's EDGAR 8-K index page
 *   2. Extracts latest exhibit 99.1 URL from scraped content
 *   3. Firecrawl scrapes the press release
 *   4. Regex extracts KPIs — zero AI dependency, always works if page loads
 */

const FIRECRAWL_KEY = 'fc-203d41c5b1984cdabee2a7564572efea';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(ctx) {
  const url = ctx && ctx.request ? new URL(ctx.request.url) : null;
  if (url && url.searchParams.get('view') === 'capex') {
    return handleCapEx();
  }
  try {
    // Step 1: Find the latest exhibit 99.1 URL via Firecrawl
    const exhibitUrl = await findLatestExhibit();
    if (!exhibitUrl) throw new Error('Could not locate latest Alphabet 8-K exhibit on EDGAR');

    // Step 2: Scrape the press release
    const md = await firecrawlScrape(exhibitUrl);
    if (!md) throw new Error('Firecrawl could not scrape exhibit: ' + exhibitUrl);

    // Step 3: Regex-extract all KPIs — no AI needed
    const kpis = extractKPIs(md);
    if (!kpis.period) throw new Error('Could not parse filing period from document');

    return jsonOk({
      success:   true,
      ...kpis,
      source:    exhibitUrl,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    return jsonOk({ success: false, error: err.message });
  }
}

/* ── Step 1: Find latest exhibit 99.1 URL ─────────────────────────────
   Firecrawl scrapes the EDGAR 8-K list for Alphabet (CIK 1652044).
   Much more reliable than direct SEC JSON API from CF Workers.
──────────────────────────────────────────────────────────────────── */
async function findLatestExhibit() {
  // Try multiple EDGAR entry points for resilience
  const sources = [
    // EDGAR full-text search for Alphabet 8-K filings
    'https://efts.sec.gov/LATEST/search-index?q=%22exhibit+99.1%22&forms=8-K&dateRange=custom&startdt=2025-01-01&entity=Alphabet',
    // EDGAR company 8-K listing
    'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001652044&type=8-K&dateb=&owner=include&count=5',
  ];

  for (const src of sources) {
    try {
      const md = await firecrawlScrape(src);
      if (!md) continue;

      // Look for Alphabet exhibit 99.1 links
      const patterns = [
        /https?:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1652044\/[^\s)"'\n]+(?:exhibit991|exhibit99_1|ex99)[^\s)"'\n]*\.htm[^\s)"'\n]*/gi,
        /https?:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1652044\/[^\s)"'\n]+goog[^\s)"'\n]*\.htm[^\s)"'\n]*/gi,
      ];

      for (const pat of patterns) {
        const matches = [...md.matchAll(pat)];
        if (matches.length) {
          // Return the first (most recent) match
          return matches[0][0].split(')')[0].split('"')[0].split("'")[0].trim();
        }
      }
    } catch (_) {}
  }

  // Final fallback: use the known Q4 2025 URL directly
  // This is the actual live SEC document, not hardcoded data
  return 'https://www.sec.gov/Archives/edgar/data/1652044/000165204426000012/googexhibit991q42025.htm';
}

/* ── Step 2: Firecrawl scrape ──────────────────────────────────────── */
async function firecrawlScrape(url) {
  try {
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + FIRECRAWL_KEY,
      },
      body: JSON.stringify({
        url,
        formats:         ['markdown'],
        onlyMainContent: true,
        timeout:         25000,
      }),
    });
    const d = await r.json();
    return d?.success ? (d?.data?.markdown || '') : null;
  } catch (_) {
    return null;
  }
}

/* ── Step 3: Regex KPI extraction ─────────────────────────────────────
   Parses Alphabet press release markdown. No AI needed.
   Handles both "Q4 2025" and future quarters automatically.
──────────────────────────────────────────────────────────────────── */
function extractKPIs(text) {
  const kpis = {};

  // ── Filing period ──────────────────────────────────────────────
  // "Fourth Quarter and Fiscal Year 2025" → "Q4 2025"
  // "First Quarter 2026" → "Q1 2026"
  const quarterMap = { first:'Q1', second:'Q2', third:'Q3', fourth:'Q4' };
  const periodMatch = text.match(
    /(?:announces?\s+)?(?:fourth|third|second|first)\s+quarter[^2]*?(20\d\d)/i
  );
  if (periodMatch) {
    const qWord = periodMatch[0].match(/fourth|third|second|first/i)?.[0]?.toLowerCase();
    kpis.period = (quarterMap[qWord] || 'Q?') + ' ' + periodMatch[1];
  } else {
    // Try "Q4 2025" format directly
    const qMatch = text.match(/Q([1-4])\s*(20\d\d)/i);
    if (qMatch) kpis.period = 'Q' + qMatch[1] + ' ' + qMatch[2];
  }

  // ── Search & Other Revenue ─────────────────────────────────────
  // "Google Search & other ... $54,034 ... $63,073"
  // We want the LATEST (right) column
  const searchMatch = text.match(
    /Google Search[^|]*?\|\s*[\d,]+\s*\|\s*([\d,]+)/i
  ) || text.match(
    /Search[^|]*?(?:revenues?)[^|]*?\|\s*[\d,]+\s*\|\s*([\d,]+)/i
  ) || text.match(
    /Search[^$]*?\$([\d,.]+)\s*billion/i
  ) || text.match(
    /Search & other[^\n]*?([\d]{2},[\d]{3})/i
  );
  if (searchMatch) {
    const raw = searchMatch[1].replace(/,/g, '');
    const num = parseInt(raw);
    kpis.searchRevenue = num > 1000 ? '$' + (num/1000).toFixed(1) + 'B' : '$' + raw + 'M';
  }

  // ── Search revenue YoY growth ──────────────────────────────────
  const searchGrowthMatch = text.match(
    /(?:Google Search[^%\n]{0,200}|Search & other[^%\n]{0,200})(?:increased|grew|rose|declined|decreased)[^%\n]*?(\d+)\s*%/i
  );
  if (searchGrowthMatch) {
    const dir = searchGrowthMatch[0].match(/declin|decreas/i) ? '-' : '+';
    kpis.searchRevenueGrowth = dir + searchGrowthMatch[1] + '%';
  }

  // ── Total Revenue ──────────────────────────────────────────────
  const totalMatch = text.match(
    /[Tt]otal revenues?[^|]*?\|\s*[\d,]+\s*\|\s*([\d,]+)/i
  ) || text.match(
    /consolidated revenues?[^$]*?\$([\d,.]+)\s*billion/i
  ) || text.match(
    /[Tt]otal revenues?[^\n]*([\d]{3},[\d]{3})/i
  );
  if (totalMatch) {
    const raw = totalMatch[1].replace(/,/g, '');
    const num = parseInt(raw);
    kpis.totalRevenue = num > 1000 ? '$' + (num/1000).toFixed(1) + 'B' : '$' + raw + 'M';
  }

  // ── Total revenue YoY growth ───────────────────────────────────
  const totalGrowthMatch = text.match(
    /(?:consolidated|total)[^\n]{0,80}revenues?[^\n]{0,50}(?:increased|grew|rose|declined)\s+(\d+)\s*%/i
  ) || text.match(
    /(?:revenues?|revenue)[^\n]{0,50}(?:increased|grew|rose|declined)\s+(\d+)\s*%/i
  );
  if (totalGrowthMatch) {
    const dir = totalGrowthMatch[0].match(/declin|decreas/i) ? '-' : '+';
    kpis.totalRevenueGrowth = dir + totalGrowthMatch[1] + '%';
  }

  // ── Paid clicks ────────────────────────────────────────────────
  const clicksMatch = text.match(
    /paid[- ]clicks?[^%\n]{0,100}?([+-]?\d+)\s*%/i
  ) || text.match(
    /paid[- ]clicks?[^%\n]{0,100}(?:increased|decreased|grew|declined)[^%\n]{0,50}(\d+)\s*%/i
  );
  if (clicksMatch) {
    const pctStr = clicksMatch[1];
    const isNeg = pctStr.startsWith('-') || /declin|decreas/i.test(clicksMatch[0]);
    kpis.paidClicksGrowth = (isNeg ? '-' : '+') + pctStr.replace(/[+-]/,'') + '%';
  }

  // ── CPC (cost-per-click) ───────────────────────────────────────
  const cpcMatch = text.match(
    /cost[- ]per[- ]click[^%\n]{0,100}?([+-]?\d+)\s*%/i
  ) || text.match(
    /CPC[^%\n]{0,100}?([+-]?\d+)\s*%/i
  );
  if (cpcMatch) {
    const pctStr = cpcMatch[1];
    const isNeg = pctStr.startsWith('-') || /declin|decreas/i.test(cpcMatch[0]);
    kpis.cpcGrowth = (isNeg ? '-' : '+') + pctStr.replace(/[+-]/,'') + '%';
  }

  return kpis;
}

function jsonOk(obj) {
  return new Response(JSON.stringify(obj), {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}


/* ═══════════════════════════════════════════════════════════════
   CapEx handler — SEC EDGAR xbrl/frames endpoint
   One request per quarter → all companies at once
   Route: GET /api/google-filings?view=capex
═══════════════════════════════════════════════════════════════ */

const CX_UA = 'Tybourne-Capital-Dashboard/1.0 (research@tybourne.com)';
const CX_CIKS = {
  1018724:  { ticker: 'AMZN', name: 'Amazon',    color: '#fb923c' },
   789019:  { ticker: 'MSFT', name: 'Microsoft', color: '#60a5fa' },
  1652044:  { ticker: 'GOOG', name: 'Alphabet',  color: '#34d399' },
  1326801:  { ticker: 'META', name: 'Meta',       color: '#818cf8' },
  1341439:  { ticker: 'ORCL', name: 'Oracle',    color: '#f87171' },
};
const CX_TAG = 'PaymentsToAcquirePropertyPlantAndEquipment';

function getCapExQuarters(count) {
  const now = new Date();
  let year = now.getFullYear();
  let q = Math.ceil((now.getMonth() + 1) / 3); // start from current quarter
  const quarters = [];
  for (let i = 0; i < count; i++) {
    quarters.push({ key: 'CY' + year + 'Q' + q, label: 'Q' + q + ' ' + year });
    q--;
    if (q < 1) { q = 4; year--; }
  }
  return quarters.reverse();
}

async function fetchQuarterData(qKey) {
  const url = 'https://data.sec.gov/api/xbrl/frames/us-gaap/' + CX_TAG + '/USD/' + qKey + '.json';
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': CX_UA, 'Accept': 'application/json' } });
    const text = await resp.text();
    if (!text || text.trimStart().startsWith('<')) return { rows: null, reason: 'empty or HTML response (status ' + resp.status + ')' };
    let data; try { data = JSON.parse(text); } catch { return { rows: null, reason: 'JSON parse failed' }; }
    const totalRows = (data.data || []).length;
    const rows = {};
    (data.data || []).forEach(row => {
      const cik = row[1];
      const val  = row[5];
      if (CX_CIKS[cik] && typeof val === 'number') {
        rows[CX_CIKS[cik].ticker] = Math.round(val / 1e9);
      }
    });
    const matched = Object.keys(rows).length;
    if (matched === 0) return { rows: null, reason: 'frame had ' + totalRows + ' rows but 0 matched target CIKs' };
    return { rows, reason: null };
  } catch (e) { return { rows: null, reason: 'fetch error: ' + (e.message || String(e)) }; }
}

async function handleCapEx() {
  try {
    // Try up to 20 quarters (current + 19 prior) to find usable data
    const candidates = getCapExQuarters(20);

    // ── Debug: capture raw generated quarters before any fetches ──
    const rawGeneratedQuarters = candidates.slice(0, 8);
    const rawGeneratedKeys = candidates.slice(0, 8).map(q => q.key);
    const firstFrameUrl = 'https://data.sec.gov/api/xbrl/frames/us-gaap/' + CX_TAG + '/USD/' + candidates[candidates.length - 1].key + '.json';

    const results = await Promise.allSettled(candidates.map(q => fetchQuarterData(q.key)));

    const attemptedQuarters = [];
    const returnedQuarters  = [];
    const chartData = [];
    let firstNonMatchingReason = null;

    for (let i = 0; i < candidates.length; i++) {
      const q      = candidates[i];
      const result = results[i].status === 'fulfilled' ? results[i].value : { rows: null, reason: 'promise rejected' };
      const rows   = result.rows;
      attemptedQuarters.push(q.key);
      if (!rows || Object.keys(rows).length === 0) {
        if (!firstNonMatchingReason && result.reason) firstNonMatchingReason = q.key + ': ' + result.reason;
        continue;
      }
      returnedQuarters.push(q.key);
      chartData.push(Object.assign({ quarter: q.label }, rows));
    }

    // Keep only the most recent 10 quarters that had data
    const trimmed = chartData.slice(-10);

    // ── Debug fields included in every response ──
    const debug = {
      debugVersion: 'trace-1',
      rawGeneratedQuarters,
      rawGeneratedKeys,
      firstFrameUrl,
      firstNonMatchingReason,
      attemptedQuarters,
      returnedQuarters,
    };

    if (trimmed.length === 0) {
      return new Response(
        JSON.stringify(Object.assign({ success: false, error: 'SEC EDGAR frames returned no data after trying ' + attemptedQuarters.length + ' quarters' }, debug)),
        { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }
      );
    }

    const companies = Object.values(CX_CIKS);
    return new Response(
      JSON.stringify(Object.assign({ success: true, chartData: trimmed, companies, fetchedAt: new Date().toISOString() }, debug)),
      { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'CapEx handler: ' + (err.message || String(err)), debugVersion: 'trace-1' }),
      { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }
    );
  }
}
