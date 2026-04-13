'use strict';

/* =========================================================
   TYBOURNE CAPITAL — GOOGLE / GEMINI TRACKING DASHBOARD
   Main JS — Phase 1, Public data signals only
   Tab-based SPA: one section visible at a time (no infinite scroll)
   All chart data: relative illustrative shapes (0–100 index)
   No faux-precise numbers, no synthetic composites
   ========================================================= */

/* ── THEME PALETTE ── */
var DARK_PAL = {
  bg:    '#1e2329',
  title: '#e8eaed',
  body:  '#9aa3b0',
  grid:  'rgba(255,255,255,0.06)',
  border:'rgba(255,255,255,0.10)'
};
var LIGHT_PAL = {
  bg:    '#ffffff',
  title: '#111827',
  body:  '#4b5563',
  grid:  'rgba(0,0,0,0.06)',
  border:'rgba(0,0,0,0.12)'
};

/* ── COLOR PALETTE ── */
function getC() {
  var light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    blue:   light ? '#2563eb' : '#4e9de3',
    green:  light ? '#16a34a' : '#2ecc71',
    purple: light ? '#7c3aed' : '#a06cd5',
    amber:  light ? '#d97706' : '#f39c12',
    red:    light ? '#dc2626' : '#e74c3c',
    teal:   light ? '#0d9488' : '#1abc9c',
    slate:  light ? '#64748b' : '#7f8c8d',
    grid: (light ? LIGHT_PAL : DARK_PAL).grid
  };
}

/* ── RGBA HELPER ── */
function toRgba(hex, alpha) {
  var r=parseInt(hex.slice(1,3),16),
      g=parseInt(hex.slice(3,5),16),
      b=parseInt(hex.slice(5,7),16);
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}

/* ── MONTH LABELS ── */
function lastNMonths(n) {
  var mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var now=new Date(), out=[];
  for(var i=n-1;i>=0;i--){
    var d=new Date(now.getFullYear(),now.getMonth()-i,1);
    out.push(mo[d.getMonth()]+' \''+String(d.getFullYear()).slice(2));
  }
  return out;
}

/* ── CHART REGISTRY (for rebuild on theme switch) ── */
var _charts = {};

function destroyChart(id) {
  if(_charts[id]) { try { _charts[id].destroy(); } catch(e){} delete _charts[id]; }
}

/* =========================================================
   SPARKLINES
   ========================================================= */
function drawSparkline(canvasId, data, color) {
  var el = document.getElementById(canvasId);
  if(!el) return;
  destroyChart(canvasId);
  var C=getC();
  _charts[canvasId] = new Chart(el.getContext('2d'), {
    type: 'line',
    data: {
      labels: data.map(function(_,i){ return i; }),
      datasets: [{
        data: data,
        borderColor: color,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.4,
        fill: true,
        backgroundColor: toRgba(color, 0.08)
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend:{display:false}, tooltip:{enabled:false} },
      scales: {
        x: { display:false },
        y: { display:false }
      }
    }
  });
}

function initSparklines() {
  var C=getC();
  /* Cards 1 & 2 sparklines are populated by ExecRadar (live Cloudflare data).
     Cards 3 & 4 remain static KW Planner proxy shapes. */
  // Card 3: Search Volume / Demand (slight decline recently) — KW Planner proxy
  drawSparkline('spark-volume',  [95,96,97,98,99,100,101,99,98,97,96,95], C.amber);
  // Card 4: Search Pricing (growing) — KW Planner proxy
  drawSparkline('spark-pricing', [100,102,103,104,106,108,110,112,114,116,118,120], C.green);

  // Trigger live fetch for cards 1 & 2
  if (window.ExecRadar) {
    window.ExecRadar.init();
  }
}

/* =========================================================
   GEMINI TREND CHART — FALLBACK PROXY
   ⚠️ PLACEHOLDER DATA — Replace with live Cloudflare API + GT API
   ========================================================= */
function buildGeminiChart() {
  destroyChart('chart-gemini-trend');
  var C=getC();
  var pal=(document.documentElement.getAttribute('data-theme')==='light')?LIGHT_PAL:DARK_PAL;
  var labels=lastNMonths(12);
  // ⚠️ SYNTHETIC DATA FOR ILLUSTRATION — Not live
  var datasets=[
    { label:'ChatGPT',   data:[72,75,74,76,78,79,80,82,83,84,85,86], borderColor:C.green,  bg:toRgba(C.green,.06),  dashed:false },
    { label:'Gemini',    data:[52,55,57,58,56,54,53,51,50,48,47,46], borderColor:C.blue,   bg:toRgba(C.blue,.06),   dashed:false },
    { label:'Perplexity',data:[10,12,14,16,18,20,21,23,25,27,29,31], borderColor:C.purple, bg:toRgba(C.purple,.06), dashed:false },
    { label:'Claude',    data:[12,13,14,15,16,17,18,19,20,20,21,22], borderColor:C.amber,  bg:toRgba(C.amber,.06),  dashed:true  }
  ];

  var el=document.getElementById('chart-gemini-trend');
  if(!el) return;
  _charts['chart-gemini-trend'] = new Chart(el.getContext('2d'), {
    type:'line',
    data:{
      labels:labels,
      datasets: datasets.map(function(d){
        return {
          label:d.label,
          data:d.data,
          borderColor:d.borderColor,
          backgroundColor:d.bg,
          borderWidth:1.8,
          borderDash: d.dashed?[4,3]:[],
          pointRadius:0,
          tension:0.35,
          fill:true
        };
      })
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:pal.bg,
          borderColor:pal.border,
          borderWidth:1,
          titleColor:pal.title,
          bodyColor:pal.body,
          callbacks:{
            afterBody:function(){ return ['','Index = relative interest (0–100), not absolute engagement']; }
          }
        }
      },
      scales:{
        x:{grid:{color:C.grid},ticks:{maxTicksLimit:6,font:{size:10},color:pal.body}},
        y:{min:0,max:100,grid:{color:C.grid},ticks:{stepSize:25,font:{size:10},color:pal.body}}
      }
    }
  });

  // Legend
  var leg=document.getElementById('gemini-legend');
  if(leg){
    leg.innerHTML=datasets.map(function(d){
      return '<div class="legend-item"><span class="legend-dot" style="background:'+d.borderColor+'"></span>'+d.label+'</div>';
    }).join('');
  }
}

/* =========================================================
   GEMINI REGIONAL CHART — REMOVED
   Regional split removed per Phase 1 simplification.
   Only 2 panels: Usage Trend + Search Interest Fallback.
   ========================================================= */
// function buildGeminiRegionalChart() { ... } — DELETED

/* =========================================================
   DEMAND BASKET CHART
   ========================================================= */
/* =========================================================
   SEARCH VOLUME HISTORY CHART — HISTORICAL VOLUME PROXY
   Filed volume history vs external proxy (Google Ads Search Trends)
   ⚠️ Google Trends NOT used as main number — directional only
   ========================================================= */

// Global state for volume time range
var _volumeTimeRange = '2Y';

