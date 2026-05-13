-- Cloudflare D1 migration — UBS Evidence Lab dataset snapshots.
--
-- Generic long-table for any UBS-published time-series we capture into
-- this Pages project. Keyed by (dataset_key, snapshot_date) with up to
-- two pivotable dimension columns so a single table can hold AI-model,
-- GPU-pricing, distributor-inventory, and data-center-registry series
-- without separate schemas per dataset. The full raw observation is
-- preserved in raw_json so we can re-derive metrics if the parser
-- mapping changes.
--
-- Idempotent: every CREATE uses IF NOT EXISTS so the migration can be
-- re-applied safely (matches the convention used by 0001/0002).
--
-- NOTE on D1 placement: this migrations/ directory is currently bound
-- to the EC2_PRICING_DB database in wrangler.toml. That means
-- ubs_dataset_snapshots will live alongside the EC2 pricing tables in
-- the gdash-aws-ec2-pricing D1 until a dedicated UBS_DB binding is
-- added. The table is independent of every existing table and uses a
-- distinct name, so the placement is safe but cross-domain — it is a
-- candidate to move into its own D1 once UBS volume is understood.

CREATE TABLE IF NOT EXISTS ubs_dataset_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_key     TEXT NOT NULL,
  ubs_dataset_id  TEXT NOT NULL,
  snapshot_date   TEXT NOT NULL,
  period          TEXT,
  dimension_1     TEXT,
  dimension_2     TEXT,
  metric_name     TEXT NOT NULL,
  metric_value    REAL,
  unit            TEXT,
  raw_json        TEXT,
  source          TEXT NOT NULL DEFAULT 'UBS Evidence Lab',
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ubs_snapshots_dataset_date
  ON ubs_dataset_snapshots(dataset_key, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_ubs_snapshots_dataset_metric_dim1_date
  ON ubs_dataset_snapshots(dataset_key, metric_name, dimension_1, snapshot_date DESC);
