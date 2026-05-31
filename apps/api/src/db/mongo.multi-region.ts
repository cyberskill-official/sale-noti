/**
 * FR-ADMIN-004: MongoDB multi-region client factory
 * Singapore primary + US secondary with geo-aware routing, connection pooling, and failover.
 */

import { MongoClient, type Db, ServerSelectionTimeoutError } from "mongodb";

export interface MongoRegionConfig {
  sg: {
    uri: string;
    poolSize: number;
  };
  us: {
    uri: string;
    poolSize: number;
  };
  debug: boolean;
  retryPolicy: {
    maxRetries: number;
    backoffMultiplier: number;
    initialDelayMs: number;
  };
  timeoutMs: number;
}

export type MongoRegion = "sg" | "us";
export type MongoOperation = "read" | "write" | "analytics";

interface RegionalClient {
  client: MongoClient;
  latencyMs: number;
  replicaLagSeconds: number | null;
  status: "primary" | "secondary" | "primary-down" | "primary-promoted";
  lastHealthCheckAt: Date;
}

declare global {
  var __salenotiMultiRegionMongo:
    | {
        sg: RegionalClient;
        us: RegionalClient;
      }
    | undefined;
}

/**
 * Load configuration from environment variables.
 */
function loadConfig(): MongoRegionConfig {
  const sgUri = process.env.MONGO_URI_SG;
  const usUri = process.env.MONGO_URI_US;

  if (!sgUri || !usUri) {
    throw new Error(
      "MONGO_URI_SG and MONGO_URI_US must be set in environment"
    );
  }

  const poolSize = parseInt(process.env.MONGO_POOL_SIZE || "50", 10);
  const debug = process.env.MONGO_DEBUG === "true";
  const maxPoolSizeMb = parseInt(process.env.MONGO_MAX_POOL_SIZE_MB || "128", 10);

  return {
    sg: { uri: sgUri, poolSize },
    us: { uri: usUri, poolSize },
    debug,
    retryPolicy: {
      maxRetries: 3,
      backoffMultiplier: 2,
      initialDelayMs: 100,
    },
    timeoutMs: 5000, // 5s per query
  };
}

/**
 * Log helper for debug output
 */
function debugLog(config: MongoRegionConfig, region: MongoRegion, msg: string) {
  if (config.debug) {
    console.log(`[MongoRegion:${region}] ${msg}`);
  }
}

/**
 * Exponential backoff retry helper
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: MongoRegionConfig,
  region: MongoRegion
): Promise<T> {
  const { maxRetries, backoffMultiplier, initialDelayMs } = config.retryPolicy;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 0) {
        debugLog(config, region, `Retry succeeded after ${attempt} attempts`);
      }
      return result;
    } catch (error) {
      lastError = error as Error;
      const isTransient =
        lastError.message.includes("ECONNREFUSED") ||
        lastError.message.includes("ERESET") ||
        lastError.message.includes("ENOTFOUND") ||
        error instanceof ServerSelectionTimeoutError;

      if (!isTransient || attempt === maxRetries) {
        throw lastError;
      }

      const delayMs = initialDelayMs * Math.pow(backoffMultiplier, attempt);
      debugLog(
        config,
        region,
        `Transient error (${lastError.message}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error("Retry exhausted");
}

/**
 * Create a regional MongoDB client with pooling and timeout.
 */
async function createRegionalClient(
  uri: string,
  poolSize: number,
  config: MongoRegionConfig,
  region: MongoRegion
): Promise<MongoClient> {
  debugLog(config, region, `Creating client with poolSize=${poolSize}`);

  const client = new MongoClient(uri, {
    maxPoolSize: poolSize,
    minPoolSize: Math.floor(poolSize * 0.2), // 20% minimum
    serverSelectionTimeoutMS: config.timeoutMs,
    connectTimeoutMS: config.timeoutMs,
    socketTimeoutMS: config.timeoutMs,
    retryWrites: true,
  });

  await retryWithBackoff(
    async () => {
      await client.connect();
      debugLog(config, region, "Connected successfully");
    },
    config,
    region
  );

  return client;
}

