-- FR-ADMIN-002 §1 #8 — B2B subscriptions + tier management.
-- Idempotent: safe to re-run via apps/api/scripts/migrate.mjs.
-- Note: This table is pre-populated by external billing system (Stripe webhook).
-- FR-ADMIN-002 implements reads only; subscription creation deferred to FR-BILL-001.

-- @SEPARATOR
CREATE TABLE IF NOT EXISTS b2b_subscriptions (
  subscription_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id               TEXT        NOT NULL UNIQUE,  -- Shopee shop ID or internal seller ID
  user_id                 TEXT        NOT NULL,         -- JWT sub claim, links to seller
  tier                    TEXT        NOT NULL DEFAULT 'starter'
                          CHECK (tier IN ('starter', 'growth', 'enterprise')),
  monthly_product_limit   INTEGER     NOT NULL,         -- 10 | 50 | 200
  monthly_api_calls       INTEGER     NOT NULL,         -- 5000 | 50000 | 500000
  billing_email           TEXT        NOT NULL,         -- For digest + unsubscribe
  billing_period          TEXT        NOT NULL DEFAULT 'monthly'
                          CHECK (billing_period IN ('monthly', 'annual')),
  status                  TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'cancelled', 'overdue')),
  external_customer_id    TEXT,                         -- Stripe customer ID
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewal_at              TIMESTAMPTZ NOT NULL,         -- Next billing date
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- @SEPARATOR
CREATE INDEX idx_b2b_subscriptions_user_id ON b2b_subscriptions (user_id);
CREATE INDEX idx_b2b_subscriptions_status ON b2b_subscriptions (status);
CREATE INDEX idx_b2b_subscriptions_renewal_at ON b2b_subscriptions (renewal_at);

-- @SEPARATOR
-- B2B API usage tracking (for quota enforcement).
CREATE TABLE IF NOT EXISTS b2b_api_usage (
  usage_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  UUID        NOT NULL REFERENCES b2b_subscriptions (subscription_id) ON DELETE CASCADE,
  user_id          TEXT        NOT NULL,
  action           TEXT        NOT NULL
                   CHECK (action IN ('api_search', 'api_history', 'api_analytics', 'page_view_dashboard')),
  product_id       TEXT,
  request_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash          TEXT,
  user_agent_hash  TEXT
);

-- @SEPARATOR
CREATE INDEX idx_b2b_api_usage_subscription ON b2b_api_usage (subscription_id, request_at DESC);
CREATE INDEX idx_b2b_api_usage_user ON b2b_api_usage (user_id, request_at DESC);

-- @SEPARATOR
-- B2B audit log for PDPL compliance (Article 25 — access audit trail).
-- Retention: 3 years for active subscription, 1 year post-churn.
CREATE TABLE IF NOT EXISTS b2b_audit_log (
  audit_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  UUID        NOT NULL REFERENCES b2b_subscriptions (subscription_id) ON DELETE SET NULL,
  seller_id        TEXT        NOT NULL,
  user_id          TEXT        NOT NULL,
  action           TEXT        NOT NULL,
  product_id       TEXT,
  request_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash          TEXT,
  user_agent_hash  TEXT,
  details          JSONB
);

-- @SEPARATOR
CREATE INDEX idx_b2b_audit_log_seller ON b2b_audit_log (seller_id, request_at DESC);
CREATE INDEX idx_b2b_audit_log_action ON b2b_audit_log (action, request_at DESC);

-- @SEPARATOR
-- Continuous aggregate for 4-hour history buckets (for 30d queries).
CREATE MATERIALIZED VIEW IF NOT EXISTS price_history_4h_agg
  WITH (timescaledb.continuous) AS
SELECT
  product_id,
  time_bucket(INTERVAL '4 hours', observed_at) AS bucket,
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
  'price_history_4h_agg',
  start_offset       => INTERVAL '2 days',
  end_offset         => INTERVAL '1 hour',
  schedule_interval  => INTERVAL '1 hour',
  if_not_exists      => TRUE
);

-- @SEPARATOR
SELECT add_retention_policy('price_history_4h_agg', INTERVAL '90 days', if_not_exists => TRUE);

-- @SEPARATOR
-- Continuous aggregate for daily history buckets (for 90d queries).
CREATE MATERIALIZED VIEW IF NOT EXISTS price_history_1d_agg
  WITH (timescaledb.continuous) AS
SELECT
  product_id,
  time_bucket(INTERVAL '1 day', observed_at) AS bucket,
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
  'price_history_1d_agg',
  start_offset       => INTERVAL '8 days',
  end_offset         => INTERVAL '6 hours',
  schedule_interval  => INTERVAL '6 hours',
  if_not_exists      => TRUE
);

-- @SEPARATOR
SELECT add_retention_policy('price_history_1d_agg', INTERVAL '90 days', if_not_exists => TRUE);

-- @SEPARATOR
-- Function to calculate price volatility (coefficient of variation).
CREATE OR REPLACE FUNCTION calculate_price_volatility(
  p_product_id TEXT,
  p_range_days INTEGER
)
RETURNS NUMERIC AS $$
DECLARE
  v_avg_price NUMERIC;
  v_stddev NUMERIC;
  v_cv NUMERIC;
BEGIN
  SELECT AVG(avg_price), STDDEV_POP(avg_price)
    INTO v_avg_price, v_stddev
  FROM price_history_30min_agg
  WHERE product_id = p_product_id
    AND bucket > NOW() - (p_range_days || ' days')::INTERVAL;

  IF v_avg_price IS NULL OR v_avg_price = 0 THEN
    RETURN 0;
  END IF;

  v_cv := COALESCE(v_stddev, 0) / v_avg_price;
  RETURN LEAST(v_cv::NUMERIC, 1.0);  -- Cap at 1.0
END;
$$ LANGUAGE plpgsql IMMUTABLE;
