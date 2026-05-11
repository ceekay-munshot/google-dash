// Shared helpers for the /api/aws/ec2-pricing/spot/* endpoints.
//
// jsonResp / corsPreflight are reused from ../_d1-chunk.js so spot
// responses share the on-demand CORS surface exactly.
//
// insertSpotRowsChunked uses INSERT OR IGNORE against the unique dedupe
// index (observed_timestamp_utc, region_code, availability_zone,
// instance_type, product_description, spot_price_usd) so re-sending the
// same window is naturally idempotent.

export { jsonResp, corsPreflight } from '../_d1-chunk.js';

// One spot row has 11 bound params (created_at is defaulted in SQL).
// D1 hard limit: ≤100 bound params per statement.
//   9 rows × 11 cols = 99 bound params per statement (1-param margin)
//   20 stmts per batch = 180 rows per batch
export const SPOT_COLS = [
  'run_id',
  'observed_timestamp_utc',
  'region_code',
  'availability_zone',
  'instance_type',
  'instance_family',
  'instance_size',
  'family_class',
  'product_description',
  'spot_price_usd',
  'row_hash',
];

const ROWS_PER_STMT   = 9;
const STMTS_PER_BATCH = 20;

export async function insertSpotRowsChunked(db, rows) {
  let attempted = 0;
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT * STMTS_PER_BATCH) {
    const slice = rows.slice(i, i + ROWS_PER_STMT * STMTS_PER_BATCH);
    const stmts = [];
    for (let j = 0; j < slice.length; j += ROWS_PER_STMT) {
      const chunk = slice.slice(j, j + ROWS_PER_STMT);
      const placeholders = chunk.map(() => '(' + SPOT_COLS.map(() => '?').join(',') + ')').join(',');
      const sql = `INSERT OR IGNORE INTO aws_ec2_spot_price_rows (${SPOT_COLS.join(',')}) VALUES ${placeholders}`;
      const params = chunk.flatMap(r => SPOT_COLS.map(c => r[c] ?? null));
      stmts.push(db.prepare(sql).bind(...params));
    }
    await db.batch(stmts);
    attempted += slice.length;
  }
  return attempted;
}

// Probe sqlite_master so endpoints can return an honest "schema not yet
// migrated" state when the spot tables haven't been created on this D1
// instance — useful for the first production deploy before the migration
// is run.
export async function spotTablesReady(db) {
  try {
    const r = await db.prepare(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name IN ('aws_ec2_spot_price_capture_runs','aws_ec2_spot_price_rows')`,
    ).first();
    return (r?.c ?? 0) >= 2;
  } catch (_) {
    return false;
  }
}

// percentile of a sorted numeric array. linear interpolation between
// adjacent ranks. p is 0..1.
export function percentile(sortedArr, p) {
  if (!sortedArr.length) return null;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = (sortedArr.length - 1) * p;
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  const frac = idx - lo;
  return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
}

// Bearer / x-history-capture-secret / ?key= → first non-empty wins.
// Mirrors the on-demand capture auth pattern.
export function extractProvidedSecret(request, url) {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = request.headers.get('x-history-capture-secret') || '';
  const querySecret  = url.searchParams.get('key') || '';
  return bearer || headerSecret || querySecret || '';
}
