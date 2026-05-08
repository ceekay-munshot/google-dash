// GET /api/aws/ec2-pricing/history/series?bucket=daily|weekly|monthly|quarterly&group=all|family
//
// Source rules (per the customer spec — never blended without priority):
//   daily, weekly       → aws_bulk_pricelist_current ONLY (historical is monthly granularity)
//   monthly, quarterly  → both sources allowed; for the current ET bucket
//                          a current-source run wins ONLY if it is newer
//                          than the latest historical run in that bucket
//
// Each point carries its `source` field so the chart tooltip can label
// historical-vs-current cleanly.

import { jsonResp, corsPreflight } from '../_d1-chunk.js';
import { bucketKey, nowInEasternTime } from '../_et.js';
import { median } from '../_median.js';

const VALID_BUCKETS = new Set(['daily', 'weekly', 'monthly', 'quarterly']);
const VALID_GROUPS  = new Set(['all', 'family']);

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ request, env }) {
  if (!env?.EC2_PRICING_DB) {
    return jsonResp({ success: false, error: 'd1_binding_missing' }, 500);
  }
  const url = new URL(request.url);
  const bucket = (url.searchParams.get('bucket') || 'monthly').toLowerCase();
  const group  = (url.searchParams.get('group')  || 'family').toLowerCase();
  if (!VALID_BUCKETS.has(bucket)) return jsonResp({ success: false, error: 'invalid_bucket' }, 400);
  if (!VALID_GROUPS.has(group))   return jsonResp({ success: false, error: 'invalid_group' }, 400);

  const allowedSources = (bucket === 'daily' || bucket === 'weekly')
    ? ['aws_bulk_pricelist_current']
    : ['aws_bulk_pricelist_current', 'aws_bulk_pricelist_historical'];

  const db = env.EC2_PRICING_DB;
  const sourcesPlaceholders = allowedSources.map(() => '?').join(',');

  // Fetch every successful run that's eligible for this bucket.
  const runs = (await db.prepare(
    `SELECT id, captured_date_et, captured_at_utc, source
     FROM aws_ec2_pricing_capture_runs
     WHERE status = 'success' AND source IN (${sourcesPlaceholders})
     ORDER BY captured_date_et ASC, captured_at_utc ASC`,
  ).bind(...allowedSources).all()).results || [];

  if (runs.length < 2) {
    return jsonResp({
      success: true, bucket, group,
      points: [],
      hint: (bucket === 'daily' || bucket === 'weekly')
        ? 'Daily/weekly granularity begins from the first daily capture forward. Two or more daily captures are required.'
        : 'Monthly/quarterly trends will appear once historical backfill has run or after at least two monthly captures.',
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // Group runs by bucket; for monthly/quarterly, apply source priority
  // per bucket.
  const currentBucket = bucketKey(bucket, nowInEasternTime().date);
  const bucketed = new Map(); // bucket_key → chosen run

  for (const run of runs) {
    const k = bucketKey(bucket, run.captured_date_et);
    const cur = bucketed.get(k);
    if (!cur) {
      bucketed.set(k, run);
      continue;
    }
    if (bucket === 'daily' || bucket === 'weekly') {
      // Within a bucket, take the latest by date+time (single source).
      if (run.captured_date_et > cur.captured_date_et ||
          (run.captured_date_et === cur.captured_date_et && run.captured_at_utc > cur.captured_at_utc)) {
        bucketed.set(k, run);
      }
      continue;
    }
    // monthly / quarterly source-priority rule.
    const isCurrentBucket = (k === currentBucket);
    const replace =
      // Same source: take the later capture.
      (run.source === cur.source &&
        (run.captured_date_et > cur.captured_date_et ||
          (run.captured_date_et === cur.captured_date_et && run.captured_at_utc > cur.captured_at_utc)))
      // Different sources, current ET bucket: 'current' wins ONLY if newer than the existing 'historical'.
      || (isCurrentBucket && run.source === 'aws_bulk_pricelist_current' && cur.source === 'aws_bulk_pricelist_historical' && run.captured_date_et > cur.captured_date_et)
      // Different sources, non-current bucket: prefer historical (canonical for completed buckets).
      || (!isCurrentBucket && run.source === 'aws_bulk_pricelist_historical' && cur.source === 'aws_bulk_pricelist_current');
    if (replace) bucketed.set(k, run);
  }

  // Aggregate rows for each chosen run.
  const orderedKeys = [...bucketed.keys()].sort();
  const groupSql = group === 'family'
    ? `SELECT family_class, COUNT(*) AS instance_count, AVG(price_per_hour_usd) AS average_price,
              MIN(price_per_hour_usd) AS min_price, MAX(price_per_hour_usd) AS max_price
       FROM aws_ec2_pricing_rows WHERE run_id = ? GROUP BY family_class ORDER BY family_class`
    : `SELECT 'all' AS family_class, COUNT(*) AS instance_count, AVG(price_per_hour_usd) AS average_price,
              MIN(price_per_hour_usd) AS min_price, MAX(price_per_hour_usd) AS max_price
       FROM aws_ec2_pricing_rows WHERE run_id = ?`;
  const medianSql = group === 'family'
    ? `SELECT family_class, price_per_hour_usd FROM aws_ec2_pricing_rows WHERE run_id = ?`
    : `SELECT 'all' AS family_class, price_per_hour_usd FROM aws_ec2_pricing_rows WHERE run_id = ?`;

  const points = [];
  for (const k of orderedKeys) {
    const run = bucketed.get(k);
    const [aggRes, priceRes] = await db.batch([
      db.prepare(groupSql).bind(run.id),
      db.prepare(medianSql).bind(run.id),
    ]);
    const byFamilyMedian = new Map();
    for (const row of priceRes.results || []) {
      const arr = byFamilyMedian.get(row.family_class) || [];
      arr.push(row.price_per_hour_usd);
      byFamilyMedian.set(row.family_class, arr);
    }
    for (const r of aggRes.results || []) {
      points.push({
        bucket_key:    k,
        rep_date:      run.captured_date_et,
        source:        run.source,
        family_class:  r.family_class,
        instance_count: r.instance_count,
        median_price:   median(byFamilyMedian.get(r.family_class) || []),
        average_price:  r.average_price,
        min_price:      r.min_price,
        max_price:      r.max_price,
      });
    }
  }

  // Add pct_changed_vs_prior_period and pct_changed_vs_first_capture
  // per (family_class) series. Comparing only matched-instance subsets
  // is the high-fidelity approach but expensive; for the chart axes we
  // use the family-level average price as the proxy. The /changes
  // endpoint remains the source of truth for matched-instance deltas.
  const byKlass = new Map();
  for (const p of points) {
    const arr = byKlass.get(p.family_class) || [];
    arr.push(p);
    byKlass.set(p.family_class, arr);
  }
  for (const arr of byKlass.values()) {
    arr.sort((a, b) => a.bucket_key.localeCompare(b.bucket_key));
    const first = arr[0]?.average_price || null;
    for (let i = 0; i < arr.length; i++) {
      const prior = i > 0 ? arr[i - 1].average_price : null;
      arr[i].pct_changed_vs_prior_period  = prior ? (arr[i].average_price - prior) / prior : null;
      arr[i].pct_changed_vs_first_capture = first ? (arr[i].average_price - first) / first : null;
    }
  }

  return jsonResp({
    success: true,
    bucket, group,
    points: points.sort((a, b) =>
      a.bucket_key === b.bucket_key
        ? a.family_class.localeCompare(b.family_class)
        : a.bucket_key.localeCompare(b.bucket_key)),
    hint: null,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
