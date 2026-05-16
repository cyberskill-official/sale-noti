// FR-GROW-001 §1 #7 — fraud signals: same-IP, plus-alias email family.

export type FraudSignals = {
  selfRefer: boolean;
  sameIp: boolean;
  samePlusAlias: boolean;
  anyFlag: boolean;
};

function ipPrefix(ip: string): string {
  // /24 for IPv4, /64 for IPv6 — same redaction we use for analytics.
  if (ip.includes(":")) {
    const parts = ip.split(":").slice(0, 4);
    return parts.join(":");
  }
  const parts = ip.split(".");
  if (parts.length === 4) return parts.slice(0, 3).join(".");
  return ip;
}

export function emailRoot(email: string): string {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return email.toLowerCase();
  const root = local.split("+")[0]!.replace(/\./g, ""); // gmail dot-stripping
  return `${root}@${domain}`;
}

export function detectFraud(args: {
  referrerId: string;
  referredId: string;
  referrerIp?: string;
  referredIp?: string;
  referrerEmail?: string;
  referredEmail?: string;
}): FraudSignals {
  const selfRefer = args.referrerId === args.referredId;
  const sameIp = Boolean(args.referrerIp && args.referredIp && ipPrefix(args.referrerIp) === ipPrefix(args.referredIp));
  const samePlusAlias = Boolean(args.referrerEmail && args.referredEmail && emailRoot(args.referrerEmail) === emailRoot(args.referredEmail));
  return {
    selfRefer,
    sameIp,
    samePlusAlias,
    anyFlag: selfRefer || sameIp || samePlusAlias,
  };
}
