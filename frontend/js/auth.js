/**
 * auth.js — Authentication UI & Token Management
 * Handles login, OTP-verified registration, and forgot-password flow.
 */

import { CONFIG, setState, showToast } from "./app.js";
import { loadSavedPlaces } from "./places.js";

// ─── Module State ─────────────────────────────────────────────────────────────

let otpPurpose = null;      // "register" | "reset"
let otpEmail = "";
let pendingToken = "";      // carries hashed creds for registration
let resetToken = "";        // authorises password change after reset OTP
let countdownInterval = null;

// ─── Screens ──────────────────────────────────────────────────────────────────

const SCREENS = [
  "form-login",
  "form-register",
  "screen-otp",
  "screen-reset-password",
  "screen-success",
];

function showScreen(id) {
  SCREENS.forEach((s) => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle("hidden", s !== id);
  });

  // Tabs visible only on login / register screens
  const tabsEl = document.querySelector(".modal-tabs");
  if (tabsEl) {
    tabsEl.style.display = (id === "form-login" || id === "form-register") ? "" : "none";
  }
}

// ─── Modal Init ───────────────────────────────────────────────────────────────

export function initAuth() {
  // Tab switching
  document.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // "Don't have an account?" / "Already have one?" cross-links
  document.querySelectorAll(".link-btn[data-switch]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.switch));
  });

  // Close modal
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-overlay")) closeAuthModal();
  });
  document.getElementById("modal-close").addEventListener("click", closeAuthModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("modal-overlay").classList.contains("hidden")) {
      closeAuthModal();
    }
  });

  // Form submissions
  document.getElementById("form-login").addEventListener("submit", handleLogin);
  document.getElementById("form-register").addEventListener("submit", handleRegister);

  // OTP screen buttons
  document.getElementById("btn-verify-otp").addEventListener("click", handleVerifyOtp);
  document.getElementById("btn-resend-otp").addEventListener("click", handleResendOtp);
  document.getElementById("btn-otp-back").addEventListener("click", handleOtpBack);

  // OTP box auto-advance
  initOtpBoxes();

  // Forgot password
  document.getElementById("btn-forgot-password").addEventListener("click", handleForgotPassword);

  // Reset password
  document.getElementById("btn-set-password").addEventListener("click", handleSetPassword);

  // Password visibility toggles (works for all .toggle-pw buttons)
  document.querySelectorAll(".toggle-pw").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".input-wrap").querySelector("input");
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.querySelector(".eye-icon").classList.toggle("hidden", isHidden);
      btn.querySelector(".eye-off-icon").classList.toggle("hidden", !isHidden);
      btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
    });
  });
}

// ─── Open / Close ─────────────────────────────────────────────────────────────

export function openAuthModal(tab = "login") {
  document.getElementById("modal-overlay").classList.remove("hidden");
  switchTab(tab);
  setTimeout(() => {
    const firstInput = document.getElementById(tab === "login" ? "login-email" : "register-firstname");
    firstInput?.focus();
  }, 50);
}

function closeAuthModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  clearErrors();
  stopCountdown();
}

function switchTab(tabName) {
  document.querySelectorAll(".modal-tab").forEach((t) => {
    const active = t.dataset.tab === tabName;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", active);
  });
  showScreen(tabName === "login" ? "form-login" : "form-register");
  clearErrors();
}

// ─── OTP Box Behaviour ────────────────────────────────────────────────────────

function initOtpBoxes() {
  const boxes = document.querySelectorAll(".otp-box");

  boxes.forEach((box, i) => {
    box.addEventListener("input", (e) => {
      // Allow only digits
      box.value = box.value.replace(/\D/g, "").slice(-1);
      box.classList.toggle("filled", box.value !== "");
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && i > 0) {
        boxes[i - 1].value = "";
        boxes[i - 1].classList.remove("filled");
        boxes[i - 1].focus();
      }
      if (e.key === "ArrowLeft" && i > 0) boxes[i - 1].focus();
      if (e.key === "ArrowRight" && i < boxes.length - 1) boxes[i + 1].focus();
    });

    box.addEventListener("paste", (ev) => {
      ev.preventDefault();
      const text = ev.clipboardData.getData("text").replace(/\D/g, "");
      [...text].slice(0, 6).forEach((ch, j) => {
        if (boxes[j]) {
          boxes[j].value = ch;
          boxes[j].classList.add("filled");
        }
      });
      boxes[Math.min(text.length, 5)].focus();
    });
  });
}

