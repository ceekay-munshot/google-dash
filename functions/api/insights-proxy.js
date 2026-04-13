/**
 * Cloudflare Pages Function — Artificial Analysis Trends Proxy
 * Route: /api/insights-proxy
 * Method: GET
 *
 * Fetches https://artificialanalysis.ai/trends, injects CSS to hide
 * unwanted chrome (nav, footer, login, CTAs, etc.), and returns cleaned HTML.
 * Rendered inside an iframe on the Insights tab.
 */

const TARGET_URL = 'https://artificialanalysis.ai/trends';

const HIDE_SELECTORS = [
  'nav',
  'header',
  'footer',
  "[aria-label='Back to top']",
  '[data-sonner-toaster]',
  '[data-vaul-drawer]',
  '[data-vaul-overlay]',
  'aside .sticky.top-24.z-30',
  '.sticky.top-24.z-30',
  "a[href*='login']",
  "a[href*='/orgs']",
];

const REMOVE_TEXT_MATCHES = [
  'Access Report',
  'State of AI',
  'Log in',
  'Subscribe',
];

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

    // Build CSS block that hides unwanted selectors
    const hideCSS = HIDE_SELECTORS.map(
      (s) => s + '{display:none!important}'
    ).join('\n');

    // Build JS that removes elements containing unwanted text
    const removeScript = `
<script>
(function(){
  var texts = ${JSON.stringify(REMOVE_TEXT_MATCHES)};
  function clean(){
    texts.forEach(function(t){
      document.querySelectorAll('a, button, span, div, p').forEach(function(el){
        if(el.children.length < 3 && el.textContent.trim() === t){
          el.style.display = 'none';
        }
      });
    });
  }
  clean();
  setTimeout(clean, 1500);
  setTimeout(clean, 4000);
})();
</script>`;

    // Extra cleanup CSS: hide sticky side nav, promo banners, newsletter CTAs
    const extraCSS = `
aside { display: none !important; }
[class*="newsletter"] { display: none !important; }
[class*="promo"] { display: none !important; }
[class*="cta" i] { display: none !important; }
[class*="toast"] { display: none !important; }
body { overflow-x: hidden !important; }
`;

    // Inject our cleanup <style> right after <head>
    const styleTag =
      '<style id="gdash-clean">' + hideCSS + extraCSS + '</style>';

    if (html.includes('</head>')) {
      html = html.replace('</head>', styleTag + removeScript + '</head>');
    } else {
      html = styleTag + removeScript + html;
    }

    // Rewrite relative URLs to absolute so assets load correctly
    html = html.replace(
      /(href|src|action)="\/(?!\/)/g,
      '$1="https://artificialanalysis.ai/'
    );

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
