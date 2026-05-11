// GET /api/aws/ec2-pricing/spot/status
//
// Honest seeded/unseeded state for the Spot Pricing subtab. Returns a
// clean unseeded payload when the spot tables haven't been migrated
// yet (the first production deploy will hit this path until the user
// runs `wrangler d1 migrations apply EC2_PRICING_DB --remote`).

import { jsonResp, corsPreflight, spotTablesReady } from './_spot-shared.js';

const SOURCE_LABEL = 'AWS EC2 DescribeSpotPriceHistory · rolling 90-day source window';

function unseeded(reason) {
  return jsonResp({
    success: true,
    status: 'unseeded',
    reason,
    source: SOURCE_LABEL,
    rolling_source_window_days: 90,
    total_capture_runs: 0,
    successful_capture_runs: 0,
    total_rows: 0,
    distinct_instance_types: 0,
    distinct_availability_zones: 0,
    earliest_observed_timestamp_utc: null,
    latest_observed_timestamp_utc:   null,
    latest_run: null,
    is_seeded: false,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ env }) {
  if (!env?.EC2_PRICING_DB) return unseeded('d1_binding_missing');
  const db = env.EC2_PRICING_DB;

  if (!(await spotTablesReady(db))) {
    return unseeded('spot_tables_not_migrated');
  }

  const aggSql = `
    SELECT
      (SELECT COUNT(*) FROM aws_ec2_spot_price_capture_runs) AS total_capture_runs,
      (SELECT COUNT(*) FROM aws_ec2_spot_price_capture_runs WHERE status='success') AS successful_capture_runs,
      (SELECT COUNT(*) FROM aws_ec2_spot_price_rows) AS total_rows,
      (SELECT COUNT(DISTINCT instance_type) FROM aws_ec2_spot_price_rows) AS distinct_instance_types,
      (SELECT COUNT(DISTINCT availability_zone) FROM aws_ec2_spot_price_rows WHERE availability_zone IS NOT NULL) AS distinct_availability_zones,
      (SELECT MIN(observed_timestamp_utc) FROM aws_ec2_spot_price_rows) AS earliest_observed_timestamp_utc,
      (SELECT MAX(observed_timestamp_utc) FROM aws_ec2_spot_price_rows) AS latest_observed_timestamp_utc
  `;
  const latestSql = `
    SELECT id, captured_at_utc, source_window_start_utc, source_window_end_utc,
           region_code, product_description, instance_scope, row_count, status, source
    FROM aws_ec2_spot_price_capture_runs
    WHERE status='success'
    ORDER BY captured_at_utc DESC
    LIMIT 1
  `;

  const [aggRes, latestRes] = await db.batch([db.prepare(aggSql), db.prepare(latestSql)]);
  const agg    = aggRes?.results?.[0]    || {};
  const latest = latestRes?.results?.[0] || null;

  const total      = agg.total_capture_runs || 0;
  const successful = agg.successful_capture_runs || 0;
  const rowsTotal  = agg.total_rows || 0;

  return jsonResp({
    success: true,
    status: rowsTotal > 0 ? 'healthy' : 'unseeded',
    source: SOURCE_LABEL,
    rolling_source_window_days: 90,
    total_capture_runs:           total,
    successful_capture_runs:      successful,
    total_rows:                   rowsTotal,
    distinct_instance_types:      agg.distinct_instance_types || 0,
    distinct_availability_zones:  agg.distinct_availability_zones || 0,
    earliest_observed_timestamp_utc: agg.earliest_observed_timestamp_utc || null,
    latest_observed_timestamp_utc:   agg.latest_observed_timestamp_utc   || null,
    latest_run: latest ? {
      id:                       latest.id,
      captured_at_utc:          latest.captured_at_utc,
      source_window_start_utc:  latest.source_window_start_utc,
      source_window_end_utc:    latest.source_window_end_utc,
      region_code:              latest.region_code,
      product_description:      latest.product_description,
      instance_scope:           latest.instance_scope,
      row_count:                latest.row_count,
      status:                   latest.status,
      source:                   latest.source,
    } : null,
    is_seeded: rowsTotal > 0,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
