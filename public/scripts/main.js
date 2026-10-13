/* in the middle — frontend. Leaflet map + calls to the local Flask API.
 *
 * Two modes:
 *  - "room" (default): the page is a shareable session (/r/<id>). Everyone
 *    who opens the link joins with their own pin; pins sync by polling and
 *    search results are shared with the whole room.
 *  - "classic" (the "Manual" tab): single-screen mode — type 2–5 addresses
 *    yourself, no sharing involved.
 */

"use strict";

/* One colour per participant, assigned by join order (manual rows in order). */
const COLORS = ["#7fb4ff", "#ff8fb8", "#ffd479", "#9ef0a8", "#c9a2ff"];
const LABELS = ["A", "B", "C", "D", "E"];
const MAX_MANUAL = 5; // matches the server's per-room participant cap
const POLL_MS = 3000;

const state = {
  mode: "room",
  classic: { rows: [] }, // {point, marker, field, dot, input} per address
  room: {
    id: null,
    pid: null,
    participants: [],
    resultsVersion: 0,
    pollTimer: null,
    youMarker: null,
    youSet: false, // location chosen (by geolocation, search, click or drag)
    otherMarkers: new Map(), // pid -> Leaflet marker
  },
  lastResults: null, // {candidates, points:[{label,color,lat,lon}], stats}
  spotMarkers: [],
  routeLayers: [],
  activeIndex: null,
};

/* ---------- map ---------- */

const map = L.map("map", { zoomControl: false }).setView([51.5074, -0.1278], 12);
L.control.zoom({ position: "topright" }).addTo(map);

function geoErrorMessage(err) {
  if (err && err.code === 1) {
    return "Location is blocked for this site — tap the ⓘ or padlock next to the address bar, allow Location, then reload. Or just search / tap the map.";
  }
  return "Couldn't get a fix on your location — search or tap the map instead.";
}

/* "granted" | "denied" | "prompt" | "unsupported" (e.g. Safari, which has
 * no Permissions API for geolocation). Checking first lets us auto-fill a
 * pin ONLY when it's silent (already granted — no prompt shown either way),
 * and never call getCurrentPosition automatically otherwise: an unprompted
 * call is exactly what gets an origin's geolocation permanently blocked by
 * Chrome after a couple of dismissals, with no way back except the user
 * resetting the site permission by hand. */
async function geoPermissionState() {
  if (!navigator.permissions?.query) return "unsupported";
  try {
    return (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    return "unsupported";
  }
}

async function locateMe() {
  if (!navigator.geolocation) {
    setStatus("This browser doesn't share location — search or tap the map.", true);
    return;
  }
  // Skip the round trip and give exact instructions when we already know
  // it's blocked — Chrome won't show a prompt for this call either.
  if ((await geoPermissionState()) === "denied") {
    setStatus(geoErrorMessage({ code: 1 }), true);
    return;
  }
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], Math.max(map.getZoom(), 14));
      // A deliberate tap, unlike the automatic on-load attempt — always
      // drop/update a pin, not just the first time.
      placeLocationPin(latitude, longitude, "My current location");
      setStatus("");
    },
    (err) => setStatus(geoErrorMessage(err), true),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
  );
}
// OpenFreeMap: free vector tiles, no API key (CARTO now requires one off localhost).
L.maplibreGL({
  style: "https://tiles.openfreemap.org/styles/dark",
  attribution:
    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
}).addTo(map);

function pinIcon(label, color) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-pin" style="background:${color}"><span>${escapeHtml(label)}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
}

function spotIcon(rank) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-spot rank-${rank}">${rank}</div>`,
    iconSize: [rank === 1 ? 34 : 26, rank === 1 ? 34 : 26],
    iconAnchor: [rank === 1 ? 17 : 13, rank === 1 ? 17 : 13],
  });
}

function initials(name) {
  // Two letters for the generated "Sunny Otter" style names.
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
}

