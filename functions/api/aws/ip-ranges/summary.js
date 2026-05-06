/**
 * Cloudflare Pages Function — AWS Public Network Capacity Proxy: summary
 * Route: GET /api/aws/ip-ranges/summary
 *
 * Single compact endpoint that powers the investor-grade hero KPI row.
 * Combines fields the UI needs to render five trend cards:
 *
 *   - latest          (the most recent stored snapshot's totals)
 *   - qtd             (calendar-quarter-to-date IPv4 capacity change)
 *   - thirty_day      (30-day capacity change, falls back to since-first
 *                      when fewer than 30 captured days exist)
 *   - breadth         (services_expanding / regions_expanding counts using
 *                      the same baseline as thirty_day)
 *
 * Read-only — never fetches AWS upstream, never writes to KV. Operates
 * entirely on captured snapshots in HISTORY_KV (aws-ipr:* keys). When
 * data is insufficient (single snapshot, no same-quarter baseline,
 * etc.) the relevant block is returned with available:false / null
 * values rather than synthetic zeros, so the UI can render "Pending"
 * states honestly.
 */

import {
  DAY_PREFIX,
  INDEX_KEY,
  jsonResp,
  corsPreflight,
} from '../_ipr-utils.js';

/** Calendar quarter (1..4) of a YYYY-MM-DD date string. */
function quarterOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return { year: y, quarter: Math.floor((m - 1) / 3) + 1 };
}

/** YYYY-MM-DD UTC, N days before the given date. */
function dateMinusDaysUTC(dateStr, days) {
  const t = Date.parse(dateStr + 'T00:00:00Z');
  return new Date(t - days * 86400000).toISOString().slice(0, 10);
}

/**
 * Pick the snapshot whose snapshot_date is the latest one that is
 * <= targetDate. Snapshots are passed in chronological asc order.
 * Returns null if nothing in the array is on/before targetDate.
 */
function pickAtOrBefore(snaps, targetDate) {
  let chosen = null;
  for (const s of snaps) {
    if (s.snapshot_date <= targetDate) chosen = s;
    else break;
  }
  return chosen;
}

/**
 * Count "expanding" rows between two by_X arrays (by_service / by_region).
 * "Expanding" = latest_value > baseline_value, OR present at latest but
 * absent at baseline. A row absent at latest but present at baseline is
 * NOT counted (per spec — services that disappeared aren't growth).
 */
function countExpanding(latestRows, baselineRows, keyField) {
  const baselineByKey = new Map();
  for (const r of baselineRows || []) baselineByKey.set(r[keyField], r);
  let count = 0;
  for (const r of latestRows || []) {
    const baseline = baselineByKey.get(r[keyField]);
    const latestVal = typeof r.ipv4_addresses === 'number' ? r.ipv4_addresses : null;
    const baselineVal = baseline && typeof baseline.ipv4_addresses === 'number' ? baseline.ipv4_addresses : null;
    if (latestVal == null) continue; // missing latest → don't count
    if (baselineVal == null) { count += 1; continue; } // present latest, absent baseline → expanding
    if (latestVal > baselineVal) count += 1;
  }
  return count;
}

/**
 * Compute change block. Returns {available, absolute_change, pct_change,
 * baseline_date, period_label?}. period_label is set on the thirty_day
 * block to communicate "30D" vs "since first snapshot" fallback.
 */
function changeBlock(latestSnap, baselineSnap, periodLabel) {
  if (!latestSnap || !baselineSnap || latestSnap.snapshot_date === baselineSnap.snapshot_date) {
    return { available: false, absolute_change: null, pct_change: null, baseline_date: null, period_label: periodLabel || null };
  }
  const latest = latestSnap.total_ipv4_addresses;
  const base = baselineSnap.total_ipv4_addresses;
  if (typeof latest !== 'number' || typeof base !== 'number') {
    return { available: false, absolute_change: null, pct_change: null, baseline_date: null, period_label: periodLabel || null };
  }
  const abs = latest - base;
  const pct = base > 0 ? abs / base : null;
  const out = { available: true, absolute_change: abs, pct_change: pct, baseline_date: baselineSnap.snapshot_date };
  if (periodLabel) out.period_label = periodLabel;
  return out;
}

