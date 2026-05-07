/**
 * Cloudflare Pages Function — AWS EC2 On-Demand Pricing reverse proxy
 * Mount: /api/proxy/aws/ec2-on-demand-pricing/[[path]]
 *
 * Why a proxy is needed at all:
 *   aws.amazon.com/ec2/pricing/on-demand/ ships with X-Frame-Options:
 *   SAMEORIGIN, so the page can never be iframed cross-origin directly.
 *   This proxy fetches the page server-side, strips the framing/CSP
 *   headers, and serves it from our origin so the dashboard iframe is
 *   allowed to render it.
 *
 * What this proxy serves vs. what the browser still loads directly:
 *   The proxy returns the HTML body only. AWS uses ABSOLUTE URLs
 *   (https://a0.awsstatic.com/..., https://b0.p.awsstatic.com/...) for
 *   every script, font, and asset, so the browser still loads those
 *   from AWS directly — no need to mirror them through us. We only
 *   touch the top-level HTML document.
 *
 * Known limitation (documented in the dashboard's Pricing Trends note):
 *   The instance pricing TABLE inside the page is itself a NESTED
 *   iframe pulled from c0.b0.p.awsstatic.com, which enforces a CSP
 *   `frame-ancestors` allow-list of AWS-owned domains. We can't
 *   override that header on a response we don't control. So when the
 *   parent page is served from our origin, the inner widget refuses
 *   to render. The Data Transfer pricing tables (static HTML in the
 *   parent page) render fine. The UI shows a small fallback note in
 *   place of the blocked widget.
 *
 * Sub-paths under this catch-all:
 *   AWS uses absolute URLs throughout, so we don't need to mirror
 *   their assets. Any GET against a sub-path here returns a 404 — if
 *   that ever changes (AWS adds relative URLs we depend on), we'll
 *   add an asset proxy similar to the llmpricing-proxy pattern.
 */

const UPSTREAM = 'https://aws.amazon.com/ec2/pricing/on-demand/';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function corsHeaders(extra) {
  const h = new Headers(extra || {});
  h.set('Access-Control-Allow-Origin', '*');
  return h;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders({
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }),
  });
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const raw = context.params.path;
  const segments = Array.isArray(raw) ? raw.join('/') : raw || '';

  // Empty path → serve the rewritten HTML shell.
  if (segments === '') return serveHtml();

  // Sub-paths are not used today (AWS uses absolute URLs for all assets).
  // Returning 404 instead of a generic proxy keeps the surface tight.
  return new Response('Not found', { status: 404, headers: corsHeaders() });
}

