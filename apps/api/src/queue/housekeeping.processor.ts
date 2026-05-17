// FR-WORKER-001 — housekeeping worker for ops heartbeats and light cron jobs.
import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { QUEUE_CONCURRENCY } from "./queues";

@Processor("housekeeping", { concurrency: QUEUE_CONCURRENCY.housekeeping })
export class HousekeepingProcessor extends WorkerHost {
  private readonly log = new Logger(HousekeepingProcessor.name);

  async process(job: Job<{ kind?: string; heartbeatUrl?: string }>): Promise<void> {
    if (job.data.kind !== "better-stack-heartbeat") return;
    const url = job.data.heartbeatUrl ?? process.env.BETTER_STACK_HEARTBEAT_URL;
    if (!url) {
      this.log.debug("Better Stack heartbeat URL missing; skipping");
      return;
    }
    await fetch(url, { method: "GET" });
  }
}
