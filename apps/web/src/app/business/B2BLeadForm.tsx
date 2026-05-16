// FR-ADMIN-001 §3 — client form component for /business.
"use client";
import { useState } from "react";

export function B2BLeadForm() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { leadId: string }>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    const consent = (form.elements.namedItem("pdpl") as HTMLInputElement | null)?.checked;
    if (!consent) {
      setError("Vui lòng tick consent PDPL.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/business/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: data.companyName,
          website: data.website || undefined,
          contactName: data.contactName,
          email: data.email,
          phone: data.phone,
          monthlyBudget: data.monthlyBudget,
          volume: data.volume,
          useCase: data.useCase,
          howFoundUs: data.howFoundUs || undefined,
          consents: { pdpl_v1: true },
        }),
      });
      const body = await res.json();
      if (res.ok) {
        setDone({ leadId: body.leadId });
      } else {
        setError(body.error === "rate_limit" ? "Đã gửi quá nhiều. Thử lại sau 1 giờ." : body.error ?? "Lỗi gửi form.");
      }
    } catch {
      setError("Lỗi kết nối. Thử lại sau.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={{ background: "#C6F6D5", padding: 16, borderRadius: 8, color: "#22543D" }}>
        <b>✅ Cảm ơn bạn đã liên hệ.</b>
        <p style={{ margin: "8px 0 0" }}>Lead ID: {done.leadId.slice(-8)}. Chúng tôi phản hồi trong 24 giờ.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
      <Field name="companyName" label="Tên công ty *" required />
      <Field name="website" label="Website" type="url" />
      <Field name="contactName" label="Tên liên hệ *" required />
      <Field name="email" label="Email *" type="email" required />
      <Field name="phone" label="Phone (VN) *" placeholder="0901234567" required />
      <Select name="monthlyBudget" label="Monthly budget *" options={["<5M", "5-15M", "15-50M", "50M+"]} required />
      <Select name="volume" label="Volume cần track *" options={["<1K", "1K-10K", "10K-100K", "100K+"]} required />
      <Textarea name="useCase" label="Use case *" required />
      <Field name="howFoundUs" label="Bạn biết SaleNoti qua đâu?" />

      <label style={{ fontSize: 13 }}>
        <input type="checkbox" name="pdpl" required style={{ marginRight: 8 }} />
        Tôi đồng ý SaleNoti lưu thông tin liên hệ để phản hồi (PDPL Decree 13/2023). Xem{" "}
        <a href="/privacy" target="_blank">Privacy Policy</a>.
      </label>

      {error ? <p style={{ color: "#c53030", margin: 0 }}>{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        style={{
          background: submitting ? "#ccc" : "#FAA227",
          color: "white",
          border: 0,
          padding: "12px 24px",
          borderRadius: 8,
          fontWeight: 600,
          cursor: submitting ? "default" : "pointer",
        }}
      >
        {submitting ? "Đang gửi…" : "Gửi liên hệ"}
      </button>
    </form>
  );
}

function Field({ name, label, ...rest }: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "block", fontSize: 14 }}>
      <span style={{ display: "block", marginBottom: 4, color: "#444" }}>{label}</span>
      <input name={name} {...rest} style={{ width: "100%", padding: 8, fontSize: 14, border: "1px solid #ccc", borderRadius: 6 }} />
    </label>
  );
}

function Select({ name, label, options, required }: { name: string; label: string; options: string[]; required?: boolean }) {
  return (
    <label style={{ display: "block", fontSize: 14 }}>
      <span style={{ display: "block", marginBottom: 4, color: "#444" }}>{label}</span>
      <select name={name} required={required} defaultValue="" style={{ width: "100%", padding: 8, fontSize: 14, border: "1px solid #ccc", borderRadius: 6 }}>
        <option value="" disabled>— chọn —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Textarea({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label style={{ display: "block", fontSize: 14 }}>
      <span style={{ display: "block", marginBottom: 4, color: "#444" }}>{label}</span>
      <textarea
        name={name}
        required={required}
        rows={4}
        style={{ width: "100%", padding: 8, fontSize: 14, border: "1px solid #ccc", borderRadius: 6, fontFamily: "inherit" }}
      />
    </label>
  );
}
