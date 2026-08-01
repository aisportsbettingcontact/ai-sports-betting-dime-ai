Execution rules for this repo (appended to every pi session):

- Skills: if any entry in <available_skills> plausibly applies to the task — even 1% —
  read and follow it before acting. Process skills (brainstorming, systematic-debugging,
  test-driven-development, verification-before-completion) come before domain skills.
- Models: current-generation only per LLM.md (claude-fable-5 default, claude-opus-5,
  openai-codex/gpt-5.6-sol). Never switch to older models.
- Shipping: Railway auto-deploys main — a merge to main IS a production deploy. Schema
  changes require the manual db-push.yml workflow first. Use the /ship template for
  releases; it encodes the gates.
- Verification before claiming done: `npx tsc --noEmit` must pass; report real command
  output, never assumed success.