function setVolumeTimeRange(range, btn) {
  _volumeTimeRange = range;
  // Update button states
  var btns = document.querySelectorAll('.time-toggle');
  btns.forEach(function(b){ b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  // Rebuild chart
  buildVolumeHistoryChart();
}

function buildVolumeHistoryChart() {
  destroyChart('chart-volume-history');
  var C=getC();
  var pal=(document.documentElement.getAttribute('data-theme')==='light')?LIGHT_PAL:DARK_PAL;
  
  var labels, filedData, proxyData;
  
  if(_volumeTimeRange==='2Y') {
    // Last 8 quarters
    labels = ['2023 Q1','2023 Q2','2023 Q3','2023 Q4','2024 Q1','2024 Q2','2024 Q3','2024 Q4'];
    // ⚠️ PLACEHOLDER — Replace with actual filed data from 10-K/10-Q CSV upload
    filedData =  [100, 102, 105, 108, 105, 107, 104, 100];  // Index: filed volume
    proxyData =  [98, 101, 104, 108, 104, 107, 105, 102];   // Index: Google Ads Search Trends proxy
  } else if(_volumeTimeRange==='5Y') {
    // Last 20 quarters
    labels = ['2020 Q1','Q2','Q3','Q4','2021 Q1','Q2','Q3','Q4','2022 Q1','Q2','Q3','Q4','2023 Q1','Q2','Q3','Q4','2024 Q1','Q2','Q3','Q4'];
    filedData = [80,82,85,88,90,93,95,97,98,100,102,103,100,102,105,108,105,107,104,100];
    proxyData = [78,81,84,87,89,92,94,96,97,99,101,102,98,101,104,108,104,107,105,102];
  } else {
    // Since 2006 (yearly)
    labels = ['2006','2007','2008','2009','2010','2011','2012','2013','2014','2015','2016','2017','2018','2019','2020','2021','2022','2023','2024'];
    filedData = [20,25,30,35,42,48,55,62,68,74,80,86,90,94,85,95,102,104,103];
    proxyData = [18,24,29,34,40,47,54,60,67,73,79,85,89,93,83,94,101,103,102];
  }

  var el=document.getElementById('chart-volume-history');
  if(!el) return;
  _charts['chart-volume-history']=new Chart(el.getContext('2d'),{
    type:'line',
    data:{
      labels:labels,
      datasets:[
        {
          label:'Filed Volume (Index)',
          data:filedData,
          borderColor:C.blue,
          backgroundColor:toRgba(C.blue,.08),
          borderWidth:2.5,
          pointRadius:3,
          pointBackgroundColor:C.blue,
          tension:0.35,
          fill:true
        },
        {
          label:'External Proxy (Google Ads Search Trends)',
          data:proxyData,
          borderColor:C.green,
          backgroundColor:toRgba(C.green,.06),
          borderWidth:2,
          borderDash:[],
          pointRadius:2,
          pointBackgroundColor:C.green,
          tension:0.35,
          fill:false
        }
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,animation:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:pal.bg,borderColor:pal.border,borderWidth:1,
          titleColor:pal.title,bodyColor:pal.body,
          callbacks:{
            afterBody:function(){
              return ['','Filed = public 10-K/10-Q volume disclosures','Proxy = Google Ads Search Trends / Insights','⚠️ Placeholder data — replace with actual CSV upload'];
            }
          }
        }
      },
      scales:{
        x:{grid:{color:C.grid},ticks:{maxTicksLimit:_volumeTimeRange==='Since2006'?10:8,font:{size:10},color:pal.body}},
        y:{
          min:_volumeTimeRange==='Since2006'?0:80,
          grid:{color:C.grid},
          ticks:{font:{size:10},color:pal.body}
        }
      }
    }
  });

  var leg=document.getElementById('volume-legend');
  if(leg){
    leg.innerHTML='<div class="legend-item"><span class="legend-dot" style="background:'+C.blue+'"></span>Filed Volume (Index)</div>'+
                  '<div class="legend-item"><span class="legend-dot" style="background:'+C.green+'"></span>External Proxy (Google Ads Search Trends)</div>';
  }
}

/* GCP Interest Chart removed — Cloud tab removed from dashboard */

/* =========================================================
   KEYWORD TABLE
   ========================================================= */
/* =========================================================
   KW_DATA — updated structure
   Fields: cluster, cat, geo, blendedCpc (low+high/2),
           priceQq, priceYy, volTier, volQq, volYy, comp, intent, source
   NOTE: All bid/CPC values are indicative planning ranges from
   Google Ads Keyword Planner (not auction-cleared CPCs).
   Deltas are directional proxies. Replace with live KP exports.
   ========================================================= */
var KW_DATA = [
  /* ── United States ── */
  {
    cluster:'Financial Services', cat:'finance', geo:'us',
    blendedCpc:'$14.00', priceQq:'+3.2%', priceYy:'+7.8%',
    volTier:'High (100K-1M)', volQq:'+2.1%', volYy:'+8.4%',
    comp:'High', intent:'commercial', source:'KW Planner'
  },
  {
    cluster:'Travel & Hospitality', cat:'travel', geo:'us',
    blendedCpc:'$8.50', priceQq:'+4.1%', priceYy:'+11.3%',
    volTier:'High (100K-1M)', volQq:'+3.8%', volYy:'+14.2%',
    comp:'Med-High', intent:'transactional', source:'KW Planner'
  },
  {
    cluster:'Health & Pharma', cat:'health', geo:'us',
    blendedCpc:'$6.50', priceQq:'+0.3%', priceYy:'+2.1%',
    volTier:'Med-High (10K-100K)', volQq:'-0.4%', volYy:'+3.1%',
    comp:'High', intent:'commercial', source:'KW Planner'
  },
  {
    cluster:'E-Commerce / Retail', cat:'ecomm', geo:'us',
    blendedCpc:'$4.00', priceQq:'-0.8%', priceYy:'-1.9%',
    volTier:'High (100K-1M)', volQq:'-1.9%', volYy:'-3.2%',
    comp:'Medium', intent:'transactional', source:'KW Planner'
  },
  {
    cluster:'Tech / SaaS', cat:'tech', geo:'us',
    blendedCpc:'$9.00', priceQq:'-4.2%', priceYy:'-9.1%',
    volTier:'High (100K-1M)', volQq:'-3.4%', volYy:'-8.7%',
    comp:'High', intent:'commercial', source:'KW Planner + Search Trends'
  },
  {
    cluster:'Legal Services', cat:'legal', geo:'us',
    blendedCpc:'$20.00', priceQq:'+0.6%', priceYy:'+3.4%',
    volTier:'Low-Med (1K-10K)', volQq:'-0.8%', volYy:'+1.4%',
    comp:'Very High', intent:'commercial', source:'KW Planner'
  },
  {
    cluster:'Auto / Insurance', cat:'auto', geo:'us',
    blendedCpc:'$10.50', priceQq:'+2.8%', priceYy:'+6.5%',
    volTier:'High (100K-1M)', volQq:'+1.6%', volYy:'+6.8%',
    comp:'High', intent:'transactional', source:'KW Planner'
  },
  /* ── United Kingdom ── */
  {
    cluster:'Financial Services', cat:'finance', geo:'uk',
    blendedCpc:'$11.50', priceQq:'+2.7%', priceYy:'+6.2%',
    volTier:'Med-High (10K-100K)', volQq:'+1.8%', volYy:'+6.9%',
    comp:'High', intent:'commercial', source:'KW Planner'
  },
  {
    cluster:'Travel & Hospitality', cat:'travel', geo:'uk',
    blendedCpc:'$6.80', priceQq:'+3.5%', priceYy:'+9.7%',
    volTier:'Med-High (10K-100K)', volQq:'+2.9%', volYy:'+11.1%',
    comp:'Medium', intent:'transactional', source:'KW Planner'
  },
  {
    cluster:'Tech / SaaS', cat:'tech', geo:'uk',
    blendedCpc:'$7.20', priceQq:'-3.1%', priceYy:'-7.4%',
    volTier:'Med-High (10K-100K)', volQq:'-2.6%', volYy:'-6.3%',
    comp:'High', intent:'commercial', source:'KW Planner'
  }
];

function intentTag(i) {
  var map={commercial:'intent-commercial',transactional:'intent-transactional',informational:'intent-informational',navigational:'intent-navigational'};
  return '<span class="intent-tag '+(map[i]||'')+'">'+i+'</span>';
}
function volBadge(v) {
  var map={high:'vol-high',med:'vol-med',low:'vol-low'};
  var labels={high:'High',med:'Med',low:'Low'};
  return '<span class="vol-badge '+(map[v]||'')+'">'+( labels[v]||v)+'</span>';
}
function momArrow(d) {
  if(d==='up')   return '<span class="kw-trend-up">&#8593; Firming</span>';
  if(d==='down') return '<span class="kw-trend-down">&#8595; Declining</span>';
  return '<span class="kw-trend-flat">&#8594; Stable</span>';
}
function trendColor(t) {
  if(t.toLowerCase().includes('firm') || t.toLowerCase().includes('stable')) return 'trend-green';
  if(t.toLowerCase().includes('soft') || t.toLowerCase().includes('declin')) return 'trend-red';
  return 'trend-amber';
}

/* -- deltaCell helper: renders q/q or y/y value with colour coding -- */
function deltaCell(val) {
  if(!val) return '<td class="mono">—</td>';
  var first = val.charAt(0);
  var cls = first==='+' ? 'trend-green' : (first==='-') ? 'trend-red' : 'trend-amber';
  return '<td class="mono '+cls+'">'+val+'</td>';
}

/* -- filterKwTable: populates combined Pricing + Volume table -- */
function filterKwTable() {
  var cluster = (document.getElementById('kw-cluster-filter')||{value:'all'}).value;
  var geo     = (document.getElementById('kw-geo-filter')||{value:'all'}).value;
  var comp    = (document.getElementById('kw-competition-filter')||{value:'all'}).value;

  var filtered = KW_DATA.filter(function(r){
    if(cluster !== 'all' && r.cat !== cluster) return false;
    if(geo     !== 'all' && r.geo !== geo)     return false;
    if(comp    !== 'all') {
      var c = r.comp.toLowerCase();
      if(comp==='high'   && !c.includes('high')) return false;
      if(comp==='medium' && !c.includes('med'))  return false;
      if(comp==='low'    && c!=='low')           return false;
    }
    return true;
  });

  var tbody = document.getElementById('kw-table-body');
  if(!tbody) return;

  tbody.innerHTML = filtered.map(function(r){
    var geoLabel = {us:'United States', uk:'United Kingdom', global:'Global'}[r.geo] || (r.geo||'').toUpperCase();
    return '<tr>'+
      '<td style="font-weight:600;color:var(--text-primary)">'+r.cluster+'</td>'+
      '<td style="color:var(--text-secondary)">'+geoLabel+'</td>'+
      '<td class="mono" style="font-weight:600">'+r.blendedCpc+'</td>'+
      deltaCell(r.priceQq)+
      deltaCell(r.priceYy)+
      '<td class="mono">'+r.volTier+'</td>'+
      deltaCell(r.volQq)+
      deltaCell(r.volYy)+
      '<td style="color:var(--text-muted);font-size:10px">'+r.source+'</td>'+
    '</tr>';
  }).join('');
}

/* =========================================================
   HEATMAP — quarterly price change by vertical
   Columns = last 6 quarters (Q labels), rows = verticals
   Values = q/q % change in blended top-of-page bid
   Source: Google Ads Keyword Planner (placeholder; update quarterly)
   ========================================================= */
var HM_LABELS = ['Finance','Travel','Health','E-Comm','Tech/SaaS','Legal','Auto'];

/* Generate last 6 quarter labels dynamically */
var HM_QUARTERS = (function(){
  var now = new Date();
  var q = Math.floor(now.getMonth()/3)+1;
  var yr = now.getFullYear();
  var out = [];
  for(var i=5; i>=0; i--){
    var qi = q - i;
    var yi = yr;
    while(qi<1){ qi+=4; yi--; }
    while(qi>4){ qi-=4; yi++; }
    out.push('Q'+qi+"'"+(yi+'').slice(2));
  }
  return out;
})();

/* q/q % change in blended top-of-page bid per vertical x quarter
   Positive = pricing firming, Negative = pricing softening
   Directional proxies only — replace with live KP exports        */
var HM_DATA = [
  [ 1.8,  2.4,  3.1,  2.9,  3.5,  3.2],  // Finance
  [ 0.9,  1.4,  2.2,  3.8,  4.1,  4.1],  // Travel (seasonal)
  [ 0.2,  0.1,  0.4,  0.0,  0.3,  0.3],  // Health
  [-0.5, -0.9, -0.8, -1.2, -0.8, -0.8],  // E-Comm
  [-2.8, -3.5, -3.9, -4.6, -4.2, -4.2],  // Tech/SaaS
  [ 0.4,  0.8,  0.5,  0.7,  0.6,  0.6],  // Legal
  [ 1.6,  2.1,  2.7,  2.9,  2.8,  2.8]   // Auto
];

function hmClass(v) {
  if(v>=5)  return 'hm-hot';
  if(v>=2)  return 'hm-warm';
  if(v>=-2) return 'hm-flat';
  if(v>=-5) return 'hm-cool';
  return 'hm-cold';
}
function hmLabel(v) {
  var rounded = Math.round(v*10)/10;
  if(rounded>0) return '+'+rounded+'%';
  if(rounded===0) return 'flat';
  return rounded+'%';
}

function buildHeatmap() {
  var grid=document.getElementById('heatmap-grid');
  if(!grid) return;
  grid.style.gridTemplateColumns = 'minmax(72px,auto) '+HM_QUARTERS.map(function(){return '1fr';}).join(' ');
  var html='<div class="hm-header-cell">Vertical</div>';
  HM_QUARTERS.forEach(function(m){ html+='<div class="hm-header-cell">'+m+'</div>'; });
  HM_LABELS.forEach(function(label,r){
    html+='<div class="hm-label-cell">'+label+'</div>';
    HM_DATA[r].forEach(function(v){
      html+='<div class="hm-cell '+hmClass(v)+'">'+hmLabel(v)+'</div>';
    });
  });
  grid.innerHTML=html;
}

/* =========================================================
   PRICING TREND CHART — blended top-of-page bid/CPC proxy over time
   Source: Google Ads Keyword Planner (placeholder; update quarterly)
   ========================================================= */
var _pricingTrendChart = null;

function buildPricingTrendChart() {
  var canvas = document.getElementById('chart-pricing-trend');
  if(!canvas) return;
  if(_pricingTrendChart) { _pricingTrendChart.destroy(); _pricingTrendChart=null; }

  var C = getC();
  var PAL = document.documentElement.getAttribute('data-theme')==='light' ? LIGHT_PAL : DARK_PAL;

  /* Last 8 quarters — dynamic labels */
  var labels = (function(){
    var now=new Date();
    var q=Math.floor(now.getMonth()/3)+1;
    var yr=now.getFullYear();
    var out=[];
    for(var i=7;i>=0;i--){
      var qi=q-i, yi=yr;
      while(qi<1){qi+=4;yi--;}
      while(qi>4){qi-=4;yi++;}
      out.push('Q'+qi+"'"+(yi+'').slice(2));
    }
    return out;
  })();

  /* Blended CPC proxy (low+high/2) per basket over 8 quarters
     WARNING: PLACEHOLDER — replace with live Keyword Planner export */
  var series = [
    { label:'Financial Services', color:C.blue,
      data:[12.4,12.9,13.1,13.5,13.7,14.0,14.2,14.0] },
    { label:'Legal Services',     color:C.purple,
      data:[18.5,18.8,19.2,19.5,19.7,20.0,20.2,20.0] },
    { label:'Auto / Insurance',   color:C.teal,
      data:[8.8,9.2,9.6,9.9,10.2,10.5,10.6,10.5] },
    { label:'Tech / SaaS',        color:C.red,
      data:[13.2,12.8,12.1,11.5,10.8,10.1,9.5,9.0] },
    { label:'Travel',             color:C.green,
      data:[6.8,7.2,7.5,7.9,8.0,8.3,8.5,8.5] }
  ];

  _pricingTrendChart = new Chart(canvas.getContext('2d'), {
    type:'line',
    data:{
      labels:labels,
      datasets:series.map(function(s){
        return {
          label:s.label,
          data:s.data,
          borderColor:s.color,
          backgroundColor:'transparent',
          pointBackgroundColor:s.color,
          pointRadius:3,
          pointHoverRadius:5,
          tension:0.35,
          borderWidth:2
        };
      })
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label:function(ctx){
              return ctx.dataset.label+': $'+ctx.parsed.y.toFixed(2);
            }
          }
        }
      },
      scales:{
        x:{grid:{color:C.grid},ticks:{color:PAL.body,font:{size:10}}},
        y:{
          grid:{color:C.grid},
          ticks:{color:PAL.body,font:{size:10},
            callback:function(v){return '$'+v.toFixed(0);}
          },
          title:{display:true,text:'Blended CPC Proxy (USD)',color:PAL.body,font:{size:10}}
        }
      }
    }
  });

  /* Legend */
  var leg = document.getElementById('pricing-trend-legend');
  if(leg){
    leg.innerHTML = series.map(function(s){
      return '<div class="legend-item"><span class="legend-line" style="background:'+s.color+'"></span>'+s.label+'</div>';
    }).join('');
  }
}

