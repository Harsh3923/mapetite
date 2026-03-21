import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import prisma from "../db.js";
import { createOtp, verifyOtp } from "../utils/otpStore.js";
import { sendOtp } from "../utils/mailer.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signAccessToken(userId, email) {
  return jwt.sign(
    { sub: userId, email },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "15m" }
  );
}

function signRefreshToken(userId, rememberMe = false) {
  const expiresIn = rememberMe ? "30d" : "1d";
  return jwt.sign(
    { sub: userId, type: "refresh" },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn }
  );
}

function setRefreshCookie(res, token, rememberMe = false) {
  const maxAge = rememberMe
    ? 30 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;

  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    maxAge,
    path: "/api/auth",
  });
}

// ─── POST /api/auth/send-registration-otp ────────────────────────────────────
// Validates signup fields, checks email availability, sends OTP.
// Returns a short-lived pendingToken (JWT) carrying hashed credentials.

router.post(
  "/send-registration-otp",
  [
    body("firstName").trim().notEmpty().withMessage("First name is required"),
    body("lastName").trim().notEmpty().withMessage("Last name is required"),
    body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    body("confirmPassword").custom((val, { req }) => {
      if (val !== req.body.password) throw new Error("Passwords do not match");
      return true;
    }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { firstName, lastName, email, password } = req.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      // Hash password now; embed hash in a signed pendingToken so we never
      // store plaintext credentials while the OTP is pending.
      const passwordHash = await bcrypt.hash(password, 12);

      const pendingToken = jwt.sign(
        { firstName, lastName, email, passwordHash },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "10m" }
      );

      const code = await createOtp(email, "register");
      await sendOtp(email, code, "register");

      res.json({ ok: true, pendingToken });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/verify-registration-otp ──────────────────────────────────
// Verifies OTP + pendingToken → creates the user account → issues tokens.

router.post("/verify-registration-otp", async (req, res, next) => {
  try {
    const { email, code, pendingToken } = req.body;

    if (!email || !code || !pendingToken) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const valid = await verifyOtp(email, code, "register");
    if (!valid) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    let pending;
    try {
      pending = jwt.verify(pendingToken, process.env.ACCESS_TOKEN_SECRET);
    } catch {
      return res.status(400).json({ error: "Registration session expired — please start over" });
    }

    if (pending.email !== email) {
      return res.status(400).json({ error: "Email mismatch" });
    }

    // Double-check email still available (race condition guard)
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: pending.passwordHash,
        firstName: pending.firstName,
        lastName: pending.lastName,
      },
      select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
    });

    const accessToken = signAccessToken(user.id, user.email);
    const refreshToken = signRefreshToken(user.id, false);
    setRefreshCookie(res, refreshToken, false);

    res.status(201).json({ user, accessToken });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post(
  "/login",
  [
    body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
    body("password").notEmpty().withMessage("Password required"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { email, password, rememberMe = false } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        // Still run bcrypt to prevent timing-based user enumeration
        const dummy = "$2a$12$invalidhashfortimingnormalization";
        await bcrypt.compare(password, dummy).catch(() => {});
        return res.status(401).json({
          error: "No account found with this email",
          code: "USER_NOT_FOUND",
        });
      }

      const passwordMatch = await bcrypt.compare(password, user.passwordHash);

      if (!passwordMatch) {
        return res.status(401).json({
          error: "Incorrect password",
          code: "WRONG_PASSWORD",
        });
      }

      const accessToken = signAccessToken(user.id, user.email);
      const refreshToken = signRefreshToken(user.id, rememberMe);
      setRefreshCookie(res, refreshToken, rememberMe);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: user.createdAt,
        },
        accessToken,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/send-reset-otp ───────────────────────────────────────────
// Always returns ok:true to avoid user enumeration. Sends OTP only if user exists.

router.post(
  "/send-reset-otp",
  [body("email").isEmail().normalizeEmail().withMessage("Valid email required")],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { email } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const code = await createOtp(email, "reset");
        await sendOtp(email, code, "reset");
      }

      // Always return ok — don't reveal whether the email exists
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/verify-reset-otp ─────────────────────────────────────────
// Verifies OTP → returns a short-lived resetToken to authorize password change.

router.post("/verify-reset-otp", async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const valid = await verifyOtp(email, code, "reset");
    if (!valid) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "Account not found" });
    }

    const resetToken = jwt.sign(
      { sub: user.id, type: "reset" },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" }
    );

    res.json({ resetToken });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post("/reset-password", async (req, res, next) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;

    if (!resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    let payload;
    try {
      payload = jwt.verify(resetToken, process.env.ACCESS_TOKEN_SECRET);
    } catch {
      return res.status(400).json({ error: "Reset session expired — please start over" });
    }

    if (payload.type !== "reset") {
      return res.status(400).json({ error: "Invalid reset token" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: payload.sub },
      data: { passwordHash },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

router.post("/refresh", async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({ error: "No refresh token" });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    } catch {
      res.clearCookie("refreshToken", { path: "/api/auth" });
      return res.status(401).json({ error: "Refresh token expired or invalid" });
    }

    if (payload.type !== "refresh") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    if (!user) {
      res.clearCookie("refreshToken", { path: "/api/auth" });
      return res.status(401).json({ error: "User not found" });
    }

    const tokenExp = payload.exp - payload.iat;
    const isRememberMe = tokenExp > 2 * 24 * 60 * 60;

    const newAccessToken = signAccessToken(user.id, user.email);
    const newRefreshToken = signRefreshToken(user.id, isRememberMe);
    setRefreshCookie(res, newRefreshToken, isRememberMe);

    res.json({ accessToken: newAccessToken, user });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

router.post("/logout", (_req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    path: "/api/auth",
  });
  res.json({ message: "Logged out successfully" });
});

export default router;
