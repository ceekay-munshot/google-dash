'use strict';

/* =============================================================================
   GENSPARK PROXY — js/genspark-proxy.js
   Live data engine for the Gemini Tracking Dashboard

   Architecture
   ─────────────
   All live data calls go through the Genspark AI API (browser → Genspark API).
   Genspark's API can browse the web and extract structured data.
   This replaces Cloudflare Functions which don't run on static deploys.

   Key: hardcoded per owner instruction. Customer never sees it.
   Never exposed in any customer-facing UI.

   Modules exposed on window.GensparkProxy:
   ─────────────────────────────────────────
   fetchOpenRouterRankings()  → { ok, models, geminiRows, summary, scrapedAt }
   fetchGoogleTrends()        → { ok, series, summary, fetchedAt }
   fetchAiBotActivity()       → { ok, series, summary, fetchedAt }
   flushCache()
   ============================================================================= */

(function (global) {

  /* ── API config ────────────────────────────────────────────── */
  var GENSPARK_API   = 'https://api.genspark.ai/v1/chat/completions';
  var GENSPARK_KEY   = 'gsk-eyJjb2dlbl9pZCI6ImRkZjcxNGRmLTk2MTQtNDllNy1hNTU5LTM4MDJkYjg1MzM5YiIsImtleV9pZCI6Ijk4ODVkNzA3LWYxMGMtNDYzMS1hODEzLTBjMjE4OTlhMWM2ZiIsImN0aW1lIjoxNzc0NTEzNzEwLCJjbGF1ZGVfYmlnX21vZGVsIjpudWxsLCJjbGF1ZGVfbWlkZGxlX21vZGVsIjpudWxsLCJjbGF1ZGVfc21hbGxfbW9kZWwiOm51bGx9fJJgn8fmQ_0gI3Y6WqcKzMDez3SEnXlki-vvE7Mbohkw';
  var GENSPARK_MODEL = 'genspark-auto';

  /* ── Client-side cache ─────────────────────────────────────── */
  var _cache    = {};
  var CACHE_TTL = 4 * 60 * 60 * 1000;  // 4 hours

  function _cacheGet(key) {
    var e = _cache[key];
    if (!e) return null;
    if (Date.now() - e.ts > CACHE_TTL) { delete _cache[key]; return null; }
    return e.data;
  }
  function _cacheSet(key, data) { _cache[key] = { data: data, ts: Date.now() }; }
  function flushCache() { _cache = {}; }

  /* ── Core Genspark call ─────────────────────────────────────── */
  /**
   * callGenspark(userPrompt, systemPrompt)
   * Returns Promise<{ ok: bool, text: string, error?: string }>
   * Retries once on network error with 2-second delay.
   */
  function callGenspark(userPrompt, systemPrompt, retryCount) {
    retryCount = retryCount || 0;
    var body = {
      model: GENSPARK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt || 'You are a precise data extraction assistant. You MUST visit the URL provided, read the actual live data, and return ONLY valid JSON. No markdown fences, no explanation, no preamble. If you cannot access the URL, return {"error":"access_denied"}.' },
        { role: 'user',   content: userPrompt }
      ],
      temperature: 0,
      max_tokens:  8192
    };

    return fetch(GENSPARK_API, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + GENSPARK_KEY
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined
    })
    .then(function (res) {
      if (!res.ok) {
        // Retry once on 429 (rate limit) or 5xx
        if ((res.status === 429 || res.status >= 500) && retryCount < 1) {
          return new Promise(function(resolve) {
            setTimeout(function() { resolve(callGenspark(userPrompt, systemPrompt, retryCount + 1)); }, 3000);
          });
        }
        throw new Error('Genspark HTTP ' + res.status);
      }
      return res.json();
    })
    .then(function (json) {
      var text = '';
      if (json && json.choices && json.choices[0] && json.choices[0].message) {
        text = json.choices[0].message.content || '';
      } else if (json && json.content) {
        text = json.content;
      } else if (json && json.text) {
        text = json.text;
      }
      return { ok: true, text: text.trim() };
    })
    .catch(function (err) {
      // Retry once on network error
      if (retryCount < 1 && (err.name === 'TypeError' || err.name === 'AbortError')) {
        return new Promise(function(resolve) {
          setTimeout(function() { resolve(callGenspark(userPrompt, systemPrompt, retryCount + 1)); }, 2000);
        });
      }
      console.warn('[GensparkProxy] API call failed:', err.message);
      return { ok: false, text: '', error: err.message };
    });
  }

  /* ── JSON extractor ─────────────────────────────────────────── */
  /**
   * Robustly extract the first JSON array or object from a string.
   * Handles markdown code fences, trailing text, etc.
   */
  function extractJSON(text) {
    if (!text) return null;
    // Strip markdown fences
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    // Try direct parse
    try { return JSON.parse(text); } catch (_) {}
    // Find first { or [
    var start = text.search(/[\[{]/);
    if (start === -1) return null;
    var sub = text.slice(start);
    // Find matching close
    try { return JSON.parse(sub); } catch (_) {}
    // Try to extract just the first complete JSON block
    var depth = 0, inStr = false, esc = false;
    var open  = sub[0], close = open === '[' ? ']' : '}';
    for (var i = 0; i < sub.length; i++) {
      var c = sub[i];
      if (esc)        { esc = false; continue; }
      if (c === '\\') { esc = true;  continue; }
      if (c === '"')  { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === open)  depth++;
      if (c === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(sub.slice(0, i + 1)); } catch (_) {}
          break;
        }
      }
    }
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
     MODULE 1 — OPENROUTER RANKINGS
     Fetches: openrouter.ai/rankings?view=week
     Returns top-30 models with tokens, WoW%, Gemini highlighted
  ══════════════════════════════════════════════════════════════ */
  function fetchOpenRouterRankings() {
    var cacheKey = 'or_rankings_week';
    var cached   = _cacheGet(cacheKey);
    if (cached) return Promise.resolve(cached);

    var today = new Date().toISOString().slice(0, 10);

    var prompt =
      'Visit https://openrouter.ai/rankings?view=week RIGHT NOW and extract the COMPLETE leaderboard table. ' +
      'Today is ' + today + '. ' +
      'Return a JSON array where each element has EXACTLY these keys: ' +
      '{"rank":1,"model":"Gemini 2.5 Flash","provider":"google","tokensLabel":"289B","tokens":289000000000,"wowLabel":"+1%","wowPct":1,"isNew":false,"isGemini":true,"isGoogle":true}. ' +
      'Rules: ' +
      '- rank: integer position (1 = #1) ' +
      '- model: exact model name as shown ' +
      '- provider: lowercase company name (google, openai, anthropic, meta, deepseek, mistralai, qwen, etc.) ' +
      '- tokensLabel: the compact label shown (e.g. "289B", "1.2T", "980B") ' +
      '- tokens: numeric value in raw tokens (1B=1000000000, 1T=1000000000000) ' +
      '- wowLabel: the change % shown ("+1%", "-5%", "new", "0%") ' +
      '- wowPct: numeric percentage or null if "new" ' +
      '- isNew: true if labeled "new" this week ' +
      '- isGemini: true for any Google Gemini model ' +
      '- isGoogle: true for any Google model ' +
      'Include ALL visible rows (typically 20-30). ' +
      'Return ONLY the raw JSON array. Zero markdown. Zero explanation.';

    return callGenspark(prompt)
      .then(function (res) {
        if (!res.ok) {
          return {
            ok: false,
            error: res.error || 'Genspark API call failed',
            models: [], geminiRows: [], summary: null,
            scrapedAt: new Date().toISOString()
          };
        }

        var rows = extractJSON(res.text);

        // Check for access denied
        if (rows && !Array.isArray(rows) && rows.error) {
          return {
            ok: false,
            error: 'Page access denied: ' + rows.error,
            models: [], geminiRows: [], summary: null,
            scrapedAt: new Date().toISOString()
          };
        }

        if (!Array.isArray(rows) || rows.length < 3) {
          console.warn('[GensparkProxy] OR: parsed', rows ? rows.length : 'null', 'rows. Raw:', res.text.slice(0, 300));
          return {
            ok: false,
            error: 'Parsed ' + (Array.isArray(rows) ? rows.length : 0) + ' rows (expected ≥3)',
            models: [], geminiRows: [], summary: null,
            scrapedAt: new Date().toISOString()
          };
        }

        /* Normalise each row */
        rows = rows.map(function (r, i) {
          var tok = (typeof r.tokens === 'number' && r.tokens > 0) ? r.tokens : parseTokenLabel(r.tokensLabel || '');
          var wow = (typeof r.wowPct === 'number') ? r.wowPct : parseWow(r.wowLabel || '');
          var isG = r.isGemini === true || /gemini/i.test(r.model || '');
          var isGo= r.isGoogle === true || isG || /google/i.test(r.provider || '');
          return {
            rank:        r.rank || (i + 1),
            model:       (r.model || 'Unknown').trim(),
            provider:    ((r.provider) || inferProvider(r.model || '')).toLowerCase().trim(),
            tokensLabel: r.tokensLabel || formatTok(tok),
            tokens:      tok,
            wowLabel:    r.wowLabel || (wow !== null ? (wow >= 0 ? '+' : '') + wow + '%' : '—'),
            wowPct:      wow,
            isNew:       r.isNew === true || /new/i.test(r.wowLabel || ''),
            isGemini:    isG,
            isGoogle:    isGo
          };
        });

        var geminiRows = rows.filter(function (r) { return r.isGemini; });
        var summary    = buildSummary(rows);

        var result = {
          ok:         true,
          scrapedAt:  new Date().toISOString(),
          view:       'week',
          models:     rows,
          geminiRows: geminiRows,
          summary:    summary,
          sourceNote: 'OpenRouter token usage rankings — relative API usage proxy. NOT Google total queries, MAU, or revenue.'
        };

        _cacheSet(cacheKey, result);
        return result;
      });
  }

  /* ══════════════════════════════════════════════════════════════
     MODULE 2 — GOOGLE TRENDS (AI assistant search interest)
     Returns 12-month normalized index for 5 terms
  ══════════════════════════════════════════════════════════════ */
  function fetchGoogleTrends() {
    var cacheKey = 'gt_12m';
    var cached   = _cacheGet(cacheKey);
    if (cached) return Promise.resolve(cached);

    var today = new Date().toISOString().slice(0, 10);

    var prompt =
      'Visit https://trends.google.com/trends/explore?q=Gemini+AI,ChatGPT,Claude+AI,Perplexity,Copilot&date=today+12-m&hl=en-US ' +
      'and extract the interest-over-time data for all 5 terms. ' +
      'Today is ' + today + '. ' +
      'Return a JSON object: ' +
      '{"series":[{"term":"Gemini AI","data":[{"date":"YYYY-MM-DD","value":46},...]},...], ' +
      '"summary":[{"term":"Gemini AI","latest":46,"windowChangePct":-2.1,"rank":2},...]}. ' +
      'The summary array must be sorted by latest value descending. ' +
      'Return ONLY the raw JSON object. Zero markdown. Zero explanation.';

    return callGenspark(prompt)
      .then(function (res) {
        if (!res.ok) return { ok: false, error: res.error };

        var parsed = extractJSON(res.text);
        if (!parsed || !parsed.series) return { ok: false, error: 'No series in GT response' };

        var result = {
          ok:        true,
          fetchedAt: new Date().toISOString(),
          window:    '12m',
          terms:     ['Gemini AI', 'ChatGPT', 'Claude AI', 'Perplexity', 'Copilot'],
          series:    parsed.series || [],
          summary:   parsed.summary || buildGTSummary(parsed.series || []),
          success:   true
        };

        _cacheSet(cacheKey, result);
        return result;
      });
  }

  /* ══════════════════════════════════════════════════════════════
     MODULE 3 — AI BOT ACTIVITY (Cloudflare Radar public page)
     Directional crawler activity — replaces the Radar API calls
  ══════════════════════════════════════════════════════════════ */
  function fetchAiBotActivity() {
    var cacheKey = 'ai_bot_12w';
    var cached   = _cacheGet(cacheKey);
    if (cached) return Promise.resolve(cached);

    var today = new Date().toISOString().slice(0, 10);

    var prompt =
      'Visit https://radar.cloudflare.com/ai (today is ' + today + ') and extract the AI bot traffic data. ' +
      'Find: ' +
      '1. The top AI crawlers/bots by traffic share (names and % share). ' +
      '2. Any week-over-week or month-over-month change in total AI bot traffic. ' +
      '3. Google or Gemini bot share if visible. ' +
      'Return JSON: {"ok":true,"crawlers":[{"name":"GPTBot","share":34.5},{"name":"Google-Extended","share":18.2},...], ' +
      '"totalChange":{"period":"WoW","pct":5.2},"googleShare":18.2,"fetchedAt":"' + today + '"}. ' +
      'Return ONLY the raw JSON. Zero markdown. Zero explanation.';

    return callGenspark(prompt)
      .then(function (res) {
        if (!res.ok) return { ok: false, error: res.error };
        var parsed = extractJSON(res.text);
        if (!parsed) return { ok: false, error: 'No JSON in bot activity response' };
        parsed.ok = true;
        _cacheSet(cacheKey, parsed);
        return parsed;
      });
  }

  /* ══════════════════════════════════════════════════════════════
     HELPERS
  ══════════════════════════════════════════════════════════════ */
  function parseTokenLabel(lbl) {
    if (!lbl) return 0;
    var m = String(lbl).replace(/,/g, '').match(/([\d.]+)\s*([KMBT])/i);
    if (!m) return 0;
    var v = parseFloat(m[1]), u = m[2].toUpperCase();
    if (u === 'T') return v * 1e12;
    if (u === 'B') return v * 1e9;
    if (u === 'M') return v * 1e6;
    if (u === 'K') return v * 1e3;
    return v;
  }

  function parseWow(lbl) {
    if (!lbl || /new/i.test(lbl)) return null;
    var m = String(lbl).match(/([+\-]?\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : null;
  }

  function formatTok(n) {
    if (!n) return '—';
    if (n >= 1e12) return (n / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
    if (n >= 1e9)  return Math.round(n / 1e9) + 'B';
    if (n >= 1e6)  return Math.round(n / 1e6) + 'M';
    return n.toString();
  }

  function inferProvider(model) {
    var m = (model || '').toLowerCase();
    if (/gemini|google/.test(m))           return 'google';
    if (/gpt|o1|o3|o4|davinci/.test(m))   return 'openai';
    if (/claude|anthropic/.test(m))        return 'anthropic';
    if (/llama|meta/.test(m))              return 'meta';
    if (/mistral|mixtral/.test(m))         return 'mistralai';
    if (/deepseek/.test(m))               return 'deepseek';
    if (/qwen/.test(m))                    return 'qwen';
    if (/mimo/.test(m))                    return 'modelscope';
    if (/minimax/.test(m))                 return 'minimax';
    if (/step/.test(m))                    return 'stepfun';
    return 'other';
  }

  function buildSummary(models) {
    var top        = models[0] || null;
    var geminis    = models.filter(function (m) { return m.isGemini; });
    var best       = geminis[0] || null;
    var totalTok   = models.reduce(function (s, m) { return s + (m.tokens || 0); }, 0);
    var geminiTok  = geminis.reduce(function (s, m) { return s + (m.tokens || 0); }, 0);
    var share      = totalTok > 0 ? Math.round((geminiTok / totalTok) * 1000) / 10 : null;

    /* Gemini vs peers comparison rows */
    var peerProviders = ['openai', 'anthropic', 'meta', 'deepseek', 'mistralai', 'qwen'];
    var peerRows = geminis.slice(0, 3).concat([]);
    peerProviders.forEach(function (p) {
      var found = models.find(function (m) {
        return m.provider === p || m.provider.startsWith(p.split('-')[0]);
      });
      if (found && !peerRows.find(function (r) { return r.model === found.model; })) {
        peerRows.push(found);
      }
    });
    peerRows.sort(function (a, b) { return a.rank - b.rank; });

    return {
      topModel:      top,
      geminiHighest: best,
      geminiShare:   share,
      geminiVsPeers: peerRows
    };
  }

  function buildGTSummary(series) {
    return (series || [])
      .map(function (s) {
        var vals = (s.data || []).map(function (d) { return d.value; }).filter(function (v) { return typeof v === 'number'; });
        var latest = vals.length > 0 ? vals[vals.length - 1] : null;
        var half   = Math.floor(vals.length / 2);
        var pct    = null;
        if (half >= 2) {
          var avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
          var prev = avg(vals.slice(0, half)), curr = avg(vals.slice(half));
          if (prev > 0) pct = Math.round(((curr - prev) / prev) * 1000) / 10;
        }
        return { term: s.term, latest: latest, windowChangePct: pct };
      })
      .sort(function (a, b) { return (b.latest || 0) - (a.latest || 0); })
      .map(function (item, idx) { return Object.assign({}, item, { rank: idx + 1 }); });
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════ */
  global.GensparkProxy = {
    fetchOpenRouterRankings: fetchOpenRouterRankings,
    fetchGoogleTrends:       fetchGoogleTrends,
    fetchAiBotActivity:      fetchAiBotActivity,
    flushCache:              flushCache,
    callGenspark:            callGenspark,
    extractJSON:             extractJSON
  };

}(window));
