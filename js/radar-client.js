'use strict';

/* =============================================================================
   CLOUDFLARE RADAR CLIENT — direct browser calls to api.cloudflare.com
   No server-side proxy needed. Token is read-only/public Radar scope.
   ============================================================================= */

(function (global) {

  var RADAR_BASE  = 'https://api.cloudflare.com/client/v4/radar';
  var RADAR_TOKEN = 'cfut_k2KZDeJMxFczw6PSshmHev0KfhVboD1L8PaKFn9Y90c91c95';
  var CACHE_TTL   = 5 * 60 * 1000; // 5 min
  var _cache = {};

  function _cacheGet(url) {
    var e = _cache[url];
    if (!e) return null;
    if (Date.now() - e.ts > CACHE_TTL) { delete _cache[url]; return null; }
    return e;
  }

  function fetchRadarJson(path) {
    var url      = RADAR_BASE + '/' + path;
    var cached   = _cacheGet(url);
    if (cached) return Promise.resolve({ ok: true, data: cached.data, stale: false, ts: cached.ts });

    return fetch(url, {
      method:  'GET',
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + RADAR_TOKEN }
    })
    .then(function(res) { return res.json().then(function(body) { return { httpOk: res.ok, status: res.status, body: body }; }); })
    .then(function(r) {
      var ok = r.httpOk && r.body && r.body.success !== false;
      var data = ok ? (r.body.result || r.body) : null;
      if (ok) _cache[url] = { data: data, ts: Date.now() };
      return { ok: ok, data: data, error: ok ? null : ('HTTP ' + r.status), stale: false, ts: Date.now() };
    })
    .catch(function(err) { return { ok: false, data: null, error: err.message, stale: false, ts: Date.now() }; });
  }

  function getRangeParams(rangeKey) {
    var map = {
      '7d':  { dateRange: '7d',  aggInterval: '1d' },
      '4w':  { dateRange: '28d', aggInterval: '1d' },
      '12w': { dateRange: '84d', aggInterval: '1w' },
      '24w': { dateRange: '168d',aggInterval: '1w' },
      '52w': { dateRange: '52w', aggInterval: '1w' }
    };
    return map[rangeKey] || map['12w'];
  }

  function _qs(params) {
    return Object.keys(params).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');
  }

  function parseRadarSeries(data) {
    if (!data) return [];
    if (data.main && Array.isArray(data.main)) return [{ timestamps: data.main.map(function(d){ return d.timestamp; }), values: data.main.map(function(d){ return d.value !== undefined ? d.value : d.values; }), label: 'main' }];
    if (data.serie_0) return [{ timestamps: (data.serie_0.timestamps || []), values: (data.serie_0.values || data.serie_0.map ? data.serie_0 : []), label: 'serie_0' }];
    return [];
  }

  function parseRadarSummary(data) {
    if (!data) return {};
    var s = data.summary_0 || data.summary || data;
    return s;
  }

  function parseInternetServiceTop(data) {
    if (!data) return [];
    var top = (data.top || []);
    return top.map(function(r, i){ return { rank: i+1, name: r.serviceName || r.name || r.slug || '', value: parseFloat(r.value||0) }; });
  }

  function computeWindowChange(series) {
    var s = series && series[0];
    if (!s || !s.values || s.values.length < 4) return null;
    var vals = s.values.filter(function(v){ return v !== null && !isNaN(v); });
    var half = Math.floor(vals.length / 2);
    if (half < 2) return null;
    var prev = vals.slice(0, half).reduce(function(a,b){ return a+b; }, 0) / half;
    var curr = vals.slice(vals.length - half).reduce(function(a,b){ return a+b; }, 0) / half;
    return { first: prev, last: curr, absoluteDelta: curr-prev, pctChange: prev !== 0 ? ((curr-prev)/Math.abs(prev))*100 : null };
  }

  /* ── High-level helpers ── */
  function fetchAiBotTimeseries(rangeKey) {
    var p = getRangeParams(rangeKey || '12w');
    return fetchRadarJson('ai/bots/timeseries?' + _qs(p));
  }
  function fetchAiBotSummaryByAgent(rangeKey) {
    var p = getRangeParams(rangeKey || '12w');
    return fetchRadarJson('ai/bots/summary/user_agent?' + _qs(p));
  }
  function fetchAiBotTimeseriesByAgent(rangeKey) {
    var p = getRangeParams(rangeKey || '12w');
    return fetchRadarJson('ai/bots/timeseries_groups/user_agent?' + _qs(p));
  }
  function fetchAiBotTimeseriesByCrawlPurpose(rangeKey) {
    var p = getRangeParams(rangeKey || '12w');
    return fetchRadarJson('ai/bots/timeseries_groups/crawl_purpose?' + _qs(p));
  }
  function fetchInternetServiceTop(categoryParam) {
    var params = { limit: 10 };
    if (categoryParam) params.serviceCategory = categoryParam;
    return fetchRadarJson('ranking/internet_services/top?' + _qs(params));
  }
  function fetchInternetServiceTimeseries(categoryParam) {
    var p = getRangeParams('52w');
    if (categoryParam) p.serviceCategory = categoryParam;
    return fetchRadarJson('ranking/internet_services/timeseries_groups?' + _qs(p));
  }
  function fetchInternetServiceCategories() {
    return fetchRadarJson('ranking/internet_services/categories');
  }
  function fetchGeminiInternetRank() {
    return fetchInternetServiceTop('Generative AI').then(function(res) {
      if (!res.ok) return res;
      var top = parseInternetServiceTop(res.data);
      var gemini = top.find(function(r){ return /gemini/i.test(r.name); });
      return { ok: true, rank: gemini ? gemini.rank : null, top: top, data: res.data };
    });
  }
  function flushCache() { _cache = {}; }

  global.RadarClient = {
    fetchRadarJson:                    fetchRadarJson,
    getRangeParams:                    getRangeParams,
    parseRadarSeries:                  parseRadarSeries,
    parseRadarSummary:                 parseRadarSummary,
    parseInternetServiceTop:           parseInternetServiceTop,
    computeWindowChange:               computeWindowChange,
    fetchAiBotTimeseries:              fetchAiBotTimeseries,
    fetchAiBotSummaryByAgent:          fetchAiBotSummaryByAgent,
    fetchAiBotTimeseriesByAgent:       fetchAiBotTimeseriesByAgent,
    fetchAiBotTimeseriesByCrawlPurpose:fetchAiBotTimeseriesByCrawlPurpose,
    fetchInternetServiceTop:           fetchInternetServiceTop,
    fetchInternetServiceTimeseries:    fetchInternetServiceTimeseries,
    fetchInternetServiceCategories:    fetchInternetServiceCategories,
    fetchGeminiInternetRank:           fetchGeminiInternetRank,
    flushCache:                        flushCache
  };

}(window));
