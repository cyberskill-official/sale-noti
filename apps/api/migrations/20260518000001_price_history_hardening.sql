-- FR-PRICE-001 hardening migration for environments that already applied the
-- original MVP migration before the strict audit.

-- @SEPARATOR
ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS flash_sale BOOLEAN NOT NULL DEFAULT FALSE;

-- @SEPARATOR
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_history_discount_pct_check'
      AND conrelid = 'price_history'::regclass
  ) THEN
    ALTER TABLE price_history
      ADD CONSTRAINT price_history_discount_pct_check CHECK (discount_pct BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_history_stock_check'
      AND conrelid = 'price_history'::regclass
  ) THEN
    ALTER TABLE price_history
      ADD CONSTRAINT price_history_stock_check CHECK (stock >= 0);
  END IF;
END $$;

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_price_history_flash_sale
  ON price_history (flash_sale, observed_at DESC) WHERE flash_sale = true;

-- @SEPARATOR
DROP MATERIALIZED VIEW IF EXISTS price_history_30min_agg CASCADE;

CREATE MATERIALIZED VIEW price_history_30min_agg
  WITH (timescaledb.continuous) AS
SELECT
  product_id,
  time_bucket(INTERVAL '30 minutes', observed_at) AS bucket,
  MIN(price)::INTEGER  AS min_price,
  MAX(price)::INTEGER  AS max_price,
  AVG(price)::INTEGER  AS avg_price,
  COUNT(*)::INTEGER    AS observation_count,
  bool_or(flash_sale)  AS any_flash_sale
FROM price_history
GROUP BY product_id, bucket
WITH NO DATA;

-- @SEPARATOR
SELECT add_continuous_aggregate_policy(
  'price_history_30min_agg',
  start_offset       => INTERVAL '1 day',
  end_offset         => INTERVAL '15 minutes',
  schedule_interval  => INTERVAL '15 minutes',
  if_not_exists      => TRUE
);

-- @SEPARATOR
SELECT add_retention_policy('price_history_30min_agg', INTERVAL '90 days', if_not_exists => TRUE);

-- @SEPARATOR
CREATE OR REPLACE VIEW price_history_health AS
SELECT
  COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '1 hour') AS inserts_last_hour,
  COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '24 hours') AS inserts_last_24h,
  COUNT(DISTINCT product_id) FILTER (WHERE observed_at > NOW() - INTERVAL '24 hours') AS products_observed_24h,
  MAX(observed_at) AS latest_observation
FROM price_history;
