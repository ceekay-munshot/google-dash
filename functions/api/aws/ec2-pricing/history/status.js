// GET /api/aws/ec2-pricing/history/status

import { LATEST_RUN_ORDER, jsonResp, corsPreflight } from '../_d1-chunk.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ env }) {
  if (!env?.EC2_PRICING_DB) {
    return jsonResp({
      success: true,
      status: 'd1_unbound',
      source: 'AWS Price List Bulk API (versionIndexUrl + currentRegionIndexUrl)',
      total_capture_runs: 0,
      distinct_capture_days: 0,
      daily_capture_runs: 0,
      historical_capture_runs: 0,
      is_seeded: false,
      is_seeded_daily: false,
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }
  const db = env.EC2_PRICING_DB;

  const aggSql = `
    SELECT
      COUNT(*) AS total_capture_runs,
      COUNT(DISTINCT captured_date_et) AS distinct_capture_days,
      MIN(captured_date_et) AS first_capture_date_et,
      MAX(captured_date_et) AS latest_capture_date_et,
      SUM(CASE WHEN source = 'aws_bulk_pricelist_current'    THEN 1 ELSE 0 END) AS daily_capture_runs,
      SUM(CASE WHEN source = 'aws_bulk_pricelist_historical' THEN 1 ELSE 0 END) AS historical_capture_runs,
      (SELECT MIN(captured_date_et) FROM aws_ec2_pricing_capture_runs WHERE source = 'aws_bulk_pricelist_current'    AND status = 'success') AS first_daily_capture_date_et,
      (SELECT MAX(captured_date_et) FROM aws_ec2_pricing_capture_runs WHERE source = 'aws_bulk_pricelist_current'    AND status = 'success') AS latest_daily_capture_date_et,
      (SELECT MIN(captured_date_et) FROM aws_ec2_pricing_capture_runs WHERE source = 'aws_bulk_pricelist_historical' AND status = 'success') AS first_historical_capture_date_et,
      (SELECT MAX(captured_date_et) FROM aws_ec2_pricing_capture_runs WHERE source = 'aws_bulk_pricelist_historical' AND status = 'success') AS latest_historical_capture_date_et
    FROM aws_ec2_pricing_capture_runs
    WHERE status = 'success'
  `;
  const latestSql = `
    SELECT id, captured_date_et, captured_at_utc, captured_time_et, source,
           source_version_id, row_count
    FROM aws_ec2_pricing_capture_runs
    WHERE status = 'success'
    ${LATEST_RUN_ORDER}
  `;

  const [aggRes, latestRes] = await db.batch([
    db.prepare(aggSql),
    db.prepare(latestSql),
  ]);
  const agg    = aggRes?.results?.[0]    || {};
  const latest = latestRes?.results?.[0] || null;

  const total = agg.total_capture_runs || 0;
  const daily = agg.daily_capture_runs || 0;

  return jsonResp({
    success: true,
    status: total > 0 ? 'healthy' : 'unseeded',
    source: 'AWS Price List Bulk API (versionIndexUrl + currentRegionIndexUrl)',
    total_capture_runs:               total,
    distinct_capture_days:            agg.distinct_capture_days || 0,
    daily_capture_runs:               daily,
    historical_capture_runs:          agg.historical_capture_runs || 0,
    first_capture_date_et:            agg.first_capture_date_et || null,
    latest_capture_date_et:           agg.latest_capture_date_et || null,
    first_daily_capture_date_et:      agg.first_daily_capture_date_et || null,
    latest_daily_capture_date_et:     agg.latest_daily_capture_date_et || null,
    first_historical_capture_date_et: agg.first_historical_capture_date_et || null,
    latest_historical_capture_date_et:agg.latest_historical_capture_date_et || null,
    latest_run: latest ? {
      id:                latest.id,
      captured_date_et:  latest.captured_date_et,
      captured_at_utc:   latest.captured_at_utc,
      captured_time_et:  latest.captured_time_et,
      source:            latest.source,
      source_version_id: latest.source_version_id,
      row_count:         latest.row_count,
    } : null,
    is_seeded:       total > 0,
    is_seeded_daily: daily > 0,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
