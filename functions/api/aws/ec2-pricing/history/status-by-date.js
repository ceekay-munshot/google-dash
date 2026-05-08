// GET /api/aws/ec2-pricing/history/status-by-date?date=YYYY-MM-DD&source=<source>
//
// Idempotency-resume helper for the historical backfill workflow.
// Returns whether a capture already exists for the given (date, source)
// so the runner can skip it without parsing the 295MB CSV.

import { jsonResp, corsPreflight } from '../_d1-chunk.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ request, env }) {
  if (!env?.EC2_PRICING_DB) {
    return jsonResp({ success: false, error: 'd1_binding_missing' }, 500);
  }
  const url = new URL(request.url);
  const date   = url.searchParams.get('date');
  const source = url.searchParams.get('source');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResp({ success: false, error: 'invalid_date', detail: 'date must be YYYY-MM-DD' }, 400);
  }
  if (!source) {
    return jsonResp({ success: false, error: 'missing_source' }, 400);
  }

  const row = await env.EC2_PRICING_DB.prepare(
    `SELECT id, row_count, status FROM aws_ec2_pricing_capture_runs
     WHERE captured_date_et = ? AND source = ? LIMIT 1`,
  ).bind(date, source).first();

  return jsonResp({
    success: true,
    exists: !!row && row.status === 'success',
    in_progress: !!row && row.status === 'in_progress',
    run_id: row?.id ?? null,
    row_count: row?.row_count ?? null,
    status: row?.status ?? null,
  }, 200, { 'Cache-Control': 'public, max-age=15' });
}
