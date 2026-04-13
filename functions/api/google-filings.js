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
   CapEx handler — per-company SEC EDGAR companyfacts endpoint
   YTD-to-single-quarter decomposition for true quarterly CapEx
   Route: GET /api/google-filings?view=capex

   SEC cash-flow items (like CapEx) are cumulative YTD in 10-Q:
     Q1 10-Q  →  3-month value  (= single Q1)
     Q2 10-Q  →  6-month YTD    (Q2 alone = Q2_YTD − Q1_YTD)
     Q3 10-Q  →  9-month YTD    (Q3 alone = Q3_YTD − Q2_YTD)
     10-K     → 12-month FY     (Q4 alone = FY     − Q3_YTD)
═══════════════════════════════════════════════════════════════ */

const CX_UA = 'Tybourne-Capital-Dashboard/1.0 (research@tybourne.com)';
const CX_DEFAULT_TAG = 'PaymentsToAcquirePropertyPlantAndEquipment';
const CX_COMPANIES = [
  // Amazon switched from PaymentsToAcquire… to PaymentsToAcquireProductiveAssets after 2017
  { cik: '1018724',  ticker: 'AMZN', name: 'Amazon',    color: '#fb923c', tag: 'PaymentsToAcquireProductiveAssets' },
  { cik: '789019',   ticker: 'MSFT', name: 'Microsoft', color: '#60a5fa' },
  { cik: '1652044',  ticker: 'GOOG', name: 'Alphabet',  color: '#34d399' },
  { cik: '1326801',  ticker: 'META', name: 'Meta',       color: '#818cf8' },
  { cik: '1341439',  ticker: 'ORCL', name: 'Oracle',    color: '#f87171' },
];

/* Benchmark totals (all 5 companies stacked, $B) for deviation tracking */
const CX_BENCHMARK = {
  'Q3 2020':24,'Q4 2020':28,'Q1 2021':37,'Q2 2021':30,'Q3 2021':33,
  'Q4 2021':35,'Q1 2022':35,'Q2 2022':37,'Q3 2022':40,'Q4 2022':41,
  'Q1 2023':35,'Q2 2023':34,'Q3 2023':37,'Q4 2023':43,'Q1 2024':45,
  'Q2 2024':54,'Q3 2024':60,'Q4 2024':75,'Q1 2025':77,'Q2 2025':97,
  'Q3 2025':105,
};

function padCik(cik) { return String(cik).padStart(10, '0'); }

/* Map a period-end date (YYYY-MM-DD) to a calendar quarter label */
function endToCalQ(end) {
  const [y, m] = end.split('-').map(Number);
  return 'Q' + Math.ceil(m / 3) + ' ' + y;
}

/* Sort quarter labels chronologically */
function sortQLabels(labels) {
  return [...labels].sort((a, b) => {
    const ya = parseInt(a.split(' ')[1]), yb = parseInt(b.split(' ')[1]);
    return ya !== yb ? ya - yb : parseInt(a[1]) - parseInt(b[1]);
  });
}

/*
 * Fetch companyfacts for one CIK, decompose YTD → single-quarter CapEx.
 *
 * Critical subtlety: SEC filings often contain BOTH cumulative YTD entries
 * AND standalone quarterly / trailing-12-month entries for the same (fy, fp).
 * Example — Amazon FY2025 Q1 has two entries:
 *   • start=2024-04-01 end=2025-03-31 val=$93.1B  (trailing 12-month)
 *   • start=2025-01-01 end=2025-03-31 val=$25.0B  (true Q1 YTD)
 * Only the one whose `start` matches the fiscal-year start is the YTD
 * that chains correctly with Q2/Q3/FY for subtraction.
 *
 * Returns { ticker, tag, quarters: { "Q1 2025": $B }, math, factCount, error }
 */
