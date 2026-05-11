// POST /api/aws/ec2-pricing/history/capture?phase=begin|rows|finalize
//
// Multi-phase capture so the GH Actions runner can stream ~1,300 rows
// across multiple Worker invocations, never approaching D1's per-query
// or per-invocation limits regardless of plan tier.
//
//   phase=begin    body: { source, source_url, source_publication_date,
//                          source_version_id, region_code, region_label,
//                          operating_system, tenancy, license_model,
//                          snapshot_date_override?, captured_time_et_override?,
//                          expected_row_count }
//                  query: ?force=true (optional)
//                  → { run_id, captured_date_et, action }
//
//   phase=rows     query: ?run_id=<uuid>
//                  body:  { rows: [≤500 rows per chunk] }
//                  → { inserted_in_chunk, inserted_so_far }
//
//   phase=finalize query: ?run_id=<uuid>
//                  body:  {}
//                  → { success, run_id, row_count, changed_vs_prior_capture }
//
// Auth: AWS EC2 pricing capture uses AWS_EC2_PRICING_CAPTURE_SECRET.
// HISTORY_CAPTURE_SECRET is accepted as a backward-compat fallback so the
// historical-backfill workflow (which still presents the legacy secret)
// keeps working. When both env vars are bound, either value is accepted.
// STRICT on prod/preview hostnames — if neither secret is bound, a non-
// localhost host returns HTTP 500 capture_misconfigured.

import { classifyInstance } from '../_family.js';
import { nowInEasternTime, isInsideCaptureWindow } from '../_et.js';
import { COLS, insertPricingRowsChunked, rowHashSummary, jsonResp, corsPreflight } from '../_d1-chunk.js';

const VALID_SOURCES = new Set(['aws_bulk_pricelist_current', 'aws_bulk_pricelist_historical']);

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestPost({ request, env }) {
  const url   = new URL(request.url);
  const phase = url.searchParams.get('phase');
  const force = url.searchParams.get('force') === 'true';

  // Hostname classification: localhost may operate without a secret;
  // prod/preview MUST be authenticated.
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);

  // Auth gate. Accept EITHER the dedicated AWS EC2 pricing secret or the
  // legacy generic capture secret. Both may be bound concurrently with
  // different values during migration — e.g., the daily-capture workflow
  // rotates onto AWS_EC2_PRICING_CAPTURE_SECRET while the historical
  // backfill workflow still presents HISTORY_CAPTURE_SECRET. Once every
  // caller is on the dedicated secret, the legacy fallback can be dropped.
  const acceptedSecrets = [
    env?.AWS_EC2_PRICING_CAPTURE_SECRET,
    env?.HISTORY_CAPTURE_SECRET,
  ].filter(Boolean);
  if (!isLocal && acceptedSecrets.length === 0) {
    return jsonResp({
      success: false, error: 'capture_misconfigured',
      detail: 'Neither AWS_EC2_PRICING_CAPTURE_SECRET nor HISTORY_CAPTURE_SECRET is set on this environment. Production and preview deploys must require auth; refusing to capture.',
    }, 500);
  }
  if (acceptedSecrets.length > 0) {
    const auth = request.headers.get('authorization') || '';
    const bearer = auth.replace(/^Bearer\s+/i, '').trim();
    const headerSecret = request.headers.get('x-history-capture-secret') || '';
    const querySecret  = url.searchParams.get('key') || '';
    const provided = bearer || headerSecret || querySecret;
    if (!acceptedSecrets.includes(provided)) {
      return jsonResp({ success: false, error: 'unauthorized' }, 403);
    }
  }

  if (!env?.EC2_PRICING_DB) {
    return jsonResp({
      success: false, error: 'd1_binding_missing',
      detail: 'env.EC2_PRICING_DB is not bound. Add a [[d1_databases]] block to wrangler.toml with binding="EC2_PRICING_DB".',
    }, 500);
  }
  const db = env.EC2_PRICING_DB;

  let body;
  try { body = await request.json(); }
  catch { return jsonResp({ success: false, error: 'invalid_json' }, 400); }

  if (phase === 'begin')    return phaseBegin({ url, db, body, force });
  if (phase === 'rows')     return phaseRows({ url, db, body });
  if (phase === 'finalize') return phaseFinalize({ url, db });
  return jsonResp({ success: false, error: 'invalid_phase', detail: 'phase must be begin | rows | finalize' }, 400);
}

