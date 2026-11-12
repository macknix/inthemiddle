/* in the middle — frontend. Leaflet map + calls to the Flask/Worker API.
 *
 * One flow, three steps, shown one at a time in the panel:
 *   1. start   — where are you? (location button, search, or tap the map)
 *   2. people  — who else? Invite them with the room link, or add their
 *                address yourself. Then "Find the middle".
 *   3. results — ranked spots, listed in the panel and pinned on the map.
 *
 * Every page is a shareable room (/r/<id>). Addresses you add for other
 * people become room participants too, so the room is the single source of
 * truth and everyone sees the same pins and results. (This replaces the old
 * separate "manual" mode.)
 */

"use strict";

/* One colour per participant, assigned by join order. */
const COLORS = ["#7fb4ff", "#ff8fb8", "#ffd479", "#9ef0a8", "#c9a2ff"];
const MAX_PEOPLE = 5; // matches the server's per-room participant cap
const POLL_MS = 3000;
const BUDGETS = [30, 45, 60, 90]; // minutes; server caps at 90
const SHOWN_RESULTS = 5;
// A local edit wins over polled data for this long, so a poll that was
// already in flight can't snap a just-dragged pin back.
const LOCAL_EDIT_MS = 5000;

const state = {
  id: null,
  pid: null,
  participants: [],
  owned: new Set(), // pids of people *this tab* added by address
  localEdits: new Map(), // pid -> {lat, lon, label, at}
  pendingMe: null, // my location, chosen before the room join finished
  markers: new Map(), // pid (or "me" before joining) -> Leaflet marker
  resultsVersion: 0,
  pollTimer: null,
  view: "start", // "start" | "people" | "results"
  adding: false,
  budget: 60,
  lastResults: null,
  spotMarkers: [],
  routeLayers: [],
  activeIndex: null,
};

const $ = (id) => document.getElementById(id);

/* ---------- map ---------- */

const map = L.map("map", { zoomControl: false }).setView([51.5074, -0.1278], 12);
L.control.zoom({ position: "topright" }).addTo(map);

// OpenFreeMap: free vector tiles, no API key.
L.maplibreGL({
  style: "https://tiles.openfreemap.org/styles/dark",
  attribution:
    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
}).addTo(map);

function pinIcon(label, color) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-pin" style="background:${color}"><span>${escapeHtml(label)}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

