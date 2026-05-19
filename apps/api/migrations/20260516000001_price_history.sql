-- FR-PRICE-001 §3 — TimescaleDB hypertable + continuous aggregate + retention.
-- Idempotent: safe to re-run via apps/api/scripts/migrate.mjs.
-- Each block is split by -- @SEPARATOR because Timescale extension/hypertable DDL
-- cannot reliably run inside a single transaction.

-- @SEPARATOR
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- @SEPARATOR
CREATE TABLE IF NOT EXISTS price_history (
  product_id      TEXT        NOT NULL,
  shop_id         BIGINT      NOT NULL,
  region          TEXT        NOT NULL DEFAULT 'VN',
  observed_at     TIMESTAMPTZ NOT NULL,
  price           INTEGER     NOT NULL CHECK (price > 0),
  original_price  INTEGER,
  discount_pct    SMALLINT    CHECK (discount_pct BETWEEN 0 AND 100),
  stock           INTEGER     CHECK (stock >= 0),
  flash_sale      BOOLEAN     NOT NULL DEFAULT FALSE,
  source          TEXT        NOT NULL DEFAULT 'affiliate_api'
                  CHECK (source IN ('affiliate_api','extension_dom','manual','replay')),
  PRIMARY KEY (product_id, observed_at)
);

-- @SEPARATOR
SELECT create_hypertable(
  'price_history', 'observed_at',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_price_history_shop
  ON price_history (shop_id);

CREATE INDEX IF NOT EXISTS idx_price_history_region
  ON price_history (region);

CREATE INDEX IF NOT EXISTS idx_price_history_product_observed_desc
  ON price_history (product_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_history_flash_sale
  ON price_history (flash_sale, observed_at DESC) WHERE flash_sale = true;

-- @SEPARATOR
CREATE MATERIALIZED VIEW IF NOT EXISTS price_history_30min_agg
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
SELECT add_retention_policy('price_history', INTERVAL '730 days', if_not_exists => TRUE);
SELECT add_retention_policy('price_history_30min_agg', INTERVAL '90 days', if_not_exists => TRUE);

-- @SEPARATOR
CREATE OR REPLACE VIEW price_history_health AS
SELECT
  COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '1 hour') AS inserts_last_hour,
  COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '24 hours') AS inserts_last_24h,
  COUNT(DISTINCT product_id) FILTER (WHERE observed_at > NOW() - INTERVAL '24 hours') AS products_observed_24h,
  MAX(observed_at) AS latest_observation
FROM price_history;
