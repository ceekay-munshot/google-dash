/**
 * Cloudflare Pages Function — AI Dashboard Summary
 * Route: POST /api/ai-summary
 */

const GENSPARK_KEY = 'gsk-eyJjb2dlbl9pZCI6ImRkZjcxNGRmLTk2MTQtNDllNy1hNTU5LTM4MDJkYjg1MzM5YiIsImtleV9pZCI6Ijk4ODVkNzA3LWYxMGMtNDYzMS1hODEzLTBjMjE4OTlhMWM2ZiIsImN0aW1lIjoxNzc0NTEzNzEwLCJjbGF1ZGVfYmlnX21vZGVsIjpudWxsLCJjbGF1ZGVfbWlkZGxlX21vZGVsIjpudWxsLCJjbGF1ZGVfc21hbGxfbW9kZWwiOm51bGx9fJJgn8fmQ_0gI3Y6WqcKzMDez3SEnXlki-vvE7Mbohkw';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request }) {
  try {
    const body = await request.json().catch(() => ({}));
    const { filing, orModels, botTraffic, trends, generatedAt } = body;
    const dataBlock = buildDataBlock({ filing, orModels, botTraffic, trends });

    const prompt =
      `You are an elite AI and technology sector analyst briefing a senior fund manager at a long/short equity hedge fund with a position in Alphabet (GOOGL). ` +
      `Below is a live snapshot of signals across OpenRouter API rankings, Cloudflare bot traffic, Google Trends, and Alphabet's latest SEC filing.\n\n` +
      `RULES:\n` +
      `- Exactly 6 bullet points. No more, no less.\n` +
      `- Each bullet is one sentence, max 25 words.\n` +
      `- Every bullet must be actionable or directionally meaningful for an equity investor.\n` +
      `- Flag each as bullish, bearish, or watch where relevant.\n` +
      `- Focus on: Gemini vs OpenAI/xAI competitive position, search monetisation signals, AI adoption trends, anomalies.\n` +
      `- Style: Goldman Sachs TMT desk note — precise, direct, no hedging.\n\n` +
      `LIVE DATA (${generatedAt || new Date().toISOString()}):\n${dataBlock}\n\n` +
      `Return ONLY valid JSON, nothing else:\n` +
      `{"bullets":["bullet 1","bullet 2","bullet 3","bullet 4","bullet 5","bullet 6"]}`;

    // Call Genspark with retry
    let bullets = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch('https://api.genspark.ai/v1/chat/completions', {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + GENSPARK_KEY,
          },
          body: JSON.stringify({
            model:       'genspark-auto',
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens:  600,
          }),
        });

        // Read as text first — never trust .json() blindly
        const raw = await r.text();
        if (!raw || !raw.trim()) throw new Error('Empty response from Genspark (attempt ' + attempt + ')');

        let d;
        try { d = JSON.parse(raw); }
        catch (e) { throw new Error('Genspark non-JSON response: ' + raw.slice(0, 100)); }

        const content = d?.choices?.[0]?.message?.content || '';
        if (!content) throw new Error('No content in Genspark response');

        // Extract JSON from content
        const m = content.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('No JSON object in: ' + content.slice(0, 100));

        const parsed = JSON.parse(m[0]);
        if (!Array.isArray(parsed.bullets) || parsed.bullets.length < 3) {
          throw new Error('Too few bullets: ' + parsed.bullets?.length);
        }

        bullets = parsed.bullets.slice(0, 6);
        break; // success

      } catch (e) {
        lastError = e.message;
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!bullets) throw new Error(lastError || 'Genspark failed after retries');

    return jsonOk({ success: true, bullets, generatedAt: new Date().toISOString(), model: 'genspark-auto' });

  } catch (err) {
    return jsonOk({ success: false, error: err.message });
  }
}

function buildDataBlock({ filing, orModels, botTraffic, trends }) {
  const lines = [];

  if (filing?.success) {
    lines.push('=== ALPHABET LATEST EARNINGS ===');
    lines.push(`Period: ${filing.period}`);
    lines.push(`Google Search & Other: ${filing.searchRevenue} (${filing.searchRevenueGrowth} YoY)`);
    lines.push(`Paid-Click Growth: ${filing.paidClicksGrowth} YoY`);
    lines.push(`CPC Growth: ${filing.cpcGrowth} YoY`);
    lines.push(`Total Revenue: ${filing.totalRevenue} (${filing.totalRevenueGrowth} YoY)`);
    lines.push('');
  }

  if (orModels?.length) {
    lines.push('=== OPENROUTER WEEKLY TOKEN RANKINGS ===');
    orModels.slice(0, 9).forEach(m => {
      lines.push(`#${m.rank} ${m.model} (${m.provider}): ${m.tokens || m.tokensLabel} tokens, WoW ${m.wow || m.wowLabel}${m.isGemini ? ' [GEMINI]' : ''}`);
    });
    const gems = orModels.filter(m => m.isGemini).map(m => `#${m.rank} ${m.model}`);
    lines.push(`Gemini in top-10: ${gems.join(', ') || 'none'}`);
    lines.push(`#1: ${orModels[0]?.model} (${orModels[0]?.provider})`);
    lines.push('');
  }

  if (botTraffic?.length) {
    lines.push('=== AI CRAWLER TRAFFIC SHARE (Cloudflare Radar, 28d) ===');
    botTraffic.forEach(b => lines.push(`${b.name}: ${b.pct}%`));
    const g = botTraffic.find(b => /google/i.test(b.name));
    const gpt = botTraffic.find(b => /gpt/i.test(b.name));
    if (g && gpt) lines.push(`Googlebot/GPTBot ratio: ${(g.pct/gpt.pct).toFixed(1)}x`);
    lines.push('');
  }

  if (trends?.length) {
    lines.push('=== GOOGLE TRENDS SEARCH INTEREST ===');
    trends.forEach(t => lines.push(`${t.term}: ${t.score}/100`));
    const gem = trends.find(t => /gemini/i.test(t.term));
    const cgpt = trends.find(t => /chatgpt/i.test(t.term));
    if (gem && cgpt) lines.push(`Gemini/ChatGPT ratio: ${(gem.score/cgpt.score).toFixed(2)}x`);
  }

  return lines.join('\n');
}

function jsonOk(obj) {
  return new Response(JSON.stringify(obj), {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}
