// GET /api/aws/ec2-pricing/spot/discounts
//
// Joins latest Spot observation per (instance_type, availability_zone)
// against the latest On-Demand price for the same instance_type. Returns
// per-row spot_discount_pct = (on_demand - spot) / on_demand * 100.
//
// On-Demand pricing is read-only here. We pick the latest captured run
// using the same source-priority order the on-demand /history endpoints
// use (current beats historical, then captured_at_utc desc).

import { jsonResp, corsPreflight, spotTablesReady } from './_spot-shared.js';
import { LATEST_RUN_ORDER } from '../_d1-chunk.js';

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ request, env }) {
  if (!env?.EC2_PRICING_DB) return jsonResp({ success: false, error: 'd1_binding_missing' }, 500);
  const url = new URL(request.url);
  const family = (url.searchParams.get('family') || 'all').toLowerCase();
  const limit  = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 1), 5000);

  const db = env.EC2_PRICING_DB;
  if (!(await spotTablesReady(db))) {
    return jsonResp({
      success: true, family,
      rows: [],
      hint: 'Spot tables not yet migrated; discounts cannot be computed.',
      latest_spot_window_end_utc: null,
      latest_on_demand_capture_date_et: null,
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // Latest on-demand run (canonical priority).
  const odRun = await db.prepare(
    `SELECT id, captured_date_et, captured_at_utc, source
     FROM aws_ec2_pricing_capture_runs
     WHERE status='success'
     ${LATEST_RUN_ORDER}`,
  ).first();

  if (!odRun) {
    return jsonResp({
      success: true, family, rows: [],
      hint: 'No on-demand capture available to compute spot discount against.',
      latest_spot_window_end_utc: null,
      latest_on_demand_capture_date_et: null,
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // Latest spot row per (instance_type, availability_zone).
  // SQLite doesn't have DISTINCT ON; we use the MAX(observed_timestamp)
  // per group join idiom. Family filter applied here for efficiency.
  const familyFilter = family === 'all' ? '' : 'AND s.family_class = ?';
  const spotSql = `
    SELECT s.instance_type, s.instance_family, s.family_class,
           s.availability_zone, s.spot_price_usd AS latest_spot_price,
           s.observed_timestamp_utc AS latest_spot_timestamp,
           s.product_description
    FROM aws_ec2_spot_price_rows s
    JOIN (
      SELECT instance_type, availability_zone, MAX(observed_timestamp_utc) AS max_ts
      FROM aws_ec2_spot_price_rows
      GROUP BY instance_type, availability_zone
    ) m
      ON m.instance_type = s.instance_type
     AND (m.availability_zone IS NULL AND s.availability_zone IS NULL OR m.availability_zone = s.availability_zone)
     AND m.max_ts = s.observed_timestamp_utc
    WHERE 1=1 ${familyFilter}
    ORDER BY s.instance_type ASC, s.availability_zone ASC
    LIMIT ?
  `;
  const spotStmt = family === 'all' ? db.prepare(spotSql).bind(limit) : db.prepare(spotSql).bind(family, limit);
  const spotRes = await spotStmt.all();
  const spotRows = spotRes?.results || [];

  if (spotRows.length === 0) {
    return jsonResp({
      success: true, family, rows: [],
      hint: 'No spot observations captured yet.',
      latest_spot_window_end_utc: null,
      latest_on_demand_capture_date_et: odRun.captured_date_et,
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // On-demand price lookup for the joined instance_types.
  const odTypes = [...new Set(spotRows.map(r => r.instance_type))];
  // D1 / SQLite: prepared statement param limit is 100. Bucket the IN
  // lookup so we never blow past it.
  const odByType = new Map();
  const BUCKET = 80;
  for (let i = 0; i < odTypes.length; i += BUCKET) {
    const slice = odTypes.slice(i, i + BUCKET);
    const placeholders = slice.map(() => '?').join(',');
    const sql = `SELECT instance_type, price_per_hour_usd FROM aws_ec2_pricing_rows
                 WHERE run_id = ? AND instance_type IN (${placeholders})`;
    const rs = await db.prepare(sql).bind(odRun.id, ...slice).all();
    for (const r of rs.results || []) {
      odByType.set(r.instance_type, r.price_per_hour_usd);
    }
  }

  let latestWindowEnd = null;
  const out = spotRows.map(r => {
    const od = odByType.get(r.instance_type);
    const discountPct = (typeof od === 'number' && od > 0 && typeof r.latest_spot_price === 'number')
      ? ((od - r.latest_spot_price) / od) * 100
      : null;
    if (!latestWindowEnd || r.latest_spot_timestamp > latestWindowEnd) {
      latestWindowEnd = r.latest_spot_timestamp;
    }
    return {
      instance_type:             r.instance_type,
      instance_family:           r.instance_family,
      family_class:              r.family_class,
      availability_zone:         r.availability_zone,
      product_description:       r.product_description,
      latest_spot_price:         r.latest_spot_price,
      latest_spot_timestamp:     r.latest_spot_timestamp,
      latest_on_demand_price:    typeof od === 'number' ? od : null,
      spot_discount_pct:         discountPct,
    };
  });

  return jsonResp({
    success: true,
    family,
    rows: out,
    latest_spot_window_end_utc:       latestWindowEnd,
    latest_on_demand_capture_date_et: odRun.captured_date_et,
    latest_on_demand_source:          odRun.source,
    hint: null,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