function formatCoords(lat, lon) {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function participantIcon(p) {
  return pinIcon(initials(p?.name), COLORS[colorIndex(p)]);
}

/* Swap a marker's icon only when the name/colour actually changed: setIcon
 * replaces the DOM node, which interrupts drags and kills hover tooltips. */
function refreshPinIcon(marker, p) {
  const sig = `${initials(p?.name)}|${colorIndex(p)}`;
  if (marker.itmSig !== sig) {
    marker.itmSig = sig;
    marker.setIcon(participantIcon(p));
  }
}

/* Where a located point goes: your own draggable pin in room mode, or the
 * next empty address row in manual mode (a no-op if all rows are filled —
 * repeated presses don't clobber an address you've already set). Shared by
 * map clicks and the locate button. */
function placeLocationPin(lat, lon, label) {
  if (state.mode === "room") {
    setMyLocation(lat, lon, label);
    return;
  }
  const row = state.classic.rows.find((r) => !r.point);
  if (row) setManualPin(row, lat, lon, label);
}

map.on("click", (e) => {
  placeLocationPin(e.latlng.lat, e.latlng.lng, formatCoords(e.latlng.lat, e.latlng.lng));
});

/* ---------- shared helpers ---------- */

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.error ?? `Request failed (${resp.status})`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

const statusEl = document.getElementById("status");
const statusMini = document.getElementById("status-mini");
function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
  // Mirrored into the title bar so it stays visible when the panel is
  // collapsed to a bottom sheet on phones.
  statusMini.textContent = msg;
  statusMini.classList.toggle("error", isError);
}

/* ---------- collapsible panel (bottom sheet / left dock on phones) ----------
 *
 * The panel starts collapsed in the HTML itself (see index.html) so there's
 * no boot-time flash of the expanded layout on phones. On desktop that
 * class is inert — nothing outside the phone media queries below reacts to
 * it — so nothing needs to "undo" it there.
 *
 * Three ways to toggle, matching what's actually visible in each state:
 *  - Tap the header (blank area): works whenever the header is showing,
 *    i.e. always on portrait, and only while expanded on landscape (the
 *    header hides when a landscape card collapses to its slim edge tab).
 *  - #side-toggle: landscape only, visible (and toggles both ways) in
 *    both states — the header disappearing while collapsed means it's
 *    the only affordance left at that point, so it can't be collapsed-only.
 *  - Tap anywhere else on a collapsed landscape tab: the handle itself is
 *    a thin visual pill, too small a target to require precision on.
 */

// Matches the CSS breakpoints exactly: portrait phones (bottom sheet) or
// landscape phones (short + touch, so the left-docked layout applies
// regardless of width — see styles/main.css).
const isMobile = () =>
  window.matchMedia("(max-width: 640px), (max-height: 500px) and (pointer: coarse)").matches;
const panel = document.querySelector(".panel");
const panelHeader = document.querySelector(".panel-header");
const sideToggle = document.getElementById("side-toggle");

function setPanelCollapsed(collapsed) {
  panel.classList.toggle("collapsed", collapsed);
  sideToggle.setAttribute("aria-expanded", String(!collapsed));
}

panelHeader.addEventListener("click", (e) => {
  if (!isMobile()) return;
  if (e.target.closest("button, a, .help-popover, .share-menu")) return;
  setPanelCollapsed(!panel.classList.contains("collapsed"));
});

sideToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  setPanelCollapsed(!panel.classList.contains("collapsed"));
});

panel.addEventListener("click", (e) => {
  if (!isMobile() || !panel.classList.contains("collapsed")) return;
  // Header clicks are handled entirely by panelHeader's own listener above
  // (and re-checking .collapsed here would be wrong regardless — that
  // listener runs first and may have already flipped it during the same
  // bubble). It's excluded on principle, not because it's ever reachable:
  // display:none while collapsed takes it out of hit-testing anyway.
  if (e.target.closest(".panel-header, button, a")) return;
  setPanelCollapsed(false);
});

/* ---------- geocode autocomplete ---------- */

function setupAutocomplete(input, box, onPick) {
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 3) {
      box.classList.remove("open");
      return;
    }
    // Bias suggestions towards where the user is looking on the map.
    const center = map.getCenter();
    const results = await fetch(
      `/api/geocode?q=${encodeURIComponent(q)}&lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}`
    ).then((r) => r.json());
    box.innerHTML = "";
    results.forEach((r) => {
      const btn = document.createElement("button");
      btn.innerHTML = `${escapeHtml(r.name)}<br><span class="sub">${escapeHtml(r.label)}</span>`;
      btn.addEventListener("click", () => {
        box.classList.remove("open");
        onPick(r);
        map.panTo([r.lat, r.lon]);
      });
      box.appendChild(btn);
    });
    box.classList.toggle("open", results.length > 0);
  }, 300);

  input.addEventListener("input", search);
  input.addEventListener("blur", () => setTimeout(() => box.classList.remove("open"), 200));
}