function getOtpCode() {
  return [...document.querySelectorAll(".otp-box")].map((b) => b.value).join("");
}

function clearOtpBoxes() {
  document.querySelectorAll(".otp-box").forEach((b) => {
    b.value = "";
    b.classList.remove("filled");
  });
  document.querySelectorAll(".otp-box")[0]?.focus();
}

// ─── Countdown Timer ──────────────────────────────────────────────────────────

function startCountdown(seconds = 60) {
  stopCountdown();
  let remaining = seconds;

  const countdownEl = document.getElementById("otp-countdown");
  const timerText = document.getElementById("otp-timer-text");
  const resendBtn = document.getElementById("btn-resend-otp");

  timerText.classList.remove("hidden");
  resendBtn.classList.add("hidden");
  if (countdownEl) countdownEl.textContent = remaining;

  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (countdownEl) countdownEl.textContent = remaining;
    if (remaining <= 0) {
      stopCountdown();
      timerText.classList.add("hidden");
      resendBtn.classList.remove("hidden");
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function showOtpScreen(email) {
  otpEmail = email;
  document.getElementById("otp-email-display").textContent = email;
  clearOtpBoxes();
  clearErrors();
  showScreen("screen-otp");
  startCountdown(60);
  document.querySelectorAll(".otp-box")[0]?.focus();
}

// ─── Register ─────────────────────────────────────────────────────────────────

async function handleRegister(e) {
  e.preventDefault();
  clearErrors();

  const firstName = document.getElementById("register-firstname").value.trim();
  const lastName  = document.getElementById("register-lastname").value.trim();
  const email     = document.getElementById("register-email").value.trim();
  const password  = document.getElementById("register-password").value;
  const confirm   = document.getElementById("register-confirm").value;
  const submitBtn = document.getElementById("register-submit");

  if (!firstName || !lastName) {
    return showFormError("register-error", "Please enter your first and last name");
  }
  if (password.length < 8) {
    return showFormError("register-error", "Password must be at least 8 characters");
  }
  if (password !== confirm) {
    return showFormError("register-error", "Passwords do not match");
  }

  setLoading(submitBtn, true, "Continue");

  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/send-registration-otp`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email, password, confirmPassword: confirm }),
    });

    const data = await res.json();

    if (!res.ok) {
      return showFormError("register-error", data.error || "Registration failed");
    }

    pendingToken = data.pendingToken;
    otpPurpose = "register";
    showOtpScreen(email);
  } catch {
    showFormError("register-error", "Network error — is the server running?");
  } finally {
    setLoading(submitBtn, false, "Continue");
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  clearErrors();
  document.getElementById("forgot-password-hint").classList.add("hidden");

  const email     = document.getElementById("login-email").value.trim();
  const password  = document.getElementById("login-password").value;
  const rememberMe = document.getElementById("login-remember").checked;
  const submitBtn = document.getElementById("login-submit");

  setLoading(submitBtn, true, "Sign In");

  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, rememberMe }),
    });

    const data = await res.json();

    if (!res.ok) {
      showFormError("login-error", data.error || "Login failed");
      // Show forgot-password hint only when the password was specifically wrong
      if (data.code === "WRONG_PASSWORD") {
        document.getElementById("forgot-password-hint").classList.remove("hidden");
      }
      return;
    }

    setState({ user: data.user, accessToken: data.accessToken });
    closeAuthModal();
    const name = data.user.firstName || data.user.email.split("@")[0];
    showToast(`Welcome back, ${name}! 👋`, "success");
    await loadSavedPlaces();
  } catch {
    showFormError("login-error", "Network error — is the server running?");
  } finally {
    setLoading(submitBtn, false, "Sign In");
  }
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

async function handleForgotPassword() {
  clearErrors();

  // Pre-fill with whatever email they typed in login
  const email = document.getElementById("login-email").value.trim();

  if (!email) {
    showFormError("login-error", "Enter your email above first");
    return;
  }

  const btn = document.getElementById("btn-forgot-password");
  btn.textContent = "Sending…";
  btn.disabled = true;

  try {
    await fetch(`${CONFIG.API_BASE}/auth/send-reset-otp`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    // Always continue regardless of whether email exists (no enumeration)
    otpPurpose = "reset";
    showOtpScreen(email);
  } catch {
    showFormError("login-error", "Network error — is the server running?");
  } finally {
    btn.textContent = "Reset it";
    btn.disabled = false;
  }
}

// ─── OTP Verify ───────────────────────────────────────────────────────────────

async function handleVerifyOtp() {
  clearErrors();
  const code = getOtpCode();

  if (code.length < 6) {
    return showFormError("otp-error", "Please enter all 6 digits");
  }

  const btn = document.getElementById("btn-verify-otp");
  setLoading(btn, true, "Verify");

  try {
    if (otpPurpose === "register") {
      await verifyRegistrationOtp(code);
    } else {
      await verifyResetOtp(code);
    }
  } finally {
    setLoading(btn, false, "Verify");
  }
}

async function verifyRegistrationOtp(code) {
  const res = await fetch(`${CONFIG.API_BASE}/auth/verify-registration-otp`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: otpEmail, code, pendingToken }),
  });

  const data = await res.json();

  if (!res.ok) {
    clearOtpBoxes();
    return showFormError("otp-error", data.error || "Verification failed");
  }

  stopCountdown();
  setState({ user: data.user, accessToken: data.accessToken });

  // Show success then auto-close
  document.getElementById("success-title").textContent = `Welcome, ${data.user.firstName}! 🎉`;
  document.getElementById("success-sub").textContent = "Your account is ready. Start mapping your appetite.";
  showScreen("screen-success");
  await loadSavedPlaces();

  setTimeout(() => {
    closeAuthModal();
    showToast(`Account created — let's go, ${data.user.firstName}!`, "success");
  }, 2200);
}

