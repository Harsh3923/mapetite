/**
 * mailer.js — Brevo Transactional Email API for sending OTP emails.
 *
 * Uses Brevo's HTTP REST API (not SMTP) — works on Railway free tier.
 *
 * Required env vars:
 *   BREVO_API_KEY=your-brevo-api-key
 *   EMAIL_USER=youraddress@gmail.com  (must be verified as a sender in Brevo)
 *
 * If either is missing, OTPs are printed to the console (dev mode).
 */

const devMode = !process.env.BREVO_API_KEY || !process.env.EMAIL_USER;

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

  const heading = isRegister ? "Verify your email" : "Reset your password";

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

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Mapetite", email: process.env.EMAIL_USER },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Brevo API error ${response.status}: ${err}`);
  }
}
