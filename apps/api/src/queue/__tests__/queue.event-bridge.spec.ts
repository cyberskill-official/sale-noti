import { beforeEach, describe, expect, it, vi } from "vitest";

const queueEventsMock = vi.hoisted(() => ({
  instances: [] as Array<{
    name: string;
    options: unknown;
    handlers: Record<string, (payload: any) => void>;
    close: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("bullmq", () => ({
  QueueEvents: class {
    readonly handlers: Record<string, (payload: any) => void> = {};
    readonly close = vi.fn();

    constructor(
      readonly name: string,
      readonly options: unknown,
    ) {
      queueEventsMock.instances.push({ name, options, handlers: this.handlers, close: this.close });
    }

    on(event: string, handler: (payload: any) => void) {
      this.handlers[event] = handler;
      return this;
    }
  },
}));

async function loadBridge() {
  vi.resetModules();
  return import("../queue.event-bridge");
}

beforeEach(() => {
  queueEventsMock.instances.length = 0;
});

describe("FR-WORKER-001 — queue event bridge", () => {
  it("bridges completed, progress, final failed, intermediate failed, and stalled events", async () => {
    const { attachQueueEventHandlers } = await loadBridge();
    const handlers: Record<string, (payload: any) => void> = {};
    const events = { on: vi.fn((event: string, handler: (payload: any) => void) => (handlers[event] = handler)) };
    const sentry = { addBreadcrumb: vi.fn(), captureMessage: vi.fn() };
    const posthog = { capture: vi.fn() };

    attachQueueEventHandlers({ events: events as any, name: "price-check", sentry, posthog });
    handlers.completed?.({ jobId: "job-1" });
    handlers.progress?.({ jobId: "job-1", data: 50 });
    handlers.failed?.({ jobId: "job-2", failedReason: "boom", prev: "active", jobName: "worker", attemptsMade: 2 });
    handlers.failed?.({ jobId: "job-3", failedReason: "boom", prev: "failed", jobName: "worker", attemptsMade: 3 });
    handlers.failed?.({ jobId: "job-5", failedReason: "fallback", prev: "failed" });
    handlers.stalled?.({ jobId: "job-4" });

    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ category: "queue.completed" }));
    expect(sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ category: "queue.progress" }));
    expect(posthog.capture).toHaveBeenCalledWith("queue_job_completed", { queue: "price-check", jobId: "job-1" });
    expect(posthog.capture).toHaveBeenCalledWith("queue_job_progress", { queue: "price-check", jobId: "job-1" });
    expect(posthog.capture).toHaveBeenCalledWith("queue_job_failed", { queue: "price-check", jobId: "job-2", reason: "boom" });
    expect(posthog.capture).toHaveBeenCalledWith("queue_job_stalled", { queue: "price-check", jobId: "job-4" });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(3);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "Queue job final-failed: price-check/job-3",
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({ queue: "price-check", jobId: "job-3", jobName: "worker", attempt: 3 }),
      }),
    );
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "Queue job stalled: price-check/job-4",
      expect.objectContaining({ level: "warning" }),
    );
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "Queue job final-failed: price-check/job-5",
      expect.objectContaining({
        tags: expect.objectContaining({ jobName: "unknown", attempt: 3 }),
      }),
    );
  });

  it("attaches handlers to all queues and closes QueueEvents on shutdown", async () => {
    const { QueueEventBridge } = await loadBridge();
    const sentry = { addBreadcrumb: vi.fn(), captureMessage: vi.fn() };
    const posthog = { capture: vi.fn() };
    const config = { getOrThrow: vi.fn(() => "rediss://default:secret@example.upstash.io:6380") };
    const bridge = new QueueEventBridge(sentry, posthog, config as any);

    bridge.onModuleInit();
    await bridge.onApplicationShutdown();

    expect(queueEventsMock.instances.map((instance) => instance.name)).toEqual([
      "price-check",
      "alert-dispatch",
      "commission-reconcile",
      "housekeeping",
    ]);
    for (const instance of queueEventsMock.instances) {
      expect(Object.keys(instance.handlers).sort()).toEqual(["completed", "failed", "progress", "stalled"]);
      expect(instance.close).toHaveBeenCalledOnce();
    }
  });
});
