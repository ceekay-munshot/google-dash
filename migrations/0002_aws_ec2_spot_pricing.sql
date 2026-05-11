-- Cloudflare D1 migration — AWS EC2 Spot Pricing time-series schema.
--
-- Completely separate from the existing aws_ec2_pricing_capture_runs /
-- aws_ec2_pricing_rows tables (which track AWS *On-Demand* list prices
-- from the Price List Bulk API). Spot is a different dataset:
--
--   - source         AWS EC2 DescribeSpotPriceHistory
--   - granularity    one row per (instance_type, AZ, product_description,
--                    timestamp) returned by the API
--   - shape          intra-day observations, not single daily snapshots
--   - history limit  AWS exposes a rolling 90-day window; we capture
--                    forward so the internal series can exceed 90 days
--
-- Two tables:
--   aws_ec2_spot_price_capture_runs — one row per capture invocation,
--                                     records the time-window queried.
--   aws_ec2_spot_price_rows         — raw per-observation rows, source
--                                     of truth for series / discounts.

CREATE TABLE IF NOT EXISTS aws_ec2_spot_price_capture_runs (
  id                          TEXT PRIMARY KEY,
  captured_at_utc             TEXT NOT NULL,
  source_window_start_utc     TEXT NOT NULL,
  source_window_end_utc       TEXT NOT NULL,
  region_code                 TEXT NOT NULL,
  product_description         TEXT NOT NULL,
  instance_scope              TEXT,
  row_count                   INTEGER NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'in_progress',
  error                       TEXT,
  source                      TEXT NOT NULL DEFAULT 'aws_describe_spot_price_history',
  created_at                  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spot_runs_captured_at_utc
  ON aws_ec2_spot_price_capture_runs(captured_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_spot_runs_window
  ON aws_ec2_spot_price_capture_runs(source_window_end_utc DESC, source_window_start_utc);
CREATE INDEX IF NOT EXISTS idx_spot_runs_status
  ON aws_ec2_spot_price_capture_runs(status, captured_at_utc DESC);

CREATE TABLE IF NOT EXISTS aws_ec2_spot_price_rows (
  run_id                      TEXT NOT NULL REFERENCES aws_ec2_spot_price_capture_runs(id) ON DELETE CASCADE,
  observed_timestamp_utc      TEXT NOT NULL,
  region_code                 TEXT NOT NULL,
  availability_zone           TEXT,
  instance_type               TEXT NOT NULL,
  instance_family             TEXT,
  instance_size               TEXT,
  family_class                TEXT,
  product_description         TEXT NOT NULL,
  spot_price_usd              REAL NOT NULL,
  row_hash                    TEXT,
  created_at                  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Dedupe key. AWS returns the same (timestamp, AZ, instance_type,
-- product_description, price) tuple if you re-query an overlapping
-- window — we insert OR IGNORE against this index to keep the table
-- single-valued per observation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_spot_rows_dedupe
  ON aws_ec2_spot_price_rows(
    observed_timestamp_utc, region_code, availability_zone,
    instance_type, product_description, spot_price_usd
  );

CREATE INDEX IF NOT EXISTS idx_spot_rows_observed_ts
  ON aws_ec2_spot_price_rows(observed_timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_spot_rows_instance
  ON aws_ec2_spot_price_rows(instance_type, observed_timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_spot_rows_family
  ON aws_ec2_spot_price_rows(instance_family, observed_timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_spot_rows_family_class
  ON aws_ec2_spot_price_rows(family_class, observed_timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_spot_rows_az
  ON aws_ec2_spot_price_rows(availability_zone, observed_timestamp_utc DESC);
CREATE INDEX IF NOT EXISTS idx_spot_rows_run
  ON aws_ec2_spot_price_rows(run_id);
