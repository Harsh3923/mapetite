/**
 * places.js — Search, Save, Sidebar
 * Handles Mapbox Geocoding search, saving/unsaving places,
 * the My Saves sidebar, and the place info card.
 */

import { CONFIG, authFetch, getState, showToast } from "./app.js";
import {
  addPlaceToMap,
  removePlaceFromMap,
  loadPlacesOnMap,
  flyToPlace,
  showPinMarker,
  clearPinMarker,
} from "./map.js";
import {
  loadCollections,
  getCollections,
  openCollectionPicker,
  closeCollectionPicker,
} from "./collections.js";

// ─── Module State ─────────────────────────────────────────────────────────────

let savedPlaces = []; // In-memory cache of saved places
let currentPlace = null; // Place currently shown in the info card
let searchDebounce = null;

export function getSavedPlaces() { return savedPlaces; }

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initPlaces() {
  initSearch();
  initPlaceCard();
  initSidebar();

  // Listen for auth state changes (logout → clear everything)
  window.addEventListener("savour:auth-changed", (e) => {
    if (!e.detail.loggedIn) {
      savedPlaces = [];
      loadPlacesOnMap([]);
      renderSidebarList();
      updateSavesCount(0);
      closePlaceCard();
    }
  });

  // Events fired from collection detail view
  window.addEventListener("collections:delete-place", (e) => unsavePlace(e.detail.placeId));
  window.addEventListener("collections:move-place", (e) => moveToCollection(e.detail.placeId, e.detail.collectionId));
  window.addEventListener("collections:fly-to-place", (e) => {
    flyToPlace(e.detail.lng, e.detail.lat);
    showPinMarker(e.detail.lng, e.detail.lat);
    const place = savedPlaces.find((p) => p.id === e.detail.placeId);
    if (place) showPlaceCard(place, true);
  });

  // Listen for map extrusion click → show place card
  window.addEventListener("savour:map-place-clicked", (e) => {
    const place = savedPlaces.find((p) => p.id === e.detail.placeId);
    if (place) {
      showPlaceCard({
        id: place.id,
        name: place.name,
        address: place.address,
        category: place.category,
        latitude: place.latitude,
        longitude: place.longitude,
        mapboxPlaceId: place.mapboxPlaceId,
      }, true);
    }
  });
}

// ─── Load Saved Places ────────────────────────────────────────────────────────

export async function loadSavedPlaces() {
  if (!getState().accessToken) return;

  try {
    const [placesRes] = await Promise.all([
      authFetch(`${CONFIG.API_BASE}/places`),
      loadCollections(),
    ]);
    if (!placesRes.ok) return;

    const data = await placesRes.json();
    savedPlaces = data.places || [];

    loadPlacesOnMap(savedPlaces);
    renderSidebarList();
    updateSavesCount(savedPlaces.length);
  } catch (err) {
    console.error("Failed to load saved places:", err);
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

function initSearch() {
  const input = document.getElementById("search-input");
  const clearBtn = document.getElementById("search-clear");
  const results = document.getElementById("search-results");

  input.addEventListener("input", () => {
    const val = input.value.trim();
    clearBtn.classList.toggle("hidden", !val);

    clearTimeout(searchDebounce);
    if (!val) {
      closeSearchResults();
      return;
    }

    searchDebounce = setTimeout(() => geocode(val), 320);
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.classList.add("hidden");
    closeSearchResults();
    input.focus();
  });

  // Close results on outside click
  document.addEventListener("click", (e) => {
    if (
      !e.target.closest(".search-container") &&
      !results.classList.contains("hidden")
    ) {
      closeSearchResults();
    }
  });

  // Keyboard nav in results
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearchResults();
      input.blur();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const first = results.querySelector(".search-result-item");
      first?.focus();
    }
  });
}

