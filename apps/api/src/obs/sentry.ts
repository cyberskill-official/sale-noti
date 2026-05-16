// FR-OBS-001 — Sentry init for NestJS API.
// Boots inside main.ts before NestFactory; tolerates missing DSN in dev.
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN_API) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN_API,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    profilesSampleRate: 0.05,
    environment: process.env.NODE_ENV,
    release: process.env.GIT_COMMIT,
    ignoreErrors: ["AbortError"],
    beforeSend(event) {
      if (event.user?.email) event.user.email = "[redacted]";
      return event;
    },
  });
}

export const sentry = Sentry;
