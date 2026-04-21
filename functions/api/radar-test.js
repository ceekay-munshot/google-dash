/**
 * Health check endpoint for Cloudflare Radar API proxy
 * 
 * Test this endpoint to verify your API token is working:
 * https://google-dash-git.pages.dev/api/radar-test
 */

export async function onRequestGet({ env }) {
  const token = env.CLOUDFLARE_RADAR_API_TOKEN;
  
  if (!token) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'CLOUDFLARE_RADAR_API_TOKEN not configured',
      instructions: 'Go to Cloudflare Pages → Settings → Environment variables → Add variable',
      variable_name: 'CLOUDFLARE_RADAR_API_TOKEN',
      variable_value: 'YOUR_TOKEN_HERE  (set this in Pages → Environment Variables)'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Test the token by calling a simple Cloudflare Radar endpoint
  try {
    // Try multiple endpoints to find one that works
    const testEndpoints = [
      'https://api.cloudflare.com/client/v4/radar/entities/asns',
      'https://api.cloudflare.com/client/v4/radar/verified_bots/top/bots',
      'https://api.cloudflare.com/client/v4/radar/http/timeseries_groups?aggInterval=1d&dateRange=7d'
    ];
    
    let lastError = null;
    for (const endpoint of testEndpoints) {
      try {
        const response = await fetch(endpoint, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        const data = await response.json();
        
        if (data.success === true) {
          return new Response(JSON.stringify({
            status: 'success',
            message: 'Cloudflare Radar API token is working!',
            token_configured: true,
            token_valid: true,
            test_endpoint: endpoint,
            api_response: data
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        lastError = data;
      } catch (e) {
        lastError = { error: e.message };
      }
    }
    
    // If all endpoints failed
    return new Response(JSON.stringify({
      status: 'partial',
      message: 'Token configured but API endpoints returned errors',
      token_configured: true,
      token_valid: false,
      last_error: lastError,
      note: 'The token might need different permissions or the API endpoints may have changed'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'Failed to test Cloudflare Radar API',
      error: error.message,
      token_configured: true
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
