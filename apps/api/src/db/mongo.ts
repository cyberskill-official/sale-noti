// Shared Mongo client (api side).
import { MongoClient, type Db } from "mongodb";

declare global {
  // `var` is required in `declare global` to extend globalThis (let/const can't).
  var __salenotiApiMongo: MongoClient | undefined;
}

function getClient(): MongoClient {
  const uri = process.env.MONGO_URI_SG ?? process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI_SG or MONGODB_URI not set");
  if (!globalThis.__salenotiApiMongo) {
    globalThis.__salenotiApiMongo = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
  }
  return globalThis.__salenotiApiMongo;
}

export const mongo = {
  db(name: string): Db {
    return getClient().db(name);
  },
  async close() {
    if (globalThis.__salenotiApiMongo) {
      await globalThis.__salenotiApiMongo.close();
      globalThis.__salenotiApiMongo = undefined;
    }
  },
};
