// FR-OBS-001 — Browser Sentry entrypoint.
import * as Sentry from "@sentry/nextjs";
import { redactBreadcrumb, redactSentryEvent } from "./src/server/obs/pii-redactor";

if (process.env.NEXT_PUBLIC_SENTRY_DSN_WEB) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN_WEB,
    tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_GIT_COMMIT,
    beforeSend: redactSentryEvent,
    beforeBreadcrumb: redactBreadcrumb,
  });
}
