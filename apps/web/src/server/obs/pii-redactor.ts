const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const IP_RE = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;
const VN_PHONE_RE = /(?:\+84|84)[0-9]{9}\b/g;
const SENSITIVE_QUERY_KEYS = new Set(["token", "code", "t", "secret", "password"]);

export function redactText(value: string): string {
  return value
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(IP_RE, "[redacted-ip]")
    .replace(VN_PHONE_RE, "[redacted-phone]");
}

export function redactUrl(rawUrl: string): string {
  if (!rawUrl.startsWith("http") && !rawUrl.startsWith("/")) return redactText(rawUrl);
  try {
    const url = new URL(rawUrl, "https://salenoti.local");
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, "[redacted]");
    }
    const redactedUrl = rawUrl.startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
    return redactText(redactedUrl);
  } catch {
    return redactText(rawUrl);
  }
}

export function redactObject<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactObject(item)) as T;
  if (!value || typeof value !== "object") return value;

  const target = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(target)) {
    if (/refresh-token|session-token|password|secret|token/i.test(key)) {
      target[key] = "[redacted]";
    } else {
      target[key] = redactObject(child);
    }
  }
  return value;
}

export function redactSentryEvent<T extends Record<string, any>>(event: T): T {
  if (event.user?.email) event.user.email = "[redacted]";
  if (event.user?.ip_address) event.user.ip_address = "[redacted]";
  if (event.request?.cookies) redactObject(event.request.cookies);
  if (event.tags) redactObject(event.tags);
  if (event.extra) redactObject(event.extra);
  if (event.contexts) redactObject(event.contexts);
  return event;
}

export function redactBreadcrumb<T extends Record<string, any>>(breadcrumb: T): T {
  const data = breadcrumb.data as Record<string, unknown> | undefined;
  if (data?.url && typeof data.url === "string") data.url = redactUrl(data.url);
  if (data?.method && ["POST", "PUT", "PATCH"].includes(String(data.method).toUpperCase())) {
    delete data.body;
  }
  return redactObject(breadcrumb);
}
