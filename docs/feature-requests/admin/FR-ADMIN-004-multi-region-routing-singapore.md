---
id: FR-ADMIN-004
title: "Multi-region routing — MongoDB Atlas Singapore primary with geo-aware failover"
module: ADMIN
priority: MUST
status: shipped
verify: T
phase: P3
slice: 2
owner: "Senior Tech Lead"
created: 2026-05-31
last_revised: 2026-05-31
related_frs:
  - FR-ADMIN-002
  - FR-PRICE-001
  - FR-WATCH-001
  - FR-AFF-001
depends_on:
  - FR-ADMIN-002
  - FR-PRICE-001
blocks: []
effort_hours: 4
template: engineering-spec@1
new_files:
  - apps/web/src/lib/mongo-region.ts
  - apps/web/src/app/api/admin/health/db-regions/route.ts
  - apps/web/src/app/api/admin/health/__tests__/db-regions.route.spec.ts
  - docs/ops/MULTI_REGION_RUNBOOK.md
  - apps/api/src/db/mongo.multi-region.ts
  - apps/api/src/db/__tests__/mongo.multi-region.spec.ts
  - infra/mongodb-atlas-sg-cluster.tf (Terraform IaC)
modified_files:
  - apps/web/src/server/db/mongo.ts
  - apps/web/src/middleware.ts
  - apps/web/src/app/api/health/route.ts
  - apps/api/src/db/mongo.ts
  - apps/api/src/health/health.controller.ts
  - apps/mobile/src/api.ts
  - apps/mobile/App.tsx
  - .env.example
  - package.json (optional: @mongodb-js/sasl dependency verification)
allowed_tools:
  - "file_read/write apps/api/src/db/**"
  - "file_read/write infra/**"
  - "mongodb atlas CLI commands (via runbook)"
  - "bash pnpm test"
disallowed_tools:
  - "expose raw Atlas credentials in source code (use env vars only)"
  - "hard-code region URIs without env-driven configuration"
  - "write-operations to non-primary region without replication verification"
risk_if_skipped: "B2B customers in Singapore/Southeast Asia will experience 200–400ms latency on all MongoDB queries (routing through Vercel US edge → NJ Atlas cluster). Unacceptable for price-checking workflows where millisecond latency impacts perceived product performance. Multi-region failover is also a compliance gap for PDPL Art. 17/18 (data residency expectations). Without this, SaleNoti cannot confidently scale SEA B2B expansion (P3 goal: MAU 100K, ARPU $0.5)."
---

## §1 - Description (BCP-14 normative)

The multi-region routing layer SHALL provision a MongoDB Atlas cluster in the Singapore (Asia-Pacific Southeast) region as the primary write region, with read-only replicas in US-East (N. Virginia) for Vercel edge resilience, and automatic geo-aware connection routing that sends API requests to the closest region based on deployment context (Vercel region, Mobile app region, or user inferred IP).

1. The system MUST provision a MongoDB Atlas M10 (or higher) cluster in the `Asia Pacific (Singapore)` region with:
   - **Cluster name:** `salenoti-sg-primary` (short identifier, no "prod" or "staging" in name; env separation happens at database level)
   - **Replication:** 3-node replica set (1 primary in SG, 2 secondary nodes — one in SG, one in US-East for failover diversity)
   - **Sharding:** disabled initially (shard when single node > 10 GB sustained)
   - **Backup:** continuous snapshots to both SG region and US region (geo-redundant)
   - **IP Allowlist:** Vercel IPs (32.x.x.x/0, managed via `vercel env list` or fixed allowlist per Vercel docs), Render/Railway deployment IPs, mobile app client IPs (all or whitelist by region)
   - **Connection string:** `mongodb+srv://salenoti:<password>@salenoti-sg-primary.xvxyz.mongodb.net/?replicaSet=rs0&retryWrites=true&w=majority&readPreference=primaryPreferred`

2. The system MUST detect and route connections based on deployment context:
   - **Vercel Web (Next.js `/app` dir):** use primary SG connection string if request origin is `x-forwarded-for` header in `SG | MY | TH | PH | VN | ID | KH` IP ranges (GeoIP lookup via Vercel headers `x-vercel-ip-country`); fall back to US primary for non-SEA regions
   - **Mobile app (React Native + Expo):** use SG connection string if device `Locale` is `vi_VN | th_TH | fil_PH | id_ID | ms_MY | km_KH`; else use US primary
   - **API backend (NestJS `apps/api`):** always use SG primary (backend is region-agnostic, serves all users)
   - **Migration runner (scripts/migrate.mjs):** always use SG primary (single source of truth)

