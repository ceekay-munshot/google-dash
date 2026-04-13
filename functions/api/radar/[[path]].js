/**
 * Cloudflare Pages Function — Cloudflare Radar API Proxy
 * Route: /api/radar/*
 * Method: GET only
 *
 * All query string parameters (including `name=`, `dateRange=`, `aggInterval=`,
 * `normalization=`, `limitPerGroup=`, `serviceCategory=`, etc.) are forwarded
 * verbatim to the Cloudflare Radar v4 API.
 *
 * The token is read from the Pages environment variable
 * CLOUDFLARE_RADAR_API_TOKEN — it is NEVER exposed to the browser.
 */

const RADAR_BASE = 'https://api.cloudflare.com/client/v4/radar';

// Fallback token (used when env var is not set)
const RADAR_TOKEN_FALLBACK = 'cfut_k2KZDeJMxFczw6PSshmHev0KfhVboD1L8PaKFn9Y90c91c95';

// How long the CDN / browser may cache a successful response (5 min)
const CACHE_SECONDS = 300;

export async function onRequestGet({ request, env }) {
  const token = (env && env.CLOUDFLARE_RADAR_API_TOKEN) || RADAR_TOKEN_FALLBACK;

  if (!token) {
    return jsonResponse({
      success: false,
      error:   'CLOUDFLARE_RADAR_API_TOKEN not configured',
      hint:    'Add the variable in Pages → Settings → Environment Variables'
    }, 500);
  }

  const url  = new URL(request.url);
  // Strip the leading /api/radar/ prefix to get the Radar path segment
  const path = url.pathname.replace(/^\/api\/radar\/?/, '');

  if (!path) {
    return jsonResponse({ success: false, error: 'Missing Radar path' }, 400);
  }

  // Forward the complete query string unchanged (name=, dateRange=, etc.)
  const radarUrl = `${RADAR_BASE}/${path}${url.search}`;

  try {
    const upstream = await fetch(radarUrl, {
      method:  'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json'
      }
    });

    const body = await upstream.json();

    return new Response(JSON.stringify(body), {
      status: upstream.status,
      headers: {
        'Content-Type':                  'application/json',
        'Access-Control-Allow-Origin':   '*',
        'Access-Control-Allow-Methods':  'GET, OPTIONS',
        'Access-Control-Allow-Headers':  'Content-Type',
        // Cache successful responses for 5 min; errors are not cached
        'Cache-Control': upstream.ok
          ? `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`
          : 'no-store'
      }
    });

  } catch (err) {
    return jsonResponse({
      success: false,
      error:   'Upstream fetch failed',
      message: err.message
    }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

/* ── helpers ── */
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
