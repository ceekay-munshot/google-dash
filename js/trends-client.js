'use strict';

/* =============================================================================
   GOOGLE TRENDS CLIENT
   Fetches via Firecrawl scrape API directly from browser.
   Firecrawl allows browser CORS calls with API key.
   ============================================================================= */

(function (global) {

  var FC_KEY   = 'fc-203d41c5b1984cdabee2a7564572efea';
  var FC_BASE  = 'https://api.firecrawl.dev/v1/scrape';
  var TERMS    = ['Gemini AI', 'ChatGPT', 'Claude AI', 'Perplexity', 'Copilot'];
  var CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
  var _cache   = {};
  var _fetching = {};

  function fetchTrends(windowKey) {
    windowKey = windowKey || '12m';
    var now    = Date.now();
    var cached = _cache[windowKey];
    if (cached && (now - cached.ts) < CACHE_TTL) {
      return Promise.resolve({ ok: true, payload: cached.payload, stale: false });
    }
    if (_fetching[windowKey]) return _fetching[windowKey];

    var gtDate = windowKey === '3m' ? 'today 3-m' : 'today 12-m';
    var gtUrl  = 'https://trends.google.com/trends/explore?q=' +
      encodeURIComponent(TERMS.join(',')) + '&date=' + encodeURIComponent(gtDate);

    var p = fetch(FC_BASE, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + FC_KEY },
      body: JSON.stringify({ url: gtUrl, formats: ['markdown'], onlyMainContent: true, waitFor: 3000 })
    })
    .then(function(r) { return r.json(); })
    .then(function(resp) {
      delete _fetching[windowKey];
      var md = resp && resp.data && resp.data.markdown ? resp.data.markdown : '';
      var series = parseTrendsMd(md);
      var body = {
        success: true, fetchedAt: new Date().toISOString(),
        window: windowKey, terms: TERMS, series: series,
        summary: buildSummary(series)
      };
      _cache[windowKey] = { payload: body, ts: now };
      return { ok: true, payload: body, stale: false };
    })
    .catch(function(err) {
      delete _fetching[windowKey];
      if (cached) return { ok: true, payload: cached.payload, stale: true, error: err.message };
      return { ok: false, payload: null, error: err.message };
    });

    _fetching[windowKey] = p;
    return p;
  }

  function parseTrendsMd(md) {
    /* Google Trends pages are JS-heavy; if Firecrawl gets data, great.
       If not, return empty series so the chart shows gracefully. */
    var series = TERMS.map(function(t) { return { term: t, data: [] }; });
    if (!md) return series;
    // Try to find number patterns associated with term names
    TERMS.forEach(function(term, i) {
      var re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '[\\s\\S]{0,200}?(\\d{1,3})', 'i');
      var m  = md.match(re);
      if (m) { series[i].data = [{ date: new Date().toISOString().slice(0,10), value: parseInt(m[1],10) }]; }
    });
    return series;
  }

  function buildSummary(series) {
    return (series||[]).map(function(s, idx) {
      var vals = (s.data||[]).map(function(d){ return d.value; }).filter(function(v){ return typeof v==='number'; });
      var latest = vals.length ? vals[vals.length-1] : null;
      return { term: s.term, latest: latest, windowChangePct: null, rank: idx+1 };
    }).sort(function(a,b){ return (b.latest||0)-(a.latest||0); })
      .map(function(r,i){ return Object.assign({},r,{rank:i+1}); });
  }

  /* ── Render helpers ── */
  function loadGeminiTrends(cb) {
    fetchTrends('12m').then(function(result) {
      renderTrendsChart(result, 'chart-gt-12m');
      renderTrendsSummary(result);
      if (typeof cb === 'function') cb(result);
    });
  }

  function loadExecGTOverlay() {
    fetchTrends('12m').then(function(result) {
      renderTrendsChart(result, 'chart-gt-exec');
    });
  }

  function renderTrendsChart(result, canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    var existing = Chart.getChart ? Chart.getChart(canvas) : null;
    if (existing) existing.destroy();

    if (!result || !result.ok || !result.payload || !result.payload.series) return;
    var colors = ['#4e9de3','#2ecc71','#f39c12','#e74c3c','#a06cd5'];

    new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: (result.payload.series[0]&&result.payload.series[0].data||[]).map(function(d){ return d.date||''; }),
        datasets: result.payload.series.map(function(s, i) {
          return {
            label: s.term,
            data:  s.data.map(function(d){ return d.value; }),
            borderColor: colors[i%colors.length],
            borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false
          };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: { min: 0, max: 100 } }
      }
    });
  }

  function renderTrendsSummary(result) {
    var el = document.getElementById('gt-summary-strip');
    if (!el || !result || !result.payload || !result.payload.summary) return;
    el.innerHTML = (result.payload.summary||[]).map(function(r) {
      return '<span class="gt-sum-item"><b>' + r.term + '</b> ' + (r.latest !== null ? r.latest : '—') + '</span>';
    }).join('');
  }

  function flushCache() { _cache = {}; }

  global.TrendsClient = {
    fetchTrends:        fetchTrends,
    loadGeminiTrends:   loadGeminiTrends,
    loadExecGTOverlay:  loadExecGTOverlay,
    flushCache:         flushCache
  };

}(window));
