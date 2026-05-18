"use client";

import { useState } from "react";

type FormState = { kind: "idle" } | { kind: "success"; message: string } | { kind: "error"; message: string };

export function MagicLinkForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setState({ kind: "idle" });

    const response = await fetch("/api/auth/magic-link/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (response.ok) {
      const body = (await response.json()) as { message?: string };
      setState({
        kind: "success",
        message: body.message ?? "Nếu email hợp lệ, link đăng nhập đã được gửi.",
      });
    } else if (response.status === 429) {
      setState({ kind: "error", message: "Bạn gửi quá nhanh. Vui lòng thử lại sau 60 giây." });
    } else {
      setState({ kind: "error", message: "Email chưa hợp lệ." });
    }

    setIsSubmitting(false);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 8, marginTop: 24 }}>
      <label htmlFor="magic-link-email" style={{ fontSize: 14, fontWeight: 600 }}>
        Hoặc nhận link đăng nhập qua email
      </label>
      <input
        id="magic-link-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={255}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        style={{ padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6 }}
      />
      <button type="submit" disabled={isSubmitting} style={{ padding: "10px 12px" }}>
        {isSubmitting ? "Đang gửi..." : "Gửi magic link"}
      </button>
      {state.kind !== "idle" ? (
        <p role={state.kind === "error" ? "alert" : "status"} style={{ fontSize: 13, margin: 0 }}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