function spotIcon(rank, active) {
  const size = rank === 1 ? 36 : 28;
  return L.divIcon({
    className: "",
    html: `<div class="marker-spot rank-${rank}${active ? " active" : ""}">${rank}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

map.on("click", (e) => {
  const { lat, lng } = e.latlng;
  const label = formatCoords(lat, lng);
  if (state.adding) {
    addPerson(lat, lng, label);
  } else if (state.view === "start") {
    setMyLocation(lat, lng, label);
  } else if (isMobile()) {
    // A tap on the map otherwise means "let me see the map".
    setPanelCollapsed(true);
  }
});

/* ---------- helpers ---------- */

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

function initials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
}

function formatCoords(lat, lon) {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
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

const statusEl = $("status");
function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

/* ---------- panel: steps + collapsing ---------- */

// Matches the CSS breakpoints: portrait phones (bottom sheet) or landscape
// phones (short + touch → left dock).
const isMobile = () =>
  window.matchMedia("(max-width: 640px), (max-height: 500px) and (pointer: coarse)").matches;
const panel = document.querySelector(".panel");
const grabber = $("grabber");
const sideToggle = $("side-toggle");

function setPanelCollapsed(collapsed) {
  panel.classList.toggle("collapsed", collapsed);
  grabber.setAttribute("aria-expanded", String(!collapsed));
  sideToggle.setAttribute("aria-expanded", String(!collapsed));
}

[grabber, sideToggle].forEach((b) =>
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSheet();
  })
);

// A collapsed sheet opens again on any tap that isn't on one of its controls.
panel.addEventListener("click", (e) => {
  if (!panel.classList.contains("collapsed")) return;
  if (e.target.closest("button, a, input")) return;
  toggleSheet();
});

/* ---------- dragging the sheet (phones) ----------
 *
 * Portrait: drag the sheet down to collapse, up to expand. Landscape: swipe
 * the left dock left/right. The sheet tracks the finger, then snaps: a
 * flick decides by direction, a slow drag by whether it passed halfway.
 *
 * Throughout a drag (and the snap after it) the panel is in its EXPANDED
 * layout, shifted by `offset` px towards collapsed (0 = fully open,
 * travel = exactly where the collapsed sheet's edge sits). The collapsed
 * layout is only swapped in once the snap lands there, so the edge never
 * jumps. Programmatic collapses (e.g. on results) stay instant so map
 * fitting can measure the final layout straight away.
 */

const isLandscapePhone = () => window.matchMedia("(max-height: 500px) and (pointer: coarse)").matches;
const sheetTransform = (offset) =>
  isLandscapePhone() ? `translateX(${-offset}px)` : `translateY(${offset}px)`;
const SNAP_TRANSITION = "transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1)";
let suppressClickUntil = 0;
let snapTimer = null;

/* How far the edge moves between expanded and collapsed, in px. */
function sheetTravel() {
  const was = panel.classList.contains("collapsed");
  const transform = panel.style.transform;
  panel.style.transform = "";
  panel.classList.add("collapsed");
  const c = panel.getBoundingClientRect();
  panel.classList.remove("collapsed");
  const e = panel.getBoundingClientRect();
  panel.classList.toggle("collapsed", was);
  panel.style.transform = transform;
  return Math.max(isLandscapePhone() ? e.width - c.width : e.height - c.height, 0);
}

function snapSheet(collapse, from, travel) {
  clearTimeout(snapTimer);
  setPanelCollapsed(false);
  panel.style.transition = "none";
  panel.style.transform = sheetTransform(from);
  panel.getBoundingClientRect(); // commit the start position before animating
  panel.style.transition = SNAP_TRANSITION;
  panel.style.transform = sheetTransform(collapse ? travel : 0);
  const finish = () => {
    clearTimeout(snapTimer);
    panel.removeEventListener("transitionend", finish);
    panel.style.transition = "";
    panel.style.transform = "";
    if (collapse) setPanelCollapsed(true);
  };
  panel.addEventListener("transitionend", finish);
  snapTimer = setTimeout(finish, 450); // in case transitionend never fires
}

/* Slide the whole panel off-screen (phones) while a search runs, so only the
 * map and its animation show; slide it back when there's something to say. */
let hideTimer = null;
function hideSheet(hidden) {
  if (panel.classList.contains("searching") === hidden) return;
  if (hidden && !isMobile()) return;
  clearTimeout(hideTimer);
  panel.style.transition = SNAP_TRANSITION;
  panel.classList.toggle("searching", hidden);
  hideTimer = setTimeout(() => (panel.style.transition = ""), 450);
}

function toggleSheet() {
  const collapsed = panel.classList.contains("collapsed");
  if (!isMobile()) return setPanelCollapsed(!collapsed);
  const travel = sheetTravel();
  snapSheet(!collapsed, collapsed ? travel : 0, travel);
}

let drag = null;

panel.addEventListener("pointerdown", (e) => {
  if (!isMobile() || e.button > 0) return;
  const collapsed = panel.classList.contains("collapsed");
  // Expanded: drag from the header strip (the content scrolls and has
  // inputs). Collapsed: anywhere on the sheet.
  if (!collapsed && !e.target.closest(".panel-header, #side-toggle")) return;
  if (e.target.closest("input, .share-menu")) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, collapsed, started: false };
});

window.addEventListener(
  "pointermove",
  (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const land = isLandscapePhone();
    // Positive = towards collapsed (down in portrait, left in landscape).
    const delta = land ? drag.x - e.clientX : e.clientY - drag.y;
    const cross = land ? e.clientY - drag.y : e.clientX - drag.x;
    if (!drag.started) {
      if (Math.abs(delta) < 8) return; // still a tap
      if (Math.abs(cross) > Math.abs(delta)) {
        drag = null; // moving the other way: not ours
        return;
      }
      drag.started = true;
      drag.travel = sheetTravel();
      drag.base = drag.collapsed ? drag.travel : 0;
      drag.lastDelta = delta;
      drag.lastT = e.timeStamp;
      drag.v = 0;
      clearTimeout(snapTimer);
      setPanelCollapsed(false);
      panel.style.transition = "none";
      try {
        panel.setPointerCapture(drag.id);
      } catch {}
    }
    let offset = drag.base + delta;
    // Rubber-band past either end instead of a hard stop.
    if (offset < 0) offset *= 0.25;
    else if (offset > drag.travel) offset = drag.travel + (offset - drag.travel) * 0.25;
    drag.offset = offset;
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) {
      // Smoothed velocity (px/ms), so one jittery sample can't decide a flick.
      drag.v = 0.7 * ((delta - drag.lastDelta) / dt) + 0.3 * drag.v;
      drag.lastDelta = delta;
      drag.lastT = e.timeStamp;
    }
    panel.style.transform = sheetTransform(offset);
    e.preventDefault();
  },
  { passive: false }
);

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (!d.started) return;
  suppressClickUntil = performance.now() + 400; // the release isn't a tap
  // A flick decides by its direction. A slow drag commits once it's a
  // third of the way over, measured from where it started.
  const moved = d.offset - d.base;
  const collapse =
    Math.abs(d.v) > 0.3 ? d.v > 0 : Math.abs(moved) > d.travel / 3 ? moved > 0 : d.collapsed;
  snapSheet(collapse, d.offset, d.travel);
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

// Swallow the click that follows a drag, so it doesn't also toggle the sheet
// or press whichever button the finger happened to start on.
panel.addEventListener(
  "click",
  (e) => {
    if (performance.now() < suppressClickUntil) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true
);

function setView(view) {
  if (view !== state.view) {
    state.view = view;
    if (view !== "results" || !isMobile()) setPanelCollapsed(false);
  }
  render();
}

/* ---------- people ---------- */

function me() {
  return state.participants.find((p) => p.id === state.pid);
}

/* Everyone to show: the room's participants, plus my own pending pin if I
 * chose a spot before the join request came back. */
function people() {
  if (state.pid || !state.pendingMe) return state.participants;
  return [{ id: "me", order: 1, name: "", ...state.pendingMe }, ...state.participants];
}

const isMine = (p) => p.id === state.pid || p.id === "me";
const located = (p) => p.lat != null;

function colorIndex(p) {
  return ((p?.order ?? 1) - 1) % COLORS.length;
}

function myLocated() {
  return !!state.pendingMe || located(me() ?? {});
}

/* ---------- geolocation ----------
 *
 * Why the prompt never appeared before: the page only ever asked from the
 * small crosshair button, so first-time visitors saw no prompt at all. Now:
 *  - On the first visit (per browser) we ask straight away. Every browser
 *    shows its prompt for that — no tap needed.
 *  - The big "Use my location" button asks on every tap after that.
 *  - Already-granted visitors are located silently on every visit.
 * We don't re-ask on *every* load: dismissing Chrome's prompt three times
 * auto-blocks the site for a week, which would break the button too.
 *
 * Chrome sometimes shows only a small icon in the address bar instead of a
 * popup ("quiet" prompt). getCurrentPosition then just hangs — its timeout
 * doesn't start until permission is given — so a watchdog points people at
 * that icon instead of leaving a spinner running forever.
 */

const IN_APP_BROWSER = /FBAN|FBAV|Instagram|Line\/|Snapchat|; wv\)/i.test(navigator.userAgent);
let geoState = "prompt";
let geoWatchdog = null;
const locateBtn = $("locate-btn");
const locateLabel = $("locate-label");

async function geoPermissionState() {
  if (!navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (!status.itmWired) {
      status.itmWired = true;
      status.addEventListener("change", () => {
        geoState = status.state;
        updateLocateButton();
        // Allowed from the address bar after a quiet prompt or a block.
        if (status.state === "granted" && !myLocated()) requestLocation({ auto: true });
      });
    }
    return status.state;
  } catch {
    return "unsupported";
  }
}

function updateLocateButton(locating = false) {
  locateBtn.classList.toggle("loading", locating);
  locateBtn.classList.toggle("blocked", geoState === "denied" && !locating);
  locateLabel.textContent = locating
    ? "Finding you…"
    : geoState === "denied"
      ? "Location blocked"
      : "Use my location";
}

function blockedHelp() {
  if (IN_APP_BROWSER) return "Open this page in Chrome or Safari to use your location.";
  return "Location is blocked. Tap the icon left of the address bar → Location → Allow.";
}

function requestLocation({ auto = false } = {}) {
  if (!navigator.geolocation || !window.isSecureContext) {
    if (!auto) setStatus("Location isn't available here — search or tap the map.", true);
    return;
  }
  updateLocateButton(true);
  if (!auto) setStatus("");
  clearTimeout(geoWatchdog);
  geoWatchdog = setTimeout(() => {
    setStatus("Waiting for permission — check the location icon in the address bar.");
  }, 6000);

  const done = () => {
    clearTimeout(geoWatchdog);
    updateLocateButton(false);
  };
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      done();
      geoState = "granted";
      updateLocateButton(false);
      setStatus("");
      if (auto && myLocated()) return; // they picked a spot while we waited
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], Math.max(map.getZoom(), 14));
      setMyLocation(latitude, longitude, "My location");
    },
    async (err) => {
      done();
      if (err.code === 1) {
        geoState = await geoPermissionState();
        updateLocateButton(false);
        // A dismissed first-visit prompt isn't worth an error message.
        if (!auto || geoState === "denied") setStatus(auto ? "" : blockedHelp(), !auto);
      } else if (!auto) {
        setStatus("Couldn't find you — check location is on, or search instead.", true);
      }
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
  );
}

async function autoLocate() {
  if (!navigator.geolocation) return;
  geoState = await geoPermissionState();
  updateLocateButton(false);
  if (geoState === "granted") return requestLocation({ auto: true });
  if (geoState === "denied" || IN_APP_BROWSER) return;
  let askedBefore = false;
  try {
    askedBefore = localStorage.getItem("itm-geo-asked") === "1";
    localStorage.setItem("itm-geo-asked", "1");
  } catch {}
  if (!askedBefore) requestLocation({ auto: true });
}

locateBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (geoState === "denied") {
    // Chrome won't prompt again once blocked — say how to undo it, but try
    // anyway in case it was re-allowed without a reload.
    setStatus(blockedHelp(), true);
  }
  requestLocation();
});

/* ---------- geocode autocomplete ---------- */

function setupAutocomplete(input, box, onPick) {
  let latest = 0;
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 3) {
      box.classList.remove("open");
      return;
    }
    const seq = ++latest;
    const center = map.getCenter(); // bias towards where the map is
    let results = [];
    try {
      results = await fetch(
        `/api/geocode?q=${encodeURIComponent(q)}&lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}`
      ).then((r) => r.json());
    } catch {}
    if (seq !== latest || !Array.isArray(results)) return;
    box.innerHTML = "";
    results.forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `${escapeHtml(r.name)}<span class="sub">${escapeHtml(r.label)}</span>`;
      // pointerdown beats the input's blur, so the pick isn't lost.
      btn.addEventListener("pointerdown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        box.classList.remove("open");
        input.value = "";
        input.blur();
        onPick(r);
        map.panTo([r.lat, r.lon]);
      });
      box.appendChild(btn);
    });
    box.classList.toggle("open", results.length > 0);
  }, 300);

  input.addEventListener("input", search);
  input.addEventListener("blur", () => setTimeout(() => box.classList.remove("open"), 150));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") box.querySelector("button")?.click();
  });
}

setupAutocomplete($("input-you"), $("suggestions-you"), (r) => setMyLocation(r.lat, r.lon, r.name));
setupAutocomplete($("input-add"), $("suggestions-add"), (r) => addPerson(r.lat, r.lon, r.name));

/* ---------- setting pins ---------- */

function setMyLocation(lat, lon, label) {
  if (!state.pid) {
    state.pendingMe = { lat, lon, label };
    syncMarkers();
    if (state.view === "start") setView("people");
    else render();
    return;
  }
  updateParticipant(state.pid, lat, lon, label);
  if (state.view === "start") setView("people");
}

/* Optimistic: update locally (pins + panel), then tell the server. */
function updateParticipant(pid, lat, lon, label) {
  const p = state.participants.find((q) => q.id === pid);
  if (p) Object.assign(p, { lat, lon, label });
  state.localEdits.set(pid, { lat, lon, label, at: Date.now() });
  if (state.lastResults) {
    clearResults();
    if (state.view === "results") state.view = "people";
  }
  syncMarkers();
  render();
  api(`/api/rooms/${state.id}/participants/${pid}`, {
    method: "PATCH",
    body: { lat, lon, label: label ?? "" },
  }).catch(() => {});
}

async function addPerson(lat, lon, label) {
  if (!state.id) return;
  if (state.participants.length >= MAX_PEOPLE) {
    setStatus(`Up to ${MAX_PEOPLE} people per room.`, true);
    return;
  }
  closeAdd();
  try {
    const p = await api(`/api/rooms/${state.id}/participants`, { method: "POST", body: {} });
    state.owned.add(p.id);
    saveOwned();
    state.participants.push(p);
    updateParticipant(p.id, lat, lon, label);
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function removePerson(pid) {
  state.participants = state.participants.filter((p) => p.id !== pid);
  state.owned.delete(pid);
  saveOwned();
  clearResults();
  if (state.view === "results") state.view = "people";
  syncMarkers();
  render();
  api(`/api/rooms/${state.id}/participants/${pid}`, { method: "DELETE" }).catch(() => {});
}

function saveOwned() {
  if (!state.id) return;
  try {
    sessionStorage.setItem(`itm-owned-${state.id}`, JSON.stringify([...state.owned]));
  } catch {}
}

/* Pins for everyone located; mine and the ones I added are draggable. */
function syncMarkers() {
  const seen = new Set();
  people().forEach((p) => {
    if (!located(p)) return;
    const key = isMine(p) ? "me" : p.id;
    seen.add(key);
    const label = isMine(p) ? "You" : initials(p.name);
    const color = COLORS[colorIndex(p)];
    const sig = `${label}|${color}`;
    let marker = state.markers.get(key);
    if (!marker) {
      const draggable = isMine(p) || state.owned.has(p.id);
      marker = L.marker([p.lat, p.lon], { draggable, zIndexOffset: isMine(p) ? 500 : 0 });
      // Polls mustn't yank a pin out from under a drag in progress.
      marker.on("dragstart", () => (marker.itmDragging = true));
      marker.on("dragend", () => {
        marker.itmDragging = false;
        const pos = marker.getLatLng();
        const label = formatCoords(pos.lat, pos.lng);
        if (marker.itmPid === "me") setMyLocation(pos.lat, pos.lng, label);
        else updateParticipant(marker.itmPid, pos.lat, pos.lng, label);
      });
      marker.bindTooltip("");
      marker.addTo(map);
      state.markers.set(key, marker);
    }
    marker.itmPid = isMine(p) ? "me" : p.id;
    if (!marker.itmDragging) marker.setLatLng([p.lat, p.lon]);
    if (marker.itmSig !== sig) {
      marker.itmSig = sig; // setIcon replaces the DOM node: only when needed
      marker.setIcon(pinIcon(label, color));
    }
    marker.setTooltipContent(isMine(p) ? "You" : p.name);
  });
  for (const [key, marker] of state.markers) {
    if (!seen.has(key)) {
      map.removeLayer(marker);
      state.markers.delete(key);
    }
  }
}

/* ---------- add-address field ---------- */

const addField = $("add-field");
const addInput = $("input-add");

function openAdd() {
  state.adding = true;
  setPanelCollapsed(false);
  render();
  addInput.focus();
}

function closeAdd() {
  state.adding = false;
  addInput.value = "";
  render();
}

$("add-btn").addEventListener("click", openAdd);
$("back-btn").addEventListener("click", () => setView("people"));
$("add-cancel").addEventListener("click", closeAdd);

/* ---------- rendering ---------- */

function render() {
  // Without my own pin there's nothing to do but set it.
  if (state.view !== "start" && !myLocated() && !state.lastResults) state.view = "start";
  const view = state.view;

  panel.dataset.step = view;
  $("step-start").hidden = view !== "start";
  $("step-people").hidden = view !== "people";
  $("step-results").hidden = view !== "results";
  $("share-btn").hidden = view === "people"; // step 2 has its own Invite
  $("back-btn").hidden = !myLocated(); // only when changing an existing pin

  const full = state.participants.length >= MAX_PEOPLE;
  addField.hidden = !state.adding;
  $("add-actions").hidden = state.adding;
  $("add-btn").disabled = full;

  const ready = people().filter(located).length >= 2;
  findBtn.disabled = !ready || findBtn.classList.contains("loading");

  renderPeople();
}

function renderPeople() {
  const list = $("people");
  const sig = JSON.stringify([
    people().map((p) => [p.id, p.name, p.label, p.lat, p.order]),
    state.pid,
    [...state.owned],
  ]);
  if (sig === list.dataset.sig) return; // runs every poll; avoid DOM churn
  list.dataset.sig = sig;

  list.innerHTML = "";
  people().forEach((p) => {
    const li = document.createElement("li");
    li.className = "person" + (located(p) ? "" : " waiting");
    const mine = isMine(p);
    const where = located(p) ? p.label || "Pin on map" : "Joining…";
    li.innerHTML = `
      <span class="avatar" style="background:${COLORS[colorIndex(p)]}">${mine ? "" : escapeHtml(initials(p.name))}</span>
      <span class="who"><strong>${mine ? "You" : escapeHtml(p.name)}</strong><span>${escapeHtml(where)}</span></span>`;
    if (mine) {
      // Tap your own row to change where you're starting from.
      li.classList.add("editable");
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", "Change your starting point");
      const edit = () => {
        setView("start");
        $("input-you").focus();
      };
      li.addEventListener("click", edit);
      li.addEventListener("keydown", (e) => e.key === "Enter" && edit());
    } else if (state.owned.has(p.id)) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "remove";
      x.setAttribute("aria-label", `Remove ${p.name}`);
      x.textContent = "×";
      x.addEventListener("click", () => removePerson(p.id));
      li.appendChild(x);
    }
    list.appendChild(li);
  });
}

/* ---------- room ---------- */

async function initRoom() {
  try {
    const pathMatch = location.pathname.match(/^\/r\/([\w-]+)/);
    let id = pathMatch ? pathMatch[1] : new URLSearchParams(location.search).get("room");
    if (id) {
      const check = await fetch(`/api/rooms/${id}`);
      if (!check.ok) id = null; // expired: quietly start a fresh one
    }
    if (!id) id = (await api("/api/rooms", { method: "POST" })).id;
    state.id = id;
    history.replaceState(null, "", `/r/${id}`);
    try {
      JSON.parse(sessionStorage.getItem(`itm-owned-${id}`) || "[]").forEach((pid) =>
        state.owned.add(pid)
      );
    } catch {}
    await joinRoom(id);
    startPolling();
  } catch {
    setStatus("Can't reach the server — check your connection and reload.", true);
  }
}

async function joinRoom(id) {
  // sessionStorage is per-tab, so every tab is its own participant.
  const storageKey = `itm-pid-${id}`;
  let pid = sessionStorage.getItem(storageKey);
  if (pid) {
    const view = await api(`/api/rooms/${id}`);
    if (!view.participants.some((p) => p.id === pid)) pid = null;
  }
  if (!pid) {
    // Rejoin as "the same person" after a reload (pagehide stashes name+pin).
    const stashKey = `itm-me-${id}`;
    let stash = null;
    try {
      stash = JSON.parse(sessionStorage.getItem(stashKey) || "null");
    } catch {}
    sessionStorage.removeItem(stashKey);

    const joined = await api(`/api/rooms/${id}/participants`, {
      method: "POST",
      body: stash?.name ? { name: stash.name } : {},
    });
    pid = joined.id;
    sessionStorage.setItem(storageKey, pid);
    state.participants.push(joined);
    if (stash?.lat != null && !state.pendingMe) {
      state.pendingMe = { lat: stash.lat, lon: stash.lon, label: stash.label };
    }
  }
  state.pid = pid;

  // A pin chosen before the join finished: push it now.
  if (state.pendingMe) {
    const { lat, lon, label } = state.pendingMe;
    state.pendingMe = null;
    updateParticipant(pid, lat, lon, label);
  }
}

window.addEventListener("pagehide", () => {
  if (state.id && state.pid) {
    navigator.sendBeacon(`/api/rooms/${state.id}/participants/${state.pid}/leave`);
    sessionStorage.removeItem(`itm-pid-${state.id}`);
    const mine = me();
    if (mine) {
      sessionStorage.setItem(
        `itm-me-${state.id}`,
        JSON.stringify({ name: mine.name, lat: mine.lat, lon: mine.lon, label: mine.label })
      );
    }
    state.pid = null;
  }
});

window.addEventListener("pageshow", (e) => {
  if (e.persisted && state.id && !state.pid) joinRoom(state.id).catch(() => {});
});

function startPolling() {
  stopPolling();
  pollRoom();
  state.pollTimer = setInterval(pollRoom, POLL_MS);
}

function stopPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function pollRoom() {
  if (!state.id) return;
  let data;
  try {
    data = await api(`/api/rooms/${state.id}`);
  } catch (err) {
    if (err.status === 404) {
      stopPolling();
      setStatus("This room has expired — reload to start a new one.", true);
    }
    return;
  }
  const now = Date.now();
  state.participants = data.participants.map((p) => {
    const edit = state.localEdits.get(p.id);
    return edit && now - edit.at < LOCAL_EDIT_MS
      ? { ...p, lat: edit.lat, lon: edit.lon, label: edit.label }
      : p;
  });
  for (const pid of state.owned) {
    if (!state.participants.some((p) => p.id === pid)) state.owned.delete(pid);
  }
  syncMarkers();

  // Someone (maybe us) ran a search — show everyone the same results.
  if (data.results && data.resultsVersion !== state.resultsVersion) {
    state.resultsVersion = data.resultsVersion;
    renderResults(decorateResults(data.results));
  }
  render();
}

function decorateResults(results) {
  return {
    ...results,
    points: results.points.map((p, i) => {
      // Pin colour follows join order, not array position.
      const person = state.participants.find((q) => q.id === p.id);
      return {
        ...p,
        label: p.id === state.pid ? "You" : p.name,
        color: COLORS[person ? colorIndex(person) : i % COLORS.length],
      };
    }),
  };
}

/* ---------- sharing ---------- */

const shareBtn = $("share-btn");
const shareMenu = $("share-menu");

function placePopover(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const maxRight = window.innerWidth - el.offsetWidth - 8;
  el.style.right = `${Math.min(Math.max(window.innerWidth - r.right, 8), Math.max(maxRight, 8))}px`;
  const below = r.bottom + 8;
  el.style.top =
    below + el.offsetHeight <= window.innerHeight - 8
      ? `${below}px`
      : `${Math.max(r.top - 8 - el.offsetHeight, 8)}px`;
}

function closeShareMenu() {
  shareMenu.hidden = true;
  shareBtn.setAttribute("aria-expanded", "false");
}

/* Native share sheet on phones; elsewhere a small menu (WhatsApp, email,
 * copy). Desktop share sheets are skipped: their "copy" bundles extra text. */
function share(anchor) {
  if (!shareMenu.hidden) return closeShareMenu();
  const data = { title: "in the middle", url: location.href };
  if (isMobile() && navigator.canShare?.(data)) {
    navigator.share(data).catch(() => {});
    return;
  }
  const text = encodeURIComponent(`Let's meet in the middle — add where you're coming from: ${location.href}`);
  $("share-whatsapp").href = `https://wa.me/?text=${text}`;
  $("share-email").href = `mailto:?subject=${encodeURIComponent("Meet in the middle")}&body=${text}`;
  shareMenu.hidden = false;
  placePopover(shareMenu, anchor);
  shareBtn.setAttribute("aria-expanded", "true");
}

[shareBtn, $("invite-btn")].forEach((b) =>
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    share(b);
  })
);
document.addEventListener("click", (e) => {
  if (!shareMenu.hidden && !shareMenu.contains(e.target)) closeShareMenu();
});
window.addEventListener("resize", closeShareMenu);

