/**
 * Dime Chat demo — the REAL chat page, embedded.
 *
 * Owner directive 2026-07-31 (round 2): "We need the actual Dime AI Chat
 * interface on the landing page. As a Demo for the users to see the UI/UX."
 * So this is no longer landing-invented chrome wrapped around real bubbles —
 * it mounts <DimeChatPage demoMode /> itself. Sidebar, top bar, brand hero,
 * composer, thread, streaming states, motion: all the product's own.
 *
 * demoMode (DimeChatPage) guarantees two things for a public page:
 *   • no history reads/writes — a signed-in owner scrolling past must never
 *     see their private threads inside a marketing embed;
 *   • no SSE call — /api/dime/chat is auth-gated and metered, so submits
 *     replay scripted product copy through the real reducer.
 *
 * Containment: the chat shell is a fixed, full-viewport app below 1024px.
 * `.dc-demo-embed` re-anchors that fixed layer to the frame (see
 * landing-v2.css) so the product renders at whatever layout matches the
 * visitor's device — a phone visitor previews the phone UI — without ever
 * escaping its box.
 */

import DimeChatPage from "@/pages/dime-chat/DimeChatPage";
import { SectionHead, CtaRow } from "./shared";

export default function ChatDemo() {
  return (
    <section className="sec" id="chat-demo" aria-label="Dime Chat demo">
      <div className="wrap">
        <div className="sec-body">
          <SectionHead
            eyebrow="Dime Chat"
            headline={{
              before: "Interrogate the number, ",
              em: "not the narrative",
              after: ".",
            }}
            sub="The panel below is the product's own chat interface, running live — ask it something, or press a suggestion. Answers here are sample copy; with access it runs against tonight's real slate."
          />

          <div
            className="dc-demo-embed"
            style={{ marginTop: "clamp(28px, 4vw, 44px)" }}
          >
            <span className="dc-demo-tag">Demo · sample markets</span>
            <DimeChatPage demoMode />
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