setupAutocomplete(
  document.getElementById("input-you"),
  document.getElementById("suggestions-you"),
  (r) => setMyLocation(r.lat, r.lon, r.name)
);

/* ---------- popovers (help, share menu) ---------- */

/* Popovers are position:fixed so the panel's overflow scrolling can't clip
 * them; this drops one under its button, or above when there's no room
 * (e.g. the bottom sheet on phones). Call after unhiding. */
function placePopover(el, anchor) {
  const r = anchor.getBoundingClientRect();
  // Right-align to the button, but never push the popover off screen left.
  const maxRight = window.innerWidth - el.offsetWidth - 8;
  el.style.right = `${Math.min(Math.max(window.innerWidth - r.right, 8), Math.max(maxRight, 8))}px`;
  const below = r.bottom + 8;
  el.style.top =
    below + el.offsetHeight <= window.innerHeight - 8
      ? `${below}px`
      : `${Math.max(r.top - 8 - el.offsetHeight, 8)}px`;
}

/* One wiring for toggle-button popovers: open (placed), close on outside
 * click or viewport resize, aria-expanded kept in sync. `beforeOpen` may
 * veto the menu (e.g. hand off to the native share sheet) by returning
 * false. Returns the close function. */
function wirePopover(button, popover, beforeOpen) {
  const close = () => {
    popover.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!popover.hidden) return close();
    if (beforeOpen && beforeOpen() === false) return;
    popover.hidden = false;
    placePopover(popover, button);
    button.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", (e) => {
    if (!popover.hidden && !popover.contains(e.target)) close();
  });
  window.addEventListener("resize", close);
  return close;
}

const helpToggle = document.getElementById("help-toggle");
const helpPopover = document.getElementById("help-popover");
wirePopover(helpToggle, helpPopover);

/* ---------- mode toggle ---------- */

const roomTab = document.getElementById("mode-room");
const classicTab = document.getElementById("mode-classic");
const roomUi = document.getElementById("room-ui");
const classicUi = document.getElementById("classic-ui");

roomTab.addEventListener("click", (e) => {
  e.stopPropagation();
  setMode("room");
});
classicTab.addEventListener("click", (e) => {
  e.stopPropagation();
  setMode("classic");
});

function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  const room = mode === "room";
  roomTab.classList.toggle("active", room);
  classicTab.classList.toggle("active", !room);
  roomTab.setAttribute("aria-selected", String(room));
  classicTab.setAttribute("aria-selected", String(!room));
  roomUi.hidden = !room;
  classicUi.hidden = room;
  shareBtn.hidden = !room; // nothing to share in manual mode
  closeShareMenu();
  document.getElementById("help-room").hidden = !room;
  document.getElementById("help-classic").hidden = room;

  clearResults();
  toggleMarkers(state.roomMarkerList(), room);
  toggleMarkers(state.classic.rows.map((r) => r.marker), !room);

  if (room) {
    state.room.id ? startPolling() : initRoom();
  } else {
    stopPolling();
    setStatus("");
  }
  updateFindButton();
}

state.roomMarkerList = () => [
  state.room.youMarker,
  ...state.room.otherMarkers.values(),
];

function toggleMarkers(markers, show) {
  markers.forEach((m) => {
    if (!m) return;
    if (show) m.addTo(map);
    else map.removeLayer(m);
  });
}

/* ---------- room mode ---------- */

const shareBtn = document.getElementById("share-btn");
const shareMenu = document.getElementById("share-menu");
const youInput = document.getElementById("input-you");

document.getElementById("locate-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  locateMe();
});

// Reveals the panel (if collapsed) and raises the keyboard on the next
// address that needs filling in — the discoverable "type it instead" path
// on phones, where the address field isn't visible until you expand.
document.getElementById("search-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  setPanelCollapsed(false);
  const input =
    state.mode === "room"
      ? youInput
      : (state.classic.rows.find((r) => !r.point) || state.classic.rows[0])?.input;
  if (!input) return;
  input.focus();
  input.select();
  input.scrollIntoView({ block: "center", behavior: "smooth" });
});

