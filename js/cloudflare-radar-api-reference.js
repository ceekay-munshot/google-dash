/**
 * CLOUDFLARE RADAR API — Reference Implementation
 * 
 * Purpose: This file documents how to integrate Cloudflare Radar API calls
 * in a backend proxy layer (Cloudflare Worker or Pages Functions).
 * 
 * IMPORTANT: This dashboard is currently STATIC (no backend). To use the API:
 * 1. Create a Cloudflare Worker or Pages Function
 * 2. Store CLOUDFLARE_RADAR_API_TOKEN in Worker/Pages environment secrets
 * 3. Implement the proxy endpoints below
 * 4. Update dashboard frontend to call these proxy endpoints instead of embeds
 * 
 * API Token: YOUR_TOKEN_HERE  (set CLOUDFLARE_RADAR_API_TOKEN in Pages env, never in frontend)
 * Base URL: https://api.cloudflare.com/client/v4/radar/
 * Auth: Bearer token in Authorization header
 */

// ═══════════════════════════════════════════════════════════════
// EXAMPLE: Cloudflare Worker Proxy
// ═══════════════════════════════════════════════════════════════

/**
 * Example Worker code to proxy Cloudflare Radar API requests
 * 
 * Deploy this as a Cloudflare Worker, set CLOUDFLARE_RADAR_API_TOKEN
 * in Worker environment secrets, then call from your dashboard frontend.
 */
/*
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/radar/', '')
  
  // Only allow GET requests
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }
  
  // Read API token from Worker environment secret
  const token = CLOUDFLARE_RADAR_API_TOKEN
  if (!token) {
    return new Response('API token not configured', { status: 500 })
  }
  
  // Proxy to Cloudflare Radar API
  const radarUrl = `https://api.cloudflare.com/client/v4/radar/${path}${url.search}`
  const response = await fetch(radarUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
  
  const data = await response.json()
  
  // Return with CORS headers for dashboard access
  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}
*/

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS — Reference
// ═══════════════════════════════════════════════════════════════

/**
 * AI Bots — Time Series by User Agent
 * 
 * GET /radar/ai/bots/timeseries_groups
 * Query params:
 *   - dateRange: e.g., "12w" (12 weeks)
 *   - groupBy: "user_agent"
 *   - limit: e.g., 20
 *   - normalization: "MIN0_MAX" or other
 * 
 * Returns: Time series of AI bot HTTP traffic by user agent
 * (ChatGPT-bot, GoogleOther-GoogleProducer, ClaudeBot, etc.)
 */
const AI_BOTS_BY_USER_AGENT = {
  endpoint: '/radar/ai/bots/timeseries_groups',
  params: {
    dateRange: '12w',
    groupBy: 'user_agent',
    limit: 20,
    normalization: 'MIN0_MAX'
  }
}

/**
 * AI Bots — Time Series by Crawl Purpose
 * 
 * GET /radar/ai/bots/timeseries_groups
 * Query params:
 *   - dateRange: "12w"
 *   - groupBy: "crawl_purpose"
 *   - normalization: "MIN0_MAX"
 * 
 * Returns: Time series by why bots are crawling
 * (training, search-indexing, content-scraping, etc.)
 */
const AI_BOTS_BY_PURPOSE = {
  endpoint: '/radar/ai/bots/timeseries_groups',
  params: {
    dateRange: '12w',
    groupBy: 'crawl_purpose',
    normalization: 'MIN0_MAX'
  }
}

/**
 * Workers AI — Inference by Model
 * 
 * GET /radar/ai/inference/timeseries_groups
 * Query params:
 *   - dateRange: "12w"
 *   - groupBy: "model"
 *   - limit: 20
 * 
 * Returns: Time series of Workers AI inference requests by model
 * (Gemini, GPT, Claude, Llama, etc.)
 */
const WORKERS_AI_BY_MODEL = {
  endpoint: '/radar/ai/inference/timeseries_groups',
  params: {
    dateRange: '12w',
    groupBy: 'model',
    limit: 20
  }
}

/**
 * Workers AI — Inference by Task Type
 * 
 * GET /radar/ai/inference/timeseries_groups
 * Query params:
 *   - dateRange: "12w"
 *   - groupBy: "task"
 *   - limit: 20
 * 
 * Returns: Time series by task type
 * (text-generation, summarization, translation, image-classification, etc.)
 */
const WORKERS_AI_BY_TASK = {
  endpoint: '/radar/ai/inference/timeseries_groups',
  params: {
    dateRange: '12w',
    groupBy: 'task',
    limit: 20
  }
}

/**
 * AI Services Ranking
 * 
 * GET /radar/ai/services/ranking
 * 
 * Returns: Relative popularity ranking of AI services by traffic
 */
const AI_SERVICES_RANKING = {
  endpoint: '/radar/ai/services/ranking',
  params: {}
}

// ═══════════════════════════════════════════════════════════════
// FRONTEND USAGE EXAMPLE (once backend proxy is deployed)
// ═══════════════════════════════════════════════════════════════

/**
 * Example: Fetch AI bot data from your Worker proxy
 * 
 * Replace the iframe embed with a Chart.js chart powered by API data
 */
/*
async function fetchAIBotsByUserAgent() {
  try {
    const response = await fetch('https://your-worker.workers.dev/api/radar/ai/bots/timeseries_groups?dateRange=12w&groupBy=user_agent&limit=20&normalization=MIN0_MAX')
    const data = await response.json()
    
    if (data.success) {
      // Transform Cloudflare Radar response into Chart.js format
      const chartData = transformRadarData(data.result)
      renderChart('ai-bots-chart', chartData)
    } else {
      console.error('Cloudflare Radar API error:', data.errors)
      // Fallback: show embed iframe or cached data
    }
  } catch (error) {
    console.error('Failed to fetch Cloudflare Radar data:', error)
    // Fallback: show embed iframe or cached data
  }
}
*/

// ═══════════════════════════════════════════════════════════════
// IMPORTANT NOTES
// ═══════════════════════════════════════════════════════════════

/**
 * Security Requirements:
 * - NEVER expose CLOUDFLARE_RADAR_API_TOKEN in frontend code
 * - NEVER log the token in console, error messages, or analytics
 * - Always use server-side proxy (Worker/Function) for API calls
 * - Use environment secrets/variables for token storage
 * 
 * Labeling Requirements:
 * - Always show "Cloudflare Radar — public directional signal"
 * - Include methodology note: "normalized public trend data based on
 *   observed AI bot / crawler activity — use for directional intelligence,
 *   not exact request accounting"
 * 
 * Implementation Approach:
 * - Keep Cloudflare Radar integration modular and toggleable
 * - If API is unavailable, gracefully fall back to embed iframes
 * - Handle endpoint changes gracefully (Cloudflare may adjust Radar API)
 * - Cache responses appropriately (respect rate limits)
 * 
 * Current Status:
 * - ✅ 5 embed iframes integrated in dashboard
 * - ⏳ Backend proxy not yet implemented (static site)
 * - ⏳ API-driven charts not yet implemented
 */

export {}
