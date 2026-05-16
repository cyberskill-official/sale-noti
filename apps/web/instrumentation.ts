// Next.js 15 instrumentation hook — boots Sentry early.
// FR-OBS-001 ties into this; FR-AUTH-001 uses sentry breadcrumbs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./src/server/obs/sentry.server");
  }
}