const SHARE_TEXT = "Meet in the middle — join my room:";

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus("Link copied — send it to whoever you're meeting.");
  } catch {
    // Clipboard needs a secure context; fall back to showing the link.
    setStatus(`Copy this link: ${location.href}`);
  }
}

/* Native share sheet (WhatsApp & friends live there) on phones; elsewhere a
 * small menu of share links plus copy. Desktop share sheets are avoided on
 * purpose: their built-in "copy" bundles the share text with the URL. The
 * payload carries no `text` for the same reason. */
const closeShareMenu = wirePopover(shareBtn, shareMenu, () => {
  const data = { title: "in the middle", url: location.href };
  if (isMobile() && navigator.canShare?.(data)) {
    void navigator.share(data).catch(() => {}); // user may dismiss the sheet
    return false;
  }
  const text = encodeURIComponent(`${SHARE_TEXT} ${location.href}`);
  document.getElementById("share-whatsapp").href = `https://wa.me/?text=${text}`;
  document.getElementById("share-email").href =
    `mailto:?subject=${encodeURIComponent("Meet in the middle")}&body=${text}`;
});

document.getElementById("share-copy").addEventListener("click", () => {
  copyShareLink();
  closeShareMenu();
});

async function initRoom() {
  try {
    // Share links are /r/<id>; ?room=<id> is the old form, still honoured.
    const pathMatch = location.pathname.match(/^\/r\/([\w-]+)/);
    let id = pathMatch ? pathMatch[1] : new URLSearchParams(location.search).get("room");
    if (id) {
      const check = await fetch(`/api/rooms/${id}`);
      if (!check.ok) {
        id = null;
        setStatus("That room has expired — started a fresh one.", true);
      }
    }
    if (!id) {
      id = (await api("/api/rooms", { method: "POST" })).id;
    }
    state.room.id = id;
    history.replaceState(null, "", `/r/${id}`);

    await joinRoom(id);

    startPolling();
    autoFillLocationIfGranted();
  } catch (err) {
    setStatus("Could not reach the local server to create a room.", true);
  }
}

async function joinRoom(id) {
  // sessionStorage is per-tab, so every tab is its own participant —
  // handy for testing a whole room from one browser.
  const storageKey = `itm-pid-${id}`;
  let pid = sessionStorage.getItem(storageKey);
  if (pid) {
    const view = await api(`/api/rooms/${id}`);
    if (!view.participants.some((p) => p.id === pid)) pid = null;
  }
  if (!pid) {
    // Rejoin as "the same person" if this tab left on a reload (the unload
    // handler stashes name+pin; a truly closed tab loses sessionStorage, so
    // that stays a real leave). Otherwise the server hands out a friendly
    // random name ("Sunny Otter").
    const stashKey = `itm-me-${id}`;
    let stash = null;
    try {
      stash = JSON.parse(sessionStorage.getItem(stashKey) || "null");
    } catch {}
    sessionStorage.removeItem(stashKey);

    const me = await api(`/api/rooms/${id}/participants`, {
      method: "POST",
      body: stash?.name ? { name: stash.name } : {},
    });
    pid = me.id;
    sessionStorage.setItem(storageKey, pid);
    state.room.pid = pid;
    if (stash && stash.lat != null && !state.room.youSet) {
      setMyLocation(stash.lat, stash.lon, stash.label || formatCoords(stash.lat, stash.lon));
    }
  }
  state.room.pid = pid;

  // If the user dropped a pin before the join finished, sync it now.
  if (state.room.youSet && state.room.youMarker) {
    const pos = state.room.youMarker.getLatLng();
    setMyLocation(pos.lat, pos.lng, youInput.value);
  }
}

