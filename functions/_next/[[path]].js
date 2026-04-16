/**
 * Catch-all proxy for /_next/* → https://openrouter.ai/_next/*
 * Proxies JS chunks, CSS, and other Next.js assets for the
 * OpenRouter rankings iframe embed.
 */
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const path = context.params.path;
  const segments = Array.isArray(path) ? path.join('/') : path;
  const url = new URL(context.request.url);
  const target = 'https://openrouter.ai/_next/' + segments + url.search;

  try {
    const resp = await fetch(target, {
      headers: {
        'User-Agent': context.request.headers.get('User-Agent') || '',
        'Accept': context.request.headers.get('Accept') || '*/*',
      },
    });

    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    // Next.js hashed assets are immutable
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    return new Response(resp.body, {
      status: resp.status,
      headers,
    });
  } catch (err) {
    return new Response('', { status: 502 });
  }
}
