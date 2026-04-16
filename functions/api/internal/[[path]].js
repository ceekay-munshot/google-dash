/**
 * Catch-all proxy for /api/internal/* → https://openrouter.ai/api/internal/*
 * Proxies internal API calls for the OpenRouter rankings iframe embed.
 */
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const path = context.params.path;
  const segments = Array.isArray(path) ? path.join('/') : path;
  const url = new URL(context.request.url);
  const target = 'https://openrouter.ai/api/internal/' + segments + url.search;

  try {
    const resp = await fetch(target, {
      method: context.request.method,
      headers: {
        'User-Agent': context.request.headers.get('User-Agent') || '',
        'Accept': context.request.headers.get('Accept') || 'application/json',
      },
    });

    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=300');
    return new Response(resp.body, { status: resp.status, headers });
  } catch (err) {
    return new Response('{}', { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}
