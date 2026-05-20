#!/usr/bin/env node
/**
 * Capture the OpenRouter weekly "Top Models" and "Market Share" series and
 * forward them to the dashboard capture endpoint. Run by
 * .github/workflows/openrouter-capture.yml.
 *
 * OpenRouter's rankings charts are client-rendered, so the weekly token
 * series are not in the page HTML — they arrive as network responses after
 * the page's JS runs. This script loads the page in a headless browser,
 * intercepts both responses, and POSTs each to:
 *     /api/openrouter-chart-weekly?capture=1
 * which parses and persists them to HISTORY_KV (the endpoint auto-routes
 * model-level vs provider-level payloads to their own keys).
 *
 * Required env:
 *   OPENROUTER_CAPTURE_URL  POST target, e.g.
 *       https://google-dash-git.pages.dev/api/openrouter-chart-weekly?capture=1
 *   CAPTURE_TOKEN           bearer token; must match the dashboard's CAPTURE_TOKEN
 *
 * Optional:
 *   DRY_RUN=true  (or pass --dry-run)  capture only — print a summary, skip POSTs
 */
import { chromium } from 'playwright';

const RANKINGS_URL  = 'https://openrouter.ai/rankings?view=week';
const CAPTURE_URL   = process.env.OPENROUTER_CAPTURE_URL || '';
const CAPTURE_TOKEN = process.env.CAPTURE_TOKEN || '';
const DRY_RUN       = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function log(...a) { console.error('[capture-openrouter]', ...a); }

/** Model-level "Top Models" series: {"data":[{x,ys}]} keyed by provider/model slugs. */
function isModelSeries(body) {
  if (!body || body.indexOf('"data":[') < 0) return false;
  if (body.indexOf('"x":"') < 0 || body.indexOf('"ys":') < 0) return false;
  return /"[a-z][a-z0-9-]*\/[A-Za-z0-9][\w.:-]*":\s*\d/.test(body);
}

/** Provider-level "Market Share" series: a bare [{x,ys}] keyed by provider names. */
function isProviderSeries(body) {
  if (!body || body.indexOf('[{"x":"') < 0) return false;
  if (body.indexOf('"ys":') < 0 || body.indexOf('"data":[') >= 0) return false;
  return /"(google|openai|anthropic|deepseek|qwen|tencent|moonshotai|meta-llama|mistralai|x-ai|openrouter)":\s*\d/.test(body);
}

async function captureOnce() {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const modelHits = [], providerHits = [];
    page.on('response', async (resp) => {
      try {
        const rt = resp.request().resourceType();
        if (rt !== 'fetch' && rt !== 'xhr' && rt !== 'document') return;
        if (resp.status() !== 200) return;
        const body = await resp.text();
        if (isModelSeries(body)) modelHits.push({ url: resp.url(), body });
        else if (isProviderSeries(body)) providerHits.push({ url: resp.url(), body });
      } catch (_) { /* body not retrievable — skip */ }
    });
    await page.goto(RANKINGS_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Both chart fetches fire after hydration — wait up to ~20s for both.
    for (let i = 0; i < 20 && (modelHits.length === 0 || providerHits.length === 0); i++) {
      await page.waitForTimeout(1000);
    }
    if (modelHits.length === 0) throw new Error('no model-level chart response observed');
    modelHits.sort((a, b) => b.body.length - a.body.length);
    providerHits.sort((a, b) => b.body.length - a.body.length);
    return { model: modelHits[0], provider: providerHits[0] || null };
  } finally {
    await browser.close();
  }
}

async function postCapture(body, label) {
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
      log(`POST ${label} attempt ${attempt}: HTTP ${resp.status}`, JSON.stringify(json));
      if (resp.ok && json.success === true) return true;
    } catch (e) {
      log(`POST ${label} attempt ${attempt} failed: ${e.message}`);
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 10000));
  }
  return false;
}

async function main() {
  if (!DRY_RUN && !CAPTURE_URL) { log('ERROR: OPENROUTER_CAPTURE_URL is not set'); process.exit(2); }

  let cap = null, lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log(`capture attempt ${attempt}/3 …`);
      cap = await captureOnce();
      break;
    } catch (e) {
      lastErr = e;
      log(`attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 10000));
    }
  }
  if (!cap) { log('FAILED — could not capture the weekly series: ' + (lastErr && lastErr.message)); process.exit(1); }

  const modelWeeks = (cap.model.body.match(/"x":"/g) || []).length;
  log(`models:    ${cap.model.body.length} bytes (~${modelWeeks} week rows) from ${cap.model.url}`);
  if (cap.provider) {
    const provWeeks = (cap.provider.body.match(/"x":"/g) || []).length;
    log(`providers: ${cap.provider.body.length} bytes (~${provWeeks} week rows) from ${cap.provider.url}`);
  } else {
    log('providers: NOT captured this run');
  }

  if (DRY_RUN) {
    log('DRY RUN — not posting. Model preview:');
    console.log(cap.model.body.slice(0, 400));
    if (cap.provider) { log('Provider preview:'); console.log(cap.provider.body.slice(0, 400)); }
    log('OK (dry run)');
    return;
  }

  let ok = await postCapture(cap.model.body, 'models');
  if (cap.provider) {
    ok = (await postCapture(cap.provider.body, 'providers')) && ok;
  } else {
    log('FAILED — provider-level series was not captured');
    ok = false;
  }
  if (!ok) { log('FAILED — one or more captures did not persist'); process.exit(1); }
  log('OK — Top Models and Market Share series captured and persisted');
}

main().catch(e => { log('FATAL: ' + (e && e.message)); process.exit(1); });
