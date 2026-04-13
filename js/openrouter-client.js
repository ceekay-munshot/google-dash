'use strict';

/* =============================================================================
   OPENROUTER CLIENT
   Data source: github.com/jampongsathorn/openrouter-rankings (daily JSON mirror)
   raw.githubusercontent.com has open CORS — works from any browser directly.
   ============================================================================= */

(function (global) {

  var CACHE_TTL   = 4 * 60 * 60 * 1000; // 4 hours
  var LATEST_URL  = 'https://raw.githubusercontent.com/jampongsathorn/openrouter-rankings/main/data/latest.json';
  var _localCache = {};
  var _fetching   = false;

  var PROVIDER_COLORS = {
    'google':    '#4e9de3', 'openai':    '#2ecc71', 'anthropic': '#f39c12',
    'meta':      '#e74c3c', 'deepseek':  '#1abc9c', 'mistralai': '#a06cd5',
    'x-ai':      '#8b5cf6', 'qwen':      '#3498db', 'xiaomi':    '#ef4444',
    'other':     '#7f8c8d'
  };

  function providerColor(p) {
    if (!p) return PROVIDER_COLORS['other'];
    var lp = p.toLowerCase();
    return PROVIDER_COLORS[lp] || PROVIDER_COLORS[lp.split('-')[0]] || PROVIDER_COLORS['other'];
  }

  function fetchRankings() {
    var cached = _localCache['week'];
    var now    = Date.now();
    if (cached && (now - cached.ts) < CACHE_TTL) {
      return Promise.resolve({ ok: true, payload: cached.payload, stale: false });
    }
    if (_fetching) {
      return new Promise(function(resolve) {
        var t = setInterval(function() {
          var c = _localCache['week'];
          if (c) { clearInterval(t); resolve({ ok: true, payload: c.payload, stale: false }); }
        }, 500);
        setTimeout(function() { clearInterval(t); resolve({ ok: false, payload: null, error: 'Timeout' }); }, 30000);
      });
    }

    _fetching = true;

    /* Step 1: get latest snapshot date */
    return fetch(LATEST_URL)
      .then(function(r) { return r.json(); })
      .then(function(latest) {
        var date = latest.meta && latest.meta.fetched_at
          ? latest.meta.fetched_at.slice(0,10)
          : (latest.date || '');
        /* Step 2: if the latest.json already has models, use it directly */
        if (latest.models && latest.models.length > 0) return latest;
        /* Otherwise fetch the dated snapshot */
        var snapUrl = 'https://raw.githubusercontent.com/jampongsathorn/openrouter-rankings/main/data/' + date + '/rankings.json';
        return fetch(snapUrl).then(function(r) { return r.json(); });
      })
      .then(function(data) {
        _fetching = false;
        if (!data || !data.models || data.models.length === 0) {
          return { ok: false, payload: null, error: 'No models in snapshot' };
        }

        var models = data.models.map(function(m) {
          var isG = /gemini|google/i.test(m.author || '') || /gemini/i.test(m.model_id || m.name || '');
          var wow = m.change ? (m.change.direction === 'up' ? '+' : '-') + m.change.value + '%' : 'new';
          return {
            rank:        m.rank,
            model:       (m.name || m.model_id || '').replace(/^[^\/]+\//, ''),
            provider:    (m.author || 'other').toLowerCase(),
            tokensLabel: m.tokens_display || '',
            tokens:      m.tokens || 0,
            wowLabel:    wow,
            wowPct:      m.change ? (m.change.direction === 'up' ? m.change.value : -m.change.value) : null,
            isNew:       !m.change,
            isGoogle:    isG,
            isGemini:    /gemini/i.test(m.model_id || m.name || '')
          };
        });

        var geminis   = models.filter(function(m) { return m.isGemini; });
        var totalTok  = models.reduce(function(s,m){ return s+(m.tokens||0); }, 0);
        var geminiTok = geminis.reduce(function(s,m){ return s+(m.tokens||0); }, 0);
        var peers     = ['openai','anthropic','meta','deepseek','x-ai','mistralai'];
        var peerRows  = geminis.slice(0,3).slice();
        peers.forEach(function(p){
          var f = models.find(function(m){ return m.provider===p || m.provider.startsWith(p); });
          if (f && !peerRows.find(function(r){ return r.model===f.model; })) peerRows.push(f);
        });
        peerRows.sort(function(a,b){ return a.rank-b.rank; });

        var payload = {
          ok: true,
          models:     models,
          geminiRows: geminis,
          summary: {
            topModel:      models[0] || null,
            geminiHighest: geminis[0] || null,
            geminiShare:   totalTok > 0 ? Math.round((geminiTok/totalTok)*1000)/10 : null,
            geminiVsPeers: peerRows
          },
          scrapedAt:  (data.meta && data.meta.fetched_at) || new Date().toISOString(),
          stale:      false,
          fromCache:  false
        };
        _localCache['week'] = { payload: payload, ts: Date.now() };
        return { ok: true, payload: payload, stale: false };
      })
      .catch(function(err) {
        _fetching = false;
        return { ok: false, payload: null, error: err.message };
      });
  }

  function flushCache() { _localCache = {}; _fetching = false; }

  /* ── Status badge ── */
  function statusBadgeHtml(result) {
    if (!result) return '<span class="or-badge or-badge--loading">loading…</span>';
    if (!result.ok) return '<span class="or-badge or-badge--error">OR data unavailable &middot; ' + (result.error||'').slice(0,60) + '</span>';
    return result.stale
      ? '<span class="or-badge or-badge--stale">Stale cache</span>'
      : '<span class="or-badge or-badge--live"><i class="fas fa-circle"></i> Live &middot; OpenRouter (GitHub mirror)</span>';
  }

  function htmlEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  /* ── Render full rankings table ── */
  function renderTable(result) {
    var tbody = document.getElementById('or-rankings-table-body');
    if (!tbody) return;
    if (!result || !result.ok || !result.payload || !result.payload.models || !result.payload.models.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="or-error-cell">Rankings unavailable &mdash; ' + htmlEsc((result&&result.error)||'fetch failed') + '</td></tr>';
      return;
    }
    var models = result.payload.models;
    tbody.innerHTML = models.map(function(m) {
      var pColor = providerColor(m.provider);
      var wowCls = m.wowPct > 0 ? 'delta-pos' : m.wowPct < 0 ? 'delta-neg' : '';
      var gemBadge = m.isGemini ? '<span class="badge badge--gemini">Gemini</span>' : '';
      return '<tr class="' + (m.isGemini ? 'or-row--gemini' : '') + '">'
        + '<td class="mono">' + m.rank + '</td>'
        + '<td><span class="prov-dot" style="background:' + pColor + '"></span>' + htmlEsc(m.model) + ' ' + gemBadge + '</td>'
        + '<td>' + htmlEsc(m.provider) + '</td>'
        + '<td class="mono">' + htmlEsc(m.tokensLabel) + '</td>'
        + '<td class="mono ' + wowCls + '">' + htmlEsc(m.wowLabel) + '</td>'
        + '<td class="mono">' + (m.isNew ? '<span class="badge badge--new">new</span>' : '') + '</td>'
        + '</tr>';
    }).join('');
  }

  /* ── Render exec strip (Card 2) ── */
  function loadExecStrip() {
    var rankVal  = document.getElementById('exec-or-rank-value');
    var wowVal   = document.getElementById('exec-or-wow-value');
    var stripEl  = document.getElementById('exec-or-strip');
    var badgeEl  = document.getElementById('exec-or-badge');

    if (rankVal) rankVal.innerHTML = '<div class="exec-card-trend trend-neutral">loading&hellip;</div>';

    fetchRankings().then(function(result) {
      var badge = statusBadgeHtml(result);
      if (badgeEl) badgeEl.innerHTML = badge;

      if (!result || !result.ok || !result.payload) return;
      var p = result.payload;
      var best = p.summary && p.summary.geminiHighest;

      if (rankVal && best) {
        rankVal.innerHTML = '<div class="exec-card-value">#' + best.rank + '</div>';
      } else if (rankVal) {
        rankVal.innerHTML = '<div class="exec-card-trend trend-neutral">not in top 30</div>';
      }

      if (wowVal && best) {
        var cls = best.wowPct > 0 ? 'trend-up' : best.wowPct < 0 ? 'trend-down' : 'trend-neutral';
        wowVal.innerHTML = '<div class="exec-card-trend ' + cls + '">' + htmlEsc(best.wowLabel||'—') + '</div>';
      }

      if (stripEl && p.summary && p.summary.geminiVsPeers && p.summary.geminiVsPeers.length) {
        var maxTok = Math.max.apply(null, p.summary.geminiVsPeers.map(function(r){ return r.tokens||0; }));
        stripEl.innerHTML = p.summary.geminiVsPeers.slice(0,6).map(function(r) {
          var w = maxTok > 0 ? Math.round((r.tokens||0)/maxTok*100) : 0;
          var c = providerColor(r.provider);
          return '<div class="exec-or-row" title="' + htmlEsc(r.model) + ' — ' + htmlEsc(r.tokensLabel) + '">'
            + '<span class="exec-or-label">' + htmlEsc(r.model.slice(0,18)) + '</span>'
            + '<div class="exec-or-bar-wrap"><div class="exec-or-bar" style="width:' + w + '%;background:' + c + '"></div></div>'
            + '<span class="exec-or-val">' + htmlEsc(r.tokensLabel) + '</span>'
            + '</div>';
        }).join('');
      }
    });
  }

  /* ── Render Gemini tab ── */
  function loadGeminiTab(cb) {
    var badgeEl = document.getElementById('or-status-badge');
    var shareEl = document.getElementById('or-gemini-share-cell');
    if (badgeEl) badgeEl.innerHTML = '<span class="or-badge or-badge--loading"><span class="fa fa-spinner fa-spin"></span> Fetching live data&hellip;</span>';

    fetchRankings().then(function(result) {
      if (badgeEl) badgeEl.innerHTML = statusBadgeHtml(result);
      renderTable(result);
      if (shareEl && result && result.ok && result.payload && result.payload.summary) {
        var share = result.payload.summary.geminiShare;
        shareEl.textContent = share !== null ? share + '%' : '—';
      }
      renderPeersChart(result);
      if (typeof cb === 'function') cb(result);
    });
  }

  /* ── Peers bar chart ── */
  function renderPeersChart(result) {
    var canvas = document.getElementById('chart-or-peers');
    if (!canvas || !window.Chart) return;
    if (!result || !result.ok || !result.payload) return;
    var peers = (result.payload.summary && result.payload.summary.geminiVsPeers) || [];
    if (!peers.length) return;

    var existingChart = Chart.getChart ? Chart.getChart(canvas) : null;
    if (existingChart) existingChart.destroy();

    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: peers.map(function(r){ return r.model.slice(0,16); }),
        datasets: [{
          data:            peers.map(function(r){ return r.tokens || 0; }),
          backgroundColor: peers.map(function(r){ return providerColor(r.provider); }),
          borderWidth: 0, borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { callback: function(v){ return v >= 1e9 ? Math.round(v/1e9)+'B' : v >= 1e6 ? Math.round(v/1e6)+'M' : v; } } }
        }
      }
    });
  }

  global.ORClient = {
    fetchRankings:  fetchRankings,
    loadGeminiTab:  loadGeminiTab,
    loadExecStrip:  loadExecStrip,
    flushCache:     flushCache
  };

}(window));
