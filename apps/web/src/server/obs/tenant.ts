export type TenantObservabilityScope = "public" | "b2b";

export type TenantTier = "starter" | "growth" | "enterprise";

export type TenantObservabilityContext = {
  scope: TenantObservabilityScope;
  tenantId?: string | null;
  subscriptionId?: string | null;
  tier?: TenantTier | null;
};

type HeaderBag = Headers | Record<string, string | string[] | undefined> | undefined;

type SamplerContext = {
  request?: {
    url?: string;
    headers?: HeaderBag;
  } | null;
  transactionContext?: {
    name?: string;
  } | null;
};

const B2B_ROUTE_MATCHERS = ["/dashboard", "/api/admin"];

function isB2bRoute(candidate: string): boolean {
  const normalized = candidate.toLowerCase();

  return B2B_ROUTE_MATCHERS.some((matcher) => normalized.includes(matcher));
}

function getHeaderValue(headers: HeaderBag, key: string): string | null {
  if (!headers) return null;

  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(key);
  }

  const normalizedKey = key.toLowerCase();
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (headerKey.toLowerCase() !== normalizedKey) continue;
    if (Array.isArray(headerValue)) return headerValue[0] ?? null;
    return typeof headerValue === "string" ? headerValue : null;
  }

  return null;
}

function pathFromCandidate(candidate: string): string {
  try {
    return new URL(candidate, "https://salenoti.local").pathname;
  } catch {
    return candidate;
  }
}

export function observabilityScopeFromPathname(candidate: string): TenantObservabilityScope {
  return isB2bRoute(candidate) ? "b2b" : "public";
}

export function observabilityScopeFromSamplerContext(context: SamplerContext): TenantObservabilityScope {
  const headerScope = getHeaderValue(context.request?.headers, "x-observability-scope")?.toLowerCase();
  if (headerScope === "b2b" || headerScope === "public") return headerScope;

  const requestUrl = context.request?.url;
  if (requestUrl) {
    const scope = observabilityScopeFromPathname(pathFromCandidate(requestUrl));
    if (scope === "b2b") return scope;
  }

  const transactionName = context.transactionContext?.name;
  if (transactionName) return observabilityScopeFromPathname(pathFromCandidate(transactionName));

  return "public";
}

export function traceSampleRateForScope(scope: TenantObservabilityScope, publicTraceSampleRate: number): number {
  return scope === "b2b" ? 1 : publicTraceSampleRate;
}

export function applyTenantObservabilityTags(
  target: { setTag(name: string, value: string): unknown },
  context: TenantObservabilityContext,
): void {
  target.setTag("tenant_scope", context.scope);

  if (context.tenantId) target.setTag("tenant_id", context.tenantId);
  if (context.subscriptionId) target.setTag("tenant_subscription_id", context.subscriptionId);
  if (context.tier) target.setTag("tenant_tier", context.tier);
}
