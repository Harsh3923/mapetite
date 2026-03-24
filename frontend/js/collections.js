/**
 * collections.js — Collections UI
 * Handles creating, listing, assigning, and viewing collections.
 */

import { CONFIG, authFetch, getState, showToast } from "./app.js";

// ─── State ────────────────────────────────────────────────────────────────────

let collections = [];
let selectedColor = "#FF8C00";
let pickerCallback = null;
let currentDetailCollectionId = null;
let getPlacesCallback = () => [];

const COLORS = [
  { hex: "#FF8C00", name: "Amber"  },
  { hex: "#E63946", name: "Red"    },
  { hex: "#06D6A0", name: "Mint"   },
  { hex: "#118AB2", name: "Blue"   },
  { hex: "#8338EC", name: "Purple" },
  { hex: "#FB5607", name: "Orange" },
  { hex: "#FF006E", name: "Pink"   },
  { hex: "#3A86FF", name: "Sky"    },
  { hex: "#FFBE0B", name: "Yellow" },
  { hex: "#2EC4B6", name: "Teal"   },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export function getCollections() { return collections; }

/** Called from app.js to give collections.js access to saved places without a circular import */
export function setPlacesGetter(fn) { getPlacesCallback = fn; }

export async function loadCollections() {
  if (!getState().accessToken) return;
  try {
    const res = await authFetch(`${CONFIG.API_BASE}/collections`);
    if (!res.ok) return;
    const data = await res.json();
    collections = data.collections || [];

    // If a detail view is open, refresh it; otherwise refresh the main list
    if (currentDetailCollectionId) {
      const col = collections.find((c) => c.id === currentDetailCollectionId);
      if (col) {
        refreshDetailView(col);
      } else {
        // Collection was deleted — go back to list
        hideCollectionDetail();
      }
    } else {
      renderCollectionsList();
    }
  } catch (err) {
    console.error("Failed to load collections:", err);
  }
}

export function initCollections() {
  initCollectionsSidebar();
  initCreateModal();
}

// ─── Collections Sidebar ──────────────────────────────────────────────────────

function initCollectionsSidebar() {
  const sidebar = document.getElementById("collections-sidebar");

  document.getElementById("btn-collections").addEventListener("click", () => {
    if (sidebar.classList.contains("open")) {
      closeCollectionsSidebar();
    } else {
      sidebar.classList.remove("hidden");
      requestAnimationFrame(() => sidebar.classList.add("open"));
    }
  });

  document.getElementById("collections-sidebar-close").addEventListener("click", closeCollectionsSidebar);
  document.getElementById("btn-new-collection").addEventListener("click", openCreateModal);

  document.addEventListener("click", (e) => {
    if (
      sidebar.classList.contains("open") &&
      !e.target.closest("#collections-sidebar") &&
      !e.target.closest("#btn-collections")
    ) {
      closeCollectionsSidebar();
    }
  });
}

function closeCollectionsSidebar() {
  document.getElementById("collections-sidebar").classList.remove("open");
}

function renderCollectionsList() {
  const list = document.getElementById("collections-list");
  const empty = document.getElementById("collections-empty");

  if (collections.length === 0) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }

  empty?.classList.add("hidden");

  list.innerHTML = collections
    .map((col) => {
      const count = col._count?.places ?? 0;
      return `
        <li class="collection-item" data-id="${col.id}" style="cursor:pointer">
          <span class="collection-dot" style="background:${col.color}"></span>
          <span class="collection-item-name">${escapeHtml(col.name)}</span>
          <span class="collection-item-count">${count}</span>
          <button class="collection-item-delete" data-id="${col.id}" aria-label="Delete ${escapeHtml(col.name)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
          </button>
        </li>
      `;
    })
    .join("");

  list.querySelectorAll(".collection-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.closest(".collection-item-delete")) return;
      const col = collections.find((c) => c.id === item.dataset.id);
      if (col) showCollectionDetail(col);
    });
  });

  list.querySelectorAll(".collection-item-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCollection(btn.dataset.id);
    });
  });
}

async function deleteCollection(id) {
  try {
    const res = await authFetch(`${CONFIG.API_BASE}/collections/${id}`, { method: "DELETE" });
    if (!res.ok) { showToast("Failed to delete collection", "error"); return; }
    collections = collections.filter((c) => c.id !== id);
    renderCollectionsList();
    showToast("Collection deleted", "info");
    window.dispatchEvent(new CustomEvent("collections:deleted", { detail: { collectionId: id } }));
  } catch {
    showToast("Network error", "error");
  }
}

// ─── Collection Detail View ───────────────────────────────────────────────────