/* =========================================================
   VOLUME TREND CHART — avg monthly search volume proxy per basket
   Source: Google Ads Keyword Planner + Search Trends / Insights
   ========================================================= */
var _volumeTrendChart = null;

function buildVolumeTrendChart() {
  var canvas = document.getElementById('chart-volume-trend');
  if(!canvas) return;
  if(_volumeTrendChart) { _volumeTrendChart.destroy(); _volumeTrendChart=null; }

  var C = getC();
  var PAL = document.documentElement.getAttribute('data-theme')==='light' ? LIGHT_PAL : DARK_PAL;

  /* Last 8 quarters */
  var labels = (function(){
    var now=new Date();
    var q=Math.floor(now.getMonth()/3)+1;
    var yr=now.getFullYear();
    var out=[];
    for(var i=7;i>=0;i--){
      var qi=q-i, yi=yr;
      while(qi<1){qi+=4;yi--;}
      while(qi>4){qi-=4;yi++;}
      out.push('Q'+qi+"'"+(yi+'').slice(2));
    }
    return out;
  })();

  /* Relative volume index (earliest quarter = 100) per basket
     WARNING: PLACEHOLDER — replace with live Keyword Planner export */
  var series = [
    { label:'Financial Services', color:C.blue,
      data:[93,95,97,98,100,102,104,104] },
    { label:'Travel & Hospitality', color:C.green,
      data:[82,88,92,96,100,104,107,107] },
    { label:'Health & Pharma',    color:C.amber,
      data:[97,98,99,100,100,101,102,102] },
    { label:'E-Commerce / Retail',color:C.red,
      data:[103,102,101,100,99,98,97,97] },
    { label:'Tech / SaaS',        color:C.purple,
      data:[110,108,106,104,101,98,95,92] }
  ];

  _volumeTrendChart = new Chart(canvas.getContext('2d'), {
    type:'line',
    data:{
      labels:labels,
      datasets:series.map(function(s){
        return {
          label:s.label,
          data:s.data,
          borderColor:s.color,
          backgroundColor:'transparent',
          pointBackgroundColor:s.color,
          pointRadius:3,
          pointHoverRadius:5,
          tension:0.35,
          borderWidth:2
        };
      })
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label:function(ctx){
              return ctx.dataset.label+': Index '+ctx.parsed.y.toFixed(0);
            }
          }
        }
      },
      scales:{
        x:{grid:{color:C.grid},ticks:{color:PAL.body,font:{size:10}}},
        y:{
          grid:{color:C.grid},
          ticks:{color:PAL.body,font:{size:10}},
          title:{display:true,text:'Relative Volume Index (base=100)',color:PAL.body,font:{size:10}}
        }
      }
    }
  });

  /* Legend */
  var leg = document.getElementById('volume-trend-legend');
  if(leg){
    leg.innerHTML = series.map(function(s){
      return '<div class="legend-item"><span class="legend-line" style="background:'+s.color+'"></span>'+s.label+'</div>';
    }).join('');
  }
}

