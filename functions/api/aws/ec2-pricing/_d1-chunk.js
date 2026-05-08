// Chunked INSERT for aws_ec2_pricing_rows + canonical "latest run"
// SQL ordering used by every read endpoint.
//
// D1 hard limits:
//   - ≤100 bound parameters per prepared statement
//   - ≤100KB SQL statement size
// aws_ec2_pricing_rows has 18 columns. 5 rows per statement × 18 cols
// = 90 bound params (≤100, with a 10-param safety margin). 20 stmts
// per db.batch = 100 rows per batch. ~1,300 rows ÷ 100 = ~13 batches
// per phase=rows invocation.

export const COLS = [
  'run_id','captured_at_utc','captured_date_et','instance_type','instance_family','instance_size',
  'product_family','bare_metal','family_class','price_per_hour_usd','vcpu','memory_gib',
  'memory_label','storage','network_performance','processor_architecture','current_generation','row_hash',
];

const ROWS_PER_STMT   = 5;
const STMTS_PER_BATCH = 20;

export async function insertPricingRowsChunked(db, rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT * STMTS_PER_BATCH) {
    const slice = rows.slice(i, i + ROWS_PER_STMT * STMTS_PER_BATCH);
    const stmts = [];
    for (let j = 0; j < slice.length; j += ROWS_PER_STMT) {
      const chunk = slice.slice(j, j + ROWS_PER_STMT);
      const placeholders = chunk.map(() => '(' + COLS.map(() => '?').join(',') + ')').join(',');
      const sql = `INSERT INTO aws_ec2_pricing_rows (${COLS.join(',')}) VALUES ${placeholders}`;
      const params = chunk.flatMap(r => COLS.map(c => r[c] ?? null));
      stmts.push(db.prepare(sql).bind(...params));
    }
    await db.batch(stmts);
    inserted += slice.length;
  }
  return inserted;
}

// Canonical ordering for "latest run". Daily current beats historical
// when both exist on the same ET date; ties broken by captured_at_utc.
export const LATEST_RUN_ORDER = `
  ORDER BY captured_date_et DESC,
           CASE source
             WHEN 'aws_bulk_pricelist_current'    THEN 0
             WHEN 'aws_bulk_pricelist_historical' THEN 1
             ELSE 2
           END ASC,
           captured_at_utc DESC
`;

// SHA-256 over a canonicalized form of the rows so we can detect
// "AWS published a new version" without reading every column.
//
// Lines are sorted by instance_type, formatted as
//   ${instance_type}:${price_per_hour_usd}\n
// Web Crypto API is available in Cloudflare Workers.
export async function rowHashSummary(rows) {
  const lines = rows
    .map(r => `${r.instance_type}:${r.price_per_hour_usd}`)
    .sort()
    .join('\n');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Standard JSON response with CORS headers (mirrors the pattern in
// functions/api/aws/_ipr-utils.js so /history endpoints feel familiar).
export function jsonResp(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-history-capture-secret',
      ...extraHeaders,
    },
  });
}

export function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-history-capture-secret',
    },
  });
}