// Closing the tab (or navigating away) leaves the room, so the others don't
// wait on a ghost pin. sendBeacon is the only request type that reliably
// survives unload; it can only POST, hence the /leave alias. A stash of
// name+pin lets a reload (which keeps sessionStorage) rejoin seamlessly.
window.addEventListener("pagehide", () => {
  if (state.room.id && state.room.pid) {
    navigator.sendBeacon(`/api/rooms/${state.room.id}/participants/${state.room.pid}/leave`);
    sessionStorage.removeItem(`itm-pid-${state.room.id}`);
    const me = state.room.participants.find((p) => p.id === state.room.pid);
    if (me) {
      sessionStorage.setItem(
        `itm-me-${state.room.id}`,
        JSON.stringify({ name: me.name, lat: me.lat, lon: me.lon, label: me.label })
      );
    }
    state.room.pid = null;
  }
});

// Restored from the back-forward cache after having left: quietly rejoin.
window.addEventListener("pageshow", (e) => {
  if (e.persisted && state.room.id && !state.room.pid) {
    joinRoom(state.room.id).catch(() => {});
  }
});

/* Called once on page load, with no user gesture behind it — so it must
 * NEVER be allowed to trigger a permission prompt. Only fires
 * getCurrentPosition when the permission is already "granted", in which
 * case the browser shows no UI at all and this is purely a convenience
 * auto-fill. Everyone else gets a plain hint pointing at the locate button,
 * which is gesture-triggered and the only place we ever prompt. */
async function autoFillLocationIfGranted() {
  if (!navigator.geolocation) return;
  // No hint on the other outcomes — the icons (magnifying glass, crosshair)
  // and the "?" help popover explain themselves, and leaving the status
  // line empty gives the mobile toolbar its full width to space out.
  if ((await geoPermissionState()) !== "granted") return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (state.room.youSet) return; // user beat the GPS to it
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 13);
      setMyLocation(latitude, longitude, "My current location");
    },
    () => {}, // granted-but-failed (GPS off, etc.) — the locate button covers retry
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 }
  );
}

function setMyLocation(lat, lon, label, { push = true } = {}) {
  state.room.youSet = true;
  const me = state.room.participants.find((p) => p.id === state.room.pid);
  if (state.room.youMarker) {
    state.room.youMarker.setLatLng([lat, lon]);
  } else {
    const marker = L.marker([lat, lon], {
      icon: participantIcon(me),
      draggable: true,
      zIndexOffset: 500,
    });
    marker.bindTooltip("You — drag to move");
    if (state.mode === "room") marker.addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      setMyLocation(pos.lat, pos.lng, formatCoords(pos.lat, pos.lng));
    });
    state.room.youMarker = marker;
  }
  if (label) youInput.value = label;
  if (push && state.room.pid) {
    api(`/api/rooms/${state.room.id}/participants/${state.room.pid}`, {
      method: "PATCH",
      body: { lat, lon, label: label ?? "" },
    }).catch(() => {});
  }
  updateFindButton();
}

function colorIndex(participant) {
  return ((participant?.order ?? 1) - 1) % COLORS.length;
}

function startPolling() {
  stopPolling();
  pollRoom();
  state.room.pollTimer = setInterval(pollRoom, POLL_MS);
}

function stopPolling() {
  if (state.room.pollTimer) {
    clearInterval(state.room.pollTimer);
    state.room.pollTimer = null;
  }
}

async function pollRoom() {
  if (!state.room.id) return;
  let data;
  try {
    data = await api(`/api/rooms/${state.room.id}`);
  } catch (err) {
    if (err.status === 404) {
      stopPolling();
      setStatus("This room has expired. Reload the page to start a new one.", true);
    }
    return;
  }
  state.room.participants = data.participants;
  renderParticipants();

  // Someone (maybe us) ran a search — show the shared results.
  if (data.results && data.resultsVersion !== state.room.resultsVersion) {
    state.room.resultsVersion = data.resultsVersion;
    if (state.mode === "room") renderResults(decorateRoomResults(data.results));
  }
  updateFindButton();
}