/* =========================================================
   TAB NAVIGATION (the core architecture fix)
   ========================================================= */
var _activeTab = 'executive';
var _chartsBuilt = {};

function switchTab(tabId) {
  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
  // Show target panel
  var target = document.getElementById('tab-'+tabId);
  if(target) { target.classList.add('active'); target.scrollTop=0; }

  // Update nav active state
  document.querySelectorAll('.nav-item[data-tab]').forEach(function(b){ b.classList.remove('active'); });
  var activeBtn = document.querySelector('.nav-item[data-tab="'+tabId+'"]');
  if(activeBtn) activeBtn.classList.add('active');

  _activeTab = tabId;

  // Scroll tab-content-area to top
  var tca = document.getElementById('tab-content-area');
  if(tca) tca.scrollTop=0;

  // Build charts lazily on first visit
  buildChartsForTab(tabId);
}

function buildChartsForTab(tabId) {
  if(_chartsBuilt[tabId]) return; // already built
  _chartsBuilt[tabId] = true;

  if(tabId==='executive') {
    /* initSparklines() draws Cards 3 & 4 sparklines, then calls ExecRadar.init()
       ExecRadar.init() → _loadViaGenspark() → GensparkProxy.fetchAiBotActivity() (Card 1)
                                              → ORClient.loadExecStrip()          (Card 2)
       No duplicate calls needed here. */
    setTimeout(initSparklines, 50);
    /* GT overlay (collapsed — background load, low priority) */
    if (window.TrendsClient) {
      setTimeout(function(){ window.TrendsClient.loadExecGTOverlay(); }, 1200);
    }
  }
  if(tabId==='gemini') {
    /* PRIMARY: OpenRouter live rankings — fires immediately */
    if (window.ORClient) {
      setTimeout(function(){ window.ORClient.loadGeminiTab(); }, 50);
    }
    /* FALLBACK: Google Trends directional overlay — loads after OR */
    if (window.TrendsClient) {
      setTimeout(function(){
        window.TrendsClient.loadGeminiTrends(function(result) {
          if (!result || !result.ok || !result.payload ||
              !result.payload.series ||
              result.payload.series.every(function(s){ return !s.data || s.data.length === 0; })) {
            buildGeminiChart();
          }
        });
      }, 300);
    } else {
      setTimeout(buildGeminiChart, 300);
    }
  }
  if(tabId==='searchdemand') {
    setTimeout(buildVolumeHistoryChart, 50);
  }
  if(tabId==='adpricing') {
    setTimeout(function(){
      filterKwTable();
      buildHeatmap();
      buildPricingTrendChart();
      /* Volume trend chart (Tab 2) built lazily on first open via setKwTab */
    }, 50);
  }
  // cloud tab removed — buildGcpChart no longer called
}

