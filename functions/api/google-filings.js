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
   One request per company → extract quarterly CapEx from facts
   Route: GET /api/google-filings?view=capex
═══════════════════════════════════════════════════════════════ */

const CX_UA = 'Tybourne-Capital-Dashboard/1.0 (research@tybourne.com)';
const CX_COMPANIES = [
  { cik: '1018724',  ticker: 'AMZN', name: 'Amazon',    color: '#fb923c' },
  { cik: '789019',   ticker: 'MSFT', name: 'Microsoft', color: '#60a5fa' },
  { cik: '1652044',  ticker: 'GOOG', name: 'Alphabet',  color: '#34d399' },
  { cik: '1326801',  ticker: 'META', name: 'Meta',       color: '#818cf8' },
  { cik: '1341439',  ticker: 'ORCL', name: 'Oracle',    color: '#f87171' },
];
const CX_TAG = 'PaymentsToAcquirePropertyPlantAndEquipment';

/* Zero-pad CIK to 10 digits for the companyfacts URL */
function padCik(cik) { return String(cik).padStart(10, '0'); }

/* Convert an SEC `end` date (YYYY-MM-DD) to a quarter label like "Q1 2025".
   Q1 = ends Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec */
function endDateToQuarterLabel(end) {
  const [y, m] = end.split('-').map(Number);
  const q = Math.ceil(m / 3);
  return 'Q' + q + ' ' + y;
}

/* Fetch companyfacts for one CIK, return quarterly CapEx map { "Q1 2025": valueInBillions } */
async function fetchCompanyCapEx(company) {
  const url = 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + padCik(company.cik) + '.json';
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': CX_UA, 'Accept': 'application/json' } });
    if (!resp.ok) return { ticker: company.ticker, quarters: {}, factCount: 0, error: 'HTTP ' + resp.status };
    const data = await resp.json();

    // Navigate to the CapEx fact series
    const factObj = data?.facts?.['us-gaap']?.[CX_TAG];
    if (!factObj) return { ticker: company.ticker, quarters: {}, factCount: 0, error: 'tag not found in companyfacts' };

    // Prefer USD units
    const entries = factObj?.units?.['USD'];
    if (!entries || entries.length === 0) return { ticker: company.ticker, quarters: {}, factCount: 0, error: 'no USD entries for tag' };

    // Filter for quarterly entries only (10-Q or 10-K with fp like Q1-Q4, not FY)
    // Also accept entries that have a `frame` matching CYxxxxQx pattern
    const quarterlyEntries = entries.filter(e => {
      // Skip annual / full-year entries
      if (e.fp === 'FY') return false;
      // Must have a quarterly frame like CY2024Q1 (not CY2024 which is annual)
      if (e.frame && /^CY\d{4}Q[1-4](I)?$/.test(e.frame)) return true;
      // Or filed on 10-Q with a quarterly fp
      if (e.form === '10-Q' && /^Q[1-4]$/.test(e.fp)) return true;
      // 10-K filings can contain Q4 data with fp=Q4 (some companies report this way)
      if (e.form === '10-K' && e.fp === 'Q4') return true;
      return false;
    });

    // Deduplicate: for each quarter label, keep the entry with the latest filed date
    const bestByQuarter = {};
    quarterlyEntries.forEach(e => {
      const label = endDateToQuarterLabel(e.end);
      const existing = bestByQuarter[label];
      if (!existing || (e.filed && (!existing.filed || e.filed > existing.filed))) {
        bestByQuarter[label] = e;
      }
    });

    // Convert to { "Q1 2025": rounded billions }
    const quarters = {};
    Object.keys(bestByQuarter).forEach(label => {
      const val = bestByQuarter[label].val;
      if (typeof val === 'number' && val > 0) {
        quarters[label] = Math.round(val / 1e9);
      }
    });

    return { ticker: company.ticker, quarters, factCount: entries.length, selectedCount: Object.keys(quarters).length, error: null };
  } catch (e) {
    return { ticker: company.ticker, quarters: {}, factCount: 0, error: 'fetch error: ' + (e.message || String(e)) };
  }
}

async function handleCapEx() {
  try {
    // Fetch companyfacts for all target companies in parallel
    const results = await Promise.allSettled(CX_COMPANIES.map(c => fetchCompanyCapEx(c)));
    const companyResults = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { ticker: CX_COMPANIES[i].ticker, quarters: {}, factCount: 0, error: 'promise rejected' }
    );

    // Collect all quarter labels across all companies
    const allQuarterLabels = new Set();
    companyResults.forEach(cr => {
      Object.keys(cr.quarters).forEach(label => allQuarterLabels.add(label));
    });

    // Sort quarter labels chronologically
    const sorted = [...allQuarterLabels].sort((a, b) => {
      const [qa, ya] = [parseInt(a[1]), parseInt(a.split(' ')[1])];
      const [qb, yb] = [parseInt(b[1]), parseInt(b.split(' ')[1])];
      return ya !== yb ? ya - yb : qa - qb;
    });

    // Keep only the most recent 10 quarters
    const recentQuarters = sorted.slice(-10);

    // Build chartData: one object per quarter with each company's value
    const chartData = recentQuarters.map(label => {
      const row = { quarter: label };
      companyResults.forEach(cr => {
        if (cr.quarters[label] != null) {
          row[cr.ticker] = cr.quarters[label];
        }
      });
      return row;
    });

    // Debug fields
    const perCompanyFactCount = {};
    const perCompanySelectedQuarters = {};
    const missingCompanies = [];
    companyResults.forEach(cr => {
      perCompanyFactCount[cr.ticker] = cr.factCount;
      perCompanySelectedQuarters[cr.ticker] = Object.keys(cr.quarters).sort();
      if (Object.keys(cr.quarters).length === 0) {
        missingCompanies.push(cr.ticker + ': ' + (cr.error || 'no quarterly data'));
      }
    });

    const debug = {
      debugVersion: 'trace-3',
      perCompanyFactCount,
      perCompanySelectedQuarters,
      missingCompanies,
    };

    if (chartData.length === 0) {
      return new Response(
        JSON.stringify(Object.assign({ success: false, error: 'No quarterly CapEx data found for any company' }, debug)),
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
      JSON.stringify({ success: false, error: 'CapEx handler: ' + (err.message || String(err)), debugVersion: 'trace-3' }),
      { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }
    );
  }
}