/**
 * Measure latency to MongoDB via ping command.
 */
async function measureLatency(client: MongoClient): Promise<number> {
  const startMs = Date.now();
  await client.db("admin").command({ ping: 1 });
  const endMs = Date.now();
  return endMs - startMs;
}

/**
 * Get replica lag from replica set status (for secondary nodes).
 */
async function getReplicaLag(client: MongoClient): Promise<number | null> {
  try {
    const status = await client.db("admin").command({ replSetGetStatus: 1 });
    const myMember = status.members.find(
      (m: any) => m._id === status.myState - 1
    );
    if (!myMember || myMember.state === 1) {
      // Primary node, no lag
      return null;
    }
    // Secondary: optimeDate - currentDate gives lag
    const optimeDate = new Date(myMember.optimeDate).getTime();
    const currentDate = new Date(myMember.lastHeartbeatRecv).getTime();
    return Math.max(0, (currentDate - optimeDate) / 1000);
  } catch {
    return null; // Unavailable
  }
}

/**
 * Initialize multi-region MongoDB clients.
 */
export async function initializeMongoRegions(
  overrideConfig?: Partial<MongoRegionConfig>
): Promise<{ sg: MongoClient; us: MongoClient }> {
  const config = { ...loadConfig(), ...overrideConfig };

  if (globalThis.__salenotiMultiRegionMongo) {
    return {
      sg: globalThis.__salenotiMultiRegionMongo.sg.client,
      us: globalThis.__salenotiMultiRegionMongo.us.client,
    };
  }

  const sgClient = await createRegionalClient(
    config.sg.uri,
    config.sg.poolSize,
    config,
    "sg"
  );
  const usClient = await createRegionalClient(
    config.us.uri,
    config.us.poolSize,
    config,
    "us"
  );

  globalThis.__salenotiMultiRegionMongo = {
    sg: {
      client: sgClient,
      latencyMs: 0,
      replicaLagSeconds: null,
      status: "primary",
      lastHealthCheckAt: new Date(),
    },
    us: {
      client: usClient,
      latencyMs: 0,
      replicaLagSeconds: null,
      status: "secondary",
      lastHealthCheckAt: new Date(),
    },
  };

  return { sg: sgClient, us: usClient };
}

/**
 * Get the appropriate region based on Vercel geolocation context.
 */
export function getMongoRegionFromVercelContext(geolocation?: {
  country?: string;
}): MongoRegion {
  if (!geolocation?.country) return "us";

  const seaCountries = ["SG", "MY", "TH", "PH", "VN", "ID", "KH"];
  return seaCountries.includes(geolocation.country) ? "sg" : "us";
}

/**
 * Get the appropriate region based on device locale.
 */
export function getMongoRegionFromDeviceLocale(locale: string): MongoRegion {
  const seaLocales = ["vi_VN", "th_TH", "fil_PH", "id_ID", "ms_MY", "km_KH"];
  return seaLocales.some((l) => locale.startsWith(l)) ? "sg" : "us";
}

export function resolveMongoDbOptions(operation: MongoOperation): {
  readPreference?: "primaryPreferred" | "secondary";
  writeConcern?: { w: "majority"; j: true };
} {
  if (operation === "write") {
    return {
      writeConcern: { w: "majority", j: true },
    };
  }

  if (operation === "analytics") {
    return {
      readPreference: "secondary",
    };
  }

  return {
    readPreference: "primaryPreferred",
  };
}

export function resolveMongoRegionForOperation(
  region: MongoRegion,
  operation: MongoOperation
): MongoRegion {
  if (operation === "write") {
    return getActivePrimaryRegion();
  }

  return region;
}

/**
 * Perform health check on both regions.
 */
