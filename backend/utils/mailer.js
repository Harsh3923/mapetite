/**
 * mailer.js — Nodemailer Gmail transporter for sending OTP emails.
 *
 * Setup: add to .env
 *   EMAIL_USER=youraddress@gmail.com
 *   EMAIL_PASS=your-16-char-gmail-app-password
 *
 * Gmail App Password guide:
 *   1. Enable 2-Step Verification on your Google Account
 *   2. Go to Security → App passwords → create one for "Mail"
 *   3. Paste the 16-char password (no spaces) as EMAIL_PASS
 *
 * If EMAIL_USER / EMAIL_PASS are not set, OTPs are printed to the console
 * so you can test locally without email configuration.
 */

import nodemailer from "nodemailer";

const devMode = !process.env.EMAIL_USER || !process.env.EMAIL_PASS;

let transporter = null;

if (!devMode) {
  transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

/**
 * Sends an OTP email.
 * @param {string} to      - recipient email
 * @param {string} code    - 6-digit OTP
 * @param {"register"|"reset"} purpose
 */
export async function sendOtp(to, code, purpose) {
  const isRegister = purpose === "register";

  const subject = isRegister
    ? "Your Mapetite verification code"
    : "Reset your Mapetite password";

  const heading = isRegister
    ? "Verify your email"
    : "Reset your password";

  const body = isRegister
    ? "Thanks for joining Mapetite! Use the code below to verify your email address."
    : "We received a request to reset your password. Use the code below to continue.";

  const html = `
    <div style="font-family:'DM Sans',Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:linear-gradient(135deg,#7C3AED,#EC4899);padding:32px 32px 24px;text-align:center;">
        <span style="font-size:22px;font-weight:800;letter-spacing:0.18em;color:#fff;">MAPETITE</span>
        <p style="color:rgba(255,255,255,0.8);font-size:12px;margin:4px 0 0;font-style:italic;">Map your appetite, before you forget it.</p>
      </div>
      <div style="padding:32px;">
        <h2 style="font-size:20px;font-weight:700;color:#1A1029;margin:0 0 10px;">${heading}</h2>
        <p style="font-size:14px;color:#6B7280;line-height:1.6;margin:0 0 28px;">${body}</p>
        <div style="background:#F3F0FF;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
          <span style="font-size:38px;font-weight:800;letter-spacing:14px;color:#7C3AED;">${code}</span>
        </div>
        <p style="font-size:13px;color:#9CA3AF;text-align:center;margin:0;">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      </div>
      <div style="background:#F9F9FF;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
        <p style="font-size:12px;color:#9CA3AF;margin:0;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    </div>
  `;

  if (devMode) {
    console.log(`\n━━━ OTP (DEV MODE — email not configured) ━━━`);
    console.log(`  To:      ${to}`);
    console.log(`  Purpose: ${purpose}`);
    console.log(`  Code:    ${code}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    return;
  }

  await transporter.sendMail({
    from: `"Mapetite" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
}
