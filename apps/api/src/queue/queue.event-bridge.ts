// FR-WORKER-001 §1 #6 — bridge BullMQ events to Sentry + PostHog.
import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueueEvents } from "bullmq";
import { QUEUES, bullConnectionFromUrl, type QueueName } from "./queues";

type QueueEventEmitter = Pick<QueueEvents, "on">;
type QueueEventPayload = {
  jobId?: string;
  failedReason?: string;
  prev?: string;
  jobName?: string;
  name?: string;
  attemptsMade?: number;
  attempt?: number;
  data?: unknown;
};

export function attachQueueEventHandlers({
  events,
  name,
  sentry,
  posthog,
}: {
  events: QueueEventEmitter;
  name: QueueName;
  sentry: any;
  posthog: any;
}) {
  events.on("completed", ({ jobId }: QueueEventPayload) => {
    sentry.addBreadcrumb?.({
      category: "queue.completed",
      level: "info",
      data: { queue: name, jobId, fr: "FR-WORKER-001" },
    });
    posthog.capture("queue_job_completed", { queue: name, jobId });
  });

  events.on("progress", ({ jobId, data }: QueueEventPayload) => {
    sentry.addBreadcrumb?.({
      category: "queue.progress",
      level: "debug",
      data: { queue: name, jobId, progress: data, fr: "FR-WORKER-001" },
    });
    posthog.capture("queue_job_progress", { queue: name, jobId });
  });

  events.on("failed", ({ jobId, failedReason, prev, jobName, name: eventJobName, attemptsMade, attempt }: QueueEventPayload) => {
    const finalAttempt = Number(attemptsMade ?? attempt ?? 3);
    const finalJobName = jobName ?? eventJobName ?? "unknown";
    posthog.capture("queue_job_failed", { queue: name, jobId, reason: failedReason });
    if (prev !== "active") {
      sentry.captureMessage(`Queue job final-failed: ${name}/${jobId}`, {
        level: "error",
        tags: { queue: name, jobId, jobName: finalJobName, attempt: finalAttempt, fr: "FR-WORKER-001" },
        extra: { failedReason },
      });
    }
  });

  events.on("stalled", ({ jobId }: QueueEventPayload) => {
    posthog.capture("queue_job_stalled", { queue: name, jobId });
    sentry.captureMessage(`Queue job stalled: ${name}/${jobId}`, {
      level: "warning",
      tags: { queue: name, jobId, fr: "FR-WORKER-001" },
    });
  });
}

@Injectable()
export class QueueEventBridge implements OnModuleInit, OnApplicationShutdown {
  private readonly queueEvents: QueueEvents[] = [];

  constructor(
    @Inject("OBS_SENTRY") private readonly sentry: any,
    @Inject("OBS_POSTHOG") private readonly posthog: any,
    private readonly config: ConfigService
  ) {}

  onModuleInit() {
    const connection = bullConnectionFromUrl(this.config.getOrThrow<string>("REDIS_URL"));

    for (const name of QUEUES) {
      const events = new QueueEvents(name as QueueName, { connection });
      this.queueEvents.push(events);
      attachQueueEventHandlers({ events, name, sentry: this.sentry, posthog: this.posthog });
    }
  }

  async onApplicationShutdown() {
    await Promise.all(this.queueEvents.map((events) => events.close()));
  }
}
