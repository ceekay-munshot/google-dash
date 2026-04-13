/**
 * Cloudflare Radar API - Entities (ASNs, Locations, etc.)
 * 
 * Get information about network entities
 * 
 * Usage: /api/radar/entities?type=asns&limit=10
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
  const type = url.searchParams.get('type') || 'asns';
  const limit = url.searchParams.get('limit') || '20';

  try {
    const radarUrl = `https://api.cloudflare.com/client/v4/radar/entities/${type}?limit=${limit}`;
    
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
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
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
