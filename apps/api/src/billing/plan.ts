// FR-BILL-001 §1 #1 — plan catalog + caps.

export type Plan = "free" | "pro" | "pro_plus";
export type Interval = "monthly" | "yearly";

export const PLAN_CAPS: Record<Plan, number> = {
  free: 10,
  pro: 200,
  pro_plus: Number.MAX_SAFE_INTEGER,
};

export const PLAN_PRICE_VND: Record<Plan, Record<Interval, number>> = {
  free: { monthly: 0, yearly: 0 },
  pro: { monthly: 39_000, yearly: 350_000 },
  pro_plus: { monthly: 89_000, yearly: 800_000 },
};

export function isValidPlan(p: string): p is Exclude<Plan, "free"> {
  return p === "pro" || p === "pro_plus";
}