async function phaseBegin({ url, db, body, force }) {
  const t0 = Date.now();

  if (!body || !VALID_SOURCES.has(body.source)) {
    return jsonResp({ success: false, error: 'invalid_source', detail: 'source must be one of: ' + [...VALID_SOURCES].join(', ') }, 400);
  }

  // Compute captured_date_et / captured_time_et.
  const isHistorical = body.source === 'aws_bulk_pricelist_historical';
  const hasOverride  = !!body.snapshot_date_override;
  let captured_date_et, captured_time_et;

  if (hasOverride) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.snapshot_date_override)) {
      return jsonResp({ success: false, error: 'invalid_override', detail: 'snapshot_date_override must be YYYY-MM-DD' }, 400);
    }
    captured_date_et = body.snapshot_date_override;
    captured_time_et = body.captured_time_et_override || '00:00:00';
  } else {
    const et = nowInEasternTime();
    captured_date_et = et.date;
    captured_time_et = et.time;
    // ET-window validation (skipped on force=true, on overrides, and for historical source).
    if (!force && !isHistorical && !isInsideCaptureWindow(et)) {
      return jsonResp({
        success: true,
        action:  'skipped_outside_capture_window',
        reason:  `time=${et.time} weekday=${et.weekday} not in 10:00-12:00 America/New_York`,
      });
    }
  }

  // Idempotency check against (captured_date_et, source).
  const prior = await db.prepare(
    `SELECT id, row_count, status FROM aws_ec2_pricing_capture_runs
     WHERE captured_date_et = ? AND source = ? LIMIT 1`,
  ).bind(captured_date_et, body.source).first();

  if (prior && prior.status === 'success' && !force) {
    return jsonResp({
      success: true,
      action: 'skipped_already_captured',
      run_id: prior.id,
      row_count: prior.row_count,
      captured_date_et,
      source: body.source,
    });
  }

  if (prior && force) {
    // Cascade-deletes rows via FK ON DELETE CASCADE.
    await db.prepare(`DELETE FROM aws_ec2_pricing_capture_runs WHERE id = ?`).bind(prior.id).run();
  }

  const run_id = crypto.randomUUID();
  const captured_at_utc = new Date().toISOString();

  await db.prepare(
    `INSERT INTO aws_ec2_pricing_capture_runs
     (id, captured_at_utc, captured_date_et, captured_time_et, source, source_url,
      source_publication_date, source_version_id, region_code, region_label,
      operating_system, tenancy, license_model, row_count, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,'in_progress')`,
  ).bind(
    run_id, captured_at_utc, captured_date_et, captured_time_et, body.source,
    body.source_url || null, body.source_publication_date || null, body.source_version_id || null,
    body.region_code || 'us-east-1', body.region_label || 'US East (N. Virginia)',
    body.operating_system || 'Linux', body.tenancy || 'Shared',
    body.license_model || 'No License required',
  ).run();

  return jsonResp({
    success: true,
    action: prior && force ? 'replaced_via_force' : 'created',
    run_id,
    captured_date_et,
    captured_time_et,
    captured_at_utc,
    source: body.source,
    duration_ms: Date.now() - t0,
  });
}

