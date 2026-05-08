// GET /api/aws/ec2-pricing/history/changes?period=wtd|mtd|qtd&top=N
//
// Compare the latest capture against the first capture on or after
// the period start in America/New_York. Period rules:
//   wtd → first capture on/after Monday of current ET week
//   mtd → first capture on/after first day of current ET month
//   qtd → first capture on/after first day of current calendar quarter
//
// Honest empty state when no baseline exists or only one capture is
// available. New / removed instance types are computed separately and
// never reported as price changes from/to zero.

import { LATEST_RUN_ORDER, jsonResp, corsPreflight } from '../_d1-chunk.js';
import { periodStartET } from '../_et.js';
import { median } from '../_median.js';

const VALID = new Set(['wtd', 'mtd', 'qtd']);
const PERIOD_HINT = {
  wtd: "Pricing history is being collected from today. WTD will populate after Monday's capture lands.",
  mtd: 'Pricing history is being collected from today. MTD will populate as daily captures accumulate this month.',
  qtd: 'Pricing history is being collected from today. QTD will populate as daily captures accumulate this quarter.',
};

export async function onRequestOptions() { return corsPreflight(); }

export async function onRequestGet({ request, env }) {
  if (!env?.EC2_PRICING_DB) {
    return jsonResp({ success: false, error: 'd1_binding_missing' }, 500);
  }
  const url = new URL(request.url);
  const period = (url.searchParams.get('period') || 'wtd').toLowerCase();
  if (!VALID.has(period)) {
    return jsonResp({ success: false, error: 'invalid_period', detail: 'period must be wtd | mtd | qtd' }, 400);
  }
  const top = Math.min(Math.max(parseInt(url.searchParams.get('top') || '10', 10) || 10, 1), 50);
  const period_start = periodStartET(period);
  const db = env.EC2_PRICING_DB;

  const latest = await db.prepare(
    `SELECT id, captured_date_et FROM aws_ec2_pricing_capture_runs
     WHERE status = 'success' ${LATEST_RUN_ORDER}`,
  ).first();

  if (!latest) {
    return jsonResp({
      success: true, period, period_start,
      current_capture_date: null, baseline_capture_date: null,
      total_instances_compared: 0, instances_up: 0, instances_down: 0, instances_unchanged: 0,
      median_change_pct: null, average_change_pct: null,
      biggest_increases: [], biggest_decreases: [], new_instances: [], removed_instances: [],
      family_summary: [], hint: PERIOD_HINT[period],
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // Baseline = first capture on/after period_start. Pick the same
  // source-priority order for stability so we don't compare a daily
  // run against a historical baseline mid-week.
  const baseline = await db.prepare(
    `SELECT id, captured_date_et FROM aws_ec2_pricing_capture_runs
     WHERE status = 'success' AND captured_date_et >= ?
     ORDER BY captured_date_et ASC,
              CASE source
                WHEN 'aws_bulk_pricelist_current'    THEN 0
                WHEN 'aws_bulk_pricelist_historical' THEN 1
                ELSE 2
              END ASC,
              captured_at_utc ASC
     LIMIT 1`,
  ).bind(period_start).first();

  if (!baseline || baseline.id === latest.id) {
    return jsonResp({
      success: true, period, period_start,
      current_capture_date: latest.captured_date_et,
      baseline_capture_date: baseline ? baseline.captured_date_et : null,
      total_instances_compared: 0, instances_up: 0, instances_down: 0, instances_unchanged: 0,
      median_change_pct: null, average_change_pct: null,
      biggest_increases: [], biggest_decreases: [], new_instances: [], removed_instances: [],
      family_summary: [], hint: PERIOD_HINT[period],
    }, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  // Matched join + new/removed anti-joins in a single batch (3 stmts).
  const matchedSql = `
    SELECT cur.instance_type, cur.family_class,
           base.price_per_hour_usd AS baseline_price,
           cur.price_per_hour_usd  AS latest_price,
           cur.vcpu, cur.memory_label
    FROM aws_ec2_pricing_rows cur
    JOIN aws_ec2_pricing_rows base
      ON base.run_id = ? AND base.instance_type = cur.instance_type
    WHERE cur.run_id = ?
  `;
  const newSql = `
    SELECT cur.instance_type, cur.family_class, cur.price_per_hour_usd AS latest_price
    FROM aws_ec2_pricing_rows cur
    LEFT JOIN aws_ec2_pricing_rows base
      ON base.run_id = ? AND base.instance_type = cur.instance_type
    WHERE cur.run_id = ? AND base.instance_type IS NULL
    ORDER BY cur.instance_type ASC
  `;
  const removedSql = `
    SELECT base.instance_type, base.family_class, base.price_per_hour_usd AS baseline_price
    FROM aws_ec2_pricing_rows base
    LEFT JOIN aws_ec2_pricing_rows cur
      ON cur.run_id = ? AND cur.instance_type = base.instance_type
    WHERE base.run_id = ? AND cur.instance_type IS NULL
    ORDER BY base.instance_type ASC
  `;

  const [matchedRes, newRes, removedRes] = await db.batch([
    db.prepare(matchedSql).bind(baseline.id, latest.id),
    db.prepare(newSql).bind(baseline.id, latest.id),
    db.prepare(removedSql).bind(baseline.id, latest.id),
  ]);

  const matched = (matchedRes.results || []).map(r => {
    const abs = r.latest_price - r.baseline_price;
    const pct = r.baseline_price > 0 ? (r.latest_price - r.baseline_price) / r.baseline_price : null;
    return { ...r, abs_change: abs, pct_change: pct };
  });

  const up        = matched.filter(r => r.latest_price > r.baseline_price);
  const down      = matched.filter(r => r.latest_price < r.baseline_price);
  const unchanged = matched.length - up.length - down.length;

  const allPcts = matched.map(r => r.pct_change).filter(v => v != null && Number.isFinite(v));
  const median_change_pct  = median(allPcts);
  const average_change_pct = allPcts.length ? allPcts.reduce((a, b) => a + b, 0) / allPcts.length : null;

  const cmpAbs = (a, b) => Math.abs(b.pct_change ?? 0) - Math.abs(a.pct_change ?? 0);
  const biggest_increases = [...up].sort(cmpAbs).slice(0, top);
  const biggest_decreases = [...down].sort(cmpAbs).slice(0, top);

  // Family-level summary (median/avg pct change + counts).
  const byFamily = new Map();
  for (const r of matched) {
    const k = r.family_class || 'other';
    if (!byFamily.has(k)) byFamily.set(k, { family_class: k, instance_count: 0, n_increased: 0, n_decreased: 0, _pcts: [] });
    const acc = byFamily.get(k);
    acc.instance_count += 1;
    if (r.latest_price > r.baseline_price) acc.n_increased += 1;
    else if (r.latest_price < r.baseline_price) acc.n_decreased += 1;
    if (r.pct_change != null && Number.isFinite(r.pct_change)) acc._pcts.push(r.pct_change);
  }
  const family_summary = [...byFamily.values()].map(f => ({
    family_class:      f.family_class,
    instance_count:    f.instance_count,
    n_increased:       f.n_increased,
    n_decreased:       f.n_decreased,
    median_change_pct: median(f._pcts),
    average_change_pct: f._pcts.length ? f._pcts.reduce((a, b) => a + b, 0) / f._pcts.length : null,
  })).sort((a, b) => a.family_class.localeCompare(b.family_class));

  return jsonResp({
    success: true,
    period,
    period_start,
    current_capture_date:  latest.captured_date_et,
    baseline_capture_date: baseline.captured_date_et,
    total_instances_compared: matched.length,
    instances_up:        up.length,
    instances_down:      down.length,
    instances_unchanged: unchanged,
    median_change_pct,
    average_change_pct,
    biggest_increases,
    biggest_decreases,
    new_instances:     newRes.results || [],
    removed_instances: removedRes.results || [],
    family_summary,
    hint: null,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}