export async function checkMongoRegionHealth(): Promise<{
  sg: {
    connected: boolean;
    latency_ms: number | null;
    replica_lag_seconds: number | null;
    status: string;
  };
  us: {
    connected: boolean;
    latency_ms: number | null;
    replica_lag_seconds: number | null;
    status: string;
  };
  timestamp: string;
}> {
  if (!globalThis.__salenotiMultiRegionMongo) {
    throw new Error("Mongo regions not initialized. Call initializeMongoRegions() first.");
  }

  const state = globalThis.__salenotiMultiRegionMongo;

  try {
    // Check SG
    const sgLatency = await measureLatency(state.sg.client);
    const sgReplicaLag = await getReplicaLag(state.sg.client);
    state.sg.latencyMs = sgLatency;
    state.sg.replicaLagSeconds = sgReplicaLag;
    state.sg.lastHealthCheckAt = new Date();
    state.sg.status = "primary";
  } catch (error) {
    state.sg.latencyMs = null;
    state.sg.status = "primary-down";
  }

  try {
    // Check US
    const usLatency = await measureLatency(state.us.client);
    const usReplicaLag = await getReplicaLag(state.us.client);
    state.us.latencyMs = usLatency;
    state.us.replicaLagSeconds = usReplicaLag;
    state.us.lastHealthCheckAt = new Date();
    state.us.status = "secondary";
  } catch (error) {
    state.us.latencyMs = null;
    state.us.status = "secondary-down";
  }

  // If SG is down and US is up, promote US to primary for failover
  if (state.sg.status === "primary-down" && state.us.status === "secondary") {
    state.us.status = "primary-promoted";
  }

  return {
    sg: {
      connected: state.sg.status !== "primary-down",
      latency_ms: state.sg.latencyMs,
      replica_lag_seconds: state.sg.replicaLagSeconds,
      status: state.sg.status,
    },
    us: {
      connected: state.us.status !== "secondary-down",
      latency_ms: state.us.latencyMs,
      replica_lag_seconds: state.us.replicaLagSeconds,
      status: state.us.status,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get a MongoDB database instance for a specific region.
 */
export async function getMongoDb(
  region: MongoRegion,
  dbName: string,
  operation: MongoOperation = "read"
): Promise<Db> {
  if (!globalThis.__salenotiMultiRegionMongo) {
    await initializeMongoRegions();
  }

  const state = globalThis.__salenotiMultiRegionMongo!;
  const effectiveRegion = resolveMongoRegionForOperation(region, operation);
  const client =
    effectiveRegion === "sg" ? state.sg.client : state.us.client;

  return client.db(dbName, resolveMongoDbOptions(operation));
}

export async function getMongoReadDb(
  region: MongoRegion,
  dbName: string
): Promise<Db> {
  return getMongoDb(region, dbName, "read");
}

export async function getMongoAnalyticsDb(
  region: MongoRegion,
  dbName: string
): Promise<Db> {
  return getMongoDb(region, dbName, "analytics");
}

export async function getMongoWriteDb(dbName: string): Promise<Db> {
  return getMongoDb(getActivePrimaryRegion(), dbName, "write");
}

/**
 * Close all regional clients.
 */
export async function closeMongoRegions() {
  if (globalThis.__salenotiMultiRegionMongo) {
    const { sg, us } = globalThis.__salenotiMultiRegionMongo;
    await Promise.all([sg.client.close(), us.client.close()]);
    globalThis.__salenotiMultiRegionMongo = undefined;
  }
}

/**
 * Get the active primary region (handles failover).
 */
export function getActivePrimaryRegion(): MongoRegion {
  if (!globalThis.__salenotiMultiRegionMongo) {
    return "sg"; // Default to SG
  }

  const state = globalThis.__salenotiMultiRegionMongo;

  // If SG primary is down and US is promoted to primary, return US
  if (
    state.sg.status === "primary-down" &&
    state.us.status === "primary-promoted"
  ) {
    return "us";
  }

  // Otherwise, SG is primary
  return "sg";
}