function renderParticipants() {
  const me = state.room.participants.find((p) => p.id === state.room.pid);

  // First poll after a reload: restore our own pin from the server.
  if (me && me.lat != null && !state.room.youSet) {
    setMyLocation(me.lat, me.lon, me.label || formatCoords(me.lat, me.lon), { push: false });
  }
  if (me) {
    document.getElementById("pin-dot-you").style.background = COLORS[colorIndex(me)];
    if (state.room.youMarker) refreshPinIcon(state.room.youMarker, me);
  }

  // Pins for everyone else (ours is the draggable youMarker).
  const seen = new Set();
  state.room.participants.forEach((p) => {
    if (p.id === state.room.pid || p.lat == null) return;
    seen.add(p.id);
    const existing = state.room.otherMarkers.get(p.id);
    if (existing) {
      existing.setLatLng([p.lat, p.lon]);
      refreshPinIcon(existing, p);
      existing.setTooltipContent(p.name);
    } else {
      const marker = L.marker([p.lat, p.lon], { icon: participantIcon(p) });
      marker.bindTooltip(p.name);
      if (state.mode === "room") marker.addTo(map);
      state.room.otherMarkers.set(p.id, marker);
    }
  });
  for (const [pid, marker] of state.room.otherMarkers) {
    if (!seen.has(pid)) {
      map.removeLayer(marker);
      state.room.otherMarkers.delete(pid);
    }
  }

  // Rebuild the panel list only when something actually changed — this runs
  // on every 3s poll and would otherwise churn the DOM constantly.
  const listSig = state.room.participants
    .map((p) => `${p.id}|${p.name}|${p.label}|${p.lat},${p.lon}`)
    .join(";") + `|${state.room.pid}`;
  if (listSig === state.room.listSig) return;
  state.room.listSig = listSig;

  const list = document.getElementById("participants");
  list.innerHTML = "";
  state.room.participants.forEach((p) => {
    const li = document.createElement("li");
    const located = p.lat != null;
    li.innerHTML = `
      <span class="p-dot" style="background:${COLORS[colorIndex(p)]}"></span>
      <span class="p-name">${escapeHtml(p.name)}${p.id === state.room.pid ? " (you)" : ""}</span>
      <span class="p-where">${located ? escapeHtml(p.label || "pin on map") : "no pin yet"}</span>`;
    li.classList.toggle("unlocated", !located);
    list.appendChild(li);
  });
}

function decorateRoomResults(results) {
  return {
    ...results,
    points: results.points.map((p, i) => {
      // Match the person's pin colour (join order), not the array position —
      // the two differ once someone has left the room.
      const participant = state.room.participants.find((q) => q.id === p.id);
      return {
        ...p,
        label: p.id === state.room.pid ? "You" : p.name,
        color: COLORS[participant ? colorIndex(participant) : i % COLORS.length],
      };
    }),
  };
}

/* ---------- manual mode ---------- */

const manualFields = document.getElementById("manual-fields");
const addAddressBtn = document.getElementById("add-address");

addAddressBtn.addEventListener("click", () => addManualRow());

function addManualRow() {
  if (state.classic.rows.length >= MAX_MANUAL) return;

  const field = document.createElement("div");
  field.className = "field";
  const dot = document.createElement("span");
  dot.className = "pin-dot";
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder =
    state.classic.rows.length === 0 ? "Your starting point" : "Another starting point";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-address";
  remove.title = "Remove this address";
  remove.setAttribute("aria-label", "Remove this address");
  remove.textContent = "×";
  const box = document.createElement("div");
  box.className = "suggestions";
  field.append(dot, input, remove, box);
  manualFields.appendChild(field);

  const row = { point: null, marker: null, field, dot, input };
  state.classic.rows.push(row);
  setupAutocomplete(input, box, (r) => setManualPin(row, r.lat, r.lon, r.name));
  remove.addEventListener("click", () => removeManualRow(row));

  refreshManualRows();
}

function removeManualRow(row) {
  const rows = state.classic.rows;
  if (rows.length <= 2) return; // always keep two starting points
  rows.splice(rows.indexOf(row), 1);
  if (row.marker) map.removeLayer(row.marker);
  row.field.remove();
  clearResults();
  refreshManualRows();
}

/* Re-letter and re-colour the rows (and their pins) after any add/remove. */
function refreshManualRows() {
  const rows = state.classic.rows;
  rows.forEach((row, i) => {
    row.dot.style.background = COLORS[i];
    if (row.marker) {
      row.marker.setIcon(pinIcon(LABELS[i], COLORS[i]));
      row.marker.setTooltipContent(`${LABELS[i]} — drag to move`);
    }
  });
  manualFields.querySelectorAll(".remove-address").forEach((btn) => {
    btn.hidden = rows.length <= 2;
  });
  addAddressBtn.hidden = rows.length >= MAX_MANUAL;
  updateFindButton();
}

