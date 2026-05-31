import { NextResponse } from "next/server";
import { mongo } from "@/server/db/mongo";

export const runtime = "nodejs";

export async function GET() {
  const payload = await mongo.health();
  const status = payload.sg.connected || payload.us.connected ? 200 : 503;

  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