function showCollectionDetail(col) {
  currentDetailCollectionId = col.id;

  // Swap header
  const titleEl = document.querySelector("#collections-sidebar .sidebar-title");
  titleEl.innerHTML = `
    <button class="collections-back-btn" id="collections-back-btn" aria-label="Back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>
    <span class="collection-dot" style="background:${col.color};width:10px;height:10px"></span>
    <span style="font-size:15px;font-weight:600">${escapeHtml(col.name)}</span>
  `;
  document.getElementById("collections-back-btn").addEventListener("click", hideCollectionDetail);

  // Hide list + new button
  document.getElementById("collections-list").classList.add("hidden");
  document.getElementById("btn-new-collection").classList.add("hidden");
  document.getElementById("collections-empty")?.classList.add("hidden");

  // Show or create detail container
  let detailEl = document.getElementById("collection-detail");
  if (!detailEl) {
    detailEl = document.createElement("div");
    detailEl.id = "collection-detail";
    detailEl.style.cssText = "flex:1;overflow-y:auto;";
    document.getElementById("collections-sidebar").appendChild(detailEl);
  }
  detailEl.classList.remove("hidden");
  renderDetailPlaces(col, detailEl);
}

function hideCollectionDetail() {
  currentDetailCollectionId = null;

  // Restore header
  const titleEl = document.querySelector("#collections-sidebar .sidebar-title");
  titleEl.innerHTML = `<h3>My Collections</h3>`;

  document.getElementById("collections-list").classList.remove("hidden");
  document.getElementById("btn-new-collection").classList.remove("hidden");
  document.getElementById("collection-detail")?.classList.add("hidden");
  renderCollectionsList();
}

function refreshDetailView(col) {
  // Update the count in the header dot tooltip if needed, then re-render places
  const detailEl = document.getElementById("collection-detail");
  if (detailEl && !detailEl.classList.contains("hidden")) {
    renderDetailPlaces(col, detailEl);
  }
}

function renderDetailPlaces(col, container) {
  const allPlaces = getPlacesCallback();
  const places = allPlaces.filter(
    (p) => p.collection?.id === col.id || p.collectionId === col.id
  );

  if (places.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--color-text-muted)">
        <div style="font-size:32px;margin-bottom:10px">📍</div>
        <p style="font-size:14px">No places in this collection yet.</p>
        <p style="font-size:12px;margin-top:4px">Save a place and add it to <strong>${escapeHtml(col.name)}</strong>.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `<ul class="saves-list">${places.map((place) => `
    <li class="save-item detail-place-item" data-id="${place.id}" data-lng="${place.longitude}" data-lat="${place.latitude}">
      <div class="save-item-icon">${getCategoryEmoji(place.category)}</div>
      <div class="save-item-text">
        <div class="save-item-name">${escapeHtml(place.name)}</div>
        <div class="save-item-address">${escapeHtml((place.address || "").split(",").slice(0, 2).join(","))}</div>
      </div>
      <div class="save-item-actions">
        <button class="save-item-menu-btn detail-move-btn" data-id="${place.id}" title="Move to another collection">···</button>
        <button class="save-item-delete detail-delete-btn" data-id="${place.id}" aria-label="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          </svg>
        </button>
      </div>
      <div class="save-item-move-menu hidden detail-move-menu" data-id="${place.id}"></div>
    </li>
  `).join("")}</ul>`;

  // Fly to place on row click
  container.querySelectorAll(".detail-place-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.closest(".detail-move-btn") || e.target.closest(".detail-delete-btn") || e.target.closest(".detail-move-menu")) return;
      window.dispatchEvent(new CustomEvent("collections:fly-to-place", {
        detail: { placeId: item.dataset.id, lng: parseFloat(item.dataset.lng), lat: parseFloat(item.dataset.lat) }
      }));
      closeCollectionsSidebar();
    });
  });

  // Delete buttons
  container.querySelectorAll(".detail-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("collections:delete-place", { detail: { placeId: btn.dataset.id } }));
    });
  });

  // Move buttons
  container.querySelectorAll(".detail-move-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const placeId = btn.dataset.id;
      const menuEl = container.querySelector(`.detail-move-menu[data-id="${placeId}"]`);
      const isOpen = !menuEl.classList.contains("hidden");
      container.querySelectorAll(".detail-move-menu").forEach((m) => m.classList.add("hidden"));
      if (!isOpen) {
        renderDetailMoveMenu(menuEl, placeId, col.id);
        menuEl.classList.remove("hidden");
      }
    });
  });
}

