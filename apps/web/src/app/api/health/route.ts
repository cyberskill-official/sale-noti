// FR-OBS-001 §1 #11 — /api/health (Better Stack target).
import { mongo } from "@/server/db/mongo";

export const runtime = "nodejs";

export async function GET() {
  const checks = await Promise.all([
    mongo
      .db("salenoti")
      .command({ ping: 1 })
      .then(() => ["mongo", true] as const)
      .catch(() => ["mongo", false] as const),
  ]);
  const obj = Object.fromEntries(checks);
  const ok = Object.values(obj).every(Boolean);
  return Response.json(
    { status: ok ? "ok" : "degraded", checks: obj },
    { status: ok ? 200 : 503 }
  );
}
