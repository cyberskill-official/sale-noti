import { Global, Module } from "@nestjs/common";
import "./sentry"; // side-effect init at import time
import { posthog } from "./posthog";
import { slack } from "./slack";
import { sentry } from "./sentry";

@Global()
@Module({
  providers: [
    { provide: "OBS_SENTRY", useValue: sentry },
    { provide: "OBS_POSTHOG", useValue: posthog },
    { provide: "OBS_SLACK", useValue: slack },
  ],
  exports: ["OBS_SENTRY", "OBS_POSTHOG", "OBS_SLACK"],
})
export class ObsModule {}