async function phaseRows({ url, db, body }) {
  const t0 = Date.now();
  const run_id = url.searchParams.get('run_id');
  if (!run_id) return jsonResp({ success: false, error: 'missing_run_id' }, 400);
  if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
    return jsonResp({ success: false, error: 'invalid_rows', detail: 'body.rows must be a non-empty array' }, 400);
  }
  if (body.rows.length > 500) {
    return jsonResp({ success: false, error: 'chunk_too_large', detail: 'rows chunk size must be ≤500' }, 400);
  }

  const run = await db.prepare(
    `SELECT id, captured_at_utc, captured_date_et, status FROM aws_ec2_pricing_capture_runs WHERE id = ? LIMIT 1`,
  ).bind(run_id).first();
  if (!run) return jsonResp({ success: false, error: 'run_not_found' }, 404);
  if (run.status !== 'in_progress') {
    return jsonResp({ success: false, error: 'run_not_in_progress', detail: `run is in status '${run.status}'` }, 409);
  }

  // Materialize rows with denormalized fields and family classification.
  const materialized = body.rows.map(r => {
    const klass = classifyInstance(r.instance_type);
    return {
      run_id,
      captured_at_utc:        run.captured_at_utc,
      captured_date_et:       run.captured_date_et,
      instance_type:          r.instance_type,
      instance_family:        klass.instance_family,
      instance_size:          klass.instance_size,
      product_family:         r.product_family || (klass.bare_metal ? 'Compute Instance (bare metal)' : 'Compute Instance'),
      bare_metal:             r.bare_metal != null ? Number(r.bare_metal) : klass.bare_metal,
      family_class:           klass.family_class,
      price_per_hour_usd:     Number(r.price_per_hour_usd),
      vcpu:                   r.vcpu != null ? Number(r.vcpu) : null,
      memory_gib:             parseMemoryGib(r.memory_label || r.memory),
      memory_label:           r.memory_label || r.memory || null,
      storage:                r.storage || null,
      network_performance:    r.network_performance || null,
      processor_architecture: r.processor_architecture || null,
      current_generation:     r.current_generation || null,
      row_hash:               `${r.instance_type}:${r.price_per_hour_usd}`,
    };
  });

  const inserted_in_chunk = await insertPricingRowsChunked(db, materialized);
  const totalSoFar = await db.prepare(
    `SELECT COUNT(*) AS c FROM aws_ec2_pricing_rows WHERE run_id = ?`,
  ).bind(run_id).first();

  return jsonResp({
    success: true,
    action: 'rows_inserted',
    run_id,
    inserted_in_chunk,
    inserted_so_far: totalSoFar?.c ?? inserted_in_chunk,
    duration_ms: Date.now() - t0,
  });
}

async function phaseFinalize({ url, db }) {
  const t0 = Date.now();
  const run_id = url.searchParams.get('run_id');
  if (!run_id) return jsonResp({ success: false, error: 'missing_run_id' }, 400);

  const run = await db.prepare(
    `SELECT id, source, captured_date_et, captured_at_utc, source_version_id, status
     FROM aws_ec2_pricing_capture_runs WHERE id = ? LIMIT 1`,
  ).bind(run_id).first();
  if (!run) return jsonResp({ success: false, error: 'run_not_found' }, 404);
  if (run.status !== 'in_progress') {
    return jsonResp({ success: false, error: 'run_not_in_progress', detail: `run is in status '${run.status}'` }, 409);
  }

  const allRows = await db.prepare(
    `SELECT instance_type, price_per_hour_usd FROM aws_ec2_pricing_rows WHERE run_id = ? ORDER BY instance_type ASC`,
  ).bind(run_id).all();
  const rows = allRows.results || [];

  if (rows.length === 0) {
    await db.prepare(`UPDATE aws_ec2_pricing_capture_runs SET status='failed', error='no_rows_inserted' WHERE id = ?`).bind(run_id).run();
    return jsonResp({ success: false, error: 'no_rows_inserted' }, 400);
  }

  const hash = await rowHashSummary(rows);

  // Compare against the most recent prior successful capture in the
  // same source stream (any earlier date — captures of unchanged
  // pricing are still valid daily data points).
  const prior = await db.prepare(
    `SELECT row_hash_summary FROM aws_ec2_pricing_capture_runs
     WHERE source = ? AND captured_date_et < ? AND status = 'success'
     ORDER BY captured_date_et DESC LIMIT 1`,
  ).bind(run.source, run.captured_date_et).first();
  const changed_vs_prior_capture = prior == null ? null : (prior.row_hash_summary === hash ? 0 : 1);

  await db.prepare(
    `UPDATE aws_ec2_pricing_capture_runs
     SET row_count = ?, row_hash_summary = ?, changed_vs_prior_capture = ?, status = 'success', error = NULL
     WHERE id = ?`,
  ).bind(rows.length, hash, changed_vs_prior_capture, run_id).run();

  return jsonResp({
    success: true,
    action: 'finalized',
    run_id,
    captured_date_et: run.captured_date_et,
    captured_at_utc: run.captured_at_utc,
    source: run.source,
    source_version_id: run.source_version_id,
    row_count: rows.length,
    row_hash_summary: hash,
    changed_vs_prior_capture,
    duration_ms: Date.now() - t0,
  });
}

// Parse "0.5 GiB" / "4 GiB" / "768 GiB" → numeric GiB. Returns null if
// unparseable. AWS is consistent enough that this trivial parse covers
// every row we've seen.
function parseMemoryGib(label) {
  if (!label) return null;
  const m = String(label).match(/^([\d.]+)\s*(GiB|MiB|TiB)?\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || 'GiB').toLowerCase();
  if (unit === 'mib') return n / 1024;
  if (unit === 'tib') return n * 1024;
  return n;
}
