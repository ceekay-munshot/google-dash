'use strict';

/* =============================================================================
   TYBOURNE CAPITAL — EXECUTIVE SUMMARY LIVE RADAR WIRING
   js/exec-radar.js  (v3 — Genspark-first, clean fallbacks)

   Scope: ONLY the Executive Summary tab (tab-executive).
   Touches: Cards 1 & 2, API-summary strips beneath each Radar module.

   Card 1: TOTAL AI USAGE PROXY
   ─────────────────────────────
   Primary: GensparkProxy.fetchAiBotActivity() → scrapes radar.cloudflare.com/ai
   Fallback: Show last 12-week trend from Cloudflare Radar embed (iframes stay
             visible). Card shows "Live data unavailable — see chart below".
   NEVER shows synthetic/fake numbers. If live fails, card shows embed note.

   Card 2: GEMINI API USAGE RANK
   ──────────────────────────────
   Primary: ORClient.loadExecStrip() → OpenRouter weekly token rankings via Genspark
   Secondary signal: localStorage-persisted daily rank snapshots (Cloudflare Radar).
   This file wires ONLY the secondary (CF Radar) fallback signal.
   ORClient handles the primary OpenRouter card entirely.

   Fallback policy
   ───────────────
   If ANY API call fails: embed iframes remain visible.
   Cards show "Live data unavailable — embed fallback active".
   Cards 3 & 4 (Search Volume / Pricing) are NOT touched by this file.
   ============================================================================= */

