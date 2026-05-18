import { afterEach, describe, expect, it, vi } from "vitest";
import { resend } from "@/server/email/resend";

describe("FR-AUTH-002 — Resend dev stub redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log raw magic-link tokens when RESEND_API_KEY is absent", async () => {
    const originalKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await resend.send({
      from: "SaleNoti <noreply@salenoti.vn>",
      to: "user@example.com",
      subject: "Đăng nhập SaleNoti",
      html: '<a href="https://salenoti.test/api/auth/magic-link/consume?token=raw-secret-token">login</a>',
      text: "https://salenoti.test/api/auth/magic-link/consume?token=raw-secret-token",
    });

    const logged = JSON.stringify(consoleSpy.mock.calls);
    expect(logged).not.toContain("raw-secret-token");
    expect(logged).toContain("htmlBytes");

    if (originalKey) process.env.RESEND_API_KEY = originalKey;
  });
});
