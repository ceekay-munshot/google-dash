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

    // Include a snippet of the raw markdown for debugging parsing issues
    const mdSnippet = md ? md.slice(0, 600) : '';
    return jsonOk({
      success:   true,
      ...kpis,
      source:    exhibitUrl,
      fetchedAt: new Date().toISOString(),
      _debug: { mdLength: md ? md.length : 0, mdSnippet },
    });

  } catch (err) {
    return jsonOk({ success: false, error: err.message });
  }
}

/* ── Step 1: Find latest exhibit 99.1 URL ─────────────────────────────
   Uses SEC EDGAR EFTS JSON search API directly (no Firecrawl needed).
   This auto-discovers new filings as Alphabet publishes them.
──────────────────────────────────────────────────────────────────── */
async function findLatestExhibit() {
  // Strategy 1: SEC EFTS full-text search — returns JSON with filing URLs
  // Dynamically compute startdt: 18 months ago, so it always finds the latest filing
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 18);
  const startdt = startDate.toISOString().slice(0, 10);
  const eftsUrl = 'https://efts.sec.gov/LATEST/search-index?q=%22exhibit+99.1%22+%22Google+Search%22&forms=8-K&dateRange=custom&startdt=' + startdt + '&entity=Alphabet+Inc';

  try {
    const eftsResp = await fetch(eftsUrl, {
      headers: { 'User-Agent': 'Tybourne-Capital-Dashboard/1.0 (research@tybourne.com)', 'Accept': 'application/json' }
    });
    if (eftsResp.ok) {
      const eftsData = await eftsResp.json();
      // EFTS returns hits[] with file_url or _source.file_url
      const hits = eftsData?.hits?.hits || [];
      for (const hit of hits) {
        const fileUrl = hit?._source?.file_url || hit?.file_url || '';
        if (fileUrl && /exhibit99/i.test(fileUrl)) {
          return fileUrl.startsWith('http') ? fileUrl : 'https://www.sec.gov' + fileUrl;
        }
      }
    }
  } catch (_) {}

  // Strategy 2: SEC EDGAR company filings JSON API — no scraping needed
  try {
    const filingsUrl = 'https://data.sec.gov/submissions/CIK0001652044.json';
    const filingsResp = await fetch(filingsUrl, {
      headers: { 'User-Agent': 'Tybourne-Capital-Dashboard/1.0 (research@tybourne.com)', 'Accept': 'application/json' }
    });
    if (filingsResp.ok) {
      const filingsData = await filingsResp.json();
      const recent = filingsData?.filings?.recent;
      if (recent && recent.form && recent.accessionNumber && recent.primaryDocument) {
        // Find most recent 8-K filing
        for (let i = 0; i < recent.form.length && i < 50; i++) {
          if (recent.form[i] === '8-K') {
            const accn = recent.accessionNumber[i].replace(/-/g, '');
            const doc = recent.primaryDocument[i];
            // Check if the primary doc is an exhibit99
            if (/exhibit99|ex99/i.test(doc)) {
              return 'https://www.sec.gov/Archives/edgar/data/1652044/' + accn + '/' + doc;
            }
            // Otherwise try to find exhibit99 in the filing index
            const indexUrl = 'https://www.sec.gov/Archives/edgar/data/1652044/' + accn + '/';
            try {
              const idxMd = await firecrawlScrape(indexUrl);
              if (idxMd) {
                const exMatch = idxMd.match(/(?:exhibit991|exhibit99_1|ex99|exhibit99)[^\s)"']*\.htm[^\s)"']*/i);
                if (exMatch) {
                  return indexUrl + exMatch[0];
                }
              }
            } catch (_) {}
            // Even if we can't find the exhibit, try primary doc — it might be the press release
            return 'https://www.sec.gov/Archives/edgar/data/1652044/' + accn + '/' + doc;
          }
        }
      }
    }
  } catch (_) {}

  // Strategy 3: Firecrawl scrape of EDGAR search page as last resort
  try {
    const md = await firecrawlScrape('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001652044&type=8-K&dateb=&owner=include&count=5');
    if (md) {
      const pat = /https?:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1652044\/[^\s)"'\n]+(?:exhibit991|exhibit99_1|ex99|goog)[^\s)"'\n]*\.htm[^\s)"'\n]*/gi;
      const matches = [...md.matchAll(pat)];
      if (matches.length) {
        return matches[0][0].split(')')[0].split('"')[0].split("'")[0].trim();
      }
    }
  } catch (_) {}

  // Final fallback: known Q4 2025 URL (will be stale for future quarters)
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
  // Alphabet tables use: "Google Search & other | $54,034 | $63,073"
  // We want the LATEST (rightmost) 5-6 digit number in that row.
  // Also handles "$XX.X billion" prose format.
  const searchMatch = text.match(
    /Google Search[^\n|]*?\|\s*\$?[\d,]+\s*\|\s*\$?([\d,]{5,7})/i
  ) || text.match(
    /Google Search[^\n]*?([\d]{2},[\d]{3})/ig
  ) || text.match(
    /Search & other[^\n]*?\|\s*\$?[\d,]+\s*\|\s*\$?([\d,]{5,7})/i
  ) || text.match(
    /Search[^$\n]{0,40}\$([\d,.]+)\s*billion/i
  );
  if (searchMatch) {
    // For the global regex fallback, take the last match
    let rawStr;
    if (searchMatch.length > 1 && searchMatch[1]) {
      rawStr = searchMatch[1];
    } else {
      // Global regex: extract number from last match
      const allMatches = text.match(/Google Search[^\n]*?([\d]{2},[\d]{3})/ig);
      if (allMatches) {
        const lastRow = allMatches[allMatches.length - 1];
        const nums = [...lastRow.matchAll(/([\d]{2},[\d]{3})/g)];
        rawStr = nums.length ? nums[nums.length - 1][1] : null;
      }
    }
    if (rawStr) {
      // Check if it's in "billion" format
      if (/billion/i.test(searchMatch[0])) {
        const bn = parseFloat(rawStr);
        kpis.searchRevenue = '$' + bn.toFixed(1) + 'B';
      } else {
        const raw = rawStr.replace(/,/g, '');
        const num = parseInt(raw);
        kpis.searchRevenue = num > 1000 ? '$' + (num / 1000).toFixed(1) + 'B' : '$' + raw + 'M';
      }
    }
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
   CapEx handler — SEC EDGAR companyconcept (per tag, per company)
   YTD-to-single-quarter decomposition for true quarterly CapEx
   Route: GET /api/google-filings?view=capex

   KEY: uses /api/xbrl/companyconcept/ instead of /companyfacts/.
   companyfacts returns ALL XBRL facts (10-50 MB per company) —
   too large for CF Pages' wall-clock limit. companyconcept returns
   only the specific tag (a few KB), so all 5 fetches finish fast.

   SEC cash-flow items (like CapEx) are cumulative YTD in 10-Q:
     Q1 10-Q  →  3-month value  (= single Q1)
     Q2 10-Q  →  6-month YTD    (Q2 alone = Q2_YTD − Q1_YTD)
     Q3 10-Q  →  9-month YTD    (Q3 alone = Q3_YTD − Q2_YTD)
     10-K     → 12-month FY     (Q4 alone = FY     − Q3_YTD)
═══════════════════════════════════════════════════════════════ */

const CX_UA = 'Tybourne-Capital-Dashboard/1.0 (research@tybourne.com)';
const CX_DEFAULT_TAG = 'PaymentsToAcquirePropertyPlantAndEquipment';
const CX_COMPANIES = [
  // Amazon switched to PaymentsToAcquireProductiveAssets after 2017
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

function endToCalQ(end) {
  const [y, m] = end.split('-').map(Number);
  return 'Q' + Math.ceil(m / 3) + ' ' + y;
}

function sortQLabels(labels) {
  return [...labels].sort((a, b) => {
    const ya = parseInt(a.split(' ')[1]), yb = parseInt(b.split(' ')[1]);
    return ya !== yb ? ya - yb : parseInt(a[1]) - parseInt(b[1]);
  });
}

/*
 * Fetch one company's CapEx via companyconcept (tag-specific, ~KB not MB).
 * URL: /api/xbrl/companyconcept/CIK{padded}/us-gaap/{tag}.json
 * Response: { units: { USD: [ {fy,fp,form,start,end,val,filed,...}, ... ] } }
 *
 * Decompose YTD → single-quarter, filtering out trailing/standalone entries
 * when multiple entries exist for the same (fy, fp) with different start dates.
 */
async function fetchCompanyCapEx(company) {
  const tag = company.tag || CX_DEFAULT_TAG;
  const url = 'https://data.sec.gov/api/xbrl/companyconcept/CIK' + padCik(company.cik) + '/us-gaap/' + tag + '.json';
  const math = [];
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': CX_UA, 'Accept': 'application/json' } });
    if (!resp.ok) return { ticker: company.ticker, tag, quarters: {}, math, factCount: 0, error: 'HTTP ' + resp.status };
    const data = await resp.json();

    // companyconcept puts entries directly under units (not facts.us-gaap.tag.units)
    const entries = data?.units?.['USD'];
    if (!entries || !entries.length) return { ticker: company.ticker, tag, quarters: {}, math, factCount: 0, error: 'no USD entries' };

    /* ── Step 1: Group valid entries by fiscal year ──────────────── */
    const rawByFY = {};
    entries.forEach(e => {
      if (!e.fy || !e.fp || !e.end) return;
      const form = (e.form || '').replace(/\/A$/i, '');
      if (form !== '10-Q' && form !== '10-K') return;
      const validFps = form === '10-Q' ? ['Q1','Q2','Q3'] : ['FY'];
      if (!validFps.includes(e.fp)) return;
      if (e.fy < 2019) return;
      if (!rawByFY[e.fy]) rawByFY[e.fy] = [];
      rawByFY[e.fy].push(e);
    });

    /* ── Step 2: Per FY, find fyStart and keep only YTD entries ─── */
    const quarters = {};
    Object.keys(rawByFY).sort().forEach(fy => {
      const group = rawByFY[fy];

      // Detect fiscal-year start from entries that have a `start` field
      let fyStart = null;
      const fyEntry = group.find(e => e.fp === 'FY' && e.start);
      if (fyEntry) { fyStart = fyEntry.start; }
      if (!fyStart) {
        const startCounts = {};
        group.forEach(e => { if (e.start) startCounts[e.start] = (startCounts[e.start] || 0) + 1; });
        const sorted = Object.entries(startCounts).sort((a, b) => b[1] - a[1]);
        if (sorted.length) fyStart = sorted[0][0];
      }

      // Keep only YTD entries: if entry has `start`, it must match fyStart.
      // Entries without `start` (older filings) pass through — no ambiguity.
      const best = {};
      group.forEach(e => {
        if (fyStart && e.start && e.start !== fyStart) return;
        const prev = best[e.fp];
        if (!prev || (e.filed && (!prev.filed || e.filed > prev.filed))) {
          best[e.fp] = e;
        }
      });

      /* ── Step 3: YTD decomposition ──────────────────────────────── */
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
    // Fetch all 5 companies in parallel — companyconcept responses are small (~KB)
    const results = await Promise.allSettled(CX_COMPANIES.map(c => fetchCompanyCapEx(c)));
    const cr = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { ticker: CX_COMPANIES[i].ticker, tag: CX_COMPANIES[i].tag || CX_DEFAULT_TAG, quarters: {}, math: [], factCount: 0, error: 'rejected' }
    );

    // Merge all quarter labels, sort chronologically
    const allLabels = new Set();
    cr.forEach(c => Object.keys(c.quarters).forEach(l => allLabels.add(l)));
    const sorted = sortQLabels(allLabels);

    // Build chartData
    const chartData = sorted.map(label => {
      const row = { quarter: label };
      cr.forEach(c => { if (c.quarters[label] != null) row[c.ticker] = c.quarters[label]; });
      return row;
    });

    // Generated totals vs benchmark
    const generatedTotalsByQuarter = {};
    const deviationByQuarter = {};
    chartData.forEach(row => {
      const total = CX_COMPANIES.reduce((s, c) => s + (row[c.ticker] || 0), 0);
      generatedTotalsByQuarter[row.quarter] = total;
      if (CX_BENCHMARK[row.quarter] != null) {
        deviationByQuarter[row.quarter] = total - CX_BENCHMARK[row.quarter];
      }
    });

    // Debug
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
      debugVersion: 'trace-6',
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
      JSON.stringify({ success: false, error: 'CapEx: ' + (err.message || String(err)), debugVersion: 'trace-6' }),
      { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) }
    );
  }
}
