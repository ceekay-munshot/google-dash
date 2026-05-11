// POST /api/aws/ec2-pricing/spot/capture
//
// Receives EC2 Spot Price History rows fetched by an external runner
// (scripts/fetch-aws-ec2-spot-history.mjs) and writes them to D1.
// Idempotent via the (observed_timestamp_utc, region_code,
// availability_zone, instance_type, product_description, spot_price_usd)
// unique index — re-sending an overlapping window is safe and never
// duplicates rows.
//
// Auth: AWS EC2 spot capture accepts either:
//   - env.AWS_EC2_SPOT_CAPTURE_SECRET  (dedicated to spot — preferred)
//   - env.AWS_EC2_PRICING_CAPTURE_SECRET (shared with on-demand daily capture)
// HISTORY_CAPTURE_SECRET (the legacy generic capture secret used by
// non-Amazon workflows) is deliberately NOT accepted here — spot must
// stay isolated from unrelated dashboard flows.
//
// Request body (single phase — basket is small enough not to need
// multi-phase chunking, unlike the 1,300-row on-demand capture):
//   {
//     region:                  "us-east-1",
//     product_description:     "Linux/UNIX",
//     start_time:              ISO 8601,
//     end_time:                ISO 8601,
//     instance_scope:          "v1_institutional_basket" | "custom_basket",
//     requested_instance_types:["m7i.large", ...],
//     rows: [{
//       observed_timestamp_utc, region_code, availability_zone,
//       instance_type, instance_family, instance_size, family_class,
//       product_description, spot_price_usd, row_hash,
//     }, ...],
//     dry_run: false,
//   }
//
//   dry_run=true → validate payload, return summary, no D1 write.

import { jsonResp, corsPreflight, spotTablesReady, insertSpotRowsChunked, extractProvidedSecret } from './_spot-shared.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestPost({ request, env }) {
  const url   = new URL(request.url);
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);

  // Auth gate. Accept either of two EC2-scoped secrets; deliberately
  // NOT accepting HISTORY_CAPTURE_SECRET.
  const acceptedSecrets = [
    env?.AWS_EC2_SPOT_CAPTURE_SECRET,
    env?.AWS_EC2_PRICING_CAPTURE_SECRET,
  ].filter(Boolean);
  if (!isLocal && acceptedSecrets.length === 0) {
    return jsonResp({
      success: false, error: 'capture_misconfigured',
      detail: 'Neither AWS_EC2_SPOT_CAPTURE_SECRET nor AWS_EC2_PRICING_CAPTURE_SECRET is set on this environment. Production and preview deploys must require auth; refusing to capture.',
    }, 500);
  }
  if (acceptedSecrets.length > 0) {
    const provided = extractProvidedSecret(request, url);
    if (!acceptedSecrets.includes(provided)) {
      return jsonResp({ success: false, error: 'unauthorized' }, 403);
    }
  }

  if (!env?.EC2_PRICING_DB) {
    return jsonResp({ success: false, error: 'd1_binding_missing' }, 500);
  }
  const db = env.EC2_PRICING_DB;

  if (!(await spotTablesReady(db))) {
    return jsonResp({
      success: false, error: 'schema_not_migrated',
      detail: 'Spot tables not present on this D1. Run: wrangler d1 migrations apply EC2_PRICING_DB --remote',
    }, 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResp({ success: false, error: 'invalid_json' }, 400); }

  const dryRun = body?.dry_run === true;
  const region              = body?.region || '';
  const productDescription  = body?.product_description || '';
  const startTime           = body?.start_time || '';
  const endTime             = body?.end_time   || '';
  const instanceScope       = body?.instance_scope || null;
  const rows                = Array.isArray(body?.rows) ? body.rows : [];

  // Required-fields validation.
  if (!region) return jsonResp({ success: false, error: 'missing_region' }, 400);
  if (!productDescription) return jsonResp({ success: false, error: 'missing_product_description' }, 400);
  if (!startTime || Number.isNaN(new Date(startTime).getTime())) {
    return jsonResp({ success: false, error: 'invalid_start_time', detail: 'start_time must be ISO 8601' }, 400);
  }
  if (!endTime || Number.isNaN(new Date(endTime).getTime())) {
    return jsonResp({ success: false, error: 'invalid_end_time', detail: 'end_time must be ISO 8601' }, 400);
  }

  // Per-row shape validation. We require the canonical 10 fields the
  // runner is supposed to emit. spot_price_usd must be a positive number.
  const REQUIRED = ['observed_timestamp_utc','region_code','instance_type','product_description','spot_price_usd'];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (const k of REQUIRED) {
      if (r?.[k] === undefined || r?.[k] === null || r?.[k] === '') {
        return jsonResp({ success: false, error: 'invalid_row', detail: `row[${i}] missing ${k}` }, 400);
      }
    }
    if (!(Number.isFinite(r.spot_price_usd) && r.spot_price_usd >= 0)) {
      return jsonResp({ success: false, error: 'invalid_row', detail: `row[${i}].spot_price_usd must be a non-negative number` }, 400);
    }
  }

  const uniqueInstanceTypes = new Set(rows.map(r => r.instance_type));
  const uniqueAzs = new Set(rows.map(r => r.availability_zone).filter(Boolean));

  if (dryRun) {
    return jsonResp({
      success: true,
      dry_run: true,
      action: 'validated',
      received_row_count:           rows.length,
      distinct_instance_types:      uniqueInstanceTypes.size,
      distinct_availability_zones:  uniqueAzs.size,
      sample_rows:                  rows.slice(0, 3),
      window:                       { start: startTime, end: endTime },
    });
  }

  // Persist: capture run + rows.
  const run_id = crypto.randomUUID();
  const capturedAtUtc = new Date().toISOString();

  await db.prepare(
    `INSERT INTO aws_ec2_spot_price_capture_runs
       (id, captured_at_utc, source_window_start_utc, source_window_end_utc,
        region_code, product_description, instance_scope, row_count, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'in_progress', 'aws_describe_spot_price_history')`,
  ).bind(
    run_id, capturedAtUtc, startTime, endTime,
    region, productDescription, instanceScope,
  ).run();

  const rowsWithRunId = rows.map(r => ({ ...r, run_id }));
  const attempted = await insertSpotRowsChunked(db, rowsWithRunId);

  // INSERT OR IGNORE means actual inserted count may be < attempted. We
  // read it back so the final row_count is honest.
  const inserted = (await db.prepare(
    `SELECT COUNT(*) AS c FROM aws_ec2_spot_price_rows WHERE run_id = ?`,
  ).bind(run_id).first())?.c ?? 0;

  await db.prepare(
    `UPDATE aws_ec2_spot_price_capture_runs SET row_count = ?, status = 'success' WHERE id = ?`,
  ).bind(inserted, run_id).run();

  return jsonResp({
    success: true,
    action: 'captured',
    run_id,
    captured_at_utc:          capturedAtUtc,
    region_code:              region,
    product_description:      productDescription,
    instance_scope:           instanceScope,
    window:                   { start: startTime, end: endTime },
    received_row_count:       rows.length,
    inserted_row_count:       inserted,
    deduped_row_count:        attempted - inserted,
    distinct_instance_types:  uniqueInstanceTypes.size,
    distinct_availability_zones: uniqueAzs.size,
  });
}