$("share-copy").addEventListener("click", async () => {
  closeShareMenu();
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus("Link copied.");
  } catch {
    setStatus(location.href);
  }
});

/* ---------- options ---------- */

const budgetChip = $("budget-chip");
budgetChip.addEventListener("click", () => {
  state.budget = BUDGETS[(BUDGETS.indexOf(state.budget) + 1) % BUDGETS.length];
  budgetChip.textContent = `≤ ${state.budget} min`;
});

/* The departure input sits invisibly over its chip, so a tap opens the
 * native picker on phones; desktop browsers get showPicker(). */
const depart = $("depart");
depart.addEventListener("click", (e) => {
  e.stopPropagation();
  try {
    depart.showPicker();
  } catch {}
});
depart.addEventListener("change", () => {
  const label = $("depart-label");
  if (!depart.value) {
    label.textContent = "Leave now";
    return;
  }
  const d = new Date(depart.value);
  const sameDay = d.toDateString() === new Date().toDateString();
  label.textContent =
    "Leave " +
    (sameDay ? "" : d.toLocaleDateString([], { weekday: "short" }) + " ") +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
});

/* ---------- search ---------- */

const findBtn = $("find");
findBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  runSearch();
});

function clearResults() {
  state.spotMarkers.forEach((m) => map.removeLayer(m));
  state.spotMarkers = [];
  clearRoutes();
  state.lastResults = null;
  state.activeIndex = null;
  $("results").innerHTML = "";
}

