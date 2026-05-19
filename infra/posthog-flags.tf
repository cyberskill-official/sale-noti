resource "posthog_feature_flag" "freemium_pricing_v1" {
  key    = "freemium_pricing_v1"
  name   = "Freemium pricing v1"
  active = false
}

resource "posthog_feature_flag" "pro_tier_visible" {
  key    = "pro_tier_visible"
  name   = "Pro tier visible"
  active = false
}

resource "posthog_feature_flag" "mega_sale_mode_2026_11_11" {
  key    = "mega_sale_mode_2026_11_11"
  name   = "Mega Sale mode 2026-11-11"
  active = false
}

resource "posthog_feature_flag" "bullmq_adaptive_scheduler_v2" {
  key    = "bullmq_adaptive_scheduler_v2"
  name   = "BullMQ adaptive scheduler v2"
  active = false
}