async function serveHtml() {
  let resp;
  try {
    resp = await fetch(UPSTREAM, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
  } catch (err) {
    return fallbackResp('upstream fetch failed: ' + (err && err.message ? err.message : err));
  }

  if (!resp.ok) {
    return fallbackResp('upstream returned HTTP ' + resp.status);
  }

  let html = await resp.text();

  // ── 1. <base href> so any RELATIVE URL the page emits resolves back to AWS.
  //       Most assets are absolute; this is belt-and-suspenders for anchor
  //       hrefs (e.g. "?#topic-1") and any rare relative <img> reference.
  const baseTag = `<base href="${UPSTREAM}">`;

  // ── 2. CSS to clip the page down to the two areas the dashboard needs:
  //       (a) On-Demand Plans for Amazon EC2 (instance pricing widget),
  //       (b) Data Transfer pricing tables.
  //       Hides the global nav / header / footer / hero / FAQ / CTA / chat
  //       bubble / cookie banner. AWS's marketing page structure is fluid;
  //       this is best-effort and may need tightening when AWS reorganizes.
  const cleanupCSS = `
<style id="gdash-aws-ec2-clean">
:root, html, body {
  background: #ffffff !important;
  color: #111827 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow-x: hidden !important;
}
/* Top global nav, sticky utility bar, breadcrumbs */
header, nav, [role="banner"], [role="navigation"],
.lb-page-header, .lb-page-nav, .lb-breadcrumbs,
.lb-billboard, .lb-hero, .lb-hero-content,
.aws-page-header, .aws-page-header-container,
#aws-page-header, #aws-nav, #aws-header,
.aws-nav, .lb-cf-i, .lb-icon-bar, .awsui-feedback-floating,
.m-headline, .lb-grid-row.lb-padding-top--none ~ section[data-aem-block]:first-of-type {
  display: none !important;
}
/* Footer + sub-footer */
footer, [role="contentinfo"],
.lb-page-footer, .aws-page-footer, #aws-page-footer, #aws-footer {
  display: none !important;
}
/* Common AWS marketing furniture: chat bubble, cookie banner, social CTAs */
#awsccc-cb-c, #awsccc-cs-container, .awsccc-cb-c,
[id^="awsccc-"], #consent-banner,
[data-component="ChatWidget"], .gcr-chat-widget,
[id*="cookie"], [class*="cookie"][class*="banner"],
[aria-label*="chat" i], [aria-label*="feedback" i] {
  display: none !important;
}
/* Reduce top padding the nav used to occupy */
body, main, .aws-content-wrapper, .lb-content {
  padding-top: 0 !important;
  margin-top: 0 !important;
}
/* Tighten section padding so the clipped view feels like a single
   compact reference, not a long marketing scroll. */
main section, .lb-section { padding-top: 12px !important; padding-bottom: 12px !important; }
/* Hide everything between the nav and the first pricing table by zeroing
   out the marketing hero / billboard sections that come before pricing.
   The pricing tables themselves use AEM blocks; we keep those visible. */
section.lb-hero, section.lb-billboard, section.aws-billboard,
[data-aem-block="hero"], [data-aem-block="billboard"] { display: none !important; }
/* Ensure the embedded pricing-table iframe (when it works) renders without
   a scrollbar collapse from a fixed parent height. */
iframe[src*="awsstatic.com"], iframe[src*="aws.a2z.com"] {
  width: 100% !important;
  min-height: 600px !important;
  border: 0 !important;
}
/* Lightweight scrollbar inside the iframe */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
</style>`;

  // ── 3. Belt-and-suspenders runtime cleanup. Marketing pages frequently
  //       inject extra DOM after hydration; this re-runs the hide pass on
  //       a small interval so late-arriving banners / chat widgets get
  //       suppressed without us needing per-element selectors. Also opens
  //       any escaped link in a new tab so the iframe can't be navigated
  //       away from the pricing context.
  const postHydrate = `
<script>
(function(){
  var killSelectors = [
    'header','nav','footer','[role="banner"]','[role="navigation"]','[role="contentinfo"]',
    '.lb-page-header','.lb-page-nav','.lb-page-footer','.lb-breadcrumbs','.lb-billboard','.lb-hero',
    '.aws-page-header','.aws-page-footer','#aws-page-header','#aws-page-footer','#aws-nav','#aws-header','#aws-footer',
    '[id^="awsccc-"]','#consent-banner','.awsccc-cb-c',
    '[data-component="ChatWidget"]','.gcr-chat-widget',
    '[aria-label*="chat" i]','[aria-label*="feedback" i]','.awsui-feedback-floating',
  ];
  function killChrome(){
    try {
      for (var i = 0; i < killSelectors.length; i++) {
        var nodes = document.querySelectorAll(killSelectors[i]);
        for (var j = 0; j < nodes.length; j++) nodes[j].style.display = 'none';
      }
    } catch (e) {}
  }
  function retargetLinks(){
    try {
      var anchors = document.querySelectorAll('a[href]');
      for (var i = 0; i < anchors.length; i++) {
        var h = anchors[i].getAttribute('href') || '';
        if (!h || h.charAt(0) === '#') continue;
        anchors[i].setAttribute('target', '_blank');
        anchors[i].setAttribute('rel', 'noopener');
      }
    } catch (e) {}
  }
  // Suppress noisy unhandled rejections from AWS analytics so they don't
  // turn the dashboard's console red.
  window.addEventListener('unhandledrejection', function(e){ e.preventDefault(); });
  killChrome(); retargetLinks();
  setTimeout(function(){ killChrome(); retargetLinks(); }, 600);
  setTimeout(function(){ killChrome(); retargetLinks(); }, 2000);
  setTimeout(function(){ killChrome(); retargetLinks(); }, 5000);
})();
</script>`;

  // Inject in the right places. Order matters:
  //   - <base> first inside <head> so subsequent relative URLs in <head>
  //     (mostly AWS already uses absolute URLs but be defensive) resolve.
  //   - cleanup CSS at end of <head> so it overrides AWS's own styles.
  //   - postHydrate at end of <body> so it runs after the page's own scripts
  //     have populated the DOM.
  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + baseTag);
  } else {
    html = baseTag + html;
  }
  if (html.includes('</head>')) {
    html = html.replace('</head>', cleanupCSS + '</head>');
  } else {
    html = cleanupCSS + html;
  }
  if (html.includes('</body>')) {
    html = html.replace('</body>', postHydrate + '</body>');
  } else {
    html = html + postHydrate;
  }

  // Strip framing / CSP. We do NOT pass the upstream's CSP through because
  // it includes report-uri targets that would 403 from our origin and adds
  // noise; AWS's static assets are loaded by absolute URL and don't depend
  // on CSP allow-lists from our response.
  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  headers.set('Access-Control-Allow-Origin', '*');
  // Explicitly DO NOT set X-Frame-Options or Content-Security-Policy.

  return new Response(html, { status: 200, headers });
}

/** Tiny standalone fallback document. The dashboard wrapper also has a
 *  fallback message; this one fires when even the upstream HTML can't be
 *  fetched (e.g. transient AWS 5xx). Keeps the iframe from showing the
 *  user a raw error string. */
function fallbackResp(detail) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>EC2 pricing temporarily unavailable</title>
<style>html,body{margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#374151}
.wrap{padding:40px 24px;max-width:600px;margin:0 auto;text-align:center}
.t{font-size:14px;font-weight:600;color:#111827;margin-bottom:6px}
.s{font-size:12px;color:#6b7280;line-height:1.55}
a{color:#0e7490;text-decoration:none;border-bottom:1px dashed #0e7490}</style></head>
<body><div class="wrap">
<div class="t">AWS EC2 pricing live embed temporarily unavailable.</div>
<div class="s">${escapeHtml(detail)}<br><br>You can open the source page directly: <a href="${UPSTREAM}" target="_blank" rel="noopener">aws.amazon.com/ec2/pricing/on-demand</a></div>
</div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: corsHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    }),
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