function clearRoutes() {
  state.routeLayers.forEach((l) => map.removeLayer(l));
  state.routeLayers = [];
}

/* While searching: each person's pin sends out soft ripples in their colour,
 * dotted lines drift from every pin towards the plain geographic centre, and
 * a glow breathes there. Pure CSS animations (transform/opacity only, plus a
 * dash offset), faded in and out so nothing pops. */
function startSearchAnimation() {
  const pts = people().filter(located);
  if (!pts.length) return { stop() {} };
  const centre = [
    pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    pts.reduce((s, p) => s + p.lon, 0) / pts.length,
  ];
  const fx = (html) =>
    L.divIcon({ className: "", html, iconSize: [0, 0], iconAnchor: [0, 0] });
  const layers = [];
  pts.forEach((p, i) => {
    const color = COLORS[colorIndex(p)];
    layers.push(
      L.polyline([[p.lat, p.lon], centre], {
        color,
        weight: 3,
        opacity: 0.7,
        dashArray: "1 11",
        lineCap: "round",
        className: "seek-line seek-fx",
        interactive: false,
      }),
      L.marker([p.lat, p.lon], {
        icon: fx(`<div class="ripple seek-fx" style="--c:${color};--d:${(i * 0.35).toFixed(2)}s"><i></i><i></i></div>`),
        interactive: false,
        keyboard: false,
        zIndexOffset: -1000,
      })
    );
  });
  layers.push(
    L.marker(centre, {
      icon: fx('<div class="seek-core seek-fx"></div>'),
      interactive: false,
      keyboard: false,
    })
  );
  layers.forEach((l) => l.addTo(map));
  map.flyToBounds([...pts.map((p) => [p.lat, p.lon]), centre], {
    ...mapPadding(),
    duration: 0.8,
    maxZoom: 14,
  });
  // Next frame, so the fade-in transition actually runs.
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("seeking")));

  return {
    stop() {
      document.body.classList.remove("seeking");
      setTimeout(() => layers.forEach((l) => map.removeLayer(l)), 450);
    },
  };
}

