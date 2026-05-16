// Shared Resend client. Tolerates missing API key in early dev (logs the email instead).
import { Resend } from "resend";

let _client: Resend | null = null;
function client(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY);
  return _client;
}

export const resend = {
  async send(args: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
    tags?: Array<{ name: string; value: string }>;
    headers?: Record<string, string>;
  }): Promise<{ id: string }> {
    const c = client();
    if (!c) {
      console.log("[resend:dev-stub] send", { ...args, html: args.html.slice(0, 200) + "…" });
      return { id: "dev-stub-" + Date.now() };
    }
    const res = await c.emails.send(args);
    if (res.error) throw new Error(`Resend error: ${res.error.message}`);
    return { id: res.data!.id };
  },
};
