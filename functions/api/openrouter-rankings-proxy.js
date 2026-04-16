/**
 * Cloudflare Pages Function — OpenRouter Rankings Proxy
 * Route: /api/openrouter-rankings-proxy
 * Method: GET
 *
 * Fetches https://openrouter.ai/rankings?view=week and returns the full
 * page HTML with relative URLs intact. Companion catch-all proxy functions
 * at /_next/*, /api/frontend/*, /api/internal/*, /images/* forward those
 * requests to openrouter.ai so the page's JS can load chunks, fetch data,
 * and render the chart. Injects CSS to hide everything except the chart
 * and a script to suppress Clerk auth errors.
 */

const TARGET_URL = 'https://openrouter.ai/rankings?view=week';

export async function onRequestGet() {
  try {
    const resp = await fetch(TARGET_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!resp.ok) {
      return new Response('Upstream returned ' + resp.status, { status: 502 });
    }

    let html = await resp.text();

    // DO NOT rewrite URLs — keep them relative so they hit our proxy routes.
    // Note: Clerk auth errors appear in console but are suppressed by our
    // injected script and don't affect chart rendering. Clerk is loaded
    // dynamically from inside a bundled JS chunk, so it can't be stripped
    // from the HTML.

    // ── 1. Error suppression — runs before any other scripts ──
    const errorSuppress = `
<script>
// Suppress Clerk auth errors (domain-locked, will always fail on proxy)
window.addEventListener('unhandledrejection', function(e) { e.preventDefault(); });
window.addEventListener('error', function(e) {
  var msg = (e.message || '').toLowerCase();
  if (msg.indexOf('clerk') !== -1 || msg.indexOf('chunk') !== -1) {
    e.preventDefault();
    return true;
  }
});
// Periodically hide error overlays and non-chart content
var _clean = function() {
  // Next.js error overlay
  var p = document.querySelector('nextjs-portal');
  if (p) p.remove();
  // "Application error" screen
  document.querySelectorAll('body > div').forEach(function(el) {
    var txt = el.innerText || '';
    if (txt.indexOf('Application error') !== -1 && !el.querySelector('svg.recharts-surface')) {
      el.style.display = 'none';
    }
  });
};
var _ival = setInterval(_clean, 300);
setTimeout(function(){ clearInterval(_ival); _clean(); }, 30000);
</script>`;

    // ── 2. CSS to show ONLY the chart section ──
    const cleanupCSS = `
<style id="gdash-or-clean">
/* === HIDE: page chrome === */
nav, header, footer,
[role="banner"], [role="navigation"], [role="contentinfo"],
aside { display: none !important; }

/* === HIDE: modals, toasts, promos, auth === */
[class*="cookie" i], [class*="toast" i], [class*="modal" i],
[class*="banner" i], [data-sonner-toaster],
[data-vaul-drawer], [data-vaul-overlay] { display: none !important; }

/* === HIDE: Next.js error overlay === */
nextjs-portal { display: none !important; }

/* === HIDE: the large "AI Model Rankings" h1 === */
h1 { display: none !important; }

/* === HIDE: description paragraph above the chart sections === */
/* "Based on real usage data from millions..." */
h1 + p { display: none !important; }

/* === HIDE: the rankings TABLE === */
table, [role="table"] { display: none !important; }

/* === HIDE: all scroll-mt sections EXCEPT the first (Top Models chart) === */
.scroll-mt-24 ~ .scroll-mt-24 { display: none !important; }

/* === HIDE: inside Top Models: the LLM Leaderboard heading + ranked list === */
/* Keep only children 0 (heading) and 1 (chart) of the first scroll-mt section */
.scroll-mt-24:first-of-type > div:nth-child(n+3) { display: none !important; }

/* === HIDE: the "Based on real usage data" description === */
/* It's in a flex-col gap-12 wrapper, first child is the description area */
.gap-12 > .flex-col:first-child > p { display: none !important; }

/* === BODY: clean embed === */
body {
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 4px !important;
  background: #fff !important;
}
body > div:first-child { min-height: unset !important; }
main, [role="main"] {
  max-width: 100% !important;
  padding: 0 !important;
  margin: 0 auto !important;
}
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
noscript { display: none !important; }
</style>`;

    // ── 2b. Post-render cleanup script — hides remaining non-chart content ──
    const postCleanup = `
<script>
document.addEventListener('DOMContentLoaded', function() {
  function clipToChart() {
    // Hide the top-level description paragraph
    var ps = document.querySelectorAll('p');
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].textContent.indexOf('Based on real usage data') !== -1) {
        ps[i].style.display = 'none';
      }
    }
    // Hide all scroll-mt-24 sections except the first one
    var sections = document.querySelectorAll('[class*="scroll-mt-24"]');
    for (var j = 1; j < sections.length; j++) {
      sections[j].style.display = 'none';
    }
    // Inside the first section, hide children after the chart (index 2+)
    if (sections[0]) {
      var kids = sections[0].children;
      for (var k = 2; k < kids.length; k++) {
        kids[k].style.display = 'none';
      }
    }
  }
  clipToChart();
  setTimeout(clipToChart, 2000);
  setTimeout(clipToChart, 5000);
  setTimeout(clipToChart, 10000);
});
</script>`;

    // ── 3. Inject into <head> ──
    if (html.includes('<head>')) {
      html = html.replace('<head>', '<head>' + errorSuppress);
    } else {
      html = errorSuppress + html;
    }

    if (html.includes('</head>')) {
      html = html.replace('</head>', cleanupCSS + postCleanup + '</head>');
    } else {
      html = cleanupCSS + postCleanup + html;
    }

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response('Proxy error: ' + err.message, { status: 502 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
