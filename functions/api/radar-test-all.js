/**
 * Final Cloudflare Radar API Test - All Working Endpoints
 * 
 * Tests all 4 working API endpoints with proper parameters
 * 
 * Usage: https://google-dash.pages.dev/api/radar-test-all
 */

export async function onRequestGet({ env }) {
  const token = env.CLOUDFLARE_RADAR_API_TOKEN;
  
  if (!token) {
    return new Response(JSON.stringify({
      status: 'error',
      message: 'CLOUDFLARE_RADAR_API_TOKEN not configured'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const tests = [
    {
      name: 'Verified Bots (Top 5, 7 days)',
      url: 'https://api.cloudflare.com/client/v4/radar/verified_bots/top/bots?dateRange=7d&limit=5',
      endpoint: '/api/radar/verified-bots?dateRange=7d&limit=5'
    },
    {
      name: 'BGP Routes (7 days)',
      url: 'https://api.cloudflare.com/client/v4/radar/bgp/timeseries?dateRange=7d',
      endpoint: '/api/radar/bgp-routes?dateRange=7d'
    },
    {
      name: 'Traffic Anomalies (5 recent)',
      url: 'https://api.cloudflare.com/client/v4/radar/traffic_anomalies?dateRange=7d&limit=5',
      endpoint: '/api/radar/traffic-anomalies?dateRange=7d&limit=5'
    },
    {
      name: 'Entities - ASNs (Top 5)',
      url: 'https://api.cloudflare.com/client/v4/radar/entities/asns?limit=5',
      endpoint: '/api/radar/entities?type=asns&limit=5'
    }
  ];

  const results = [];
  let successCount = 0;

  for (const test of tests) {
    try {
      const response = await fetch(test.url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      results.push({
        name: test.name,
        success: data.success === true,
        status_code: response.status,
        error: data.success ? null : (data.errors?.[0]?.message || 'Unknown error'),
        dashboard_endpoint: test.endpoint,
        sample_result: data.success ? {
          has_data: !!data.result,
          result_type: typeof data.result
        } : null
      });
      
      if (data.success === true) successCount++;
    } catch (error) {
      results.push({
        name: test.name,
        success: false,
        status_code: 0,
        error: error.message,
        dashboard_endpoint: test.endpoint
      });
    }
  }

  return new Response(JSON.stringify({
    status: successCount === tests.length ? 'perfect' : (successCount > 0 ? 'partial' : 'failed'),
    message: `${successCount}/${tests.length} Cloudflare Radar API endpoints working`,
    token_configured: true,
    token_valid: successCount > 0,
    endpoints_tested: tests.length,
    endpoints_working: successCount,
    test_results: results,
    next_steps: successCount > 0 ? [
      'All working endpoints are ready to use',
      'Deploy and test the individual endpoint URLs listed above',
      'Start building dashboard enhancements with live Radar data'
    ] : [
      'Check token permissions in Cloudflare dashboard',
      'Verify token is a Cloudflare Radar API token'
    ],
    timestamp: new Date().toISOString()
  }), {
    status: 200,
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });
}
