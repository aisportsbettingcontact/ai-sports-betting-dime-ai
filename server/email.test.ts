/**
 * email.test.ts
 *
 * Validates that GMAIL_APP_PASSWORD is correctly configured by verifying
 * the SMTP connection to smtp.gmail.com without sending any email.
 *
 * [INPUT]  GMAIL_APP_PASSWORD env var
 * [STEP]   Create Nodemailer transporter with Gmail SMTP credentials
 * [STEP]   Call transporter.verify() — opens a connection, authenticates, closes
 * [OUTPUT] Pass if connection succeeds, fail with diagnostic if it doesn't
 * [VERIFY] PASS = credentials are valid and SMTP is reachable
 */

import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";

const FROM_EMAIL = "team@aisportsbettingmodels.com";

describe("Gmail SMTP credentials", () => {
  it("should authenticate successfully with GMAIL_APP_PASSWORD", async () => {
    const appPassword = process.env.GMAIL_APP_PASSWORD;

    console.log(`[Email][Test] [INPUT] GMAIL_APP_PASSWORD present=${!!appPassword} length=${appPassword?.length ?? 0}`);

    expect(appPassword, "GMAIL_APP_PASSWORD env var must be set").toBeTruthy();
    expect(appPassword!.length, "App Password must be 16 characters (no spaces)").toBe(16);

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: FROM_EMAIL,
        pass: appPassword,
      },
    });

    console.log(`[Email][Test] [STEP] Verifying SMTP connection to smtp.gmail.com:465 as ${FROM_EMAIL}`);

    let verifyError: Error | null = null;
    try {
      await transporter.verify();
      console.log(`[Email][Test] [OUTPUT] SMTP verify() succeeded — credentials are valid`);
      console.log(`[Email][Test] [VERIFY] PASS`);
    } catch (err: unknown) {
      verifyError = err instanceof Error ? err : new Error(String(err));
      console.error(`[Email][Test] [VERIFY] FAIL — ${verifyError.message}`);
    }

    expect(verifyError, `SMTP authentication failed: ${verifyError?.message}`).toBeNull();
  }, 30_000); // 30s timeout for network round-trip
});