async function runSearch() {
  closeAdd();
  findBtn.classList.add("loading");
  findBtn.disabled = true;
  setStatus("Checking every route…");
  hideSheet(true); // before the animation, so the map frames for no panel
  const anim = startSearchAnimation();
  try {
    const data = await api(`/api/rooms/${state.id}/meet`, {
      method: "POST",
      body: {
        maxMinutes: state.budget,
        time: depart.value ? new Date(depart.value).toISOString() : null,
      },
    });
    state.resultsVersion = data.resultsVersion;
    setStatus("");
    // Back in first, so renderResults collapses it and frames the map
    // around where the sheet will land.
    hideSheet(false);
    renderResults(decorateResults(data));
  } catch (err) {
    hideSheet(false);
    setPanelCollapsed(false); // errors need the full panel
    setStatus(err.message ?? "Could not reach the server.", true);
  } finally {
    anim.stop();
    findBtn.classList.remove("loading");
    render();
  }
}

/* ---------- results ---------- */

function popupHtml(c, rank, results, legsHtml) {
  const transfers = c.transfers.reduce((s, t) => s + t, 0);
  const times = results.points
    .map(
      (p, j) =>
        `<span style="color:${p.color};font-weight:600">${escapeHtml(p.label)} ${c.minutes[j]} min</span>`
    )
    .join(" ");
  return `
    <div class="popup-title">${rank}. ${escapeHtml(c.name)}</div>
    <div class="result-times">${times}
      <span>${transfers} change${transfers === 1 ? "" : "s"}</span>
    </div>
    <div class="popup-legs">${legsHtml ?? "Loading routes…"}</div>`;
}

