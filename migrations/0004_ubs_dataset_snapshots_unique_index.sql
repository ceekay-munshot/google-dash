-- Cloudflare D1 migration — UBS dataset snapshots dedupe key.
--
-- Adds the unique constraint that lets the capture endpoint
-- (POST /api/ubs/capture) use INSERT OR REPLACE without piling up
-- duplicate rows across repeated runs.
--
-- Dedupe shape: (dataset_key, snapshot_date, period, dimension_1,
-- dimension_2, metric_name). SQLite treats NULL as distinct in unique
-- indexes by default, so the capture handler normalises `period` and
-- `dimension_2` to empty string '' (instead of NULL) when the source
-- row doesn't supply one. dimension_1 is required by the handler
-- (rows missing both appName and aggregatorValue are skipped).
--
-- Idempotent (matches the 0001/0002/0003 convention). Re-applying
-- this migration is a no-op.
--
-- Before this index exists, the capture handler detects its absence
-- (via sqlite_master) and falls back to a scoped delete-then-insert
-- so the endpoint stays correct even pre-migration.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ubs_dataset_snapshots_unique
ON ubs_dataset_snapshots(
  dataset_key,
  snapshot_date,
  period,
  dimension_1,
  dimension_2,
  metric_name
);
