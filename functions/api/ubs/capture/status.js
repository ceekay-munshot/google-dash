/**
 * Cloudflare Pages Function — UBS capture status / inspection.
 * Route: GET /api/ubs/capture/status
 *
 * No auth. Safe to open in the browser. Reads the D1
 * ubs_dataset_snapshots table from env.EC2_PRICING_DB.
 *
 * When the table is missing (i.e. migrations have not been applied to
 * this environment yet) we return ok:false, migrationMissing:true,
 * error:"migration_missing" rather than crashing with an unhandled D1
 * error. Same shape as documented in the capture spec.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

async function tableExists(db, name) {
  try {
    const r = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .bind(name).first();
    return !!r;
  } catch {
    return false;
  }
}

export async function onRequestGet({ env }) {
  if (!env?.EC2_PRICING_DB) {
    return jsonResp({
      ok: false,
      tableExists: false,
      migrationMissing: true,
      error: 'd1_binding_missing',
      detail: 'env.EC2_PRICING_DB is not bound on this environment',
    }, 500);
  }
  const db = env.EC2_PRICING_DB;

  const exists = await tableExists(db, 'ubs_dataset_snapshots');
  if (!exists) {
    return jsonResp({
      ok: false,
      tableExists: false,
      migrationMissing: true,
      error: 'migration_missing',
    });
  }

  // Single batched read — one round-trip to D1.
  const [
    totalRowsRes,
    latestCreatedRes,
    latestSnapshotRes,
    datasetKeysRes,
    metricCountsRes,
    topAppsRes,
    geoCountsRes,
    sampleLatestRes,
  ] = await db.batch([
    db.prepare('SELECT COUNT(*) AS c FROM ubs_dataset_snapshots'),
    db.prepare('SELECT MAX(created_at) AS v FROM ubs_dataset_snapshots'),
    db.prepare('SELECT MAX(snapshot_date) AS v FROM ubs_dataset_snapshots'),
    db.prepare('SELECT DISTINCT dataset_key FROM ubs_dataset_snapshots'),
    db.prepare('SELECT metric_name, COUNT(*) AS c FROM ubs_dataset_snapshots GROUP BY metric_name ORDER BY c DESC'),
    db.prepare('SELECT dimension_1 AS app, COUNT(*) AS c FROM ubs_dataset_snapshots GROUP BY dimension_1 ORDER BY c DESC LIMIT 20'),
    db.prepare('SELECT dimension_2 AS geo, COUNT(*) AS c FROM ubs_dataset_snapshots GROUP BY dimension_2 ORDER BY c DESC LIMIT 50'),
    db.prepare('SELECT id, dataset_key, snapshot_date, period, dimension_1, dimension_2, metric_name, metric_value, unit, source, created_at FROM ubs_dataset_snapshots ORDER BY created_at DESC LIMIT 10'),
  ]);

  const totalRows               = totalRowsRes?.results?.[0]?.c || 0;
  const latestCaptureCreatedAt  = latestCreatedRes?.results?.[0]?.v || null;
  const latestSnapshotDate      = latestSnapshotRes?.results?.[0]?.v || null;
  const datasetKeys             = (datasetKeysRes?.results || []).map((r) => r.dataset_key);
  const rowsByMetric            = Object.fromEntries((metricCountsRes?.results || []).map((r) => [r.metric_name, r.c]));
  const rowsByAppTop20          = Object.fromEntries((topAppsRes?.results || []).map((r) => [r.app == null || r.app === '' ? '(empty)' : r.app, r.c]));
  const rowsByGeography         = Object.fromEntries((geoCountsRes?.results || []).map((r) => [r.geo == null || r.geo === '' ? '(empty)' : r.geo, r.c]));
  const sampleLatestRows        = sampleLatestRes?.results || [];

  return jsonResp({
    ok: true,
    tableExists: true,
    migrationMissing: false,
    latestCaptureCreatedAt,
    latestSnapshotDate,
    datasetKeys,
    totalRows,
    rowsByMetric,
    rowsByAppTop20,
    rowsByGeography,
    sampleLatestRows,
  });
}