/* =========================================================
   KEYWORD AD-PRICING — INNER TAB SWITCHING
   ========================================================= */
var _kwChartsBuilt = {};

function setKwTab(tabId, btn) {
  // Hide all three kw tab panels
  ['demand','pricing','ctr'].forEach(function(id){
    var el = document.getElementById('kw-tab-'+id);
    if(el) el.classList.remove('active');
  });
  // Show selected
  var target = document.getElementById('kw-tab-'+tabId);
  if(target) target.classList.add('active');

  // Update tab button active state
  var parentCard = btn ? btn.closest('.module-card') : null;
  if(parentCard) {
    parentCard.querySelectorAll('.mod-tab').forEach(function(b){ b.classList.remove('active'); });
  }
  if(btn) btn.classList.add('active');

  // Lazy chart builds for inner tabs
  if(tabId==='demand' && !_kwChartsBuilt['demand']) {
    _kwChartsBuilt['demand'] = true;
    setTimeout(buildVolumeTrendChart, 50);
  }
  if(tabId==='pricing' && !_kwChartsBuilt['pricing']) {
    _kwChartsBuilt['pricing'] = true;
    setTimeout(buildPricingTrendChart, 50);
  }
}

/* =========================================================
   MODULE-LEVEL TAB SWITCHING
   ========================================================= */
function setModTab(modId, panelId, btn) {
  // Find all tab panels for this module
  var allPanels = document.querySelectorAll('[id^="'+modId+'-"]');
  allPanels.forEach(function(p){ p.classList.remove('active'); });
  var target = document.getElementById(modId+'-'+panelId);
  if(target) target.classList.add('active');

  // Tab button states
  var parentTabs = btn.closest('.module-card');
  if(parentTabs) {
    parentTabs.querySelectorAll('.mod-tab').forEach(function(b){ b.classList.remove('active'); });
  }
  btn.classList.add('active');
}

/* =========================================================
   PER-SECTION REFRESH
   ========================================================= */
function sectionRefresh(sectionId, btnId, resultId) {
  var btn    = btnId    ? document.getElementById(btnId)    : null;
  var result = resultId ? document.getElementById(resultId) : null;

  if(btn) { btn.classList.add('loading'); }

  setTimeout(function(){
    if(btn) { btn.classList.remove('loading'); }

    // Update "last updated" timestamps on section
    var now = new Date();
    var label = now.toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short',year:'numeric'});

    // Executive tab: flush all caches, then ExecRadar.refresh() handles Cards 1 & 2
    if (sectionId === 'executive') {
      /* Flush all caches */
      if (window.GensparkProxy) window.GensparkProxy.flushCache();
      if (window.ORClient)      window.ORClient.flushCache();
      if (window.RadarClient && window.RadarClient.flushCache) window.RadarClient.flushCache();
      /* ExecRadar.refresh() → _loadViaGenspark() → fetchAiBotActivity + ORClient.loadExecStrip */
      if (window.ExecRadar) window.ExecRadar.refresh();
      /* GT overlay (low priority) */
      if (window.TrendsClient) {
        window.TrendsClient.flushCache();
        setTimeout(function(){ window.TrendsClient.loadExecGTOverlay(); }, 500);
      }
      if (result) {
        result.textContent = 'Fetching live data\u2026';
        result.className   = 'refresh-result visible refresh-result--ok';
        setTimeout(function(){ result.classList.remove('visible'); }, 6000);
      }
    } else if (sectionId === 'gemini') {
      /* PRIMARY: flush + reload OpenRouter rankings */
      if (window.ORClient) {
        window.ORClient.flushCache();
        window.ORClient.loadGeminiTab(function() { delete _chartsBuilt['gemini']; });
      }
      /* FALLBACK: GT directional overlay */
      if (window.TrendsClient) {
        window.TrendsClient.flushCache();
        window.TrendsClient.loadGeminiTrends(function() { delete _chartsBuilt['gemini']; });
      }
      if (result) {
        result.textContent = 'Refreshing OpenRouter + Google Trends\u2026';
        result.className   = 'refresh-result visible refresh-result--ok';
        setTimeout(function(){ result.classList.remove('visible'); }, 6000);
      }
    } else {
      if(result) {
        result.textContent = 'Phase 1 \u2014 Public signals only';
        result.className   = 'refresh-result visible refresh-result--warn';
        setTimeout(function(){ result.classList.remove('visible'); }, 4000);
      }
    }

    // Rebuild charts for active tab to reflect any state change
    if(_chartsBuilt[sectionId]) {
      delete _chartsBuilt[sectionId];
      buildChartsForTab(sectionId);
    }

    // Update global last-updated
    injectDates();

    console.info('['+sectionId+'] Section refresh complete.');
  }, 1800);

  if(btn) {
    var icon = btn.querySelector('i');
    if(icon) icon.className = 'fas fa-sync-alt';
  }
}

/* ── Global refresh ── */
function triggerGlobalRefresh() {
  var btn  = document.getElementById('global-refresh-btn');
  var icon = document.getElementById('global-refresh-icon');

  if(btn)  { btn.classList.add('loading'); }
  if(icon) { icon.className = 'fas fa-sync-alt'; }

  setTimeout(function(){
    if(btn)  {
      btn.classList.remove('loading');
      btn.innerHTML = '<i class="fas fa-sync-alt" id="global-refresh-icon"></i><span> Refresh</span>';
    }
    injectDates();

    // Reset and rebuild active tab charts
    delete _chartsBuilt[_activeTab];
    buildChartsForTab(_activeTab);

    // Flush all data caches on global refresh
    if (window.RadarClient  && window.RadarClient.flushCache)  window.RadarClient.flushCache();
    if (window.ORClient     && window.ORClient.flushCache)     window.ORClient.flushCache();
    if (window.TrendsClient && window.TrendsClient.flushCache) window.TrendsClient.flushCache();

    if (_activeTab === 'executive' && window.ExecRadar) {
      window.ExecRadar.refresh();
      if (window.ORClient) window.ORClient.loadExecStrip();
    }

    var lu = document.getElementById('last-updated-time');
    if(lu) lu.textContent = new Date().toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short',year:'numeric'})+' · Phase 1 only';
  }, 2000);
}

