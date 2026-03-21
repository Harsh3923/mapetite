/**
 * app.js — Orchestrator
 * Bootstraps the app: checks for existing session, initialises map,
 * loads saved places, and wires all modules together.
 */

import { initMap, setMapTheme, getDefaultIsNight } from "./map.js";
import { initAuth, openAuthModal } from "./auth.js";
import { initPlaces, loadSavedPlaces, getSavedPlaces } from "./places.js";
import { initCollections, setPlacesGetter } from "./collections.js";

// ─── Configuration ────────────────────────────────────────────────────────────

export const CONFIG = {
  API_BASE: "https://mapetite-production.up.railway.app/api",
  // ⚠️  PASTE YOUR MAPTILER API KEY BELOW
  // Get one free at: https://cloud.maptiler.com/account/keys/
  MAPTILER_KEY: "mdrP4F4iWZ6JNXoVAtqR",
};

// ─── App State ────────────────────────────────────────────────────────────────

const state = {
  user: null,
  accessToken: null,
};

export function getState() { return state; }

export function setState(updates) {
  Object.assign(state, updates);
  onStateChange();
}

// ─── authFetch ────────────────────────────────────────────────────────────────
// Wraps fetch with Authorization header + silent token refresh on 401.

export async function authFetch(url, options = {}) {
  const doRequest = (token) =>
    fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await doRequest(state.accessToken);

  // If 401, try refreshing the token once
  if (res.status === 401) {
    const refreshed = await silentRefresh();
    if (refreshed) {
      res = await doRequest(state.accessToken);
    } else {
      // Refresh failed — user is logged out
      setState({ user: null, accessToken: null });
      return res;
    }
  }

  return res;
}

// ─── Silent Refresh ───────────────────────────────────────────────────────────
// Attempts to get a new access token using the httpOnly refresh cookie.

async function silentRefresh() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });

    if (!res.ok) return false;

    const data = await res.json();
    setState({ accessToken: data.accessToken, user: data.user });
    return true;
  } catch {
    return false;
  }
}

// ─── State Change Handler ─────────────────────────────────────────────────────

function onStateChange() {
  const { user } = state;
  const btnAuth = document.getElementById("btn-auth");
  const btnSaves = document.getElementById("btn-saves");
  const btnCollections = document.getElementById("btn-collections");
  const userAvatar = document.getElementById("user-avatar");

  if (user) {
    btnAuth.classList.add("hidden");
    btnSaves.classList.remove("hidden");
    btnCollections.classList.remove("hidden");
    userAvatar.classList.remove("hidden");
    const initials = user.firstName && user.lastName
      ? user.firstName[0].toUpperCase() + user.lastName[0].toUpperCase()
      : user.email[0].toUpperCase();
    userAvatar.textContent = initials;
    userAvatar.title = user.firstName ? `${user.firstName} ${user.lastName}` : user.email;
  } else {
    btnAuth.classList.remove("hidden");
    btnSaves.classList.add("hidden");
    btnCollections.classList.add("hidden");
    userAvatar.classList.add("hidden");
    closeLogoutDropdown();
    window.dispatchEvent(new CustomEvent("savour:auth-changed", { detail: { loggedIn: false } }));
  }
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(isNight) {
  document.documentElement.dataset.theme = isNight ? "dark" : "";
  setMapTheme(isNight);
}

// ─── Logout Dropdown ──────────────────────────────────────────────────────────

function toggleLogoutDropdown() {
  const dd = document.getElementById("logout-dropdown");
  const isHidden = dd.classList.contains("hidden");
  if (isHidden) {
    const u = state.user;
    document.getElementById("logout-email").textContent =
      u?.firstName ? `${u.firstName} ${u.lastName}  ·  ${u.email}` : u?.email || "";
    dd.classList.remove("hidden");
    setTimeout(() => document.addEventListener("click", closeOnOutside, { once: true }), 0);
  } else {
    closeLogoutDropdown();
  }
}

function closeLogoutDropdown() {
  document.getElementById("logout-dropdown")?.classList.add("hidden");
}

function closeOnOutside(e) {
  if (!e.target.closest("#logout-dropdown") && !e.target.closest("#user-avatar")) {
    closeLogoutDropdown();
  }
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  toast.innerHTML = `<span style="font-weight:600;color:var(--color-${type === "success" ? "success" : type === "error" ? "danger" : "accent"})">${icon}</span>${message}`;

  container.appendChild(toast);

  // Auto-remove after 3.5s
  setTimeout(() => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }, 3500);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  // 1. Initialise the 3D map immediately (no auth needed)
  initMap(CONFIG.MAPTILER_KEY);

  // 2. Set up auth UI (modal, forms)
  initAuth();

  // 3. Try silent login using refresh token cookie
  const loggedIn = await silentRefresh();

  if (loggedIn) {
    // 4. Load saved places onto the map
    await loadSavedPlaces();
  }

  // 5. Initialise places + collections modules
  initPlaces();
  initCollections();
  setPlacesGetter(getSavedPlaces);

  // 6. Wire nav buttons
  document.getElementById("btn-auth").addEventListener("click", openAuthModal);
  document.getElementById("user-avatar").addEventListener("click", toggleLogoutDropdown);
  document.getElementById("btn-confirm-logout").addEventListener("click", () => { closeLogoutDropdown(); logout(); });
  document.getElementById("btn-cancel-logout").addEventListener("click", closeLogoutDropdown);

  // 7. Day / night toggle — default based on current hour
  const themeCheckbox = document.getElementById("theme-checkbox");
  const isNight = getDefaultIsNight();
  applyTheme(isNight);
  themeCheckbox.checked = isNight;
  themeCheckbox.addEventListener("change", () => applyTheme(themeCheckbox.checked));
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout() {
  try {
    await fetch(`${CONFIG.API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Ignore network errors — clear state regardless
  }

  setState({ user: null, accessToken: null });
  showToast("You've been signed out", "info");
}

// ─── Start ────────────────────────────────────────────────────────────────────

bootstrap();
