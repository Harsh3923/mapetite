/**
 * otpStore.js — OTP generation and verification via Prisma OtpToken table
 */

import prisma from "../db.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Creates (or replaces) an OTP for the given email + purpose.
 * Returns the 6-digit code so the caller can email it.
 */
export async function createOtp(email, purpose) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Delete any existing OTP for this email + purpose first
  await prisma.otpToken.deleteMany({ where: { email, purpose } });

  await prisma.otpToken.create({ data: { email, code, purpose, expiresAt } });

  return code;
}

/**
 * Verifies an OTP. Returns true if valid; false if missing, wrong, or expired.
 * Deletes the token on success (single-use).
 */
export async function verifyOtp(email, code, purpose) {
  const token = await prisma.otpToken.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: "desc" },
  });

  if (!token) return false;
  if (token.code !== code) return false;
  if (token.expiresAt < new Date()) {
    await prisma.otpToken.delete({ where: { id: token.id } });
    return false;
  }

  // Valid — consume it
  await prisma.otpToken.delete({ where: { id: token.id } });
  return true;
}