/* Leaves room for the panel when fitting/panning the map. */
function mapPadding() {
  if (!isMobile()) return { paddingTopLeft: [400, 60], paddingBottomRight: [60, 60] };
  if (panel.classList.contains("searching")) {
    return { paddingTopLeft: [40, 40], paddingBottomRight: [40, 40] };
  }
  // offset* metrics ignore transforms, so this is where the panel will
  // settle even while it's mid-slide.
  const top = panel.offsetTop;
  const right = panel.offsetLeft + panel.offsetWidth;
  if (top > window.innerHeight / 3) {
    return { paddingTopLeft: [30, 70], paddingBottomRight: [30, window.innerHeight - top + 20] };
  }
  return { paddingTopLeft: [right + 20, 30], paddingBottomRight: [30, 30] };
}

function renderResults(results) {
  clearResults();
  state.lastResults = results;
  const shown = results.candidates.slice(0, SHOWN_RESULTS);

  const list = $("results");
  shown.forEach((c, i) => {
    const marker = L.marker([c.lat, c.lon], { icon: spotIcon(i + 1), zIndexOffset: 1000 - i }).addTo(map);
    marker.bindPopup(popupHtml(c, i + 1, results, null), {
      className: "spot-popup",
      maxWidth: 300,
    });
    marker.on("popupopen", () => selectCandidate(i));
    marker.on("popupclose", () => {
      if (state.activeIndex === i) {
        clearRoutes();
        state.activeIndex = null;
        markActive();
      }
    });
    state.spotMarkers.push(marker);

    const li = document.createElement("li");
    const times = results.points
      .map((p, j) => `<span style="color:${p.color}">${c.minutes[j]}</span>`)
      .join("");
    li.innerHTML = `
      <button type="button" class="result">
        <span class="rank">${i + 1}</span>
        <span class="r-name">${escapeHtml(c.name)}</span>
        <span class="r-times">${times}<span class="unit">min</span></span>
      </button>`;
    li.querySelector("button").addEventListener("click", (e) => {
      e.stopPropagation();
      openCandidate(i);
    });
    list.appendChild(li);
  });

  state.view = "results";
  if (isMobile()) setPanelCollapsed(true);
  render();
  markActive();

  const bounds = results.points.map((p) => [p.lat, p.lon]);
  shown.slice(0, 3).forEach((c) => bounds.push([c.lat, c.lon]));
  map.fitBounds(bounds, mapPadding());
}

