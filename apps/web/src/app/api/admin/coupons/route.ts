import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { couponService, CouponListInputSchema } from "@/server/admin/coupon.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = CouponListInputSchema.safeParse({
      query: searchParams.get("q") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "BAD_REQUEST", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await couponService.listCoupons(parsed.data);

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[admin/coupons] Error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
