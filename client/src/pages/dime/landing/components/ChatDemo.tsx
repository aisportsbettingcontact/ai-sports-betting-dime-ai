/**
 * Dime Chat demo — scripted, honest, labeled DEMO.
 * Prompt chips switch between five pre-written exchanges; each renders the
 * user turn, Dime's restrained answer, and a classification card.
 * The real product's streaming chat lives at /chat — this is a preview object.
 */

import { useState } from "react";
import { CHAT_EXCHANGES, CHAT_SIDE } from "../landing-content";
import { StatePill, SectionHead, CtaRow } from "./shared";

export default function ChatDemo() {
  const [activeId, setActiveId] = useState(CHAT_EXCHANGES[0].id);
  const [creditsUsed, setCreditsUsed] = useState(1);
  const ex = CHAT_EXCHANGES.find((e) => e.id === activeId) ?? CHAT_EXCHANGES[0];

  const pick = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    setCreditsUsed((c) => Math.min(CHAT_SIDE.creditsTotal, c + 1));
  };

  return (
    <section className="sec" id="chat-demo" aria-label="Dime Chat demo">
      <div className="wrap">
        <div className="sec-body">
          <SectionHead
            eyebrow="Dime Chat"
            headline={{ before: "Interrogate the number, ", em: "not the narrative", after: "." }}
            sub="Every answer traces back to a table the model wrote. Pick a question: the responses below are real product tone on sample markets."
          />

          <div className="chat-grid" style={{ marginTop: "clamp(28px, 4vw, 44px)" }}>
            {/* Left: prompts, filters, credits */}
            <div className="chat-side">
              <div>
                <span className="mono" style={{ display: "block", marginBottom: 10 }}>Suggested questions</span>
                <div className="chip-group">
                  {CHAT_EXCHANGES.map((e) => (
                    <button key={e.id} type="button" className="chip" aria-pressed={e.id === activeId} onClick={() => pick(e.id)}>
                      {e.chip}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="mono" style={{ display: "block", marginBottom: 10 }}>Market filters</span>
                <div className="filter-row">
                  {CHAT_SIDE.filters.map((f) => (
                    <span key={f} className="filter-chip">{f}</span>
                  ))}
                </div>
              </div>
              <div className="credit-meter">
                <span className="mono num">{CHAT_SIDE.creditsLabel} · {creditsUsed}/{CHAT_SIDE.creditsTotal}</span>
                <span className="bar"><b style={{ width: `${(creditsUsed / CHAT_SIDE.creditsTotal) * 100}%` }} /></span>
              </div>
            </div>

            {/* Right: chat thread */}
            <div className="chat-window">
              <div className="chat-bar">
                <span className="pulse" aria-hidden="true" />
                <span>dime.chat</span>
                <span className="right">Demo · sample markets</span>
              </div>
              <div className="chat-body" role="log" aria-live="polite">
                <div className="chat-user">{ex.user}</div>
                <div className="chat-dime">{ex.dime}</div>
                {ex.card && (
                  <div className="answer-card">
                    <div className="card-head">
                      <StatePill state={ex.card.state} label={ex.card.classification} />
                    </div>
                    <table>
                      <tbody>
                        {ex.card.rows.map(([k, v]) => (
                          <tr key={k}>
                            <td>{k}</td>
                            <td className="num">{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="card-foot">
                      <span className="mono">Next action</span>
                      <span style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{ex.card.nextAction}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <CtaRow
            label="The full chat runs on tonight's real slate"
            cta="Open the full chat"
            href="#pricing"
            ctaId="chat-demo-open-full-chat"
            location="chat-demo"
          />
        </div>
      </div>
    </section>
  );
}