/* =========================================================
   THEME TOGGLE
   ========================================================= */
var THEME_DARK  = 'dark';
var THEME_LIGHT = 'light';

function toggleTheme() {
  var cur = document.documentElement.getAttribute('data-theme');
  var next = cur===THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
  applyTheme(next);
}

function applyTheme(theme) {
  if(theme===THEME_LIGHT) {
    document.documentElement.setAttribute('data-theme','light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('tcTheme', theme);

  // Update Chart.js globals for new theme
  var pal = theme===THEME_LIGHT ? LIGHT_PAL : DARK_PAL;
  Chart.defaults.color = pal.body;
  Chart.defaults.plugins.tooltip.backgroundColor = pal.bg;
  Chart.defaults.plugins.tooltip.borderColor = pal.border;
  Chart.defaults.plugins.tooltip.titleColor = pal.title;
  Chart.defaults.plugins.tooltip.bodyColor  = pal.body;
  Chart.defaults.scale.grid.color = pal.grid;

  // Rebuild all charts
  Object.keys(_chartsBuilt).forEach(function(k){ delete _chartsBuilt[k]; });
  buildChartsForTab(_activeTab);
}

function initTheme() {
  var saved = localStorage.getItem('tcTheme') || THEME_DARK;
  var pal = saved===THEME_LIGHT ? LIGHT_PAL : DARK_PAL;
  Chart.defaults.color = pal.body;
  Chart.defaults.plugins.tooltip.backgroundColor = pal.bg;
  Chart.defaults.plugins.tooltip.borderColor = pal.border;
  Chart.defaults.plugins.tooltip.titleColor = pal.title;
  Chart.defaults.plugins.tooltip.bodyColor  = pal.body;
  Chart.defaults.scale.grid.color = pal.grid;
}

/* =========================================================
   DATE INJECTION
   ========================================================= */
function injectDates() {
  var now = new Date();
  var short = now.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  var full  = now.toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short',year:'numeric'});

  document.querySelectorAll('.dyn-date').forEach(function(el){ el.textContent = short; });
  document.querySelectorAll('.dyn-date-full').forEach(function(el){ el.textContent = full; });

  var lu = document.getElementById('last-updated-time');
  if(lu) lu.textContent = full + ' · Phase 1 only';

  var fd = document.getElementById('footer-date');
  if(fd) fd.textContent = short;

  // Alert timestamps
  var alertTimes = ['alert-time-1','alert-time-2','alert-time-3','alert-time-4'];
  alertTimes.forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.textContent = short;
  });
}

/* =========================================================
   NAV TOGGLE
   ========================================================= */
function toggleNav() {
  var rail = document.getElementById('nav-rail');
  if(rail) rail.classList.toggle('collapsed');
}

/* =========================================================
   PERIOD / COMPARE BUTTONS
   ========================================================= */
/* setPeriod / setCompare removed — period and compare toggles removed from header */

/* =========================================================
   ACCORDION
   ========================================================= */
function toggleAccordion(btn) {
  btn.classList.toggle('open');
  var body = btn.nextElementSibling;
  if(body) body.classList.toggle('open');
}
function expandAllAccordion() {
  document.querySelectorAll('.accordion-btn').forEach(function(b){
    b.classList.add('open');
    var body = b.nextElementSibling;
    if(body) body.classList.add('open');
  });
}

/* =========================================================
   EXPORT / SOURCES
   ========================================================= */
function showExportMenu() {
  alert('Export (CSV / PDF / Excel) will be available in Phase 2 once live data integration is complete.');
}

/* =========================================================
   HEADER SEARCH
   ========================================================= */
var SEARCH_MAP = {
  'executive':    'executive',
  'overview':     'executive',
  'gemini':       'gemini',
  'peers':        'gemini',
  'search demand':'searchdemand',
  'demand proxy': 'searchdemand',
  'volume':       'searchdemand',
  'search volume':'searchdemand',
  'keyword':      'adpricing',
  'kw':           'adpricing',
  'pricing':      'adpricing',
  'ad demand':    'adpricing',
  'cpc':          'adpricing',
  'monetization': 'monetization',
  'monetisation': 'monetization',
  'bull':         'monetization',
  'bear':         'monetization',
  'youtube':      'methodology',
  'cloud':        'methodology',
  'gcp':          'methodology',
  'vertex':       'methodology',
  'bedrock':      'methodology',
  'benchmark':    'aibenchmarks',
  'benchmarks':   'aibenchmarks',
  'image':        'aibenchmarks',
  'imagen':       'aibenchmarks',
  'dalle':        'aibenchmarks',
  'midjourney':   'aibenchmarks',
  'artificial':   'aibenchmarks',
  'alerts':       'alerts',
  'methodology':  'methodology',
  'sources':      'methodology'
};

/* =========================================================
   GT OVERLAY TOGGLE (Executive Summary collapsed panel)
   ========================================================= */
function toggleGTOverlay(headerEl) {
  var card = headerEl.closest('.module-card');
  if (!card) return;
  var body    = card.querySelector('.gt-overlay-body');
  var chevron = card.querySelector('.gt-overlay-chevron');
  if (!body) return;

  var isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (chevron) chevron.classList.toggle('open', !isOpen);

  /* Lazy-load GT overlay on first open */
  if (!isOpen && window.TrendsClient) {
    var container = document.getElementById('exec-gt-overlay');
    if (container && container.innerHTML.trim() === '') {
      window.TrendsClient.loadExecGTOverlay();
    }
  }
}

document.addEventListener('DOMContentLoaded', function(){
  // Keyboard shortcuts
  document.addEventListener('keydown', function(e){
    if(e.key==='Escape') closeDrawer();
  });
});

/* =========================================================
   DETAIL DRAWER
   ========================================================= */
