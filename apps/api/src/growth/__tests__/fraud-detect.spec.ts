import { describe, it, expect } from "vitest";
import { detectFraud, emailRoot } from "../fraud-detect";

describe("FR-GROW-001 — fraud detection", () => {
  it("emailRoot strips +alias and gmail dots", () => {
    expect(emailRoot("john.doe+ref@gmail.com")).toBe("johndoe@gmail.com");
    expect(emailRoot("john+x@gmail.com")).toBe("john@gmail.com");
    expect(emailRoot("user@example.com")).toBe("user@example.com");
  });

  it("AC5: self-referral flagged", () => {
    const r = detectFraud({ referrerId: "u1", referredId: "u1" });
    expect(r.selfRefer).toBe(true);
    expect(r.anyFlag).toBe(true);
  });

  it("AC6: same /24 IPv4 flagged", () => {
    const r = detectFraud({
      referrerId: "u1",
      referredId: "u2",
      referrerIp: "27.71.10.5",
      referredIp: "27.71.10.99",
    });
    expect(r.sameIp).toBe(true);
  });

  it("different /24 not flagged", () => {
    const r = detectFraud({
      referrerId: "u1",
      referredId: "u2",
      referrerIp: "27.71.10.5",
      referredIp: "27.71.11.5",
    });
    expect(r.sameIp).toBe(false);
  });

  it("IPv6 /64 matches while malformed email falls back to lowercase", () => {
    const r = detectFraud({
      referrerId: "u1",
      referredId: "u2",
      referrerIp: "2001:db8:85a3:0000:0000:8a2e:0370:7334",
      referredIp: "2001:db8:85a3:0000:1111:8a2e:0370:7334",
      referrerEmail: "NOT-AN-EMAIL",
      referredEmail: "not-an-email",
    });
    expect(r.sameIp).toBe(true);
    expect(r.samePlusAlias).toBe(true);
  });

  it("AC7: plus-alias email family flagged", () => {
    const r = detectFraud({
      referrerId: "u1",
      referredId: "u2",
      referrerEmail: "john+a@gmail.com",
      referredEmail: "john+b@gmail.com",
    });
    expect(r.samePlusAlias).toBe(true);
  });
});
