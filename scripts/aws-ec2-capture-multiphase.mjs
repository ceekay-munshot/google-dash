#!/usr/bin/env node
// Orchestrates the begin/rows/finalize capture flow from a GH Actions
// runner. Splits ~1,300 rows into 500-row chunks (3 HTTP calls), each
// landing in its own Worker invocation so D1 limits never come into
// play.
//
// Required env:
//   DASHBOARD_URL — base URL (e.g. https://google-dash-git.pages.dev)
//   SECRET        — HISTORY_CAPTURE_SECRET bearer token
//   PAYLOAD       — path to JSON file produced by fetch-aws-ec2-pricing.mjs --stdout
//   FORCE         — 'true' to force re-capture, anything else = idempotent

import fs from 'node:fs';

const DASHBOARD_URL = process.env.DASHBOARD_URL;
const SECRET        = process.env.SECRET || '';
const PAYLOAD_FILE  = process.env.PAYLOAD;
const FORCE         = process.env.FORCE === 'true';

if (!DASHBOARD_URL) { console.error('DASHBOARD_URL env var required'); process.exit(2); }
if (!PAYLOAD_FILE)  { console.error('PAYLOAD env var required');       process.exit(2); }

const payload = JSON.parse(fs.readFileSync(PAYLOAD_FILE, 'utf8'));
const baseUrl = new URL('/api/aws/ec2-pricing/history/capture', DASHBOARD_URL);
const ROWS_PER_CHUNK = 500;

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (SECRET) h['Authorization'] = 'Bearer ' + SECRET;
  return h;
}

async function postPhase(phase, query, body) {
  const u = new URL(baseUrl);
  u.searchParams.set('phase', phase);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    let resp, text;
    try {
      resp = await fetch(u.toString(), { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      text = await resp.text();
    } catch (e) {
      console.error(`[${phase}] attempt ${attempt} failed:`, e.message);
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, attempt * 15000));
      continue;
    }
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    console.error(`[${phase}] HTTP ${resp.status} (${Date.now() - t0}ms)`, JSON.stringify(json));
    if (resp.ok && json.success !== false) return json;
    if (attempt === 3) throw new Error(`[${phase}] failed after 3 attempts: HTTP ${resp.status}`);
    await new Promise(r => setTimeout(r, attempt * 15000));
  }
  throw new Error('unreachable');
}

async function main() {
  const beginBody = {
    source:                  payload.source,
    source_url:              payload.source_url,
    source_publication_date: payload.source_publication_date,
    source_version_id:       payload.source_version_id,
    region_code:             payload.region_code,
    region_label:            payload.region_label,
    operating_system:        payload.operating_system,
    tenancy:                 payload.tenancy,
    license_model:           payload.license_model,
    expected_row_count:      payload.rows.length,
  };
  if (process.env.SNAPSHOT_DATE_OVERRIDE) {
    beginBody.snapshot_date_override = process.env.SNAPSHOT_DATE_OVERRIDE;
  }
  if (process.env.CAPTURED_TIME_ET_OVERRIDE) {
    beginBody.captured_time_et_override = process.env.CAPTURED_TIME_ET_OVERRIDE;
  }

  const begin = await postPhase('begin', FORCE ? { force: 'true' } : {}, beginBody);

  if (begin.action === 'skipped_already_captured') {
    console.error('Run already exists for this date; idempotent success.');
    process.exit(0);
  }
  if (begin.action === 'skipped_outside_business_window') {
    console.error('Outside ET business window; capture skipped (this is normal for off-window cron slots).');
    process.exit(0);
  }
  if (!begin.run_id) {
    console.error('No run_id returned; aborting.');
    process.exit(1);
  }

  const run_id = begin.run_id;
  const total  = payload.rows.length;
  let inserted = 0;
  for (let i = 0; i < total; i += ROWS_PER_CHUNK) {
    const chunk = payload.rows.slice(i, i + ROWS_PER_CHUNK);
    const r = await postPhase('rows', { run_id }, { rows: chunk });
    inserted = r.inserted_so_far ?? (inserted + chunk.length);
    console.error(`Inserted ${inserted}/${total}`);
  }

  const fin = await postPhase('finalize', { run_id }, {});
  console.error('Finalized:', JSON.stringify({
    run_id, row_count: fin.row_count, changed_vs_prior_capture: fin.changed_vs_prior_capture,
  }));
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
