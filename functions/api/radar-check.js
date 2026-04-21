/**
 * Comprehensive Cloudflare Radar API Token Checker
 * 
 * This endpoint tests multiple Radar API endpoints to verify:
 * 1. Token is configured
 * 2. Token has valid format
 * 3. Which endpoints the token can access
 * 
 * Usage: https://google-dash-git.pages.dev/api/radar-check
 */

export async function onRequestGet({ env }) {
  const token = env.CLOUDFLARE_RADAR_API_TOKEN;
  
  if (!token) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'CLOUDFLARE_RADAR_API_TOKEN not configured',
      token_configured: false
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // List of Cloudflare Radar API endpoints to test
  const endpointsToTest = [
    {
      name: 'Verified Bots',
      url: 'https://api.cloudflare.com/client/v4/radar/verified_bots/top/bots?limit=5',
      description: 'Top verified bots'
    },
    {
      name: 'HTTP Time Series',
      url: 'https://api.cloudflare.com/client/v4/radar/http/timeseries_groups?aggInterval=1d&dateRange=7d',
      description: 'HTTP traffic time series'
    },
    {
      name: 'BGP Routes',
      url: 'https://api.cloudflare.com/client/v4/radar/bgp/timeseries?dateRange=7d',
      description: 'BGP routing data'
    },
    {
      name: 'Entities - ASNs',
      url: 'https://api.cloudflare.com/client/v4/radar/entities/asns?limit=5',
      description: 'Autonomous System Numbers'
    },
    {
      name: 'Traffic Anomalies',
      url: 'https://api.cloudflare.com/client/v4/radar/traffic_anomalies?limit=5',
      description: 'Recent traffic anomalies'
    }
  ];

  const results = [];
  let successCount = 0;

  // Test each endpoint
  for (const endpoint of endpointsToTest) {
    try {
      const response = await fetch(endpoint.url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      const testResult = {
        name: endpoint.name,
        description: endpoint.description,
        success: data.success === true,
        status_code: response.status,
        error: data.success ? null : (data.errors?.[0]?.message || 'Unknown error')
      };
      
      results.push(testResult);
      
      if (data.success === true) {
        successCount++;
      }
    } catch (error) {
      results.push({
        name: endpoint.name,
        description: endpoint.description,
        success: false,
        status_code: 0,
        error: error.message
      });
    }
  }

  // Determine overall status
  const overallStatus = successCount > 0 ? 'working' : 'failed';
  const tokenValid = successCount > 0;

  return new Response(JSON.stringify({
    status: overallStatus,
    message: tokenValid 
      ? `Cloudflare Radar API token is working! (${successCount}/${endpointsToTest.length} endpoints accessible)`
      : 'Token configured but no endpoints are accessible',
    token_configured: true,
    token_valid: tokenValid,
    endpoints_tested: endpointsToTest.length,
    endpoints_working: successCount,
    endpoint_results: results,
    recommendation: tokenValid 
      ? 'Token is working. You can now use the Radar API proxy.'
      : 'Token may have insufficient permissions or the API structure has changed. Check Cloudflare Radar API documentation.',
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });
}
