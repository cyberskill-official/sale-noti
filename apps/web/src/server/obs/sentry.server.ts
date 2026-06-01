// FR-OBS-001 — server Sentry init. Wired to be tolerant of missing DSN (dev).
import * as Sentry from "@sentry/nextjs";
import { redactBreadcrumb, redactSentryEvent } from "./pii-redactor";
import { observabilityScopeFromSamplerContext, traceSampleRateForScope } from "./tenant";

const publicTraceSampleRate = Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1");

if (process.env.SENTRY_DSN_WEB) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_WEB,
    tracesSampler(samplingContext) {
      return traceSampleRateForScope(
        observabilityScopeFromSamplerContext(samplingContext as any),
        publicTraceSampleRate,
      );
    },
    profilesSampleRate: 0.05,
    environment: process.env.NODE_ENV,
    release: process.env.GIT_COMMIT,
    ignoreErrors: ["AbortError", "NEXT_NOT_FOUND", "ResizeObserver loop limit exceeded"],
    beforeSend(event) {
      return redactSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return redactBreadcrumb(breadcrumb);
    },
  });
}

export const sentry = Sentry;