function setManualPin(row, lat, lon, label) {
  row.point = { lat, lon };
  const i = state.classic.rows.indexOf(row);
  if (row.marker) {
    row.marker.setLatLng([lat, lon]);
  } else {
    const marker = L.marker([lat, lon], {
      icon: pinIcon(LABELS[i], COLORS[i]),
      draggable: true,
    }).addTo(map);
    marker.bindTooltip(`${LABELS[i]} — drag to move`);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      row.point = { lat: pos.lat, lon: pos.lng };
      row.input.value = formatCoords(pos.lat, pos.lng);
      clearResults();
      updateFindButton();
    });
    row.marker = marker;
  }
  if (label) row.input.value = label;
  clearResults();
  updateFindButton();
}

/* ---------- controls ---------- */

const budget = document.getElementById("budget");
budget.addEventListener("input", () => {
  document.getElementById("budget-label").textContent = `${budget.value} min`;
});

/* The full-width button (desktop) and the toolbar icon (phones) are one
 * logical control — always update them together. */
const findButtons = [document.getElementById("find"), document.getElementById("find-mini")];

function locatedCount() {
  return state.room.participants.filter((p) => p.lat != null).length;
}

function updateFindButton() {
  const ready =
    state.mode === "room"
      ? locatedCount() >= 2
      : state.classic.rows.filter((r) => r.point).length >= 2;
  findButtons.forEach((b) => (b.disabled = !ready));
}

/* ---------- search ---------- */

function clearResults() {
  state.spotMarkers.forEach((m) => map.removeLayer(m));
  state.spotMarkers = [];
  clearRoutes();
  state.lastResults = null;
  state.activeIndex = null;
  setStatus("");
}

function clearRoutes() {
  state.routeLayers.forEach((l) => map.removeLayer(l));
  state.routeLayers = [];
}

findButtons.forEach((b) =>
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    runSearch();
  })
);

async function runSearch() {
  clearResults();
  findButtons.forEach((b) => {
    b.classList.add("loading");
    b.disabled = true;
  });
  setStatus("Computing transit reachability for everyone…");

  const departInput = document.getElementById("depart").value;
  const options = {
    maxMinutes: parseInt(budget.value, 10),
    time: departInput ? new Date(departInput).toISOString() : null,
  };

  try {
    if (state.mode === "room") {
      const data = await api(`/api/rooms/${state.room.id}/meet`, {
        method: "POST",
        body: options,
      });
      state.room.resultsVersion = data.resultsVersion;
      renderResults(decorateRoomResults(data));
    } else {
      // Skip rows the user added but never filled in.
      const filled = state.classic.rows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => row.point);
      const points = filled.map(({ row }) => row.point);
      const data = await api("/api/meet", { method: "POST", body: { points, ...options } });
      renderResults({
        ...data,
        points: points.map((p, j) => ({ ...p, label: LABELS[filled[j].i], color: COLORS[filled[j].i] })),
      });
    }
  } catch (err) {
    setStatus(err.message ?? "Could not reach the server.", true);
  } finally {
    findButtons.forEach((b) => b.classList.remove("loading"));
    updateFindButton();
  }
}

/* ---------- results (popups on the map, not a panel list) ---------- */

function popupHtml(c, rank, results, legsHtml) {
  const transfers = c.transfers.reduce((s, t) => s + t, 0);
  const times = results.points
    .map(
      (p, j) =>
        `<span style="color:${p.color};font-weight:600">${escapeHtml(p.label)}: ${c.minutes[j]} min</span>`
    )
    .join(" ");
  return `
    <div class="popup-title">${rank}. ${escapeHtml(c.name)}</div>
    <div class="result-times">${times}
      <span>${transfers} transfer${transfers === 1 ? "" : "s"} total</span>
    </div>
    <div class="popup-legs">${legsHtml ?? "Loading routes…"}</div>`;
}