export async function onRequestGet({ env }) {
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp({ success: false, error: 'HISTORY_KV not bound' }, 500);
  }

  const index = (await kv.get(INDEX_KEY, 'json')) || [];
  if (!index.length) {
    return jsonResp({
      success: true,
      snapshot_count: 0,
      first_snapshot_date: null,
      latest_snapshot_date: null,
      latest: null,
      qtd: { available: false, absolute_change: null, pct_change: null, baseline_date: null },
      thirty_day: { available: false, absolute_change: null, pct_change: null, baseline_date: null, period_label: null },
      breadth: { services_expanding: null, total_services_tracked: null, regions_expanding: null, total_regions_tracked: null, period_label: null },
    });
  }

  // Cap the scan at 400 — same ceiling as the index. Index is desc; flip
  // to asc so chronological math reads naturally.
  const dates = index.slice(0, 400);
  const snaps = (await Promise.all(
    dates.map(async (d) => kv.get(DAY_PREFIX + d, 'json'))
  )).filter(Boolean);
  snaps.sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1));

  const latestSnap = snaps[snaps.length - 1];
  const firstSnap = snaps[0];

  const latest = {
    total_ipv4_addresses: latestSnap.total_ipv4_addresses,
    total_ipv4_prefixes: latestSnap.total_ipv4_prefixes,
    total_ipv6_prefixes: latestSnap.total_ipv6_prefixes,
    total_regions: latestSnap.total_regions,
    total_services: latestSnap.total_services,
    aws_create_date: latestSnap.aws_create_date || null,
    sync_token: latestSnap.sync_token || null,
  };

  // ── 30D block ──
  // Pick the snapshot at-or-before (latest - 30 days). If nothing is
  // 30+ days back, fall back to the earliest captured snapshot and
  // re-label as "since first snapshot" so the UI is honest about scope.
  let thirtyDay = { available: false, absolute_change: null, pct_change: null, baseline_date: null, period_label: null };
  if (snaps.length >= 2) {
    const target = dateMinusDaysUTC(latestSnap.snapshot_date, 30);
    let baseline = pickAtOrBefore(snaps.slice(0, -1), target);
    let label = '30D';
    if (!baseline) {
      baseline = firstSnap;
      label = 'since first snapshot';
    }
    thirtyDay = changeBlock(latestSnap, baseline, label);
  }

  // ── QTD block ──
  // Earliest captured snapshot in the SAME calendar quarter as latest.
  // If the only same-quarter snapshot is latest itself, QTD is Pending —
  // we never reach across quarters for QTD (that would be QoQ, which is
  // a different metric and intentionally NOT mixed in here).
  let qtd = { available: false, absolute_change: null, pct_change: null, baseline_date: null };
  const latestQ = quarterOf(latestSnap.snapshot_date);
  const sameQuarter = snaps.filter(s => {
    const q = quarterOf(s.snapshot_date);
    return q.year === latestQ.year && q.quarter === latestQ.quarter;
  });
  if (sameQuarter.length >= 2) {
    qtd = changeBlock(latestSnap, sameQuarter[0], null);
  }

  // ── Breadth block ──
  // Mirror the thirty_day baseline (or "since first snapshot" fallback).
  // Count services / regions whose IPv4 capacity grew or appeared between
  // baseline and latest. Single-snapshot case stays Pending.
  let breadth = {
    services_expanding: null,
    total_services_tracked: latest.total_services ?? null,
    regions_expanding: null,
    total_regions_tracked: latest.total_regions ?? null,
    period_label: null,
  };
  if (snaps.length >= 2 && thirtyDay.available) {
    const baseline = snaps.find(s => s.snapshot_date === thirtyDay.baseline_date);
    if (baseline) {
      breadth.services_expanding = countExpanding(latestSnap.by_service, baseline.by_service, 'service');
      breadth.regions_expanding = countExpanding(latestSnap.by_region, baseline.by_region, 'region');
      breadth.period_label = thirtyDay.period_label;
    }
  }

  return jsonResp({
    success: true,
    snapshot_count: snaps.length,
    first_snapshot_date: firstSnap.snapshot_date,
    latest_snapshot_date: latestSnap.snapshot_date,
    latest,
    qtd,
    thirty_day: thirtyDay,
    breadth,
  }, 200, { 'Cache-Control': 'public, max-age=60' });
}

export const onRequestOptions = corsPreflight;