function renderDetailMoveMenu(menuEl, placeId, currentCollectionId) {
  const others = collections.filter((c) => c.id !== currentCollectionId);

  let html = others.length === 0
    ? `<div class="move-menu-item move-menu-empty">No other collections</div>`
    : others.map((col) => `
        <div class="move-menu-item" data-col-id="${col.id}">
          <span class="collection-dot" style="background:${col.color}"></span>
          Move to ${escapeHtml(col.name)}
        </div>
      `).join("");

  html += `<div class="move-menu-item move-menu-remove" data-col-id="null">Remove from collection</div>`;

  menuEl.innerHTML = html;

  menuEl.querySelectorAll(".move-menu-item[data-col-id]").forEach((item) => {
    if (item.classList.contains("move-menu-empty")) return;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const colId = item.dataset.colId === "null" ? null : item.dataset.colId;
      menuEl.classList.add("hidden");
      window.dispatchEvent(new CustomEvent("collections:move-place", {
        detail: { placeId, collectionId: colId }
      }));
    });
  });
}

// ─── Collection Picker (inline dropdown in place card) ────────────────────────

export function openCollectionPicker(onPick) {
  pickerCallback = onPick;
  const picker = document.getElementById("collection-picker");
  picker.innerHTML = "";

  if (collections.length === 0) {
    picker.innerHTML = `<div class="picker-empty">No collections yet</div>`;
  } else {
    collections.forEach((col) => {
      const item = document.createElement("div");
      item.className = "picker-item";
      item.innerHTML = `<span class="collection-dot" style="background:${col.color}"></span><span>${escapeHtml(col.name)}</span>`;
      item.addEventListener("click", () => { closeCollectionPicker(); pickerCallback?.(col.id); });
      picker.appendChild(item);
    });
  }

  const newBtn = document.createElement("div");
  newBtn.className = "picker-item picker-new";
  newBtn.textContent = "＋ New Collection";
  newBtn.addEventListener("click", () => {
    closeCollectionPicker();
    openCreateModal((newCol) => { if (newCol) pickerCallback?.(newCol.id); });
  });
  picker.appendChild(newBtn);
  picker.classList.remove("hidden");

  setTimeout(() => {
    document.addEventListener("click", closePicerOnOutside, { once: true });
  }, 0);
}

function closePicerOnOutside(e) {
  if (!e.target.closest("#collection-picker") && !e.target.closest("#btn-add-collection")) {
    closeCollectionPicker();
  }
}

export function closeCollectionPicker() {
  document.getElementById("collection-picker").classList.add("hidden");
  document.removeEventListener("click", closePicerOnOutside);
}

// ─── Create Collection Modal ──────────────────────────────────────────────────

let createModalCallback = null;

function initCreateModal() {
  document.getElementById("collection-modal-close").addEventListener("click", closeCreateModal);
  document.getElementById("collection-modal-overlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("collection-modal-overlay")) closeCreateModal();
  });
  document.getElementById("btn-create-collection").addEventListener("click", handleCreate);
  document.getElementById("collection-name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") closeCreateModal();
  });
}

export function openCreateModal(callback) {
  createModalCallback = callback || null;
  selectedColor = "#FF8C00";
  renderColorPalette();
  document.getElementById("collection-name-input").value = "";
  document.getElementById("collection-create-error").textContent = "";
  document.getElementById("collection-modal-overlay").classList.remove("hidden");
  setTimeout(() => document.getElementById("collection-name-input").focus(), 50);
}

function closeCreateModal() {
  document.getElementById("collection-modal-overlay").classList.add("hidden");
  createModalCallback = null;
}

function renderColorPalette() {
  const palette = document.getElementById("color-palette");
  palette.innerHTML = COLORS.map(({ hex, name }) => `
    <button class="color-swatch${hex === selectedColor ? " selected" : ""}" data-color="${hex}" style="background:${hex}" title="${name}" type="button" aria-label="${name}"></button>
  `).join("");

  palette.querySelectorAll(".color-swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => {
      selectedColor = swatch.dataset.color;
      palette.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("selected"));
      swatch.classList.add("selected");
    });
  });
}

async function handleCreate() {
  const nameInput = document.getElementById("collection-name-input");
  const errorEl = document.getElementById("collection-create-error");
  const name = nameInput.value.trim();
  if (!name) { errorEl.textContent = "Give your collection a name"; return; }

  const btn = document.getElementById("btn-create-collection");
  btn.disabled = true;
  errorEl.textContent = "";

  try {
    const res = await authFetch(`${CONFIG.API_BASE}/collections`, {
      method: "POST",
      body: JSON.stringify({ name, color: selectedColor }),
    });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || "Failed to create collection"; return; }

    collections.unshift(data.collection);
    renderCollectionsList();
    showToast(`"${name}" collection created!`, "success");
    closeCreateModal();
    createModalCallback?.(data.collection);
  } catch {
    errorEl.textContent = "Network error";
  } finally {
    btn.disabled = false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryEmoji(category) {
  const map = { restaurant: "🍽️", cafe: "☕", bar: "🍺", bakery: "🥐", pizza: "🍕", sushi: "🍣" };
  return map[category] || "🍜";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