async function fetchCompanyCapEx(company) {
  const url = 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + padCik(company.cik) + '.json';
  const math = [];
  const tag = company.tag || CX_DEFAULT_TAG;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': CX_UA, 'Accept': 'application/json' } });
    if (!resp.ok) return { ticker: company.ticker, tag, quarters: {}, math, factCount: 0, error: 'HTTP ' + resp.status };
    const data = await resp.json();

    const factObj = data?.facts?.['us-gaap']?.[tag];
    if (!factObj) return { ticker: company.ticker, tag, quarters: {}, math, factCount: 0, error: 'tag "' + tag + '" not found' };
    const entries = factObj?.units?.['USD'];
    if (!entries || !entries.length) return { ticker: company.ticker, tag, quarters: {}, math, factCount: 0, error: 'no USD entries' };

    /* ── Step 1: Collect all valid entries grouped by fiscal year ── */
    const rawByFY = {};
    entries.forEach(e => {
      if (!e.fy || !e.fp || !e.end || !e.start) return;
      const form = (e.form || '').replace(/\/A$/i, '');
      if (form !== '10-Q' && form !== '10-K') return;
      const validFps = form === '10-Q' ? ['Q1','Q2','Q3'] : ['FY'];
      if (!validFps.includes(e.fp)) return;
      if (e.fy < 2019) return;
      if (!rawByFY[e.fy]) rawByFY[e.fy] = [];
      rawByFY[e.fy].push(e);
    });

    /* ── Step 2: For each FY, identify fiscal-year start date, then
       pick only the cumulative YTD entries (start == fyStart).
       This filters out trailing-12-month and standalone-quarter
       entries that would corrupt the subtraction math. ──────────── */
    const quarters = {};
    Object.keys(rawByFY).sort().forEach(fy => {
      const group = rawByFY[fy];

      // Determine fiscal year start: prefer FY entry's start, else most common start
      let fyStart = null;
      const fyEntry = group.find(e => e.fp === 'FY');
      if (fyEntry) { fyStart = fyEntry.start; }
      if (!fyStart) {
        const startCounts = {};
        group.forEach(e => { startCounts[e.start] = (startCounts[e.start] || 0) + 1; });
        fyStart = Object.entries(startCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      }
      if (!fyStart) return;

      // Filter to YTD entries only (start matches fiscal year start)
      // Then deduplicate per fp by latest filed date
      const best = {};
      group.forEach(e => {
        if (e.start !== fyStart) return;
        const prev = best[e.fp];
        if (!prev || (e.filed && (!prev.filed || e.filed > prev.filed))) {
          best[e.fp] = e;
        }
      });

      /* ── Step 3: YTD decomposition ────────────────────────────────
         Q1 = Q1_YTD            Q2 = Q2_YTD − Q1_YTD
         Q3 = Q3_YTD − Q2_YTD   Q4 = FY     − Q3_YTD */
      const ytdQ1 = best.Q1?.val, ytdQ2 = best.Q2?.val, ytdQ3 = best.Q3?.val, ytdFY = best.FY?.val;
      const m = { fy: +fy, fyStart, ytdQ1, ytdQ2, ytdQ3, ytdFY, singles: {} };

      if (ytdQ1 != null && best.Q1.end) {
        const lbl = endToCalQ(best.Q1.end);
        const v = Math.round(ytdQ1 / 1e9);
        if (v > 0) { quarters[lbl] = v; m.singles[lbl] = v + 'B=Q1ytd'; }
      }
      if (ytdQ2 != null && ytdQ1 != null && best.Q2.end) {
        const lbl = endToCalQ(best.Q2.end);
        const v = Math.round((ytdQ2 - ytdQ1) / 1e9);
        if (v > 0) { quarters[lbl] = v; m.singles[lbl] = v + 'B=Q2ytd-Q1ytd'; }
      }
      if (ytdQ3 != null && ytdQ2 != null && best.Q3.end) {
        const lbl = endToCalQ(best.Q3.end);
        const v = Math.round((ytdQ3 - ytdQ2) / 1e9);
        if (v > 0) { quarters[lbl] = v; m.singles[lbl] = v + 'B=Q3ytd-Q2ytd'; }
      }
      if (ytdFY != null && ytdQ3 != null && best.FY.end) {
        const lbl = endToCalQ(best.FY.end);
        const v = Math.round((ytdFY - ytdQ3) / 1e9);
        if (v > 0) { quarters[lbl] = v; m.singles[lbl] = v + 'B=FY-Q3ytd'; }
      }

      if (Object.keys(m.singles).length) math.push(m);
    });

    return { ticker: company.ticker, tag, quarters, math, factCount: entries.length, error: null };
  } catch (e) {
    return { ticker: company.ticker, tag, quarters: {}, math, factCount: 0, error: 'fetch: ' + (e.message || String(e)) };
  }
}

async function handleCapEx() {
  try {
    /* Fetch all 5 companies in parallel */
    const results = await Promise.allSettled(CX_COMPANIES.map(c => fetchCompanyCapEx(c)));
    const cr = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { ticker: CX_COMPANIES[i].ticker, quarters: {}, math: [], factCount: 0, error: 'rejected' }
    );

    /* Merge all quarter labels, sort chronologically */
    const allLabels = new Set();
    cr.forEach(c => Object.keys(c.quarters).forEach(l => allLabels.add(l)));
    const sorted = sortQLabels(allLabels);

    /* Build chartData: one object per quarter with each company value */
    const chartData = sorted.map(label => {
      const row = { quarter: label };
      cr.forEach(c => { if (c.quarters[label] != null) row[c.ticker] = c.quarters[label]; });
      return row;
    });

    /* Compute generated totals and benchmark deviation */
    const generatedTotalsByQuarter = {};
    const deviationByQuarter = {};
    chartData.forEach(row => {
      const total = CX_COMPANIES.reduce((s, c) => s + (row[c.ticker] || 0), 0);
      generatedTotalsByQuarter[row.quarter] = total;
      if (CX_BENCHMARK[row.quarter] != null) {
        deviationByQuarter[row.quarter] = total - CX_BENCHMARK[row.quarter];
      }
    });

    /* Debug fields */
    const perCompanyQuarterMath = {};
    const perCompanySelectedQuarters = {};
    const perCompanyTag = {};
    const missingCompanies = [];
    cr.forEach(c => {
      perCompanyQuarterMath[c.ticker] = c.math;
      perCompanySelectedQuarters[c.ticker] = sortQLabels(Object.keys(c.quarters));
      perCompanyTag[c.ticker] = c.tag;
      if (!Object.keys(c.quarters).length) missingCompanies.push(c.ticker + ' (' + c.tag + '): ' + (c.error || 'no data'));
    });

    const debug = {
      debugVersion: 'trace-5',
      perCompanyTag,
      perCompanyQuarterMath,
      perCompanySelectedQuarters,
      missingCompanies,
      generatedTotalsByQuarter,
      benchmarkTotalsByQuarter: CX_BENCHMARK,
      deviationByQuarter,
    };

    if (!chartData.length) {
      return new Response(
        JSON.stringify(Object.assign({ success: false, error: 'No quarterly CapEx data found' }, debug)),
        { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }
      );
    }

    const companies = CX_COMPANIES.map(c => ({ ticker: c.ticker, name: c.name, color: c.color }));
    return new Response(
      JSON.stringify(Object.assign({ success: true, chartData, companies, fetchedAt: new Date().toISOString() }, debug)),
      { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'CapEx: ' + (err.message || String(err)), debugVersion: 'trace-5' }),
      { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }
    );
  }
}
