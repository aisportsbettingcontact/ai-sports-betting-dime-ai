/**
 * email.ts
 *
 * Branded transactional email service — Dime AI (mint #45E0A8, ink surfaces).
 * Delivers via Google Workspace SMTP (team@aisportsbettingmodels.com).
 *
 * All emails are fully branded — no Manus logos, no external branding.
 *
 * ENVIRONMENT VARIABLES REQUIRED:
 *   GMAIL_APP_PASSWORD — App Password for team@aisportsbettingmodels.com
 *                        (Google Account → Security → App Passwords)
 *
 * USAGE:
 *   import { sendPasswordResetEmail, sendWelcomeEmail } from "./email";
 */

import nodemailer from "nodemailer";

// ─── Constants ────────────────────────────────────────────────────────────────

const FROM_NAME = "Dime AI";
const FROM_EMAIL = "team@aisportsbettingmodels.com";
const BRAND_COLOR = "#45E0A8"; // Dime mint (brand law: no neon #39FF14)
const DARK_BG = "#0B0B0F";
const CARD_BG = "#16161C";
const BORDER_COLOR = "#1E1E26";

// ─── Transporter ──────────────────────────────────────────────────────────────

function getTransporter() {
  const TAG = "[Email][getTransporter]";
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  if (!appPassword) {
    console.error(`${TAG} [VERIFY] FAIL — GMAIL_APP_PASSWORD env var is not set`);
    throw new Error("GMAIL_APP_PASSWORD is not configured. Email delivery is unavailable.");
  }

  console.log(`${TAG} [STATE] Creating Gmail SMTP transporter for ${FROM_EMAIL}`);

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // SSL
    auth: {
      user: FROM_EMAIL,
      pass: appPassword,
    },
  });
}

// ─── HTML Template ────────────────────────────────────────────────────────────

function buildEmailHtml(opts: {
  title: string;
  preheader: string;
  bodyHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:${DARK_BG};font-family:"Familjen Grotesk",-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <!-- Preheader (hidden preview text) -->
  <span style="display:none;font-size:1px;color:${DARK_BG};max-height:0;max-width:0;opacity:0;overflow:hidden;">${opts.preheader}</span>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:${DARK_BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <!-- dime wordmark: dotless-i + mint coin-dot (brand kit) -->
                    <span style="font-size:22px;font-weight:700;color:#EDEDF2;letter-spacing:-0.05em;">d&#305;me<span style="color:${BRAND_COLOR};">.</span></span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:${CARD_BG};border:1px solid ${BORDER_COLOR};border-radius:12px;padding:32px 28px;">
              ${opts.bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:20px;">
              <p style="font-size:11px;color:#444444;margin:0;">
                &copy; ${new Date().getFullYear()} Dime AI &mdash; AI Sports Betting Models &nbsp;&bull;&nbsp;
                <a href="https://aisportsbettingmodels.com" style="color:#444444;text-decoration:none;">aisportsbettingmodels.com</a>
              </p>
              <p style="font-size:10px;color:#333333;margin:6px 0 0;">
                Analytical software &mdash; no guaranteed outcomes. For informational purposes only. 21+. Gambling problem? Call 1-800-GAMBLER.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── sendPasswordResetEmail ────────────────────────────────────────────────────

export async function sendPasswordResetEmail(opts: {
  toEmail: string;
  username: string;
  resetUrl: string;
  expiresAt: Date;
}): Promise<void> {
  const TAG = "[Email][sendPasswordResetEmail]";
  console.log(`${TAG} [INPUT] to=${opts.toEmail} username=${opts.username} expiresAt=${opts.expiresAt.toISOString()}`);

  const expiryStr = opts.expiresAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });

  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:900;color:#ffffff;margin:0 0 8px;letter-spacing:0.04em;">Password Reset</h1>
    <p style="font-size:13px;color:#aaaaaa;margin:0 0 24px;">
      Hi <strong style="color:#ffffff;">@${opts.username}</strong>, we received a request to reset your password.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td align="center">
          <a href="${opts.resetUrl}"
             style="display:inline-block;background:${BRAND_COLOR};color:#000000;font-weight:900;font-size:14px;
                    letter-spacing:0.06em;text-decoration:none;padding:14px 32px;border-radius:8px;">
            RESET PASSWORD
          </a>
        </td>
      </tr>
    </table>

    <p style="font-size:12px;color:#666666;margin:0 0 8px;">
      This link expires <strong style="color:#aaaaaa;">${expiryStr} ET</strong>.
      If you did not request a password reset, you can safely ignore this email.
    </p>

    <hr style="border:none;border-top:1px solid ${BORDER_COLOR};margin:20px 0;" />

    <p style="font-size:11px;color:#444444;margin:0;word-break:break-all;">
      If the button above doesn't work, copy and paste this URL into your browser:<br/>
      <a href="${opts.resetUrl}" style="color:#555555;">${opts.resetUrl}</a>
    </p>
  `;

  const html = buildEmailHtml({
    title: "Reset your Dime AI password",
    preheader: "Click the link to reset your password. Expires in 30 minutes.",
    bodyHtml,
  });

  const transporter = getTransporter();

  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: "Reset your Dime AI password",
      html,
      text: `Reset your Dime AI password\n\nHi @${opts.username},\n\nClick the link below to reset your password (expires ${expiryStr} ET):\n${opts.resetUrl}\n\nIf you did not request this, ignore this email.\n\n— Dime AI`,
    });
    console.log(`${TAG} [OUTPUT] Email sent messageId=${info.messageId} to=${opts.toEmail}`);
    console.log(`${TAG} [VERIFY] PASS`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [VERIFY] FAIL — SMTP error: ${msg}`);
    throw err;
  }
}