var DRAWERS = {
  'ai-usage': {
    title: 'Total AI Usage Proxy — Cloudflare Radar',
    metrics: [
      { label:'Source', value:'AI Bot Timeseries', sub:'Cloudflare Radar' },
      { label:'Metric shown', value:'Window change', sub:'1st half vs 2nd half of window' },
      { label:'NOT this', value:'Not q/q · Not y/y', sub:'Not a business-period metric' }
    ],
    sections: [
      { title:'What this tracks', text:'The rate of HTTP requests from AI bots and crawlers (ChatGPT-bot, GoogleOther-GoogleProducer, ClaudeBot, PerplexityBot, etc.) across Cloudflare\'s global network, normalised to a 0–100 index (MIN0_MAX).' },
      { title:'How the percentage is computed', text:'The displayed percentage is the change in average activity from the first half of the selected window to the second half of the selected window. Example: selecting 12W compares the average of weeks 1–6 to the average of weeks 7–12. This is a rolling-window internal comparison — NOT a quarter-on-quarter or year-on-year business-period metric. Do not compare it to Google\'s reported revenue growth or MAU figures.' },
      { title:'What it does NOT mean', text:'This is NOT a count of users, sessions, revenue, or product adoption. It reflects how actively AI companies are crawling the web via Cloudflare-protected infrastructure. A rise in Google\'s bot traffic does not mean Gemini has more users.' },
      { title:'Required caveats', text:'(1) Cloudflare covers a large but non-exhaustive share of global web traffic. (2) MIN0_MAX normalisation means the index anchors to the minimum and maximum within the window — absolute levels are not comparable across different date ranges. (3) Bot traffic can spike for operational reasons unrelated to product growth (e.g., re-training runs, index rebuilds).' }
    ],
    tags: ['Cloudflare Radar','Window change','NOT q/q','NOT y/y','Directional proxy','Crawler activity','Not MAU','Live API']
  },
  'gemini-share': {
    title: 'Gemini Traffic Rank — Cloudflare Internet Services',
    metrics: [
      { label:'Source', value:'CF Internet Services Ranking', sub:'Generative AI category' },
      { label:'Signal type', value:'Traffic rank proxy', sub:'NOT market share or revenue' },
      { label:'Update cadence', value:'Live (5-min cache)', sub:'Per API call' }
    ],
    sections: [
      { title:'What this tracks', text:'Gemini\'s rank within the "Generative AI" internet-services category as measured by traffic through Cloudflare\'s network. Rank 1 = highest traffic. The dashboard shows Gemini\'s current rank and direction vs the prior known observation.' },
      { title:'What it does NOT mean', text:'This is NOT a user-count, market-share percentage, revenue figure, or session volume. It is a relative ordering by web traffic proxy. A rank of #2 means Gemini routes more Cloudflare-observed traffic than services ranked #3+, but less than #1 (typically ChatGPT/OpenAI). Rank changes can reflect network routing changes, not just user adoption.' },
      { title:'Required caveats', text:'(1) If Gemini does not appear in the Generative AI top set, the card shows "Not in current top set" — this is a data-availability note, not an editorial statement. (2) Category name ("Generative AI") is auto-discovered; if Cloudflare renames the category the resolver will adapt. (3) Not all Gemini user traffic routes through Cloudflare.' }
    ],
    tags: ['Cloudflare Radar','Traffic rank','Not market share','Directional','Live API']
  },
  'stance': {
    title: 'Overall Stance — Composite Signal',
    metrics: [
      { label:'Stance', value:'Neutral / Watch', sub:'Directional only' },
      { label:'MoM Signal', value:'Softening', sub:'GT basket direction' },
      { label:'YoY Signal', value:'Declining', sub:'Multi-month trend' }
    ],
    sections: [
      { title:'What this tracks', text:'A qualitative composite of all Phase 1 public signals: Gemini search interest direction, commercial keyword cluster demand direction, KW Planner bid range direction, and AI Overview basket coverage rate. No numeric scoring formula is applied.' },
      { title:'Why Neutral / Watch', text:'Finance/Travel bid ranges provide partial bull signal. Gemini interest decline and rising AI Overview basket coverage provide bear signals. No single signal is strong enough to move stance to conviction; hence Neutral/Watch.' },
      { title:'What would change the stance', text:'Bull: AI Overview coverage stabilises or declines in Finance vertical; Gemini interest reverses. Bear: AI Overview penetrates Finance/Legal basket above 35%; Tech CPC continues structural decline. Phase 2 volume data required for higher confidence.' }
    ],
    tags: ['Composite','Phase 1','Directional','No numeric scoring','Monthly']
  },
  'gemini-exec': {
    title: 'Gemini Public Interest — GT Signal',
    metrics: [
      { label:'Interest Status', value:'Lagging', sub:'vs ChatGPT on GT' },
      { label:'MoM Direction', value:'Declining', sub:'GT relative index' },
      { label:'Fastest Peer', value:'Perplexity', sub:'Accelerating interest' }
    ],
    sections: [
      { title:'What this tracks', text:'Google Trends relative search interest for "Gemini AI" brand term compared to ChatGPT, Perplexity, and Claude. Values are 0–100 relative indices — NOT session counts, DAU/MAU, revenue contribution, or market share.' },
      { title:'Key finding', text:'Gemini is showing month-on-month declining relative interest versus ChatGPT. Perplexity is the fastest-accelerating peer. Claude interest is stable but low. This is a public sentiment/awareness signal, not an engagement or adoption metric.' },
      { title:'Limitations', text:'GT interest conflates informational searching about Gemini with usage intent. It does not capture users who access Gemini directly via URL or mobile app. Phase 2 will add absolute app engagement data via paid intelligence vendor.' }
    ],
    tags: ['Google Trends','Relative index','Directional','Not DAU/MAU','Phase 1']
  },
  'search-demand': {
    title: 'Search Demand Proxy Basket',
    metrics: [
      { label:'Overall Direction', value:'Softening', sub:'GT basket signal' },
      { label:'Finance/Travel', value:'Stable–Firm', sub:'Commercial clusters' },
      { label:'Tech/SaaS', value:'Softening', sub:'Multi-month decline' }
    ],
    sections: [
      { title:'What this tracks', text:'Google Trends relative interest for four commercial keyword clusters (Finance, Travel, Health, Tech/SaaS) plus Google Ads Keyword Planner volume tiers. This is a demand-side proxy for search-monetisable intent — NOT a proxy for google.com visit counts or sessions.' },
      { title:'Why this matters', text:'Finance and Travel clusters holding stable suggest high-yield query demand is not collapsing. Tech/SaaS cluster softening may reflect AI tools (ChatGPT, Copilot) capturing queries that previously drove Google search monetisation.' },
      { title:'What this is NOT', text:'This module does not report google.com traffic estimates, device splits, geographic mix, or source-of-traffic breakdown. Those require Phase 2 paid panel approval.' }
    ],
    tags: ['Google Trends','KW Planner','Commercial basket','Not visit volume','Directional']
  },
  'kw-pricing': {
    title: 'Keyword Planner Bid Range Monitor',
    metrics: [
      { label:'Overall Signal', value:'Firming', sub:'Finance/Travel clusters' },
      { label:'Finance Bid Range', value:'$10–$18', sub:'Top-of-page indicative' },
      { label:'Tech/SaaS Bid', value:'$6–$12', sub:'Declining direction' }
    ],
    sections: [
      { title:'Source and methodology', text:'Bid ranges sourced from Google Ads Keyword Planner tool. These are indicative top-of-page bid ranges, not auction-clearing CPCs. Actual CPCs depend on Quality Score, ad relevance, auction density, and bidding strategy.' },
      { title:'Signal interpretation', text:'Finance and Travel bid ranges firming: consistent with recovering auction density as advertisers return to high-intent queries. Tech/SaaS bid ranges declining: consistent with AI tools capturing some mid-funnel research queries. Legal maintaining high CPCs: supply-constrained high-value vertical shows structural stability.' },
      { title:'Limitations', text:'Keyword Planner provides volume tiers (High/Med/Low), not precise search volumes. Bid ranges are planning estimates. This is not a substitute for live Google Ads campaign data or auction-level reporting.' }
    ],
    tags: ['KW Planner','Indicative only','No vendor CPCs','Phase 1']
  },
  'monetisation': {
    title: 'Monetisation Signal — Analyst Synthesis',
    metrics: [
      { label:'Overall Signal', value:'Mixed', sub:'Transitioning' },
      { label:'Demand Health', value:'Softening', sub:'GT basket direction' },
      { label:'Intent Quality', value:'Improving', sub:'Long-tail bid signal' }
    ],
    sections: [
      { title:'Core tension', text:'Two opposing forces: (1) AI Overviews reducing click-through on informational queries (volume displacement), partially offset by (2) rising long-tail commercial query specificity driving higher bid density in Finance and Travel.' },
      { title:'AI Overview basket signal', text:'28% of our 120-keyword monitored basket now shows AI Overview (up from 20% last month). Basket is currently skewed informational — expansion into commercial/Finance verticals is the key watch item.' },
      { title:'What is NOT reported here', text:'No faux-precise MoM/YoY percentage deltas, click-through rate estimates, or zero-click rate figures are provided — these require Phase 2 paid panel data.' }
    ],
    tags: ['Analyst synthesis','Phase 1','No faux-precise metrics','Watch']
  },
  'search-demand-health': {
    title: 'Search Demand Health — Commercial Basket',
    metrics: [
      { label:'Finance/Travel', value:'Stable–Firm', sub:'GT cluster signal' },
      { label:'Tech/SaaS', value:'Softening', sub:'Multi-month' },
      { label:'Volume Data', value:'Phase 2', sub:'Paid panel required' }
    ],
    sections: [
      { title:'Assessment', text:'Finance and Travel verticals showing stable-to-firm demand on Google Trends commercial cluster proxy. Tech/SaaS showing multi-month softening signal. Serves as demand-side proxy for search-monetisable intent. Volume data not available in Phase 1.' }
    ],
    tags: ['GT commercial basket','Directional','Monthly','Phase 1','Not visit volume']
  },
  'ai-sub-risk': {
    title: 'AI Substitution Risk — Overview Basket',
    metrics: [
      { label:'This Month', value:'34 / 120 (28%)', sub:'120-keyword basket' },
      { label:'Last Month', value:'24 / 120 (20%)', sub:'Same basket' },
      { label:'Change', value:'+10 kws / +8 pp', sub:'MoM rise' }
    ],
    sections: [
      { title:'Basket composition', text:'120 keywords, manually curated. Skewed informational (~45% informational queries). This means current 28% coverage likely overstates impact on high-yield commercial query monetisation.' },
      { title:'Risk classification', text:'Elevated risk: pace of coverage increase (+8 pp in one month) is notable. However, Finance and Legal verticals not yet heavily penetrated. If Finance/Legal breach 30%, reassess to High risk immediately.' },
      { title:'Phase 2 plan', text:'Expand to 200-keyword basket with explicit high-yield vertical weighting (Finance 40%, Legal 20%, Travel 20%, Health 20%). This will provide a more monetisation-relevant coverage rate.' }
    ],
    tags: ['AI Overview','120-keyword basket','Sample-based','Manual SERP audit','Monthly']
  },
  'intent-quality': {
    title: 'AI-Assisted Intent Quality',
    metrics: [
      { label:'Commercial Mix', value:'Directional ↑', sub:'GT proxy' },
      { label:'Query Specificity', value:'Rising', sub:'Long-tail signal' },
      { label:'Long-tail Bids', value:'Firming', sub:'KW Planner' }
    ],
    sections: [
      { title:'Assessment', text:'Directional evidence suggests AI Overviews are filtering out low-commercial-intent queries, leaving a residual search volume that is more commercially specific. This is the key bull argument for the Google search monetisation transition.' },
      { title:'Limitation', text:'This signal is directional only — based on KW Planner bid range direction and GT cluster analysis. No session-level commercial intent data is available in Phase 1.' }
    ],
    tags: ['Directional proxy','KW Planner','GT cluster','Phase 1']
  },
  'kw-pricing-support': {
    title: 'Keyword Pricing Support — By Vertical',
    metrics: [
      { label:'Finance & Travel', value:'Firming', sub:'KW Planner bid range' },
      { label:'Tech / SaaS', value:'Softening', sub:'Multi-month decline' },
      { label:'Legal', value:'Stable', sub:'Supply-constrained' }
    ],
    sections: [
      { title:'Finance & Travel — Firming', text:'Top-of-page bid ranges rising in these verticals. Consistent with recovering advertiser auction density. Key support for the revenue-per-query offset thesis.' },
      { title:'Tech / SaaS — Softening', text:'Bid ranges declining. Structural signal: AI tools (Copilot, ChatGPT) may be capturing mid-funnel research queries, reducing competitive auction density.' },
      { title:'Legal — Stable high CPC', text:'Legal maintains highest CPCs in basket. Supply-constrained: limited advertisers with very high LTV per conversion. Less sensitive to AI Overview displacement due to transactional/navigational intent dominance.' }
    ],
    tags: ['KW Planner','Bid ranges','Vertical analysis','Indicative only']
  }
};

