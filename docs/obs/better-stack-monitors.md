# Better Stack Monitors And Heartbeats

Configure monitors without credentials in URLs.

| Target | Assertion | Interval | Alert |
|---|---|---:|---|
| `https://sale.cyber.skill` | HTTP 200 | 60s | 3 failures |
| `https://sale.cyber.skill/api/health` | JSON `status == ok` | 30s | 3 failures |
| `https://api.sale.cyber.skill/health` | JSON `status == ok` | 30s | 3 failures |
| MongoDB Atlas SG | TCP/activity webhook | 60s | 3 failures |
| Upstash Redis REST | HTTP/TCP reachable | 60s | 3 failures |
| Resend domain status | verified | 5m | 3 failures |

Heartbeats:

- `cron-price-check-tier1-30m`: every 30 minutes ± 5 minutes.
- `cron-price-check-tier2-6h`: every 6 hours ± 30 minutes.
- `cron-price-check-tier3-24h`: every 24 hours ± 2 hours.
- `cron-megasale-teaser`: daily 09:00 ICT ± 30 minutes.
- `cron-grace-period-worker`: every 6 hours ± 30 minutes.
- `cron-retention-purge`: every 6 hours ± 30 minutes.
