// FR-ADMIN-001 §3 — POST /v1/business/lead with per-IP + per-email rate limit.
import { Body, Controller, Headers, HttpException, HttpStatus, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { redis } from "../queue/redis.client";
import { B2bLeadService } from "./b2b-lead.service";

async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  const used = await redis.incr(bucket);
  if (used === 1) await redis.expire(bucket, windowSec);
  return used <= max;
}

@Controller("v1/business")
export class B2bLeadController {
  constructor(private readonly leads: B2bLeadService) {}

  @Post("lead")
  async submit(@Body() body: any, @Req() req: Request, @Headers("referer") referer: string | undefined, @Headers("user-agent") ua: string | undefined) {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? "0.0.0.0";
    const email = String(body?.email ?? "").toLowerCase().slice(0, 255);

    // 3 per hour per IP, 1 per email per day per FR-ADMIN-001 §1 #4.
    if (!(await rateLimit(`b2b:ip:${ip}`, 3, 3600))) {
      throw new HttpException({ ok: false, error: "rate_limit", retryAfter: 3600 }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (email && !(await rateLimit(`b2b:email:${email}`, 1, 86400))) {
      throw new HttpException({ ok: false, error: "rate_limit", retryAfter: 86400 }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const result = await this.leads.submit(body, { ip, referer: referer ?? "", ua: ua ?? "" });
    return { ok: true, leadId: result.leadId, message: "Bạn sẽ nhận hồi đáp trong 24h." };
  }
}
