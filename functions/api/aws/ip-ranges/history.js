/**
 * Cloudflare Pages Function — AWS Public Network Capacity Proxy: history
 * Route: GET /api/aws/ip-ranges/history?grain=daily|weekly|quarterly
 *
 * Reads the daily-snapshot index from KV and returns either:
 *   - daily      — every captured snapshot, newest first (capped by ?range=N).
 *   - weekly     — one representative snapshot per ISO calendar week, using
 *                  the LATEST captured snapshot in that week. WoW deltas
 *                  on total_ipv4_addresses are computed against the
 *                  immediately-prior week's representative; absolute number
 *                  is primary, percentage is secondary. If there is no
 *                  prior week, both delta fields are null and the UI is
 *                  expected to render "—".
 *   - quarterly  — one representative snapshot per calendar quarter, using
 *                  the LATEST captured snapshot in that quarter. QoQ deltas
 *                  on total_ipv4_addresses are computed against the
 *                  immediately-prior quarter's representative; absolute
 *                  number is primary, percentage is secondary. If there
 *                  is no prior quarter, both delta fields are null and
 *                  the UI is expected to render "—".
 *
 * Snapshots are returned in summary form (no by_service / by_region payloads)
 * so the history response stays compact even after months of accumulation.
 * The /latest endpoint is the right thing to call for full rollup detail.
 */

import {
  DAY_PREFIX,
  INDEX_KEY,
  jsonResp,
  corsPreflight,
} from '../_ipr-utils.js';

function getQuarter(dateStr) {
  // dateStr is YYYY-MM-DD UTC.
  const [y, m] = dateStr.split('-').map(Number);
  return { year: y, quarter: Math.floor((m - 1) / 3) + 1 };
}

function quarterKey(dateStr) {
  const { year, quarter } = getQuarter(dateStr);
  return year + '-Q' + quarter;
}

function quarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0)); // day 0 of next month = last day of this quarter
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/**
 * ISO-8601 week info for a YYYY-MM-DD UTC date string.
 * Returns { iso_year, iso_week, week_start (Monday YYYY-MM-DD), week_end
 * (Sunday YYYY-MM-DD), key (e.g. "2026-W19"), label (e.g. "W19 '26") }.
 *
 * ISO weeks anchor on Monday. Week 1 of a year is the week containing
 * the first Thursday — which means a date in early January can belong
 * to the previous calendar year's week, so we report iso_year explicitly.
 */
