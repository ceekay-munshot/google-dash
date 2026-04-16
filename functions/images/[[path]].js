/**
 * Catch-all proxy for /images/* → https://openrouter.ai/images/*
 * Proxies model icons for the OpenRouter rankings iframe embed.
 */
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  const path = context.params.path;
  const segments = Array.isArray(path) ? path.join('/') : path;
  const url = new URL(context.request.url);
  const target = 'https://openrouter.ai/images/' + segments + url.search;

  try {
    const resp = await fetch(target);
    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(resp.body, { status: resp.status, headers });
  } catch (err) {
    return new Response('', { status: 502 });
  }
}
