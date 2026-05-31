// Shared Mongo client — region-aware connection pool per Node process.
// FR-AUTH-001 §1 #6 uses this for users upsert; FR-ADMIN-004 routes reads by request region.
import { headers } from "next/headers";
import { MongoClient, type ClientSession, type Db } from "mongodb";
import { getMongoRegionFromCountry, normalizeMongoRegion, type MongoRegion } from "@/lib/mongo-region";

declare global {
  var __salenotiMongoClients: Record<string, MongoClient> | undefined;
}

function hasRegionalConfig() {
  return Boolean(process.env.MONGO_URI_SG || process.env.MONGO_URI_US);
}

function getPoolSize(): number {
  const parsed = Number.parseInt(process.env.MONGO_POOL_SIZE ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return hasRegionalConfig() ? 50 : 10;
}

function getConfiguredUri(region: MongoRegion): string | null {
  if (region === "sg") {
    return process.env.MONGO_URI_SG ?? process.env.MONGODB_URI ?? null;
  }

  return process.env.MONGO_URI_US ?? null;
}

function getFallbackUri(region: MongoRegion): string {
  if (region === "sg") {
    return process.env.MONGO_URI_SG ?? process.env.MONGODB_URI ?? process.env.MONGO_URI_US ?? "";
  }

  return process.env.MONGO_URI_US ?? process.env.MONGO_URI_SG ?? process.env.MONGODB_URI ?? "";
}

function getRequestRegion(): MongoRegion {
  try {
    const requestHeaders = headers();
    const explicit = normalizeMongoRegion(requestHeaders.get("x-mongo-region"));
    if (explicit) return explicit;

    return getMongoRegionFromCountry(requestHeaders.get("x-vercel-ip-country"));
  } catch {
    return "sg";
  }
}

function getClient(region: MongoRegion = getRequestRegion()): MongoClient {
  const uri = getFallbackUri(region);
  if (!uri) {
    throw new Error("MONGO_URI_SG, MONGO_URI_US, or MONGODB_URI is not set. Configure Doppler and rerun.");
  }

  if (!globalThis.__salenotiMongoClients) {
    globalThis.__salenotiMongoClients = {};
  }

  const cached = globalThis.__salenotiMongoClients[uri];
  if (!cached) {
    globalThis.__salenotiMongoClients[uri] = new MongoClient(uri, {
      maxPoolSize: getPoolSize(),
      serverSelectionTimeoutMS: 5000,
    });
  }

  return globalThis.__salenotiMongoClients[uri]!;
}

async function getReplicaLagSeconds(client: MongoClient): Promise<number | null> {
  try {
    const status = await client
      .db("admin")
      .command<{ members?: Array<{ self?: boolean; stateStr?: string; optimeDate?: Date | string }> }>({
        replSetGetStatus: 1,
      });
    const self = status.members?.find((member) => member.self) ?? status.members?.[0];
    if (!self || self.stateStr === "PRIMARY" || !self.optimeDate) {
      return null;
    }

    return Math.max(0, (Date.now() - new Date(self.optimeDate).getTime()) / 1000);
  } catch {
    return null;
  }
}

export const mongo = {
  db(name: string): Db {
    return getClient().db(name);
  },
  dbForRegion(region: MongoRegion, name: string): Db {
    return getClient(region).db(name);
  },
  async withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = getClient().startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result as T;
    } finally {
      await session.endSession();
    }
  },
  async health() {
    const probeRegion = async (region: MongoRegion) => {
      const configuredUri = getConfiguredUri(region);
      if (!configuredUri) {
        return {
          connected: false,
          latency_ms: null,
          replica_lag_seconds: null,
          status: region === "sg" ? ("primary-down" as const) : ("secondary-down" as const),
        };
      }

      const client = getClient(region);
      try {
        const started = Date.now();
        await client.db("admin").command({ ping: 1 });
        return {
          connected: true,
          latency_ms: Date.now() - started,
          replica_lag_seconds: await getReplicaLagSeconds(client),
          status: region === "sg" ? ("primary" as const) : ("secondary" as const),
        };
      } catch {
        return {
          connected: false,
          latency_ms: null,
          replica_lag_seconds: null,
          status: region === "sg" ? ("primary-down" as const) : ("secondary-down" as const),
        };
      }
    };

    const [sg, us] = await Promise.all([probeRegion("sg"), probeRegion("us")]);

    if (!sg.connected && us.connected) {
      return {
        sg,
        us: { ...us, status: "primary-promoted" as const },
        timestamp: new Date().toISOString(),
      };
    }

    return {
      sg,
      us,
      timestamp: new Date().toISOString(),
    };
  },
  async close() {
    if (globalThis.__salenotiMongoClients) {
      await Promise.all(Object.values(globalThis.__salenotiMongoClients).map((client) => client.close()));
      globalThis.__salenotiMongoClients = undefined;
    }
  },
};