(function () {

  /* ----------------------------------------------------------------
     1. STATE
  ---------------------------------------------------------------- */
  var _activeRange = '12w';

  /* localStorage key and retention limit for rank history */
  var LS_KEY      = 'TC_GEMINI_RANK_HISTORY';
  var MAX_HISTORY = 30;

  /* ----------------------------------------------------------------
     2. SMALL DOM / STRING HELPERS
  ---------------------------------------------------------------- */
  function setEl(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function trendClass(pct) {
    if (pct === null || pct === undefined) return 'trend-neutral';
    if (pct > 1)  return 'trend-green';
    if (pct < -1) return 'trend-red';
    return 'trend-amber';
  }

  function directionIcon(pct) {
    if (pct === null || pct === undefined) return '<i class="fas fa-minus"></i>';
    if (pct > 1)  return '<i class="fas fa-arrow-up"></i>';
    if (pct < -1) return '<i class="fas fa-arrow-down"></i>';
    return '<i class="fas fa-arrows-alt-h"></i>';
  }

  /* ----------------------------------------------------------------
     3. RANGE-TOGGLE UI
  ---------------------------------------------------------------- */
  function _setRangeBtn(rangeKey) {
    ['exec-range-4w', 'exec-range-12w', 'exec-range-24w'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle('active', id === ('exec-range-' + rangeKey));
    });
  }

  /* Called from onclick on the range toggle buttons (wired in index.html) */
  window.execSetRange = function (rangeKey) {
    _activeRange = rangeKey;
    _setRangeBtn(rangeKey);
    loadExecRadarData(rangeKey);
  };

  /* ----------------------------------------------------------------
     4. RANK HISTORY PERSISTENCE  (localStorage)
        One { date, rank } entry per calendar day.
  ---------------------------------------------------------------- */
  function _loadRankHistory() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function _saveRankHistory(history) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(history));
    } catch (e) {}
  }

  function _appendRankSnapshot(rank, serviceName) {
    var today   = new Date().toISOString().slice(0, 10);
    var history = _loadRankHistory();
    var last    = history[history.length - 1];

    if (last && last.date === today) {
      last.rank = rank;
      last.name = serviceName || last.name;
    } else {
      history.push({ date: today, rank: rank, name: serviceName || 'Gemini' });
    }

    if (history.length > MAX_HISTORY) {
      history = history.slice(history.length - MAX_HISTORY);
    }

    _saveRankHistory(history);
    return history;
  }

  function _computeRankDelta(currentRank) {
    var today   = new Date().toISOString().slice(0, 10);
    var history = _loadRankHistory();
    var prior   = null;

    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].date !== today) { prior = history[i]; break; }
    }

    if (!prior) return { delta: null, prevDate: null, prevRank: null };

    return {
      delta:    prior.rank - currentRank,
      prevDate: prior.date,
      prevRank: prior.rank
    };
  }

  /* ----------------------------------------------------------------
     5. CARD 1 — TOTAL AI USAGE PROXY
        Primary: GensparkProxy → radar.cloudflare.com/ai
        Fallback: Clean "see embed below" note
  ---------------------------------------------------------------- */
  function _renderCard1Loading() {
    setEl('exec-usage-value',
      '<div class="exec-card-value trend-neutral"><i class="fas fa-spinner fa-spin" style="font-size:14px"></i></div>');
    setEl('exec-usage-trend',
      '<div class="exec-card-trend trend-neutral">fetching&hellip;</div>');
    setEl('exec-usage-api-note',
      '<span class="exec-api-note exec-api-note--loading">' +
      '<i class="fas fa-spinner fa-spin"></i> Fetching live AI crawler data&hellip;</span>');
  }

  function _renderCard1Fallback(errorMsg) {
    setEl('exec-usage-value',
      '<div class="exec-card-value trend-neutral">&mdash;</div>');
    setEl('exec-usage-trend',
      '<div class="exec-card-trend trend-neutral">' +
      '<i class="fas fa-info-circle"></i> See chart below</div>');
    setEl('exec-usage-delta-ww',
      '<span class="ed-val delta-neu">&mdash;</span>');
    setEl('exec-usage-api-note',
      '<span class="exec-api-note exec-api-note--warn">' +
      '<i class="fas fa-exclamation-triangle"></i> ' +
      'Live data unavailable &mdash; embed fallback active' +
      (errorMsg ? ' &middot; ' + String(errorMsg).slice(0, 60) : '') +
      '</span>');
  }

  function _renderCard1FromGenspark(result) {
    if (!result || !result.ok || !result.crawlers || result.crawlers.length === 0) {
      _renderCard1Fallback(result && result.error);
      return;
    }

    /* Total WoW change */
    var totalChange = result.totalChange || {};
    var pct         = (typeof totalChange.pct === 'number') ? totalChange.pct : null;
    var cls         = trendClass(pct);

    setEl('exec-usage-value',
      '<div class="exec-card-value ' + cls + '">' +
      (pct !== null ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' : '&mdash;') +
      '</div>');

    setEl('exec-usage-trend',
      '<div class="exec-card-trend ' + cls + '">' +
      directionIcon(pct) + ' ' + (totalChange.period || 'WoW') + ' change' +
      '</div>');

    setEl('exec-usage-delta-ww',
      '<span class="ed-val ' + (pct !== null && pct >= 0 ? 'delta-pos' : 'delta-neg') + '">' +
      (pct !== null ? (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' : '&mdash;') +
      '</span>');

    setEl('exec-usage-api-note',
      '<span class="exec-api-note exec-api-note--live">' +
      '<i class="fas fa-circle"></i> Live &middot; Cloudflare Radar (via AI)</span>');

    /* Sparkline from crawler shares */
    var crawlers  = result.crawlers || [];
    var sparkVals = crawlers.slice(0, 12).map(function (c) { return c.share || 0; });
    var C         = (typeof getC === 'function') ? getC() : { green: '#2ecc71', red: '#e74c3c', amber: '#f39c12' };
    var sColor    = pct > 1 ? C.green : pct < -1 ? C.red : C.amber;
    if (typeof drawSparkline === 'function' && sparkVals.length > 0) {
      drawSparkline('spark-usage', sparkVals, sColor);
    }

    /* Bot traffic strip */
    var container = document.getElementById('exec-bot-summary-strip');
    if (container && crawlers.length > 0) {
      var maxS = crawlers.reduce(function (mx, c) { return Math.max(mx, c.share || 0); }, 0) || 1;
      var html = '<div class="exec-summary-strip">' +
        '<div class="ess-title">Top AI Crawlers &mdash; current' +
        ' <span style="font-size:10px;margin-left:8px;color:var(--green)">' +
        '<i class="fas fa-circle" style="font-size:7px"></i> Live</span></div>' +
        '<div class="ess-bars">';
      crawlers.slice(0, 8).forEach(function (c) {
        var isG  = /google|gemini/i.test(c.name || '');
        var barW = Math.round(((c.share || 0) / maxS) * 100);
        var col  = isG ? 'var(--blue)' : 'var(--text-muted)';
        html += '<div class="ess-bar-row">' +
          '<div class="ess-bar-label">' + _esc(c.name || '') +
          (isG ? ' <span class="ess-gemini-tag">Google</span>' : '') + '</div>' +
          '<div class="ess-bar-track"><div class="ess-bar-fill" style="width:' + barW + '%;background:' + col + '"></div></div>' +
          '<div class="ess-bar-pct">' + (c.share || 0).toFixed(1) + '%</div>' +
          '</div>';
      });
      html += '</div><div class="ess-note">Share of AI bot HTTP traffic. Directional proxy only.</div></div>';
      container.innerHTML = html;
    }
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ----------------------------------------------------------------
     6. CARD 2 — GEMINI TRAFFIC RANK (Secondary signal only)
        Primary: ORClient handles this card.
        This function handles the secondary CF Radar rank signal.
  ---------------------------------------------------------------- */
  function renderGeminiShareCard(result) {
    if (!result || !result.ok) {
      setEl('exec-share-api-note',
        '<span class="exec-api-note exec-api-note--warn">' +
        '<i class="fas fa-exclamation-triangle"></i> ' +
        'Live data unavailable &mdash; embed fallback active' +
        '</span>');

      /* Show last stored rank if available */
      var hist = _loadRankHistory();
      if (hist.length > 0) {
        var last = hist[hist.length - 1];
        setEl('exec-share-value',
          '<div class="exec-card-value trend-neutral">#' + last.rank +
          ' <span style="font-size:11px;font-weight:400;color:var(--text-muted)">' +
          '(last stored ' + last.date + ')</span></div>');
        setEl('exec-share-rank-row',
          '<span class="ed-val delta-neu">Last stored: #' + last.rank + ' on ' + last.date + '</span>');
      }
      return;
    }

    var RC = window.RadarClient;
    if (!RC || typeof RC.parseInternetServiceTop !== 'function') {
      /* RadarClient not available — just show "powered by OR" note */
      setEl('exec-share-api-note',
        '<span class="exec-api-note exec-api-note--warn">' +
        '<i class="fas fa-info-circle"></i> CF Radar secondary signal unavailable</span>');
      return;
    }

    var services = RC.parseInternetServiceTop(result.data);

    if (!services || services.length === 0) {
      setEl('exec-share-api-note',
        '<span class="exec-api-note exec-api-note--warn">' +
        '<i class="fas fa-exclamation-triangle"></i> ' +
        'Generative AI ranking not in API response' +
        '</span>');
      return;
    }

    /* Find Gemini */
    var geminiEntry = null;
    services.forEach(function(s, idx) {
      var name = (s.name || '').toLowerCase();
      if (!geminiEntry && (
            name.indexOf('gemini') !== -1 ||
            name.indexOf('google ai') !== -1
          )) {
        geminiEntry = { rank: s.rank || (idx + 1), name: s.name };
      }
    });

    if (!geminiEntry) {
      setEl('exec-share-value',
        '<div class="exec-card-value trend-amber">Not in top ' + services.length + '</div>');
      setEl('exec-share-api-note',
        '<span class="exec-api-note exec-api-note--warn">' +
        '<i class="fas fa-info-circle"></i> Not in Generative AI top set this fetch' +
        '</span>');
      return;
    }

    var rank     = geminiEntry.rank;
    var svcName  = geminiEntry.name;
    var totalSvc = services.length;

    /* Persist today's observation */
    _appendRankSnapshot(rank, svcName);
    var deltaInfo = _computeRankDelta(rank);

    var rankText  = '#' + rank + ' of ' + totalSvc;
    var rankCls   = 'trend-neutral';
    var badgeHtml = '';

    if (deltaInfo.delta === null) {
      rankCls   = 'trend-neutral';
      badgeHtml =
        '<div class="exec-rank-history-badge exec-rank-history-badge--tracking">' +
        '<i class="fas fa-database"></i> Building history &mdash; return tomorrow for trend' +
        '</div>';
    } else if (deltaInfo.delta > 0) {
      rankCls   = 'trend-green';
      badgeHtml =
        '<div class="exec-rank-history-badge exec-rank-history-badge--up">' +
        '<i class="fas fa-arrow-up"></i> Up ' + Math.abs(deltaInfo.delta) +
        ' place(s) vs ' + deltaInfo.prevDate + ' (was #' + deltaInfo.prevRank + ')' +
        '</div>';
    } else if (deltaInfo.delta < 0) {
      rankCls   = 'trend-red';
      badgeHtml =
        '<div class="exec-rank-history-badge exec-rank-history-badge--down">' +
        '<i class="fas fa-arrow-down"></i> Down ' + Math.abs(deltaInfo.delta) +
        ' place(s) vs ' + deltaInfo.prevDate + ' (was #' + deltaInfo.prevRank + ')' +
        '</div>';
    } else {
      rankCls   = 'trend-amber';
      badgeHtml =
        '<div class="exec-rank-history-badge exec-rank-history-badge--flat">' +
        '<i class="fas fa-minus"></i> Unchanged vs ' + deltaInfo.prevDate +
        '</div>';
    }

    setEl('exec-share-value',
      '<div class="exec-card-value ' + rankCls + '">' + rankText + '</div>');
    setEl('exec-share-history-badge', badgeHtml);

    setEl('exec-share-api-note',
      result.stale
        ? '<span class="exec-api-note exec-api-note--stale"><i class="fas fa-clock"></i> Stale cache</span>'
        : '<span class="exec-api-note exec-api-note--live"><i class="fas fa-circle"></i> Live &middot; Cloudflare Radar</span>');

    var canvas = document.getElementById('spark-share');
    if (canvas) canvas.style.display = 'none';
  }

  /* ----------------------------------------------------------------
     7. MODULE SUMMARY STRIP — AI Bot Traffic (user-agent breakdown)
  ---------------------------------------------------------------- */
  function renderBotTrafficStrip(summaryResult, rangeKey) {
    var container = document.getElementById('exec-bot-summary-strip');
    if (!container) return;

    if (!summaryResult || !summaryResult.ok) {
      container.innerHTML =
        '<div class="exec-api-note exec-api-note--warn" style="padding:8px 0">' +
        '<i class="fas fa-exclamation-triangle"></i> ' +
        'API unavailable &mdash; embed fallback active' +
        '</div>';
      return;
    }

    var RC = window.RadarClient;
    if (!RC) return;

    var summary = RC.parseRadarSummary(summaryResult.data);
    var keys    = Object.keys(summary);

    if (keys.length === 0) {
      container.innerHTML =
        '<div class="exec-api-note exec-api-note--warn" style="padding:8px 0">' +
        '<i class="fas fa-info-circle"></i> No summary data in response' +
        '</div>';
      return;
    }

    keys.sort(function(a, b) { return (summary[b] || 0) - (summary[a] || 0); });
    var top      = keys.slice(0, 6);
    var maxShare = summary[top[0]] || 1;

    var geminiKey = keys.find(function(k) {
      return k.toLowerCase().indexOf('gemini') !== -1 ||
             k.toLowerCase().indexOf('googleother') !== -1 ||
             k.toLowerCase().indexOf('google') !== -1;
    });

    var html =
      '<div class="exec-summary-strip">' +
      '<div class="ess-title">Top AI Crawlers &mdash; ' + rangeKey + ' window' +
      ' <span class="exec-api-note--live" style="font-size:10px;margin-left:8px">' +
      '<i class="fas fa-circle" style="font-size:7px"></i> Live</span></div>' +
      '<div class="ess-bars">';

    top.forEach(function(k) {
      var share    = summary[k] || 0;
      var barW     = Math.round((share / maxShare) * 100);
      var isGoogle = (k === geminiKey);
      var barColor = isGoogle ? 'var(--blue)' : 'var(--text-muted)';
      var nameStr  = k.replace(/_/g, ' ').replace(/Bot/gi, '').trim();
      html +=
        '<div class="ess-bar-row">' +
          '<div class="ess-bar-label" title="' + k + '">' + nameStr +
            (isGoogle ? ' <span class="ess-gemini-tag">Google</span>' : '') +
          '</div>' +
          '<div class="ess-bar-track">' +
            '<div class="ess-bar-fill" style="width:' + barW + '%;background:' + barColor + '"></div>' +
          '</div>' +
          '<div class="ess-bar-pct">' + share.toFixed(1) + '%</div>' +
        '</div>';
    });

    html +=
      '</div>' +
      '<div class="ess-note">Share of AI bot HTTP traffic on Cloudflare\'s network. ' +
      'Directional crawler activity proxy only &mdash; not product usage or MAU.</div>' +
      '</div>';

    container.innerHTML = html;
  }

  /* ----------------------------------------------------------------
     8. MODULE SUMMARY STRIP — Crawl Purpose breakdown
  ---------------------------------------------------------------- */
  function renderCrawlPurposeStrip(purposeResult, rangeKey) {
    var container = document.getElementById('exec-purpose-summary-strip');
    if (!container) return;

    if (!purposeResult || !purposeResult.ok) {
      container.innerHTML =
        '<div class="exec-api-note exec-api-note--warn" style="padding:8px 0">' +
        '<i class="fas fa-exclamation-triangle"></i> ' +
        'API unavailable &mdash; embed fallback active' +
        '</div>';
      return;
    }

    var RC = window.RadarClient;
    if (!RC) return;

    var series = RC.parseRadarSeries(purposeResult.data);

    if (!series || series.length === 0) {
      container.innerHTML =
        '<div class="exec-api-note exec-api-note--warn" style="padding:8px 0">' +
        '<i class="fas fa-info-circle"></i> No series data in response' +
        '</div>';
      return;
    }

    var latestShares = {};
    series.forEach(function(s) {
      var vals = (s.values || []).filter(function(v) { return v !== null && !isNaN(v); });
      if (vals.length > 0) latestShares[s.label] = vals[vals.length - 1];
    });

    var keys = Object.keys(latestShares);
    if (keys.length === 0) {
      container.innerHTML =
        '<div class="exec-api-note exec-api-note--warn" style="padding:8px 0">' +
        '<i class="fas fa-info-circle"></i> No usable values in series' +
        '</div>';
      return;
    }

    keys.sort(function(a, b) { return (latestShares[b] || 0) - (latestShares[a] || 0); });
    var maxVal = latestShares[keys[0]] || 1;

    var purposeColors = {
      'AI Training':      'var(--purple)',
      'Search Indexing':  'var(--blue)',
      'Content Scraping': 'var(--amber)',
      'Other':            'var(--text-muted)'
    };

    var html =
      '<div class="exec-summary-strip">' +
      '<div class="ess-title">Crawl Purpose Breakdown &mdash; ' + rangeKey + ' window' +
      ' <span class="exec-api-note--live" style="font-size:10px;margin-left:8px">' +
      '<i class="fas fa-circle" style="font-size:7px"></i> Live</span></div>' +
      '<div class="ess-bars">';

    keys.forEach(function(k) {
      var val  = latestShares[k] || 0;
      var barW = Math.round((val / maxVal) * 100);
      var col  = purposeColors[k] || 'var(--text-muted)';
      html +=
        '<div class="ess-bar-row">' +
          '<div class="ess-bar-label">' + k + '</div>' +
          '<div class="ess-bar-track">' +
            '<div class="ess-bar-fill" style="width:' + barW + '%;background:' + col + '"></div>' +
          '</div>' +
          '<div class="ess-bar-pct">' + val.toFixed(1) + '</div>' +
        '</div>';
    });

    html +=
      '</div>' +
      '<div class="ess-note">Relative share at end of window (index 0&ndash;100). ' +
      'Not an absolute request count.</div>' +
      '</div>';

    container.innerHTML = html;
  }

  /* ----------------------------------------------------------------
     9. MAIN LOADER
        Path A: Genspark AI proxy (works on any static host).
        Path B: Cloudflare Radar API (only on CF Pages with token set).
  ---------------------------------------------------------------- */
  function loadExecRadarData(rangeKey) {
    rangeKey = rangeKey || _activeRange || '12w';

    /* Always use Cloudflare Radar API directly (browser call with token) */
    var RC = window.RadarClient;
    if (!RC) {
      console.warn('[ExecRadar] Neither GensparkProxy nor RadarClient loaded');
      _showFallbackError();
      return;
    }

    RC.setLoadingState('exec-usage-api-note', null);
    RC.setLoadingState('exec-share-api-note', null);
    RC.setLoadingState('exec-bot-summary-strip',     'Fetching crawler breakdown\u2026');
    RC.setLoadingState('exec-purpose-summary-strip', 'Fetching crawl purpose\u2026');

    var p1 = RC.fetchAiBotTimeseries(rangeKey);
    var p2 = RC.resolveGenAICategory().then(function (cat) {
      if (!cat) return { ok: false, error: 'Category not resolved', data: null };
      return RC.fetchInternetServiceTop(cat);
    });
    var p3 = RC.fetchAiBotSummaryByAgent(rangeKey);
    var p4 = RC.fetchAiBotTimeseriesByCrawlPurpose(rangeKey);

    p1.then(function (r) { _renderCard1FromRadarAPI(r); });
    p2.then(function (r) { renderGeminiShareCard(r); });
    p3.then(function (r) { renderBotTrafficStrip(r, rangeKey); });
    p4.then(function (r) { renderCrawlPurposeStrip(r, rangeKey); });
  }

  /* ── Genspark-powered loader ─────────────────────────────── */
  function _loadViaGenspark(rangeKey) {
    _renderCard1Loading();

    /* Card 1: AI Bot Activity via Genspark */
    window.GensparkProxy.fetchAiBotActivity()
      .then(function (botResult) {
        _renderCard1FromGenspark(botResult);
      })
      .catch(function(err) {
        _renderCard1Fallback(err.message);
      });

    /* Card 2: OpenRouter data via ORClient */
    if (window.ORClient) {
      window.ORClient.loadExecStrip();
    }
  }

  /* ── Card 1 from CF Radar API (Path B) ─────────────────── */
  function _renderCard1FromRadarAPI(result) {
    if (!result || !result.ok) {
      _renderCard1Fallback(result && result.error);
      return;
    }

    var RC = window.RadarClient;
    if (!RC) { _renderCard1Fallback('RadarClient not loaded'); return; }

    var series = RC.parseRadarSeries(result.data);
    var main   = series[0];

    if (!main || !main.values || main.values.length < 4) {
      _renderCard1Fallback('Insufficient data points');
      return;
    }

    var allVals = main.values.filter(function(v) { return v !== null && !isNaN(v); });
    var half    = Math.floor(allVals.length / 2);
    var prevAvg = allVals.slice(0, half).reduce(function(a, b) { return a + b; }, 0) / half;
    var currAvg = allVals.slice(allVals.length - half).reduce(function(a, b) { return a + b; }, 0) / half;
    var pct        = prevAvg !== 0 ? ((currAvg - prevAvg) / Math.abs(prevAvg)) * 100 : null;
    var pctRounded = pct !== null ? Math.round(pct * 10) / 10 : null;
    var cls        = trendClass(pctRounded);

    setEl('exec-usage-value',
      '<div class="exec-card-value ' + cls + '">' +
        (pctRounded !== null
          ? (pctRounded >= 0 ? '+' : '') + pctRounded.toFixed(1) + '%'
          : '&mdash;') +
      '</div>');

    setEl('exec-usage-trend',
      '<div class="exec-card-trend ' + cls + '" title="Change in average activity between the first half and second half of the selected window">' +
        directionIcon(pctRounded) + ' window change' +
      '</div>');

    setEl('exec-usage-delta-ww',
      '<span class="ed-val ' + (pctRounded !== null && pctRounded >= 0 ? 'delta-pos' : 'delta-neg') + '">' +
        (pctRounded !== null
          ? (pctRounded >= 0 ? '+' : '') + pctRounded.toFixed(1) + '%'
          : '&mdash;') +
      '</span>');

    setEl('exec-usage-api-note',
      result.stale
        ? '<span class="exec-api-note exec-api-note--stale"><i class="fas fa-clock"></i> Stale cache</span>'
        : '<span class="exec-api-note exec-api-note--live"><i class="fas fa-circle"></i> Live &middot; Cloudflare Radar</span>');

    var sparkVals  = allVals.slice(-14);
    var C          = (typeof getC === 'function') ? getC() : { green: '#2ecc71', red: '#e74c3c', amber: '#f39c12' };
    var sparkColor = pctRounded > 1 ? C.green : (pctRounded < -1 ? C.red : C.amber);
    if (typeof drawSparkline === 'function') {
      drawSparkline('spark-usage', sparkVals, sparkColor);
    }
  }

  function _showFallbackError() {
    _renderCard1Fallback('Data engine not loaded');
    setEl('exec-share-api-note',
      '<span class="exec-api-note exec-api-note--warn">' +
      '<i class="fas fa-exclamation-triangle"></i> Data engine not loaded</span>');
  }

  /* ----------------------------------------------------------------
     10. PUBLIC API
  ---------------------------------------------------------------- */
  window.ExecRadar = {
    init: function () {
      _setRangeBtn(_activeRange);
      loadExecRadarData(_activeRange);
    },
    refresh: function (rangeKey) {
      loadExecRadarData(rangeKey || _activeRange);
    }
  };

})();