function openDrawer(key) {
  var cfg = DRAWERS[key];
  if(!cfg) return;

  document.getElementById('drawer-title').textContent = cfg.title;

  var html = '';

  // Metrics
  if(cfg.metrics && cfg.metrics.length) {
    html += '<div class="drawer-metric-row">';
    cfg.metrics.forEach(function(m){
      html += '<div class="drawer-metric"><div class="dm-label">'+m.label+'</div><div class="dm-value">'+m.value+'</div><div class="dm-sub">'+m.sub+'</div></div>';
    });
    html += '</div>';
  }

  // Sections
  if(cfg.sections) {
    cfg.sections.forEach(function(s){
      html += '<div class="drawer-section-title">'+s.title+'</div>';
      html += '<div class="drawer-text">'+s.text+'</div>';
    });
  }

  // Tags
  if(cfg.tags && cfg.tags.length) {
    html += '<div class="drawer-tag-row">';
    cfg.tags.forEach(function(t){ html += '<span class="drawer-tag">'+t+'</span>'; });
    html += '</div>';
  }

  document.getElementById('drawer-body').innerHTML = html;
  document.getElementById('detail-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}

function closeDrawer() {
  document.getElementById('detail-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}

/* =========================================================
   CHART.JS GLOBAL DEFAULTS
   ========================================================= */
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 6;
Chart.defaults.plugins.tooltip.titleFont = { size: 11, weight: '700' };
Chart.defaults.plugins.tooltip.bodyFont  = { size: 11 };
Chart.defaults.scale.border = { dash: [4,4], color: 'transparent' };

/* =========================================================
   INIT
   ========================================================= */
document.addEventListener('DOMContentLoaded', function(){
  initTheme();
  injectDates();

  // Build charts for the initial active tab
  buildChartsForTab('executive');

  console.info('[TC Dashboard] Initialised — Phase 1, public-data signals only. Page ready in ~' + (performance.now()/1000).toFixed(2)+'s');
});
