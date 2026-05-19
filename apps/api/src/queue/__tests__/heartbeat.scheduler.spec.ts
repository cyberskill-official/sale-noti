import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeartbeatScheduler } from "../heartbeat.scheduler";

describe("FR-WORKER-001 — Better Stack heartbeat scheduler", () => {
  beforeEach(() => {
    delete process.env.BETTER_STACK_HEARTBEAT_URL;
    delete process.env.BETTER_STACK_HEARTBEAT_URL_TIER1;
  });

  it("registers all repeatable housekeeping heartbeat jobs", async () => {
    process.env.BETTER_STACK_HEARTBEAT_URL = "https://uptime.betterstack.com/api/v1/heartbeat/default";
    process.env.BETTER_STACK_HEARTBEAT_URL_TIER1 = "https://uptime.betterstack.com/api/v1/heartbeat/tier1";
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const scheduler = new HeartbeatScheduler(queue as any);

    await scheduler.onApplicationBootstrap();

    expect(queue.add).toHaveBeenCalledTimes(6);
    expect(queue.add).toHaveBeenCalledWith(
      "better-stack-heartbeat",
      expect.objectContaining({
        kind: "better-stack-heartbeat",
        heartbeatKey: "cron-price-check-tier1-30m",
        heartbeatUrl: "https://uptime.betterstack.com/api/v1/heartbeat/tier1",
      }),
      expect.objectContaining({
        jobId: "heartbeat:cron-price-check-tier1-30m",
        repeat: { pattern: "*/30 * * * *" },
      })
    );
  });
});