function renderResults(results) {
  clearResults();
  state.lastResults = results;
  setStatus(
    `${results.stats.common.toLocaleString()} spots everyone can reach — tap a numbered pin for routes.`
  );

  const bounds = results.points.map((p) => [p.lat, p.lon]);

  results.candidates.forEach((c, i) => {
    const marker = L.marker([c.lat, c.lon], { icon: spotIcon(i + 1) }).addTo(map);
    marker.bindPopup(popupHtml(c, i + 1, results, null), {
      className: "spot-popup",
      maxWidth: 300,
      autoPanPadding: L.point(30, 90),
    });
    marker.on("popupopen", () => selectCandidate(i));
    marker.on("popupclose", () => {
      if (state.activeIndex === i) {
        clearRoutes();
        state.activeIndex = null;
      }
    });
    state.spotMarkers.push(marker);
    if (i < 3) bounds.push([c.lat, c.lon]);
  });

  // On phones, get the panel out of the way so the pins are what you see.
  if (isMobile()) {
    setPanelCollapsed(true);
    map.fitBounds(bounds, { padding: [36, 36], paddingBottomRight: [36, 90] });
  } else {
    map.fitBounds(bounds, { padding: [60, 60], paddingTopLeft: [420, 60] });
  }
}

/* ---------- route display ---------- */

async function selectCandidate(index) {
  const results = state.lastResults;
  const c = results.candidates[index];
  state.activeIndex = index;
  clearRoutes();

  const params = new URLSearchParams({ toLat: c.lat, toLon: c.lon });
  results.points.forEach((p) => params.append("from", `${p.lat},${p.lon}`));
  // Same departure anchor as the search, so these routes explain the ranked
  // minutes instead of being re-planned from "now".
  if (results.time) params.set("time", results.time);

  let data;
  try {
    const resp = await fetch(`/api/routes?${params}`);
    data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `Routes lookup failed (${resp.status}).`);
  } catch (err) {
    if (state.activeIndex === index && state.lastResults === results) {
      state.spotMarkers[index]
        .getPopup()
        .setContent(popupHtml(c, index + 1, results, escapeHtml(err.message)));
    }
    return;
  }
  // The user may have tapped another pin while we were fetching.
  if (state.activeIndex !== index || state.lastResults !== results) return;

  data.itineraries.forEach((itinerary, i) => {
    if (!itinerary) return;
    itinerary.legs.forEach((leg) => {
      const pts = decodePolyline(leg.geometry.points ?? "", leg.geometry.precision ?? 6);
      if (!pts.length) return;
      const line = L.polyline(pts, {
        color: results.points[i].color,
        weight: leg.mode === "WALK" ? 3 : 5,
        opacity: 0.85,
        dashArray: leg.mode === "WALK" ? "2 8" : null,
      }).addTo(map);
      state.routeLayers.push(line);
    });
  });

  const anchorMs = results.time ? Date.parse(results.time) : null;
  const clock = (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const legsHtml = data.itineraries
    .map((it, i) => {
      const p = results.points[i];
      if (!it) return `<div>${escapeHtml(p.label)}: no route found</div>`;
      const chips = it.legs
        .filter((l) => l.mode !== "WALK")
        .map((l) => `<span class="leg-chip">${escapeHtml(l.route ?? l.mode)}</span>`)
        .join(" → ");
      // Minutes from the shared anchor (waiting included), matching the
      // ranked minutes; the leave/arrive clock times make the wait visible.
      const total = anchorMs
        ? Math.max(Math.round((Date.parse(it.endTime) - anchorMs) / 60000), 0)
        : Math.round(it.duration / 60);
      return `<div><strong style="color:${p.color}">${escapeHtml(p.label)}</strong> ${total} min
        (leave ${clock(it.startTime)} → arrive ${clock(it.endTime)}): ${chips || "walk"}</div>`;
    })
    .join("");

  state.spotMarkers[index].getPopup().setContent(popupHtml(c, index + 1, results, legsHtml));
}

/* Google encoded polyline decoder, parameterised by precision (MOTIS uses 6). */
function decodePolyline(encoded, precision) {
  const factor = Math.pow(10, precision);
  const points = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    for (const which of ["lat", "lon"]) {
      let result = 0, shift = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === "lat") lat += delta;
      else lon += delta;
    }
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

/* ---------- boot ---------- */

addManualRow();
addManualRow();
// Nothing to do here for the panel itself — it already starts collapsed
// in the HTML (see index.html), aria-expanded included.
initRoom();
