// FR-OBS-001 — server Sentry init. Wired to be tolerant of missing DSN (dev).
import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN_WEB) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_WEB,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    profilesSampleRate: 0.05,
    environment: process.env.NODE_ENV,
    release: process.env.GIT_COMMIT,
    ignoreErrors: ["AbortError", "NEXT_NOT_FOUND"],
    beforeSend(event) {
      if (event.user?.email) event.user.email = "[redacted]";
      return event;
    },
  });
}

export const sentry = Sentry;
