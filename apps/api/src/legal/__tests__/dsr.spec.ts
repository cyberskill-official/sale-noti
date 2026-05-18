import { describe, expect, it, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { DsrDeleteService } from "../dsr-delete.service";
import { DsrExportService } from "../dsr-export.service";

const state = vi.hoisted(() => ({
  inserts: [] as Array<{ collection: string; doc: any }>,
  updates: [] as Array<{ collection: string; filter: any; update: any }>,
  deletes: [] as Array<{ collection: string; filter: any }>,
  finds: [] as Array<{ collection: string; query: any }>,
}));

vi.mock("../../db/mongo", () => ({
  mongo: {
    db: () => ({
      collection: (name: string) => ({
        insertOne: async (doc: any) => {
          const insertedId = new ObjectId();
          state.inserts.push({ collection: name, doc: { ...doc, _insertedId: insertedId } });
          return { insertedId };
        },
        updateOne: async (filter: any, update: any) => {
          state.updates.push({ collection: name, filter, update });
          return { matchedCount: 1, modifiedCount: 1 };
        },
        updateMany: async (filter: any, update: any) => {
          state.updates.push({ collection: name, filter, update });
          return { matchedCount: 1, modifiedCount: 1 };
        },
        deleteMany: async (filter: any) => {
          state.deletes.push({ collection: name, filter });
          return { deletedCount: 1 };
        },
        find: (query: any) => {
          state.finds.push({ collection: name, query });
          return {
            limit: () => ({
              toArray: async () => [{ _id: new ObjectId(), collection: name }],
            }),
          };
        },
      }),
    }),
  },
}));

describe("FR-LEGAL-001 — DSR services", () => {
  beforeEach(() => {
    state.inserts = [];
    state.updates = [];
    state.deletes = [];
    state.finds = [];
  });

  it("queues a portability export with a 30-day SLA and audit row", async () => {
    const userId = new ObjectId().toHexString();
    const service = new DsrExportService();

    const result = await service.requestExport(userId);

    expect(result.traceId).toMatch(/^dsr_/);
    expect(result.expectedDeliveryAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(state.inserts.some((op) => op.collection === "privacy_export_requests" && op.doc.status === "queued")).toBe(true);
    expect(state.inserts.some((op) => op.collection === "privacy_audit_log" && op.doc.action === "dsr_export_requested")).toBe(true);
  });

  it("exports structured access data across user-linked collections and writes audit", async () => {
    const userId = new ObjectId().toHexString();
    const service = new DsrExportService();

    const result = await service.exportUser(userId);

    expect(result.users).toEqual(expect.any(Array));
    expect(result.watchlists).toEqual(expect.any(Array));
    expect(state.finds.map((op) => op.collection)).toContain("notifications");
    expect(state.inserts.some((op) => op.collection === "privacy_audit_log" && op.doc.action === "dsr_export")).toBe(true);
  });

  it("soft-tombstones immediately and schedules hard purge after 72h", async () => {
    const userId = new ObjectId().toHexString();
    const service = new DsrDeleteService();

    const result = await service.requestErasure(userId, "user requested account deletion");

    expect(result.cancelUntil.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(result.purgeAfter.getTime()).toBeGreaterThan(Date.now() + 71 * 60 * 60 * 1000);
    const userUpdate = state.updates.find((op) => op.collection === "users");
    expect(userUpdate?.update.$set.status).toBe("pending_erasure");
    expect(userUpdate?.update.$set.deletedAt).toEqual(expect.any(Date));
    expect(userUpdate?.update.$set.purgeScheduledAt).toEqual(expect.any(Date));
  });

  it("purges direct PII and revokes linked user state", async () => {
    const userId = new ObjectId().toHexString();
    const service = new DsrDeleteService();

    await service.purgeUserPii(userId, "pdpl erasure deadline reached");

    expect(state.updates.find((op) => op.collection === "users")?.update.$set).toMatchObject({
      email: null,
      name: null,
      phone: null,
      status: "erased",
    });
    expect(state.deletes.some((op) => op.collection === "magic_link_tokens")).toBe(true);
    expect(state.updates.some((op) => op.collection === "refresh_tokens" && op.update.$set.revokeReason === "pdpl_erasure")).toBe(true);
    expect(state.updates.some((op) => op.collection === "watchlists" && op.update.$set.status === "deleted")).toBe(true);
  });
});
