// FR-OBS-001 — Edge runtime Sentry entrypoint. Server config is node-only, so keep edge minimal.
import * as Sentry from "@sentry/nextjs";
import { redactBreadcrumb, redactSentryEvent } from "./src/server/obs/pii-redactor";

if (process.env.SENTRY_DSN_WEB) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_WEB,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    environment: process.env.NODE_ENV,
    release: process.env.GIT_COMMIT,
    beforeSend: redactSentryEvent,
    beforeBreadcrumb: redactBreadcrumb,
  });
}
