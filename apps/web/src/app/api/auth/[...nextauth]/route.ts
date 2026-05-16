// FR-AUTH-001 §3 — Auth.js v5 handler mount.
// runtime=nodejs is required because the mongodb driver doesn't run on Edge.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
export const runtime = "nodejs";