3. The system MUST implement connection pooling with region-aware retry logic:
   - **Pool size:** 50 connections per region (configurable via `MONGO_POOL_SIZE` env var)
   - **Retry policy:** exponential backoff (100ms, 500ms, 2s, 10s) up to 3 retries on `ECONNREFUSED`, `ERESET`, `ENOTFOUND`
   - **Timeout:** 5s per query (user-facing), 30s per batch migration
   - **Failover:** if SG primary is unhealthy (no response in 5s), automatically route writes to US-East secondary (read-only on SG secondary during this time); emit PostHog `db_failover_triggered` event with timestamp and reason

4. The system MUST configure read preference based on operation type:
   - **Writes (product inserts, price updates, alert configs):** `w: "majority"` + `journal: true` (wait for majority replica ack + journaled to disk before returning)
   - **Reads (dashboard searches, history queries):** `readPreference: "primaryPreferred"` (read from SG primary if available, fall back to secondary)
   - **Analytics reads (B2B aggregate queries):** `readPreference: "secondary"` (offload to US-East secondary to reduce primary load)

5. The system MUST expose configuration via environment variables:
   - `MONGO_URI_SG`: connection string for Singapore primary (username/password via `MONGO_USER` + `MONGO_PASSWORD` env vars, or Atlas connection string directly)
   - `MONGO_URI_US`: connection string for US-East secondary (for explicit regional routing or failover testing)
   - `MONGO_POOL_SIZE`: max connections per region (default 50)
   - `MONGO_MAX_POOL_SIZE_MB`: memory limit for all pools (default 128 MB)
   - `MONGO_DEBUG`: boolean to enable connection logs (default false; set true for runbook troubleshooting)
   - `.env.example` MUST document all vars with sample values (e.g., `MONGO_URI_SG=mongodb+srv://salenoti:...@salenoti-sg-primary.xvxyz.mongodb.net/?replicaSet=rs0`)

6. The system MUST implement a health check endpoint `GET /api/admin/health/db-regions` returning:
   - `{ sg: { connected: bool, latency_ms: number, replica_lag_seconds: number }, us: { connected: bool, latency_ms: number } }`
   - Latency measured via `db.adminCommand({ ping: 1 })` round-trip time
   - Replica lag queried from `rs.status()` secondary node in SG replica set
   - Used by monitoring (Sentry, PostHog, Better Stack) to alert on region degradation

7. The system MUST document the multi-region topology in `docs/ops/MULTI_REGION_RUNBOOK.md` with:
   - **Architecture diagram:** SG primary (write) ↔ US secondary (read) + backup topology
   - **Failover procedure:** manual steps to promote US secondary to primary if SG is unreachable (includes DNS cutover, replica set reconfiguration, verification steps)
   - **Restore from backup:** how to restore from geo-redundant snapshot
   - **Connection string rotation:** how to roll new credentials in .env without downtime (use Vercel env update)
   - **Monitoring checklist:** which PostHog/Sentry events to watch, thresholds for alerting

8. The system MUST wire Terraform IaC in `infra/mongodb-atlas-sg-cluster.tf` to:
   - Define the MongoDB Atlas cluster resource (`mongodbatlas_cluster`) with SG region, M10 tier, 3-node replica set
   - Define the IP allowlist entry (`mongodbatlas_project_ip_access_list`) with Vercel IPs + developer IPs
   - Define backup policy (continuous snapshots, 30-day retention)
   - Output: cluster name, connection string (non-secret), replica set name
   - **Sensitive data handling:** use Terraform sensitive variable `mongo_atlas_api_key` and `mongo_atlas_org_id` (injected via Doppler or GitHub Actions secrets) to authenticate Atlas API calls without exposing keys in `.tf` files

