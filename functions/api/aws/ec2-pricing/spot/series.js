// GET /api/aws/ec2-pricing/spot/series?bucket=daily|weekly|monthly&family=all|general|compute|memory|storage|gpu|baremetal
//
// Spot observations bucketed by time-of-observation. Output one row
// per (period, family_class, instance_family). All numeric aggregates
// computed in JS — D1 doesn't have PERCENTILE_CONT.
//
// Buckets:
//   daily   → YYYY-MM-DD (UTC date of observation)
//   weekly  → YYYY-MM-DD of the ISO-Monday of the observation's week
//   monthly → YYYY-MM-01

import { jsonResp, corsPreflight, spotTablesReady, percentile } from './_spot-shared.js';
import { median } from '../_median.js';

const VALID_BUCKETS = new Set(['daily', 'weekly', 'monthly']);
const VALID_FAMILIES = new Set(['all', 'general', 'compute', 'memory', 'storage', 'gpu', 'baremetal', 'other']);

export async function onRequestOptions() { return corsPreflight(); }

function bucketKey(bucket, isoTimestamp) {
  const d = new Date(isoTimestamp);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (bucket === 'monthly') return `${y}-${m}-01`;
  if (bucket === 'weekly') {
    // ISO week starts Monday. getUTCDay: 0=Sun..6=Sat → back to Monday.
    const wd = d.getUTCDay();
    const back = (wd + 6) % 7;
    const t = Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - back * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  // daily
  return `${y}-${m}-${day}`;
}

export async function onRequestGet({ request, env }) {
  if (!env?.EC2_PRICING_DB) return jsonResp({ success: false, error: 'd1_binding_missing' }, 500);
  const url = new URL(request.url);
  const bucket = (url.searchParams.get('bucket') || 'daily').toLowerCase();
  const family = (url.searchParams.get('family') || 'all').toLowerCase();
  if (!VALID_BUCKETS.has(bucket)) return jsonResp({ success: false, error: 'invalid_bucket' }, 400);
  if (!VALID_FAMILIES.has(family)) return jsonResp({ success: false, error: 'invalid_family' }, 400);

  const db = env.EC2_PRICING_DB;
  if (!(await spotTablesReady(db))) {
    return jsonResp({
      success: true,
      bucket, family,
      points: [],
      hint: 'Spot tables are not yet migrated on this deploy. Run `wrangler d1 migrations apply EC2_PRICING_DB --remote` and capture a first sample.',
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  const familyFilter = family === 'all' ? '' : 'AND family_class = ?';
  const sql = `
    SELECT observed_timestamp_utc, family_class, instance_family,
           instance_type, availability_zone, spot_price_usd
    FROM aws_ec2_spot_price_rows
    WHERE 1=1 ${familyFilter}
    ORDER BY observed_timestamp_utc ASC
  `;
  const stmt = family === 'all' ? db.prepare(sql) : db.prepare(sql).bind(family);
  const result = await stmt.all();
  const rows = result?.results || [];

  if (rows.length === 0) {
    return jsonResp({
      success: true, bucket, family, points: [],
      hint: 'No spot observations captured yet for this family.',
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // Group by (period, family_class, instance_family).
  const groups = new Map();
  for (const r of rows) {
    const period = bucketKey(bucket, r.observed_timestamp_utc);
    const key = `${period}\x00${r.family_class}\x00${r.instance_family}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        period, family_class: r.family_class, instance_family: r.instance_family,
        prices: [], instanceTypes: new Set(), azs: new Set(),
      };
      groups.set(key, g);
    }
    g.prices.push(r.spot_price_usd);
    g.instanceTypes.add(r.instance_type);
    if (r.availability_zone) g.azs.add(r.availability_zone);
  }

  const points = [];
  for (const g of groups.values()) {
    const sorted = g.prices.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((acc, n) => acc + n, 0);
    points.push({
      period:                 g.period,
      family_class:           g.family_class,
      instance_family:        g.instance_family,
      median_spot_price:      median(g.prices),
      p10_spot_price:         percentile(sorted, 0.10),
      p90_spot_price:         percentile(sorted, 0.90),
      avg_spot_price:         sum / sorted.length,
      event_count:            sorted.length,
      unique_instance_types:  g.instanceTypes.size,
      unique_azs:             g.azs.size,
    });
  }

  points.sort((a, b) =>
    a.period === b.period
      ? (a.family_class === b.family_class ? a.instance_family.localeCompare(b.instance_family) : a.family_class.localeCompare(b.family_class))
      : a.period.localeCompare(b.period));

  return jsonResp({ success: true, bucket, family, points, hint: null }, 200, { 'Cache-Control': 'public, max-age=60' });
}
