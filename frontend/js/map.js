/**
 * map.js — Cuboid beacon extrusions for saved places
 *
 * Each saved place renders as a coloured fill-extrusion square that sits
 * from ground level up to BEACON_HEIGHT, anchored at the place coordinates.
 * Building height is queried via queryRenderedFeatures and refined on idle
 * so the cuboid sits cleanly on the rooftop once tiles load.
 *
 * Hover  → MapLibre Popup with name + address
 * Click  → dispatches "savour:map-place-clicked"
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_ID     = "saved-beacons";
const LAYER_ID      = "saved-beacons-fill";
const DELTA         = 0.00012;   // ~13 m each way → ~26 × 26 m footprint
const BEACON_HEIGHT = 10;        // metres the cuboid rises above the rooftop

// ─── Module State ─────────────────────────────────────────────────────────────

let map             = null;
let maptilerKey     = null;
let mapReady        = false;
let buildingLayerId = null;

let currentFeatures = [];
const savedMeta     = new Map();   // placeId → { place, bHeight }
let pendingPlaces   = [];

let pinMarker   = null;
let hoverPopup  = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initMap(key) {
  maptilerKey = key;

  map = new maplibregl.Map({
    container: "map",
    style:     getMapStyle(getDefaultIsNight()),
    center:    [-79.383, 43.653],
    zoom:      13.5,
    pitch:     55,
    bearing:   -17,
    antialias: true,
    maxBounds: [[-80.2, 43.3], [-78.8, 44.3]],
  });

  map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

  // "load" fires once after the first render — confirmed reliable in this project.
  map.on("load", setupLayers);

  // After a theme switch (setStyle), "load" does not re-fire.
  // "styledata" fires whenever style data changes; use it to detect that our
  // custom source was wiped and needs re-adding.
  map.on("styledata", () => {
    if (mapReady && !map.getSource(SOURCE_ID)) {
      setupLayers();
    }
  });

  window.__savourMap = map;
  return map;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

export function getDefaultIsNight() {
  const h = new Date().getHours();
  return h < 6 || h >= 19;
}

function getMapStyle(isNight) {
  const name = isNight ? "streets-v2-dark" : "streets-v2";
  return `https://api.maptiler.com/maps/${name}/style.json?key=${maptilerKey}`;
}

export function setMapTheme(isNight) {
  if (!map) return;
  map.setStyle(getMapStyle(isNight));
}

// ─── Layer Setup ──────────────────────────────────────────────────────────────

function setupLayers() {
  // Find the maptiler building extrusion layer to insert before it.
  const bldgLayer = map.getStyle().layers.find(
    (l) => l.type === "fill-extrusion" && l["source-layer"] === "building"
  );
  buildingLayerId = bldgLayer?.id ?? null;

  // Guard against double-init (styledata can fire multiple times).
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer(LAYER_ID)) {
    map.addLayer(
      {
        id:     LAYER_ID,
        type:   "fill-extrusion",
        source: SOURCE_ID,
        paint: {
          "fill-extrusion-color":   ["coalesce", ["get", "color"], "#FF8C00"],
          "fill-extrusion-base":    ["get", "bBase"],
          "fill-extrusion-height":  ["get", "bTop"],
          "fill-extrusion-opacity": 0.9,
        },
      },
      buildingLayerId ?? undefined
    );

    map.on("mouseenter", LAYER_ID, onBeaconEnter);
    map.on("mouseleave", LAYER_ID, onBeaconLeave);
    map.on("click",      LAYER_ID, onBeaconClick);
    map.on("mouseenter", LAYER_ID, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", LAYER_ID, () => { map.getCanvas().style.cursor = ""; });
  }

  mapReady = true;

  // Drain places that arrived before the map was ready.
  const queued = [...pendingPlaces];
  pendingPlaces = [];
  for (const place of queued) _upsert(place);

  // Re-flush existing features (needed after a theme-change reinit).
  flushSource();
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

function makeSquare(lng, lat) {
  return [
    [lng - DELTA, lat - DELTA],
    [lng + DELTA, lat - DELTA],
    [lng + DELTA, lat + DELTA],
    [lng - DELTA, lat + DELTA],
    [lng - DELTA, lat - DELTA],
  ];
}

function queryBuildingHeight(lng, lat) {
  if (!map || !buildingLayerId) return 0;
  try {
    const pt  = map.project([lng, lat]);
    const fs  = map.queryRenderedFeatures(pt, { layers: [buildingLayerId] });
    const bld = fs.find((f) => f.sourceLayer === "building");
    return +(bld?.properties?.render_height ?? bld?.properties?.height ?? 0);
  } catch (_) {
    return 0;
  }
}

function buildFeature(place, bBase) {
  const color = place.collection?.color || "#FF8C00";
  return {
    type: "Feature",
    properties: {
      placeId: place.id,
      name:    place.name    || "",
      address: place.address || "",
      color,
      bBase,
      bTop:  bBase + BEACON_HEIGHT,
    },
    geometry: {
      type:        "Polygon",
      coordinates: [makeSquare(place.longitude, place.latitude)],
    },
  };
}

// ─── Source Management ────────────────────────────────────────────────────────

function flushSource() {
  if (!mapReady) return;
  const src = map.getSource(SOURCE_ID);
  if (src) src.setData({ type: "FeatureCollection", features: currentFeatures });
}

function _upsert(place) {
  const bBase   = queryBuildingHeight(place.longitude, place.latitude);
  const feature = buildFeature(place, bBase);

  savedMeta.set(place.id, { place, bBase });

  const idx = currentFeatures.findIndex((f) => f.properties.placeId === place.id);
  if (idx >= 0) currentFeatures[idx] = feature;
  else          currentFeatures.push(feature);

  flushSource();

  // Refine height once tiles have fully rendered (if height was unknown).
  if (bBase === 0) {
    map.once("idle", () => {
      const refined = queryBuildingHeight(place.longitude, place.latitude);
      if (refined > 0) {
        const i = currentFeatures.findIndex((f) => f.properties.placeId === place.id);
        if (i >= 0) {
          currentFeatures[i] = buildFeature(place, refined);
          savedMeta.set(place.id, { place, bBase: refined });
          flushSource();
        }
      }
    });
  }
}

// ─── Interactions ─────────────────────────────────────────────────────────────

function onBeaconEnter(e) {
  if (!e.features?.length) return;
  const { name, address } = e.features[0].properties;

  if (hoverPopup) hoverPopup.remove();
  hoverPopup = new maplibregl.Popup({
    closeButton:  false,
    closeOnClick: false,
    offset:       12,
    className:    "beacon-popup",
  })
    .setLngLat(e.lngLat)
    .setHTML(
      `<div class="beacon-popup-name">${escapeHtml(name)}</div>` +
      `<div class="beacon-popup-addr">${escapeHtml(address)}</div>`
    )
    .addTo(map);
}

function onBeaconLeave() {
  if (hoverPopup) { hoverPopup.remove(); hoverPopup = null; }
}

function onBeaconClick(e) {
  if (!e.features?.length) return;
  const { placeId } = e.features[0].properties;
  window.dispatchEvent(
    new CustomEvent("savour:map-place-clicked", { detail: { placeId } })
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function addPlaceToMap(place, _animate = false) {
  if (!mapReady) { pendingPlaces.push(place); return; }
  _upsert(place);
}

export function removePlaceFromMap(placeId) {
  savedMeta.delete(placeId);
  currentFeatures = currentFeatures.filter((f) => f.properties.placeId !== placeId);
  flushSource();
}

export function loadPlacesOnMap(places) {
  savedMeta.clear();
  currentFeatures = [];

  if (!mapReady) {
    pendingPlaces = [...places];
    return;
  }

  for (const place of places) _upsert(place);
}

export function flyToPlace(lng, lat) {
  if (!map) return;
  map.flyTo({ center: [lng, lat], zoom: 17, pitch: 65, speed: 1.2, curve: 1.4 });
}

export function showPinMarker(lng, lat) {
  if (!map) return;
  if (pinMarker) {
    pinMarker.setLngLat([lng, lat]);
  } else {
    pinMarker = new maplibregl.Marker({ color: "#E53E3E" })
      .setLngLat([lng, lat])
      .addTo(map);
  }
}

export function clearPinMarker() {
  if (pinMarker) { pinMarker.remove(); pinMarker = null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