function isoWeekInfo(dateStr) {
  const t = Date.parse(dateStr + 'T00:00:00Z');
  const d = new Date(t);
  // Monday-of-week, UTC.
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(t - dayOfWeek * 86400000);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  // ISO-8601 week number: Thursday of the same ISO week, year of that
  // Thursday is the iso_year, and Jan 4 of that iso_year always lies
  // in ISO week 1.
  const thursday = new Date(monday.getTime() + 3 * 86400000);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayOfWeek = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4DayOfWeek * 86400000);
  const isoWeek = Math.floor((thursday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd = sunday.toISOString().slice(0, 10);
  const wPad = String(isoWeek).padStart(2, '0');
  const yyShort = String(isoYear).slice(-2);
  return {
    iso_year: isoYear,
    iso_week: isoWeek,
    week_start: weekStart,
    week_end: weekEnd,
    key: isoYear + '-W' + wPad,
    label: 'W' + wPad + " '" + yyShort,
  };
}

/**
 * Strip a stored snapshot down to the small set of fields useful for trend
 * tables — keeps the history response compact and avoids shipping the full
 * by_service / by_region arrays with every entry.
 */
function summarize(snap) {
  if (!snap) return null;
  return {
    snapshot_date: snap.snapshot_date,
    captured_at: snap.captured_at,
    aws_create_date: snap.aws_create_date,
    sync_token: snap.sync_token,
    total_ipv4_prefixes: snap.total_ipv4_prefixes,
    total_ipv4_addresses: snap.total_ipv4_addresses,
    total_ipv6_prefixes: snap.total_ipv6_prefixes,
    total_services: snap.total_services,
    total_regions: snap.total_regions,
    total_network_border_groups: snap.total_network_border_groups,
  };
}

export async function onRequestGet({ request, env }) {
  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp({ success: false, error: 'HISTORY_KV not bound' }, 500);
  }

  const url = new URL(request.url);
  const grain = (url.searchParams.get('grain') || 'daily').toLowerCase();
  const range = Math.min(parseInt(url.searchParams.get('range') || '90', 10) || 90, 365);

  const index = (await kv.get(INDEX_KEY, 'json')) || [];
  if (!index.length) {
    return jsonResp({
      success: true,
      grain,
      snapshots: [],
      points: [],
      count: 0,
      message: 'No AWS IP-range history yet. Hit /api/aws/ip-ranges/capture to create the first snapshot.',
    });
  }

  // Index is sorted desc by date. For weekly/quarterly grains we scan a
  // wider window so groupings stay meaningful even when ?range is small.
  const scanWindow = grain === 'daily' ? range : Math.min(index.length, 365);
  const dates = index.slice(0, scanWindow);
  const snapshots = (await Promise.all(
    dates.map(async (d) => kv.get(DAY_PREFIX + d, 'json'))
  )).filter(Boolean);

  // ── Daily grain ──
  if (grain === 'daily') {
    // Snapshots come back desc; flip to asc so chart axis reads
    // chronologically, then compute a `points` array with the deltas the
    // aggregate Total IPv4 chart needs (vs prev point + vs first).
    const ascSnaps = snapshots.slice().sort(
      (a, b) => (a.snapshot_date < b.snapshot_date ? -1 : 1)
    );
    const firstTotal = ascSnaps.length ? ascSnaps[0].total_ipv4_addresses : null;
    const points = ascSnaps.map((s, i) => {
      const prev = i > 0 ? ascSnaps[i - 1] : null;
      const total = s.total_ipv4_addresses;
      const prevTotal = prev ? prev.total_ipv4_addresses : null;
      const absVsPrev = (prev && typeof prevTotal === 'number' && typeof total === 'number')
        ? total - prevTotal
        : null;
      const pctVsPrev = (prev && typeof prevTotal === 'number' && prevTotal > 0 && typeof total === 'number')
        ? (total - prevTotal) / prevTotal
        : null;
      const absVsFirst = (typeof firstTotal === 'number' && typeof total === 'number')
        ? total - firstTotal
        : null;
      const pctVsFirst = (typeof firstTotal === 'number' && firstTotal > 0 && typeof total === 'number')
        ? (total - firstTotal) / firstTotal
        : null;
      return {
        date: s.snapshot_date,
        total_ipv4_addresses: total,
        total_ipv4_prefixes: s.total_ipv4_prefixes,
        total_ipv6_prefixes: s.total_ipv6_prefixes,
        snapshot_count: 1,
        abs_vs_prev: absVsPrev,
        pct_vs_prev: pctVsPrev,
        abs_vs_first: absVsFirst,
        pct_vs_first: pctVsFirst,
      };
    });
    // snapshots[] (desc) preserved for back-compat with any older client.
    const out = snapshots.slice(0, range).map(summarize);
    return jsonResp({
      success: true,
      grain: 'daily',
      snapshots: out,
      points,
      count: out.length,
      earliest: out.length ? out[out.length - 1].snapshot_date : null,
      latest: out.length ? out[0].snapshot_date : null,
    });
  }

  // ── Weekly grain ──
  // Group by ISO calendar week, keeping the LATEST snapshot per week
  // (snapshots are date-desc in `snapshots`, so the first one we see for
  // a key wins). Each week becomes one aggregate point on the chart with
  // WoW deltas against the immediate-prior week.
  if (grain === 'weekly') {
    const byWeek = new Map(); // weekKey → { rep, info, count }
    for (const s of snapshots) {
      const info = isoWeekInfo(s.snapshot_date);
      if (!byWeek.has(info.key)) {
        byWeek.set(info.key, { rep: s, info, count: 1 });
      } else {
        byWeek.get(info.key).count += 1;
      }
    }

    // Sort weeks asc so the chart axis reads chronologically and the
    // points carry stable WoW comparisons against the prior point.
    const sortedWeekKeys = Array.from(byWeek.keys()).sort();
    const firstTotal = sortedWeekKeys.length
      ? byWeek.get(sortedWeekKeys[0]).rep.total_ipv4_addresses
      : null;

    const points = sortedWeekKeys.map((wk, i) => {
      const { rep, info, count } = byWeek.get(wk);
      const prevWk = i > 0 ? sortedWeekKeys[i - 1] : null;
      const prevRep = prevWk ? byWeek.get(prevWk).rep : null;
      const total = rep.total_ipv4_addresses;
      const prevTotal = prevRep ? prevRep.total_ipv4_addresses : null;
      const absVsPrev = (prevRep && typeof prevTotal === 'number' && typeof total === 'number')
        ? total - prevTotal
        : null;
      const pctVsPrev = (prevRep && typeof prevTotal === 'number' && prevTotal > 0 && typeof total === 'number')
        ? (total - prevTotal) / prevTotal
        : null;
      const absVsFirst = (typeof firstTotal === 'number' && typeof total === 'number')
        ? total - firstTotal
        : null;
      const pctVsFirst = (typeof firstTotal === 'number' && firstTotal > 0 && typeof total === 'number')
        ? (total - firstTotal) / firstTotal
        : null;
      return {
        date: rep.snapshot_date,                  // representative day
        week_key: info.key,
        week_start: info.week_start,
        week_end: info.week_end,
        week_label: info.label,
        iso_year: info.iso_year,
        iso_week: info.iso_week,
        total_ipv4_addresses: total,
        total_ipv4_prefixes: rep.total_ipv4_prefixes,
        total_ipv6_prefixes: rep.total_ipv6_prefixes,
        snapshot_count: count,
        abs_vs_prev: absVsPrev,                   // WoW absolute change
        pct_vs_prev: pctVsPrev,                   // WoW percentage change
        abs_vs_first: absVsFirst,
        pct_vs_first: pctVsFirst,
      };
    });

    return jsonResp({
      success: true,
      grain: 'weekly',
      points,
      count: points.length,
      earliest: points.length ? points[0].week_start : null,
      latest: points.length ? points[points.length - 1].week_end : null,
    });
  }

  // ── Quarterly grain ──
  if (grain === 'quarterly') {
    // Group by quarter, keeping the LATEST snapshot per quarter (snapshots
    // are already date-desc, so the first one we see for a key wins).
    const byQuarter = new Map(); // qid → snapshot
    for (const s of snapshots) {
      const q = quarterKey(s.snapshot_date);
      if (!byQuarter.has(q)) byQuarter.set(q, s);
    }

    const todayKey = quarterKey(new Date().toISOString().slice(0, 10));
    const sortedQids = Array.from(byQuarter.keys()).sort().reverse(); // desc

    // Build entries with QoQ delta against the immediate-prior quarter, if
    // present in the same response. We deliberately do NOT chase quarters
    // that don't exist in the captured set — if the prior quarter has no
    // data, both delta fields are null so the UI renders "—".
    const out = sortedQids.map((qid, i) => {
      const rep = byQuarter.get(qid);
      const prior = i + 1 < sortedQids.length ? byQuarter.get(sortedQids[i + 1]) : null;
      const [yStr, qStr] = qid.split('-Q');
      const range = quarterRange(parseInt(yStr, 10), parseInt(qStr, 10));

      let qoq_ipv4_addresses_abs = null;
      let qoq_ipv4_addresses_pct = null;
      if (prior && typeof prior.total_ipv4_addresses === 'number' && prior.total_ipv4_addresses > 0) {
        qoq_ipv4_addresses_abs = rep.total_ipv4_addresses - prior.total_ipv4_addresses;
        qoq_ipv4_addresses_pct = qoq_ipv4_addresses_abs / prior.total_ipv4_addresses;
      }

      return {
        period_id: qid,
        period_start: range.start,
        period_end: range.end,
        partial: qid === todayKey,
        representative_date: rep.snapshot_date,
        ...summarize(rep),
        qoq_ipv4_addresses_abs,
        qoq_ipv4_addresses_pct,
      };
    });

    return jsonResp({
      success: true,
      grain: 'quarterly',
      snapshots: out,
      count: out.length,
      earliest: out.length ? out[out.length - 1].period_start : null,
      latest: out.length ? out[0].period_end : null,
    });
  }

  return jsonResp({
    success: false,
    error: 'Unknown grain: ' + grain + ' (use daily | weekly | quarterly)',
  }, 400);
}

export const onRequestOptions = corsPreflight;