9. The system MUST pass unit tests in `apps/api/src/db/__tests__/mongo.multi-region.spec.ts` validating:
   - ✅ Connection pooling logic (max connections enforced per region)
   - ✅ Retry logic (exponential backoff fires on transient errors, succeeds after 2–3 retries)
   - ✅ Read preference selection (writes use w="majority", reads use primaryPreferred or secondary based on op type)
   - ✅ Failover trigger (SG primary timeout → route to US secondary, emit event)
   - ✅ Health check endpoint (returns both regions' status, calculates latency)
   - ✅ Configuration loading (env vars parsed correctly, defaults applied if missing)
   - ✅ Geography detection (Vercel header `x-vercel-ip-country` → SG URI, non-SEA → US URI, mobile Locale → region routing)

10. The system SHOULD document migration strategy for existing data (if any in US cluster):
    - **Option A (recommended for P3):** Use MongoDB Atlas online migration tool to replicate US data to SG cluster, then cut over to SG primary (zero-downtime)
    - **Option B:** Export data via MongoDB Compass or `mongodump`, import to SG cluster, verify integrity, cut over (scheduled downtime ~30 min if data > 1 GB)
    - **Cutover validation:** run smoke tests on new cluster (search 10 products, fetch price history, verify KPI calculations match old cluster ±1% for floating-point ops)

---

## §2 - Rationale

**Why Singapore primary now?** SaleNoti's P3 expansion target is SEA B2B customers (Malaysia, Thailand, Philippines, Vietnam). Latency from Vercel US edge to NJ MongoDB is ~200–400ms round-trip; from Vercel SG edge to SG MongoDB is ~50–100ms. For price-checking workflows (10–20 DB queries per page load), this delta compounds: 300ms × 15 queries = 4.5s wasted latency per user interaction. **ARPU sensitivity:** B2B customers will not tolerate sluggish dashboards at $500–2000/mo subscription. Regional colocation is table-stakes for SaaS.

**Why 3-node replica set with US secondary?** MongoDB best practice is odd number of nodes (3 or 5) for quorum integrity. US secondary ensures:
- Failover quorum if SG primary goes offline (can promote SG secondary + US secondary to majority without SG primary)
- Geographic diversity (not all eggs in one data center)
- Reduced latency for Vercel US edge users (can read from US secondary; writes still go to SG primary)

**Why terraform IaC?** Infrastructure as code ensures reproducibility (spin up new cluster with `terraform apply`), auditability (diffs track config changes), and integration with CI/CD (automatic cluster provisioning on PR merges to ops branches).

---

## §3 - Contract (API / Data format)

### §3.1 - Configuration loading

```typescript
// apps/api/src/db/mongo.multi-region.ts
interface MongoRegionConfig {
  sg: {
    uri: string; // from MONGO_URI_SG
    poolSize: number; // from MONGO_POOL_SIZE, default 50
  };
  us: {
    uri: string; // from MONGO_URI_US
    poolSize: number;
  };
  debug: boolean; // from MONGO_DEBUG
  retryPolicy: {
    maxRetries: number; // 3
    backoffMultiplier: number; // 2 (100ms → 500ms → 2s → 10s)
    initialDelayMs: number; // 100
  };
}

export async function initializeMongoRegions(
  config: Partial<MongoRegionConfig> = {}
): Promise<{ sgClient: MongoClient; usClient: MongoClient }> {
  // Load env vars, merge with config, validate
  // Create connection pools for both regions
  // Return clients ready for use
}
```

### §3.2 - Region detection

```typescript
// Vercel Next.js middleware
export function getMongoRegionFromContext(context: {
  geolocation?: { country: string }; // from x-vercel-ip-country
  deploymentRegion?: string; // from x-vercel-deployment-region
}): "sg" | "us" {
  // If x-vercel-ip-country is SG|MY|TH|PH|VN|ID|KH → "sg"
  // Else → "us"
  // Default: "us" if missing
}

// React Native Expo
export function getMongoRegionFromDevice(locale: string): "sg" | "us" {
  // If Locale includes vi_VN|th_TH|fil_PH|id_ID|ms_MY|km_KH → "sg"
  // Else → "us"
}
```

### §3.3 - Health check response

```json
GET /api/admin/health/db-regions
200 OK
{
  "sg": {
    "connected": true,
    "latency_ms": 45,
    "replica_lag_seconds": 0.5,
    "status": "primary"
  },
  "us": {
    "connected": true,
    "latency_ms": 120,
    "replica_lag_seconds": 12,
    "status": "secondary"
  },
  "timestamp": "2026-05-31T09:30:00Z"
}
```

---

## §4 - Acceptance criteria

- ✅ MongoDB Atlas cluster `salenoti-sg-primary` provisioned in Singapore with 3-node replica set (1 SG primary, 1 SG secondary, 1 US secondary)
- ✅ Connection pooling logic implemented: max 50 connections per region, configurable via `MONGO_POOL_SIZE`
- ✅ Retry logic with exponential backoff: 100ms → 500ms → 2s → 10s (3 retries max)
- ✅ Read preference: writes use `w="majority"`, reads use `primaryPreferred`, analytics use `secondary`
- ✅ Failover detection: SG primary timeout triggers automatic route to US secondary, emits PostHog event
- ✅ Health check endpoint: `GET /api/admin/health/db-regions` returns both regions' latency + replica lag
- ✅ Environment variables: `MONGO_URI_SG`, `MONGO_URI_US`, `MONGO_POOL_SIZE`, `MONGO_DEBUG` documented in `.env.example`
- ✅ Region detection: Vercel middleware routes based on `x-vercel-ip-country`, mobile app routes based on device `Locale`
- ✅ Terraform IaC: `infra/mongodb-atlas-sg-cluster.tf` defines cluster, IP allowlist, backup policy
- ✅ Unit tests: 9+ test cases (pooling, retry, read preference, failover, health check, config loading, geo detection) all passing
- ✅ Integration tests (optional): smoke test on new SG cluster (search products, fetch history, validate KPIs match old cluster)
- ✅ Documentation: `docs/ops/MULTI_REGION_RUNBOOK.md` includes architecture diagram, failover procedures, restore steps, monitoring checklist

---

## §5 - Verification / Testing

### §5.1 - Unit tests (`apps/api/src/db/__tests__/mongo.multi-region.spec.ts`)

```typescript
describe("MongoRegions", () => {
  describe("Connection pooling", () => {
    it("respects MONGO_POOL_SIZE limit per region");
    it("reuses pooled connections for subsequent queries");
    it("closes idle connections after configurable TTL");
  });

  describe("Retry logic", () => {
    it("retries on ECONNREFUSED with exponential backoff");
    it("succeeds after 2–3 retries on transient error");
    it("gives up after max retries, throws error");
    it("emits PostHog event with retry count on success");
  });

  describe("Read preference", () => {
    it("sends writes with w='majority' to SG primary");
    it("sends normal reads with readPreference=primaryPreferred");
    it("sends analytics reads with readPreference=secondary");
  });

  describe("Failover", () => {
    it("detects SG primary timeout (5s), routes write to US secondary");
    it("emits PostHog db_failover_triggered event");
    it("recovers and routes back to SG primary when healthy");
  });

  describe("Health check", () => {
    it("calculates latency via db.adminCommand({ ping: 1 })");
    it("queries rs.status() for replica lag on secondaries");
    it("returns both regions' status in response");
  });

  describe("Configuration", () => {
    it("loads MONGO_URI_SG and MONGO_URI_US from env");
    it("applies defaults: MONGO_POOL_SIZE=50, MONGO_DEBUG=false");
    it("validates connection strings on init");
  });

  describe("Region detection", () => {
    it("Vercel middleware: x-vercel-ip-country=SG → sg URI");
    it("Vercel middleware: x-vercel-ip-country=US → us URI");
    it("Mobile app: locale=vi_VN → sg URI");
    it("Mobile app: locale=en_US → us URI");
  });
});
```

### §5.2 - Integration checklist (manual or CI)

- [ ] Provision SG cluster via `terraform apply infra/mongodb-atlas-sg-cluster.tf` (or verify manually in Atlas console)
- [ ] Update `.env` with `MONGO_URI_SG`, `MONGO_URI_US` connection strings
- [ ] Run `pnpm test` in `apps/api` — all tests pass
- [ ] Deploy to Vercel staging (`git push origin feature/fr-admin-004`)
- [ ] Hit `/api/admin/health/db-regions` from SG IP (VPN to SGP) — should show `sg.latency_ms < 100`
- [ ] Hit `/api/admin/health/db-regions` from US IP — should show `us.latency_ms < 100`
- [ ] Search a product via `/api/admin/products/search` from SG edge — verify response time < 200ms
- [ ] Kill SG replica set primary (chaos test) — verify failover to US secondary within 5s, system stays up
- [ ] Restore SG primary — verify automatic route-back to SG

---

## §6 - Implementation skeleton

### Step 1: Environment setup (30 min)

```bash
# Add to .env.example
MONGO_URI_SG=mongodb+srv://salenoti:***@salenoti-sg-primary.xvxyz.mongodb.net/?replicaSet=rs0&retryWrites=true&w=majority
MONGO_URI_US=mongodb+srv://salenoti:***@salenoti-us-east.xvxyz.mongodb.net/?replicaSet=rs0&retryWrites=true&w=primaryPreferred
MONGO_POOL_SIZE=50
MONGO_DEBUG=false
```

### Step 2: Multi-region client factory (1 h)

Create `apps/api/src/db/mongo.multi-region.ts`:
- `initializeMongoRegions(config)` → { sgClient, usClient }
- `getMongoRegionFromContext(context)` → "sg" | "us"
- Connection pooling with configurable limits
- Retry logic with exponential backoff
- Read preference selection based on operation type

### Step 3: Failover + health check (1 h)

- Implement failover detection (5s timeout → emit event, switch route)
- Health check endpoint `GET /api/admin/health/db-regions`
- PostHog integration (`db_failover_triggered`, `db_region_latency`)

### Step 4: Unit tests (45 min)

Write 9+ test cases covering pooling, retry, read preference, failover, health check, config, geo detection.

### Step 5: Terraform IaC + documentation (45 min)

- `infra/mongodb-atlas-sg-cluster.tf` — cluster, IP allowlist, backup policy
- `docs/ops/MULTI_REGION_RUNBOOK.md` — architecture, failover, restore, monitoring

---

## §7 - Dependencies

- **Depends on:** FR-ADMIN-002 (must have B2B dashboard running so we can test multi-region routing on real workload), FR-PRICE-001 (TimescaleDB baseline exists)
- **Blocks:** FR-ADMIN-003 (Coupon aggregator can assume multi-region SG primary), FR-AFF-009 (Regional expansion to TH/PH needs SG latency baseline)

---

## §8 - Examples

### Example 1: Region-aware routing in Next.js middleware

```typescript
// apps/web/src/middleware.ts
import { getMongoRegionFromContext } from "@/server/db/mongo.multi-region";

export function middleware(request: NextRequest) {
  const country = request.geo?.country;
  const region = getMongoRegionFromContext({ geolocation: { country: country || "" } });
  
  // Store in request context so API handlers can use it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-mongo-region", region);
  
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}
```

### Example 2: Health check response during failover

```json
// Before failover
GET /api/admin/health/db-regions
{
  "sg": { "connected": true, "latency_ms": 45, "replica_lag_seconds": 0, "status": "primary" },
  "us": { "connected": true, "latency_ms": 120, "replica_lag_seconds": 12, "status": "secondary" }
}

// During SG primary timeout (failover triggered)
GET /api/admin/health/db-regions
{
  "sg": { "connected": false, "latency_ms": null, "replica_lag_seconds": null, "status": "primary-down" },
  "us": { "connected": true, "latency_ms": 80, "replica_lag_seconds": 0, "status": "primary-promoted" }
}

// After recovery
GET /api/admin/health/db-regions
{
  "sg": { "connected": true, "latency_ms": 48, "replica_lag_seconds": 5, "status": "primary-recovered" },
  "us": { "connected": true, "latency_ms": 125, "replica_lag_seconds": 45, "status": "secondary" }
}
```

---

## §9 - Open questions

1. **Data migration:** Should existing MongoDB data (if any) in US cluster be migrated to SG cluster before cutover, or is this a greenfield (no legacy data)? → **Answer (pending founder input):** assume greenfield for P3; if legacy data exists, use Option A (MongoDB Atlas online migration tool) in runbook.

2. **Read-heavy analytics:** Should we offload B2B analytics queries to a dedicated read replica in a different region (e.g., Japan region for lower latency to Japan-based B2B customers in P3.2)? → **Answer (pending roadmap):** out of scope for P3.1; document as future optimization in runbook.

3. **Atlas tier:** M10 is sufficient for current data volume (~500 MB product metadata + 1–2 GB price history per month). At what data size should we upgrade to M20/M30? → **Answer:** document threshold (10 GB sustained) in runbook; set up postHog alerts to watch `mongo_db_size_bytes`.

---

## §10 - Failure modes & mitigations

| Failure | Detection | Mitigation |
|---------|-----------|-----------|
| SG primary network partition | Health check fails, API latency spikes | Failover to US secondary, emit alert |
| US secondary replication lag > 60s | Health check `replica_lag_seconds` > 60 | Alert ops team, do not route to secondary until lag < 30s |
| Connection pool exhaustion (50 connections) | `ECONNREFUSED: Max pool size reached` | Scale `MONGO_POOL_SIZE` to 100, deploy new version |
| Backup restore fails | Restore job logs show error | Manual recovery from previous snapshot + replay transaction log (runbook step 4) |
| Incorrect IP allowlist | `ECONNREFUSED: not allowed` on new deployment | Update `mongodbatlas_project_ip_access_list` in Terraform, run `terraform apply` |

---

## §11 - Notes

- **Cost:** MongoDB Atlas M10 SG + US secondary + geo-redundant backups ≈ $150–200/month. Budget-conscious option: downgrade to M5 ($57/mo each region) for staging/QA; keep M10 for production.
- **Monitoring:** Enable MongoDB Atlas alerts for replica lag, connection pool usage, disk space. Integrate with Sentry + PostHog dashboards.
- **Compliance:** PDPL Art. 17 (data localization) — SG primary satisfies "personal data must reside in Vietnam or approved regional hub." Verify with legal before production.

---

_FR-ADMIN-004 shipped after audit round 4. Status: draft → audited → accepted → building → shipped._
