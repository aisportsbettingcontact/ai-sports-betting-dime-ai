/**
 * Controlled Access — Founder application form, wired to the REAL waitlist
 * backend (trpc.waitlist.submit). No fake scarcity: copy says exactly what
 * the queue is. utmSource distinguishes founder applications in /admin/waitlist.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CONTROLLED_ACCESS } from "../landing-content";
import { MintCheck, SectionHead } from "./shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ControlledAccess() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const submit = trpc.waitlist.submit.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = fullName.trim();
    const mail = email.trim();
    if (name.length < 2) return setClientError("Enter your full name.");
    if (!EMAIL_RE.test(mail)) return setClientError("Enter a valid email address.");
    setClientError(null);
    submit.mutate({
      email: mail,
      fullName: name,
      whyText: "Founder access application (landing v2)",
      utmSource: "landing-v2-founder",
    });
  };

  return (
    <section className="sec" id="access" aria-label="Founder access application">
      <div className="wrap">
        <div className="sec-body">
          <div className="access-grid">
            <SectionHead
              eyebrow={CONTROLLED_ACCESS.eyebrow}
              headline={CONTROLLED_ACCESS.headline}
              sub={CONTROLLED_ACCESS.copy}
            />

            <form className="apply-card" onSubmit={onSubmit} noValidate>
              <span className="mono mono--mint">{CONTROLLED_ACCESS.formTitle}</span>
              {submitted ? (
                <div className="apply-ok" role="status">
                  <MintCheck />
                  <span>{CONTROLLED_ACCESS.success}</span>
                </div>
              ) : (
                <>
                  <label>
                    {CONTROLLED_ACCESS.fields.name}
                    <input
                      type="text"
                      name="fullName"
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your name"
                    />
                  </label>
                  <label>
                    {CONTROLLED_ACCESS.fields.email}
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  {(clientError || submit.isError) && (
                    <span className="apply-err" role="alert">
                      {clientError ?? "Something went wrong submitting the application. Try again in a minute."}
                    </span>
                  )}
                  <button
                    type="submit"
                    className="btn btn--mint btn--wide"
                    disabled={submit.isPending}
                    data-cta-id="access-founder-apply"
                    data-cta-location="controlled-access"
                    data-plan="founder"
                    data-mode="paid"
                  >
                    {submit.isPending ? "Submitting…" : CONTROLLED_ACCESS.submit}
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
