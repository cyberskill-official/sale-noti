// FR-WORKER-001 §1 #6 — bridge BullMQ events to Sentry + PostHog.
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueueEvents } from "bullmq";
import { QUEUES, bullConnectionFromUrl, type QueueName } from "./queues";

@Injectable()
export class QueueEventBridge implements OnModuleInit {
  constructor(
    @Inject("OBS_SENTRY") private readonly sentry: any,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    private readonly config: ConfigService
  ) {}

  onModuleInit() {
    const connection = bullConnectionFromUrl(this.config.getOrThrow<string>("REDIS_URL"));

    for (const name of QUEUES) {
      const events = new QueueEvents(name as QueueName, { connection });
      events.on("failed", ({ jobId, failedReason, prev }) => {
        // Only emit Sentry on FINAL failure (after retries exhausted).
        // Heuristic: prev !== "active" means this is the retried-and-failed terminal.
        // Bullmq emits a chain; we capture both terminal + intermediate at debug.
        this.posthog.capture("queue_job_failed", { queue: name, jobId, reason: failedReason });
        if (prev !== "active") {
          this.sentry.captureMessage(`Queue job final-failed: ${name}/${jobId}`, {
            level: "error",
            tags: { queue: name, jobId, fr: "FR-WORKER-001" },
            extra: { failedReason },
          });
        }
      });
      events.on("stalled", ({ jobId }) => {
        this.sentry.captureMessage(`Queue job stalled: ${name}/${jobId}`, {
          level: "warning",
          tags: { queue: name, jobId, fr: "FR-WORKER-001" },
        });
      });
    }
  }
}
