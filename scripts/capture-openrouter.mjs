#!/usr/bin/env node
/**
 * Capture the OpenRouter "Top Models" weekly token series and forward it to
 * the dashboard capture endpoint. Run by .github/workflows/openrouter-capture.yml.
 *
 * OpenRouter's rankings chart is client-rendered, so the weekly `x + ys` token
 * series is not in the page HTML — it arrives as a network response after the
 * page's JS runs. This script loads the page in a headless browser, intercepts
 * that response, and POSTs the exact payload to:
 *     /api/openrouter-chart-weekly?capture=1
 * which parses it and persists it to HISTORY_KV.
 *
 * Required env:
 *   OPENROUTER_CAPTURE_URL  POST target, e.g.
 *       https://google-dash-git.pages.dev/api/openrouter-chart-weekly?capture=1
 *   CAPTURE_TOKEN           bearer token; must match the dashboard's CAPTURE_TOKEN
 *
 * Optional:
 *   DRY_RUN=true  (or pass --dry-run)  capture only — print a summary, skip the POST
 */
import { chromium } from 'playwright';

const RANKINGS_URL  = 'https://openrouter.ai/rankings?view=week';
const CAPTURE_URL   = process.env.OPENROUTER_CAPTURE_URL || '';
const CAPTURE_TOKEN = process.env.CAPTURE_TOKEN || '';
const DRY_RUN       = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function log(...a) { console.error('[capture-openrouter]', ...a); }

/** True when a response body carries the model-level weekly series. */
function isModelSeries(body) {
  if (!body || body.indexOf('"data":[') < 0) return false;
  if (body.indexOf('"x":"') < 0 || body.indexOf('"ys":') < 0) return false;
  // Model-level ys keys are "provider/model" slugs — find a slug:number pair.
  return /"[a-z][a-z0-9-]*\/[A-Za-z0-9][\w.:-]*":\s*\d/.test(body);
}

async function captureOnce() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const hits = [];
    page.on('response', async (resp) => {
      try {
        const rt = resp.request().resourceType();
        if (rt !== 'fetch' && rt !== 'xhr' && rt !== 'document') return;
        if (resp.status() !== 200) return;
        const body = await resp.text();
        if (isModelSeries(body)) hits.push({ url: resp.url(), body });
      } catch (_) { /* body not retrievable — skip */ }
    });
    await page.goto(RANKINGS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // The chart fetch fires after hydration — give it up to ~20s to land.
    for (let i = 0; i < 20 && hits.length === 0; i++) await page.waitForTimeout(1000);
    if (hits.length === 0) throw new Error('no model-level chart response observed');
    // Prefer the largest matching payload (the full multi-week series).
    hits.sort((a, b) => b.body.length - a.body.length);
    return hits[0];
  } finally {
    await browser.close();
  }
}

async function postCapture(body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(CAPTURE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          ...(CAPTURE_TOKEN ? { Authorization: 'Bearer ' + CAPTURE_TOKEN } : {}),
        },
        body,
      });
      const text = await resp.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
      log(`POST attempt ${attempt}: HTTP ${resp.status}`, JSON.stringify(json));
      if (resp.ok && json.success === true) return true;
    } catch (e) {
      log(`POST attempt ${attempt} failed: ${e.message}`);
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 10000));
  }
  return false;
}

async function main() {
  if (!DRY_RUN && !CAPTURE_URL) { log('ERROR: OPENROUTER_CAPTURE_URL is not set'); process.exit(2); }

  let hit = null, lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log(`capture attempt ${attempt}/3 …`);
      hit = await captureOnce();
      const weekCount = (hit.body.match(/"x":"/g) || []).length;
      log(`captured ${hit.body.length} bytes (~${weekCount} week rows) from ${hit.url}`);
      break;
    } catch (e) {
      lastErr = e;
      log(`attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 10000));
    }
  }
  if (!hit) { log('FAILED — could not capture the weekly series: ' + (lastErr && lastErr.message)); process.exit(1); }

  if (DRY_RUN) {
    log('DRY RUN — capture succeeded, not posting. Payload preview:');
    console.log(hit.body.slice(0, 700));
    log('OK (dry run)');
    return;
  }

  const ok = await postCapture(hit.body);
  if (!ok) { log('FAILED — capture endpoint did not confirm success'); process.exit(1); }
  log('OK — weekly series captured and persisted');
}

main().catch(e => { log('FATAL: ' + (e && e.message)); process.exit(1); });
