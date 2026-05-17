// Tiny trace-id helper. Matches FR-AUTH-001 §6 skeleton (returns ULID-shaped string).
import { randomBytes } from "crypto";

export function traceId(): string {
  // 16-byte → 26-char crockford-base32-ish. Good enough for "give the user a trace tag".
  return randomBytes(16).toString("base64url").slice(0, 26);
}
