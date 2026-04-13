/**
 * Cloudflare Pages Function — Firecrawl Scrape Proxy
 * Route: /api/scrape
 * Method: POST
 *
 * Body: { url: string, formats?: string[], onlyMainContent?: boolean }
 * Returns: Firecrawl scrape response JSON
 */

const FIRECRAWL_API_KEY = 'fc-203d41c5b1984cdabee2a7564572efea';
const FIRECRAWL_BASE    = 'https://api.firecrawl.dev/v1';

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  if (!body || !body.url) {
    return jsonResponse({ success: false, error: 'Missing required field: url' }, 400);
  }

  const payload = {
    url:             body.url,
    formats:         body.formats         || ['markdown'],
    onlyMainContent: body.onlyMainContent !== undefined ? body.onlyMainContent : true
  };

  try {
    const upstream = await fetch(FIRECRAWL_BASE + '/scrape', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + FIRECRAWL_API_KEY,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json();

    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-store'
      }
    });

  } catch (err) {
    return jsonResponse({ success: false, error: 'Upstream fetch failed: ' + err.message }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control':               'no-store'
    }
  });
}