function openCandidate(i) {
  const marker = state.spotMarkers[i];
  if (!marker) return;
  if (isMobile()) setPanelCollapsed(true);
  const pad = mapPadding();
  Object.assign(marker.getPopup().options, {
    autoPanPaddingTopLeft: L.point(pad.paddingTopLeft),
    autoPanPaddingBottomRight: L.point(pad.paddingBottomRight),
  });
  marker.openPopup();
}

/* Highlight the selected spot (or #1) in the list; it's what a collapsed
 * sheet keeps showing. */
function markActive() {
  const active = state.activeIndex ?? 0;
  [...$("results").children].forEach((li, i) => {
    li.classList.toggle("active", i === active);
    li.classList.toggle("peek", i === active);
  });
  state.spotMarkers.forEach((m, i) => m.setIcon(spotIcon(i + 1, i === state.activeIndex)));
}

$("edit-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  map.closePopup();
  setView("people");
});

async function selectCandidate(index) {
  const results = state.lastResults;
  const c = results.candidates[index];
  state.activeIndex = index;
  markActive();
  clearRoutes();

  const params = new URLSearchParams({ toLat: c.lat, toLon: c.lon });
  results.points.forEach((p) => params.append("from", `${p.lat},${p.lon}`));
  // Same departure anchor as the search, so routes explain the ranked minutes.
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
      const total = anchorMs
        ? Math.max(Math.round((Date.parse(it.endTime) - anchorMs) / 60000), 0)
        : Math.round(it.duration / 60);
      return `<div><strong style="color:${p.color}">${escapeHtml(p.label)}</strong> ${total} min
        · ${clock(it.startTime)} → ${clock(it.endTime)}<br>${chips || "walk"}</div>`;
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

render();
autoLocate(); // in parallel with the room join, so the prompt shows at once
initRoom();
