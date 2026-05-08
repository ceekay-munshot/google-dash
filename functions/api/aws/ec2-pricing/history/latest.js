// GET /api/aws/ec2-pricing/history/latest
//
// Returns the latest captured snapshot's per-instance rows. Same query
// shape as /api/aws/ec2-pricing/on-demand so the dashboard's Latest
// Table sub-tab can swap fetch URLs cleanly.

import { LATEST_RUN_ORDER, jsonResp, corsPreflight } from '../_d1-chunk.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ request, env }) {
  if (!env?.EC2_PRICING_DB) {
    return jsonResp({ success: false, error: 'd1_binding_missing' }, 500);
  }
  const url = new URL(request.url);
  const q       = (url.searchParams.get('q') || '').trim().toLowerCase();
  const limit   = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 1500);
  const offset  = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
  const sort    = url.searchParams.get('sort') || 'price';

  const run = await env.EC2_PRICING_DB.prepare(
    `SELECT id, captured_date_et, captured_at_utc, captured_time_et, source,
            source_version_id, row_count
     FROM aws_ec2_pricing_capture_runs WHERE status = 'success' ${LATEST_RUN_ORDER}`,
  ).first();

  if (!run) {
    return jsonResp({
      success: true,
      is_seeded: false,
      hint: 'No captures yet. Latest Table is using the static snapshot fallback.',
      rows: [],
      matched_rows: 0,
      total_rows: 0,
      offset, limit,
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  const orderClause =
    sort === 'type' ? `ORDER BY instance_type ASC` :
                      `ORDER BY price_per_hour_usd ASC`;

  const totalAgg = await env.EC2_PRICING_DB.prepare(
    `SELECT COUNT(*) AS c FROM aws_ec2_pricing_rows WHERE run_id = ?
     ${q ? 'AND lower(instance_type) LIKE ?' : ''}`,
  ).bind(...(q ? [run.id, `%${q}%`] : [run.id])).first();

  const rowsRes = await env.EC2_PRICING_DB.prepare(
    `SELECT instance_type, instance_family, instance_size, family_class,
            product_family, bare_metal, price_per_hour_usd, vcpu, memory_label,
            storage, network_performance, processor_architecture, current_generation
     FROM aws_ec2_pricing_rows WHERE run_id = ?
     ${q ? 'AND lower(instance_type) LIKE ?' : ''}
     ${orderClause}
     LIMIT ? OFFSET ?`,
  ).bind(...(q ? [run.id, `%${q}%`, limit, offset] : [run.id, limit, offset])).all();

  return jsonResp({
    success: true,
    is_seeded: true,
    captured_date_et:  run.captured_date_et,
    captured_at_utc:   run.captured_at_utc,
    captured_time_et:  run.captured_time_et,
    source:            run.source,
    source_version_id: run.source_version_id,
    matched_rows:      totalAgg?.c || 0,
    total_rows:        run.row_count,
    offset, limit,
    rows: rowsRes.results || [],
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
