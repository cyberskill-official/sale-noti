// Shared Mongo client — single connection pool per Node process.
// FR-AUTH-001 §1 #6 uses this for users upsert.
import { MongoClient, type ClientSession, type Db } from "mongodb";

declare global {
  var __salenotiMongo: MongoClient | undefined;
}

function getClient(): MongoClient {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set. Configure Doppler and rerun.");
  }
  if (!globalThis.__salenotiMongo) {
    globalThis.__salenotiMongo = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
  }
  return globalThis.__salenotiMongo;
}

export const mongo = {
  db(name: string): Db {
    return getClient().db(name);
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
  async close() {
    if (globalThis.__salenotiMongo) {
      await globalThis.__salenotiMongo.close();
      globalThis.__salenotiMongo = undefined;
    }
  },
};
