/**
 * Cloudflare Pages Function — AWS Public Network Capacity Proxy: history
 * Route: GET /api/aws/ip-ranges/history?grain=daily|quarterly
 *
 * Reads the daily-snapshot index from KV and returns either:
 *   - daily      — every captured snapshot, newest first (capped by ?range=N).
 *   - quarterly  — one representative snapshot per calendar quarter, using
 *                  the LATEST captured snapshot in that quarter. QoQ deltas
 *                  on total_ipv4_addresses are computed against the
 *                  immediately-prior quarter's representative; the absolute
 *                  number is primary, the percentage is secondary. If there
 *                  is no prior quarter, both delta fields are null and the
 *                  UI is expected to render "—".
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
      count: 0,
      message: 'No AWS IP-range history yet. Hit /api/aws/ip-ranges/capture to create the first snapshot.',
    });
  }

  // Index is sorted desc by date. For both grains we scan a wide window so
  // quarterly groupings stay meaningful even when ?range is small.
  const scanWindow = grain === 'daily' ? range : Math.min(index.length, 365);
  const dates = index.slice(0, scanWindow);
  const snapshots = (await Promise.all(
    dates.map(async (d) => kv.get(DAY_PREFIX + d, 'json'))
  )).filter(Boolean);

  // ── Daily grain ──
  if (grain === 'daily') {
    const out = snapshots.slice(0, range).map(summarize);
    return jsonResp({
      success: true,
      grain: 'daily',
      snapshots: out,
      count: out.length,
      earliest: out.length ? out[out.length - 1].snapshot_date : null,
      latest: out.length ? out[0].snapshot_date : null,
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
    error: 'Unknown grain: ' + grain + ' (use daily | quarterly)',
  }, 400);
}

export const onRequestOptions = corsPreflight;
