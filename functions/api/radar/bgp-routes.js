/**
 * Cloudflare Radar API - BGP Routes Time Series
 * 
 * Get BGP routing data over time
 * 
 * Usage: /api/radar/bgp-routes?dateRange=7d
 */

export async function onRequestGet({ request, env }) {
  const token = env.CLOUDFLARE_RADAR_API_TOKEN;
  
  if (!token) {
    return new Response(JSON.stringify({
      success: false,
      error: 'API token not configured'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const url = new URL(request.url);
  const dateRange = url.searchParams.get('dateRange') || '7d';

  try {
    const radarUrl = `https://api.cloudflare.com/client/v4/radar/bgp/timeseries?dateRange=${dateRange}`;
    
    const response = await fetch(radarUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