async function geocode(query) {
  const results = document.getElementById("search-results");

  // Show loading state
  results.classList.remove("hidden");
  results.innerHTML = `<li class="search-no-results"><span class="spinner" style="display:inline-block;margin:0 auto"></span></li>`;

  try {
    // Maptiler Geocoding API — free tier, Toronto/GTA biased
    const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json`);
    url.searchParams.set("key", CONFIG.MAPTILER_KEY);
    url.searchParams.set("proximity", "-79.383,43.653"); // Bias toward downtown Toronto
    url.searchParams.set("bbox", "-80.2,43.3,-78.8,44.3"); // Limit to GTA
    url.searchParams.set("types", "poi,address");
    url.searchParams.set("limit", "6");
    url.searchParams.set("language", "en");
    url.searchParams.set("country", "ca"); // Canada only

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!data.features || data.features.length === 0) {
      results.innerHTML = `<li class="search-no-results">No results found for "${query}"</li>`;
      return;
    }

    renderSearchResults(data.features);
  } catch {
    results.innerHTML = `<li class="search-no-results">Search failed — check your connection</li>`;
  }
}

function renderSearchResults(features) {
  const results = document.getElementById("search-results");
  results.innerHTML = "";
  results.classList.remove("hidden");

  features.forEach((feature, i) => {
    const li = document.createElement("li");
    li.className = "search-result-item";
    li.setAttribute("role", "option");
    li.setAttribute("tabindex", "0");

    const category = getPlaceCategory(feature);
    const emoji = getCategoryEmoji(category);
    const name = feature.text || feature.place_name.split(",")[0];
    const address = feature.place_name.replace(name + ", ", "");

    li.innerHTML = `
      <div class="result-icon">${emoji}</div>
      <div class="result-text">
        <div class="result-name">${escapeHtml(name)}</div>
        <div class="result-address">${escapeHtml(address)}</div>
      </div>
    `;

    li.addEventListener("click", () => selectSearchResult(feature));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectSearchResult(feature);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const items = results.querySelectorAll(".search-result-item");
        items[i + 1]?.focus();
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (i === 0) {
          document.getElementById("search-input").focus();
        } else {
          const items = results.querySelectorAll(".search-result-item");
          items[i - 1]?.focus();
        }
      }
    });

    results.appendChild(li);
  });
}

function selectSearchResult(feature) {
  const [lng, lat] = feature.center;
  const name = feature.text || feature.place_name.split(",")[0];
  const address = feature.place_name;
  const category = getPlaceCategory(feature);

  closeSearchResults();
  document.getElementById("search-input").value = name;
  document.getElementById("search-clear").classList.remove("hidden");

  // Fly to location and drop red pin
  flyToPlace(lng, lat);
  showPinMarker(lng, lat);

  // Show place card
  showPlaceCard({
    mapboxPlaceId: feature.id,
    name,
    address,
    category,
    latitude: lat,
    longitude: lng,
  }, false);
}

function closeSearchResults() {
  const results = document.getElementById("search-results");
  results.classList.add("hidden");
  results.innerHTML = "";
}

// ─── Place Card ───────────────────────────────────────────────────────────────

function initPlaceCard() {
  document.getElementById("place-card-close").addEventListener("click", closePlaceCard);
  document.getElementById("place-card-collapse").addEventListener("click", closePlaceCard);
  document.getElementById("btn-save").addEventListener("click", handleSaveToggle);
  document.getElementById("btn-save-notes").addEventListener("click", handleSaveNotes);
  document.getElementById("btn-add-collection").addEventListener("click", handleAddToCollection);

  // Close card when tapping outside (on the map)
  document.addEventListener("click", (e) => {
    const card = document.getElementById("place-card");
    if (card.classList.contains("hidden")) return;
    if (
      !e.target.closest("#place-card") &&
      !e.target.closest("#search-results") &&
      !e.target.closest("#search-input") &&
      !e.target.closest(".maplibregl-canvas")
    ) return;
    if (e.target.closest("#place-card")) return;
    closePlaceCard();
  });

  // Close card when tapping the map canvas directly
  document.getElementById("map").addEventListener("click", (e) => {
    const card = document.getElementById("place-card");
    if (!card.classList.contains("hidden") && !e.target.closest("#place-card")) {
      closePlaceCard();
    }
  });
}

function showPlaceCard(place, isSaved) {
  currentPlace = place;

  document.getElementById("place-card-name").textContent = place.name;
  document.getElementById("place-card-address").textContent = place.address;
  document.getElementById("place-card-category").textContent =
    place.category || "Food & Drink";

  // Determine if already saved
  const savedVersion = savedPlaces.find(
    (p) => p.mapboxPlaceId === place.mapboxPlaceId || p.id === place.id
  );
  const actuallyIsSaved = isSaved || !!savedVersion;

  updateSaveButton(actuallyIsSaved, savedVersion);

  // Build the Google Maps "More Info" query from name + address (works saved or not)
  const name    = place.name    ?? savedVersion?.name    ?? "";
  const address = place.address ?? savedVersion?.address ?? "";
  const query   = encodeURIComponent([name, address].filter(Boolean).join(", "));
  const mapsInfoHref = `https://www.google.com/maps/search/?api=1&query=${query}`;

  // Action row (Directions + More Info) — saved state
  const actionRow     = document.getElementById("place-action-row");
  const directionsBtn = document.getElementById("btn-directions");
  const moreInfoBtn   = document.getElementById("btn-more-info");

  // Standalone More Info — unsaved state (full-width below Add/Save row)
  const moreInfoCard  = document.getElementById("btn-more-info-card");

  if (actuallyIsSaved) {
    const lat = place.latitude  ?? savedVersion?.latitude;
    const lng = place.longitude ?? savedVersion?.longitude;
    directionsBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    moreInfoBtn.href   = mapsInfoHref;
    actionRow.classList.remove("hidden");
    moreInfoCard.classList.add("hidden");
  } else {
    actionRow.classList.add("hidden");
    moreInfoCard.href = mapsInfoHref;
    moreInfoCard.classList.remove("hidden");
  }

  // Notes section
  const notesSection = document.getElementById("place-card-notes-section");
  const notesInput = document.getElementById("place-notes-input");
  if (actuallyIsSaved) {
    notesSection.classList.remove("hidden");
    notesInput.value = savedVersion?.notes || "";
    currentPlace.id = savedVersion?.id || place.id;
  } else {
    notesSection.classList.add("hidden");
    notesInput.value = "";
  }

  const card = document.getElementById("place-card");
  card.classList.remove("hidden");
  card.classList.add("slide-in");
}

function closePlaceCard() {
  const card = document.getElementById("place-card");
  card.classList.add("hidden");
  card.classList.remove("slide-in");
  currentPlace = null;
  clearPinMarker();
}

function updateSaveButton(isSaved, savedVersion = null) {
  const btn = document.getElementById("btn-save");
  const addColBtn = document.getElementById("btn-add-collection");

  if (isSaved) {
    // Already saved — show unsave button, hide collection picker button
    const col = savedVersion?.collection;
    const colStyle = col ? `color:${col.color};border-color:${col.color}` : "";
    const colLabel = col ? `● ${escapeHtml(col.name)} — tap to remove` : "Saved — tap to remove";
    btn.className = "btn-save saved";
    btn.setAttribute("style", colStyle);
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>
      ${colLabel}
    `;
    addColBtn.classList.add("hidden");
  } else {
    btn.className = "btn-save";
    btn.setAttribute("style", "");
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>
      Save
    `;
    addColBtn.classList.remove("hidden");
  }
}

async function handleSaveToggle() {
  if (!getState().user) {
    const { openAuthModal } = await import("./auth.js");
    openAuthModal("register");
    showToast("Sign in to save places", "info");
    return;
  }

  if (!currentPlace) return;

  const existingSave = savedPlaces.find(
    (p) => p.mapboxPlaceId === currentPlace.mapboxPlaceId || p.id === currentPlace.id
  );

  if (existingSave) {
    await unsavePlace(existingSave.id);
  } else {
    await savePlace(currentPlace, null);
  }
}

async function handleAddToCollection() {
  if (!getState().user) {
    const { openAuthModal } = await import("./auth.js");
    openAuthModal("register");
    showToast("Sign in to save places", "info");
    return;
  }

  if (!currentPlace) return;

  openCollectionPicker(async (collectionId) => {
    await savePlace(currentPlace, collectionId);
  });
}

async function savePlace(place, collectionId) {
  const btn = document.getElementById("btn-save");
  const addColBtn = document.getElementById("btn-add-collection");
  btn.disabled = true;
  addColBtn.disabled = true;

  try {
    const res = await authFetch(`${CONFIG.API_BASE}/places`, {
      method: "POST",
      body: JSON.stringify({
        name: place.name,
        address: place.address,
        category: place.category || null,
        latitude: place.latitude,
        longitude: place.longitude,
        mapboxPlaceId: place.mapboxPlaceId,
        notes: null,
        collectionId: collectionId || null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || "Failed to save place", "error");
      return;
    }

    savedPlaces.unshift(data.place);
    currentPlace.id = data.place.id;

    addPlaceToMap(data.place, true);
    renderSidebarList();
    updateSavesCount(savedPlaces.length);
    updateSaveButton(true, data.place);

    document.getElementById("place-card-notes-section").classList.remove("hidden");
    document.getElementById("place-notes-input").value = "";

    const colName = data.place.collection?.name;
    showToast(
      colName ? `"${place.name}" added to ${colName}!` : `"${place.name}" saved!`,
      "success"
    );
    // Refresh collection counts
    if (data.place.collection) loadCollections();
  } catch {
    showToast("Network error — couldn't save place", "error");
  } finally {
    btn.disabled = false;
    addColBtn.disabled = false;
  }
}

async function unsavePlace(placeId) {
  const btn = document.getElementById("btn-save");
  btn.disabled = true;

  try {
    const res = await authFetch(`${CONFIG.API_BASE}/places/${placeId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const data = await res.json();
      showToast(data.error || "Failed to remove place", "error");
      return;
    }

    const removedPlace = savedPlaces.find((p) => p.id === placeId);
    const hadCollection = !!removedPlace?.collection;
    savedPlaces = savedPlaces.filter((p) => p.id !== placeId);
    removePlaceFromMap(placeId);
    renderSidebarList();
    updateSavesCount(savedPlaces.length);
    updateSaveButton(false);

    document.getElementById("place-card-notes-section").classList.add("hidden");

    showToast(`"${removedPlace?.name || "Place"}" removed`, "info");
    // Refresh collection counts if place was in one
    if (hadCollection) loadCollections();
  } catch {
    showToast("Network error — couldn't remove place", "error");
  } finally {
    btn.disabled = false;
  }
}

async function handleSaveNotes() {
  if (!currentPlace?.id) return;

  const notes = document.getElementById("place-notes-input").value.trim();
  const btn = document.getElementById("btn-save-notes");
  btn.disabled = true;

  try {
    const res = await authFetch(`${CONFIG.API_BASE}/places/${currentPlace.id}`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    });

    if (!res.ok) {
      showToast("Failed to save note", "error");
      return;
    }

    // Update local cache
    const idx = savedPlaces.findIndex((p) => p.id === currentPlace.id);
    if (idx !== -1) savedPlaces[idx].notes = notes;

    showToast("Note saved", "success");
  } catch {
    showToast("Network error", "error");
  } finally {
    btn.disabled = false;
  }
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const btnSaves = document.getElementById("btn-saves");
  const btnClose = document.getElementById("sidebar-close");

  btnSaves.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) {
      closeSidebar();
    } else {
      sidebar.classList.remove("hidden");
      requestAnimationFrame(() => sidebar.classList.add("open"));
    }
  });

  btnClose.addEventListener("click", closeSidebar);

  // Close on backdrop click (map area)
  document.addEventListener("click", (e) => {
    if (
      sidebar.classList.contains("open") &&
      !e.target.closest("#sidebar") &&
      !e.target.closest("#btn-saves")
    ) {
      closeSidebar();
    }
  });
}

function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.classList.remove("open");
}

function renderSidebarList() {
  const list = document.getElementById("saves-list");
  const empty = document.getElementById("sidebar-empty");
  const countEl = document.getElementById("sidebar-count");

  countEl.textContent = savedPlaces.length;

  if (savedPlaces.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  list.innerHTML = savedPlaces
    .map((place) => {
      const emoji = getCategoryEmoji(place.category);
      const colDot = place.collection
        ? `<span class="save-item-col-dot" style="background:${place.collection.color}" title="${escapeHtml(place.collection.name)}"></span>`
        : "";
      return `
        <li class="save-item" data-id="${place.id}" data-lng="${place.longitude}" data-lat="${place.latitude}">
          <div class="save-item-icon">${emoji}</div>
          <div class="save-item-text">
            <div class="save-item-name">${escapeHtml(place.name)}${colDot}</div>
            <div class="save-item-address">${escapeHtml(place.address.split(",").slice(0, 2).join(","))}</div>
          </div>
          <div class="save-item-actions">
            <button class="save-item-menu-btn" data-id="${place.id}" aria-label="More options">···</button>
            <button class="save-item-delete" data-id="${place.id}" aria-label="Remove ${escapeHtml(place.name)}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
          <div class="save-item-move-menu hidden" data-id="${place.id}"></div>
        </li>
      `;
    })
    .join("");

  // Click on item row → fly to + show card
  list.querySelectorAll(".save-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.closest(".save-item-delete") || e.target.closest(".save-item-menu-btn") || e.target.closest(".save-item-move-menu")) return;
      const lng = parseFloat(item.dataset.lng);
      const lat = parseFloat(item.dataset.lat);
      flyToPlace(lng, lat);
      showPinMarker(lng, lat);
      closeSidebar();
      const place = savedPlaces.find((p) => p.id === item.dataset.id);
      if (place) showPlaceCard(place, true);
    });
  });

  // Delete buttons
  list.querySelectorAll(".save-item-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      unsavePlace(btn.dataset.id);
    });
  });

  // "..." menu buttons
  list.querySelectorAll(".save-item-menu-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const placeId = btn.dataset.id;
      const menuEl = list.querySelector(`.save-item-move-menu[data-id="${placeId}"]`);
      const isOpen = !menuEl.classList.contains("hidden");

      // Close all open menus first
      list.querySelectorAll(".save-item-move-menu").forEach((m) => m.classList.add("hidden"));

      if (!isOpen) {
        renderMoveMenu(menuEl, placeId);
        menuEl.classList.remove("hidden");
      }
    });
  });

  // Close move-menus on outside click
  document.addEventListener("click", () => {
    list.querySelectorAll(".save-item-move-menu").forEach((m) => m.classList.add("hidden"));
  }, { once: true });
}

function renderMoveMenu(menuEl, placeId) {
  const place = savedPlaces.find((p) => p.id === placeId);
  const collections = getCollections();

  let html = "";

  if (collections.length === 0) {
    html = `<div class="move-menu-item move-menu-empty">No collections yet</div>`;
  } else {
    collections.forEach((col) => {
      const isCurrent = place?.collection?.id === col.id;
      html += `
        <div class="move-menu-item${isCurrent ? " move-menu-current" : ""}" data-col-id="${col.id}">
          <span class="collection-dot" style="background:${col.color}"></span>
          ${escapeHtml(col.name)}
          ${isCurrent ? '<span class="move-menu-check">✓</span>' : ""}
        </div>
      `;
    });
  }

  if (place?.collection) {
    html += `<div class="move-menu-item move-menu-remove" data-col-id="null">Remove from collection</div>`;
  }

  menuEl.innerHTML = html;

  menuEl.querySelectorAll(".move-menu-item[data-col-id]").forEach((item) => {
    if (item.classList.contains("move-menu-empty")) return;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const colId = item.dataset.colId === "null" ? null : item.dataset.colId;
      menuEl.classList.add("hidden");
      moveToCollection(placeId, colId);
    });
  });
}

async function moveToCollection(placeId, collectionId) {
  try {
    const res = await authFetch(`${CONFIG.API_BASE}/places/${placeId}`, {
      method: "PATCH",
      body: JSON.stringify({ collectionId: collectionId || null }),
    });

    const data = await res.json();
    if (!res.ok) { showToast(data.error || "Failed to move place", "error"); return; }

    // Update local cache
    const idx = savedPlaces.findIndex((p) => p.id === placeId);
    if (idx !== -1) savedPlaces[idx] = data.place;

    // Re-render map markers + sidebar
    const { loadPlacesOnMap } = await import("./map.js");
    loadPlacesOnMap(savedPlaces);
    renderSidebarList();

    const colName = data.place.collection?.name;
    showToast(colName ? `Moved to "${colName}"` : "Removed from collection", "success");
    // Always refresh counts since membership changed
    loadCollections();
  } catch {
    showToast("Network error", "error");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateSavesCount(count) {
  const countEl = document.getElementById("saves-count");
  countEl.textContent = count;
  countEl.classList.toggle("hidden", count === 0);
}

function getPlaceCategory(feature) {
  const types = feature.place_type || [];
  const props = feature.properties || {};
  const category = props.category || props.maki || "";

  if (category.includes("restaurant") || types.includes("restaurant")) return "restaurant";
  if (category.includes("cafe") || category.includes("coffee")) return "cafe";
  if (category.includes("bar") || category.includes("pub")) return "bar";
  if (category.includes("bakery") || category.includes("pastry")) return "bakery";
  if (category.includes("pizza")) return "pizza";
  if (category.includes("sushi") || category.includes("japanese")) return "sushi";
  if (category.includes("food") || category.includes("eat")) return "restaurant";
  return "restaurant";
}

function getCategoryEmoji(category) {
  const map = {
    restaurant: "🍽️",
    cafe: "☕",
    bar: "🍺",
    bakery: "🥐",
    pizza: "🍕",
    sushi: "🍣",
    "Food & Drink": "🍜",
  };
  return map[category] || "🍜";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