async function verifyResetOtp(code) {
  const res = await fetch(`${CONFIG.API_BASE}/auth/verify-reset-otp`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: otpEmail, code }),
  });

  const data = await res.json();

  if (!res.ok) {
    clearOtpBoxes();
    return showFormError("otp-error", data.error || "Verification failed");
  }

  stopCountdown();
  resetToken = data.resetToken;
  showScreen("screen-reset-password");
  document.getElementById("reset-new-password").focus();
}

// ─── Resend OTP ───────────────────────────────────────────────────────────────

async function handleResendOtp() {
  clearErrors();
  clearOtpBoxes();

  const endpoint = otpPurpose === "register"
    ? `${CONFIG.API_BASE}/auth/send-registration-otp`
    : `${CONFIG.API_BASE}/auth/send-reset-otp`;

  const body = otpPurpose === "register"
    ? JSON.stringify({ email: otpEmail, pendingToken })   // server ignores fields it doesn't need
    : JSON.stringify({ email: otpEmail });

  const btn = document.getElementById("btn-resend-otp");
  btn.disabled = true;
  btn.textContent = "Sending…";

  try {
    await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body,
    });
    startCountdown(60);
  } catch {
    showFormError("otp-error", "Network error — could not resend code");
  } finally {
    btn.disabled = false;
    btn.textContent = "Resend code";
  }
}

function handleOtpBack() {
  stopCountdown();
  clearErrors();
  if (otpPurpose === "register") {
    switchTab("register");
  } else {
    switchTab("login");
  }
}

// ─── Set New Password ─────────────────────────────────────────────────────────

async function handleSetPassword() {
  clearErrors();

  const newPassword     = document.getElementById("reset-new-password").value;
  const confirmPassword = document.getElementById("reset-confirm-password").value;
  const btn = document.getElementById("btn-set-password");

  if (newPassword.length < 8) {
    return showFormError("reset-error", "Password must be at least 8 characters");
  }
  if (newPassword !== confirmPassword) {
    return showFormError("reset-error", "Passwords do not match");
  }

  setLoading(btn, true, "Set New Password");

  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/reset-password`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetToken, newPassword, confirmPassword }),
    });

    const data = await res.json();

    if (!res.ok) {
      return showFormError("reset-error", data.error || "Failed to reset password");
    }

    // Success
    document.getElementById("success-title").textContent = "Password reset! ✓";
    document.getElementById("success-sub").textContent = "You can now sign in with your new password.";
    showScreen("screen-success");

    setTimeout(() => {
      closeAuthModal();
      // Restore tabs visibility and switch to login
      const tabsEl = document.querySelector(".modal-tabs");
      if (tabsEl) tabsEl.style.display = "";
      showToast("Password updated — sign in to continue", "success");
    }, 2200);
  } catch {
    showFormError("reset-error", "Network error — is the server running?");
  } finally {
    setLoading(btn, false, "Set New Password");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showFormError(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

function clearErrors() {
  document.querySelectorAll(".form-error").forEach((el) => {
    el.classList.add("hidden");
    el.textContent = "";
  });
}

function setLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.innerHTML = loading ? `<span class="spinner"></span>` : label;
}