// ─── sendWelcomeEmail ─────────────────────────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  toEmail: string;
  username: string;
  planLabel: string; // e.g. "Monthly Plan" | "Annual Plan"
  expiryDate: Date | null;
}): Promise<void> {
  const TAG = "[Email][sendWelcomeEmail]";
  console.log(`${TAG} [INPUT] to=${opts.toEmail} username=${opts.username} plan=${opts.planLabel}`);

  const expiryLine = opts.expiryDate
    ? `<p style="font-size:12px;color:#666666;margin:0 0 0;">
         Your access is active through <strong style="color:#aaaaaa;">${opts.expiryDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong>.
       </p>`
    : "";

  const bodyHtml = `
    <h1 style="font-size:20px;font-weight:900;color:#ffffff;margin:0 0 8px;letter-spacing:0.04em;">You're In.</h1>
    <p style="font-size:13px;color:#aaaaaa;margin:0 0 20px;">
      Welcome, <strong style="color:#ffffff;">@${opts.username}</strong>. Your <strong style="color:${BRAND_COLOR};">${opts.planLabel}</strong> is now active.
    </p>

    <div style="background:#0d0d0d;border:1px solid ${BORDER_COLOR};border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <p style="font-size:11px;color:#666666;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 10px;font-weight:700;">What you now have access to</p>
      <ul style="margin:0;padding-left:18px;color:#aaaaaa;font-size:12px;line-height:1.8;">
        <li>Full AI Model Projections board &mdash; every game, priced (MLB live; World Cup 2026 in the engine)</li>
        <li>Dime Chat &mdash; ask the engine anything on the slate</li>
        <li>The Dime Verdict on every market: Pass, Monitor, or Edge Detected</li>
        <li>Live edge grades, honest PASS signals</li>
        <li>Graded against the close after the final out</li>
      </ul>
    </div>

    ${expiryLine}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
      <tr>
        <td align="center">
          <a href="https://aisportsbettingmodels.com/feed/model/mlb"
             style="display:inline-block;background:${BRAND_COLOR};color:#000000;font-weight:900;font-size:14px;
                    letter-spacing:0.06em;text-decoration:none;padding:14px 32px;border-radius:8px;">
            ENTER THE PLATFORM
          </a>
        </td>
      </tr>
    </table>
  `;

  const html = buildEmailHtml({
    title: "Welcome to Dime AI",
    preheader: `Your ${opts.planLabel} is now active. Enter the platform.`,
    bodyHtml,
  });

  const transporter = getTransporter();

  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: opts.toEmail,
      subject: `Welcome to Dime AI — Your ${opts.planLabel} is active`,
      html,
      text: `Welcome to Dime AI!\n\nHi @${opts.username},\n\nYour ${opts.planLabel} is now active.\n\nEnter the platform: https://aisportsbettingmodels.com/feed/model/mlb\n\n— Dime AI`,
    });
    console.log(`${TAG} [OUTPUT] Welcome email sent messageId=${info.messageId} to=${opts.toEmail}`);
    console.log(`${TAG} [VERIFY] PASS`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} [VERIFY] FAIL — SMTP error: ${msg}`);
    // Welcome email failure is non-fatal — log but don't throw
    console.warn(`${TAG} [STATE] Welcome email failed but account creation proceeds`);
  }
}
