-- Cloudflare D1 migration — AWS EC2 pricing time-series schema.
--
-- Two tables:
--   aws_ec2_pricing_capture_runs — one row per successful capture run,
--                                  uniqueness keyed on (captured_date_et, source).
--   aws_ec2_pricing_rows         — raw per-instance price rows; source of
--                                  truth for all aggregates (latest, WTD/MTD/QTD,
--                                  weekly/monthly/quarterly series).
--
-- Two `source` values exist: 'aws_bulk_pricelist_current' (forward daily
-- captures from the live CSV) and 'aws_bulk_pricelist_historical' (monthly
-- backfill from AWS's versionIndexUrl, May 2018+). Both can co-exist on
-- the same captured_date_et (rare but legitimate); read endpoints break
-- ties via LATEST_RUN_ORDER (current beats historical, then captured_at_utc desc).

CREATE TABLE IF NOT EXISTS aws_ec2_pricing_capture_runs (
  id                          TEXT PRIMARY KEY,
  captured_at_utc             TEXT NOT NULL,
  captured_date_et            TEXT NOT NULL,
  captured_time_et            TEXT,
  source                      TEXT NOT NULL,
  source_url                  TEXT NOT NULL,
  source_publication_date     TEXT,
  source_version_id           TEXT,
  row_hash_summary            TEXT,
  changed_vs_prior_capture    INTEGER,
  region_code                 TEXT NOT NULL DEFAULT 'us-east-1',
  region_label                TEXT NOT NULL DEFAULT 'US East (N. Virginia)',
  operating_system            TEXT NOT NULL DEFAULT 'Linux',
  tenancy                     TEXT NOT NULL DEFAULT 'Shared',
  license_model               TEXT NOT NULL DEFAULT 'No License required',
  row_count                   INTEGER NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'in_progress',
  error                       TEXT,
  created_at                  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_date_source
  ON aws_ec2_pricing_capture_runs(captured_date_et, source);
CREATE INDEX IF NOT EXISTS idx_runs_captured_at_utc
  ON aws_ec2_pricing_capture_runs(captured_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_runs_captured_date_et
  ON aws_ec2_pricing_capture_runs(captured_date_et DESC);
CREATE INDEX IF NOT EXISTS idx_runs_source_version
  ON aws_ec2_pricing_capture_runs(source_version_id, captured_date_et DESC);

CREATE TABLE IF NOT EXISTS aws_ec2_pricing_rows (
  run_id                      TEXT NOT NULL REFERENCES aws_ec2_pricing_capture_runs(id) ON DELETE CASCADE,
  captured_at_utc             TEXT NOT NULL,
  captured_date_et            TEXT NOT NULL,
  instance_type               TEXT NOT NULL,
  instance_family             TEXT NOT NULL,
  instance_size               TEXT,
  product_family              TEXT NOT NULL,
  bare_metal                  INTEGER NOT NULL DEFAULT 0,
  family_class                TEXT NOT NULL,
  price_per_hour_usd          REAL NOT NULL,
  vcpu                        REAL,
  memory_gib                  REAL,
  memory_label                TEXT,
  storage                     TEXT,
  network_performance         TEXT,
  processor_architecture      TEXT,
  current_generation          TEXT,
  row_hash                    TEXT,
  PRIMARY KEY (run_id, instance_type)
);

CREATE INDEX IF NOT EXISTS idx_rows_date_instance     ON aws_ec2_pricing_rows(captured_date_et, instance_type);
CREATE INDEX IF NOT EXISTS idx_rows_instance_date     ON aws_ec2_pricing_rows(instance_type, captured_date_et DESC);
CREATE INDEX IF NOT EXISTS idx_rows_family            ON aws_ec2_pricing_rows(instance_family, captured_date_et DESC);
CREATE INDEX IF NOT EXISTS idx_rows_family_class      ON aws_ec2_pricing_rows(family_class, captured_date_et DESC);
CREATE INDEX IF NOT EXISTS idx_rows_run               ON aws_ec2_pricing_rows(run_id);
CREATE INDEX IF NOT EXISTS idx_rows_baremetal         ON aws_ec2_pricing_rows(bare_metal, captured_date_et DESC);
CREATE INDEX IF NOT EXISTS idx_rows_captured_at_utc   ON aws_ec2_pricing_rows(captured_at_utc DESC);
