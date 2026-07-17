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
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 19,
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
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

map.on("click", (e) => {
  const coords = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
  if (state.mode === "room") {
    setMyLocation(e.latlng.lat, e.latlng.lng, coords);
    return;
  }
  const row = state.classic.rows.find((r) => !r.point);
  if (row) setManualPin(row, e.latlng.lat, e.latlng.lng, coords);
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
function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

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

/* ---------- help popover ---------- */

const helpToggle = document.getElementById("help-toggle");
const helpPopover = document.getElementById("help-popover");

helpToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = helpPopover.hidden;
  helpPopover.hidden = !open;
  helpToggle.setAttribute("aria-expanded", String(open));
});

document.addEventListener("click", (e) => {
  if (!helpPopover.hidden && !helpPopover.contains(e.target)) {
    helpPopover.hidden = true;
    helpToggle.setAttribute("aria-expanded", "false");
  }
});

/* ---------- mode toggle ---------- */

const roomTab = document.getElementById("mode-room");
const classicTab = document.getElementById("mode-classic");
const roomUi = document.getElementById("room-ui");
const classicUi = document.getElementById("classic-ui");

roomTab.addEventListener("click", () => setMode("room"));
classicTab.addEventListener("click", () => setMode("classic"));

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

const shareLink = document.getElementById("share-link");
const shareBtn = document.getElementById("share-btn");
const shareMenu = document.getElementById("share-menu");
const nameInput = document.getElementById("input-name");
const youInput = document.getElementById("input-you");

const SHARE_TEXT = "Meet in the middle — join my room:";

async function copyShareLink() {
  try {
    // The box shows the scheme-less link; copy the full clickable URL.
    await navigator.clipboard.writeText(location.href);
  } catch {
    shareLink.select();
    document.execCommand("copy");
  }
  const shown = shareLink.value;
  shareLink.value = "Copied ✓";
  setTimeout(() => (shareLink.value = shown), 1200);
}

shareLink.addEventListener("click", copyShareLink);

/* Native share sheet (WhatsApp & friends live there) when the browser has
 * one; otherwise a small menu of share links plus copy. */
shareBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  const data = { title: "in the middle", text: SHARE_TEXT, url: location.href };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
    } catch {} // user dismissed the sheet
    return;
  }
  const text = encodeURIComponent(`${SHARE_TEXT} ${location.href}`);
  document.getElementById("share-whatsapp").href = `https://wa.me/?text=${text}`;
  document.getElementById("share-email").href =
    `mailto:?subject=${encodeURIComponent("Meet in the middle")}&body=${text}`;
  shareMenu.hidden = !shareMenu.hidden;
  shareBtn.setAttribute("aria-expanded", String(!shareMenu.hidden));
});

document.getElementById("share-copy").addEventListener("click", () => {
  copyShareLink();
  shareMenu.hidden = true;
});

document.addEventListener("click", (e) => {
  if (!shareMenu.hidden && !shareMenu.contains(e.target)) {
    shareMenu.hidden = true;
    shareBtn.setAttribute("aria-expanded", "false");
  }
});

nameInput.addEventListener(
  "input",
  debounce(() => {
    const name = nameInput.value.trim();
    if (!name || !state.room.pid) return;
    // Remembered so you keep your name when you rejoin after closing the tab.
    localStorage.setItem("itm-name", name);
    api(`/api/rooms/${state.room.id}/participants/${state.room.pid}`, {
      method: "PATCH",
      body: { name },
    }).catch(() => {});
  }, 600)
);

async function initRoom() {
  try {
    // Share links are /r/<id>; ?room=<id> is the old form, still honoured.
    const pathMatch = location.pathname.match(/^\/r\/([\w-]+)/);
    let id = pathMatch ? pathMatch[1] : new URLSearchParams(location.search).get("room");
    const invited = Boolean(id);
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
    // Show the link without the scheme — tidier, and still pasteable.
    shareLink.value = `${location.host}/r/${id}`;

    await joinRoom(id);

    if (!invited) setStatus("Room created — copy the link and send it to your friends.");
    startPolling();
    requestGeolocation();
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
    const me = await api(`/api/rooms/${id}/participants`, {
      method: "POST",
      body: { name: localStorage.getItem("itm-name") || undefined },
    });
    pid = me.id;
    sessionStorage.setItem(storageKey, pid);
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
// survives unload; it can only POST, hence the /leave alias.
window.addEventListener("pagehide", () => {
  if (state.room.id && state.room.pid) {
    navigator.sendBeacon(`/api/rooms/${state.room.id}/participants/${state.room.pid}/leave`);
    sessionStorage.removeItem(`itm-pid-${state.room.id}`);
    state.room.pid = null;
  }
});

// Restored from the back-forward cache after having left: quietly rejoin.
window.addEventListener("pageshow", (e) => {
  if (e.persisted && state.room.id && !state.room.pid) {
    joinRoom(state.room.id).catch(() => {});
  }
});

function requestGeolocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (state.room.youSet) return; // user beat the GPS to it
      const { latitude, longitude } = pos.coords;
      map.setView([latitude, longitude], 13);
      setMyLocation(latitude, longitude, "My current location");
    },
    () => {
      if (!state.room.youSet) {
        setStatus("Couldn't read your location — search for it or click the map.");
      }
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
  );
}

function setMyLocation(lat, lon, label, { push = true } = {}) {
  state.room.youSet = true;
  const me = state.room.participants.find((p) => p.id === state.room.pid);
  const icon = pinIcon(initials(nameInput.value || me?.name), COLORS[colorIndex(me)]);
  if (state.room.youMarker) {
    state.room.youMarker.setLatLng([lat, lon]);
  } else {
    const marker = L.marker([lat, lon], { icon, draggable: true, zIndexOffset: 500 });
    marker.bindTooltip("You — drag to move");
    if (state.mode === "room") marker.addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      setMyLocation(pos.lat, pos.lng, `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`);
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
    setMyLocation(me.lat, me.lon, me.label || `${me.lat.toFixed(4)}, ${me.lon.toFixed(4)}`, { push: false });
  }
  if (me && !nameInput.value && !me.name.startsWith("Person ")) {
    nameInput.value = me.name;
  }
  if (me) {
    document.getElementById("pin-dot-you").style.background = COLORS[colorIndex(me)];
    // Re-icon our marker only when name/colour actually changed — a blind
    // setIcon every poll would interrupt an in-progress drag.
    const sig = `${initials(me.name)}|${colorIndex(me)}`;
    if (state.room.youMarker && sig !== state.room.youIconSig) {
      state.room.youIconSig = sig;
      state.room.youMarker.setIcon(pinIcon(initials(me.name), COLORS[colorIndex(me)]));
    }
  }

  // Pins for everyone else (ours is the draggable youMarker).
  const seen = new Set();
  state.room.participants.forEach((p) => {
    if (p.id === state.room.pid || p.lat == null) return;
    seen.add(p.id);
    const existing = state.room.otherMarkers.get(p.id);
    const sig = `${initials(p.name)}|${colorIndex(p)}`;
    if (existing) {
      existing.setLatLng([p.lat, p.lon]);
      // Only swap the icon when it actually changed: setIcon replaces the
      // DOM node, which would kill the hover tooltip on every poll.
      if (existing.itmSig !== sig) {
        existing.itmSig = sig;
        existing.setIcon(pinIcon(initials(p.name), COLORS[colorIndex(p)]));
      }
      existing.setTooltipContent(p.name);
    } else {
      const marker = L.marker([p.lat, p.lon], {
        icon: pinIcon(initials(p.name), COLORS[colorIndex(p)]),
      });
      marker.itmSig = sig;
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
    points: results.points.map((p, i) => ({
      ...p,
      label: p.id === state.room.pid ? "You" : p.name,
      color: COLORS[i % COLORS.length],
    })),
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
      row.input.value = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
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

const findBtn = document.getElementById("find");

function locatedCount() {
  return state.room.participants.filter((p) => p.lat != null).length;
}

function updateFindButton() {
  if (state.mode === "room") {
    findBtn.disabled = locatedCount() < 2;
  } else {
    findBtn.disabled = state.classic.rows.filter((r) => r.point).length < 2;
  }
}

/* ---------- search ---------- */

function clearResults() {
  state.spotMarkers.forEach((m) => map.removeLayer(m));
  state.spotMarkers = [];
  clearRoutes();
  state.lastResults = null;
  state.activeIndex = null;
  document.getElementById("results").innerHTML = "";
  setStatus("");
}

function clearRoutes() {
  state.routeLayers.forEach((l) => map.removeLayer(l));
  state.routeLayers = [];
}

findBtn.addEventListener("click", async () => {
  clearResults();
  findBtn.classList.add("loading");
  findBtn.disabled = true;
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
    setStatus(err.message ?? "Could not reach the local server.", true);
  } finally {
    findBtn.classList.remove("loading");
    updateFindButton();
  }
});

/* ---------- results ---------- */

function renderResults(results) {
  clearResults();
  state.lastResults = results;
  const list = document.getElementById("results");
  setStatus(`${results.stats.common.toLocaleString()} stops reachable by all — top picks:`);

  const bounds = results.points.map((p) => [p.lat, p.lon]);

  results.candidates.forEach((c, i) => {
    const marker = L.marker([c.lat, c.lon], { icon: spotIcon(i + 1) })
      .addTo(map)
      .on("click", () => selectCandidate(i));
    state.spotMarkers.push(marker);
    if (i < 3) bounds.push([c.lat, c.lon]);

    const li = document.createElement("li");
    li.dataset.index = i;
    const transfers = c.transfers.reduce((s, t) => s + t, 0);
    const times = results.points
      .map(
        (p, j) =>
          `<span style="color:${p.color};font-weight:600">${escapeHtml(p.label)}: ${c.minutes[j]} min</span>`
      )
      .join(" ");
    li.innerHTML = `
      <div class="result-name">${i + 1}. ${escapeHtml(c.name)}</div>
      <div class="result-times">${times}
        <span>${transfers} transfer${transfers === 1 ? "" : "s"} total</span>
      </div>
      <div class="result-legs" hidden></div>`;
    li.addEventListener("click", () => selectCandidate(i));
    list.appendChild(li);
  });

  map.fitBounds(bounds, { padding: [60, 60], paddingTopLeft: [420, 60] });
}

/* ---------- route display ---------- */

async function selectCandidate(index) {
  const results = state.lastResults;
  const c = results.candidates[index];
  state.activeIndex = index;
  clearRoutes();

  document.querySelectorAll(".results li").forEach((li) => {
    li.classList.toggle("active", Number(li.dataset.index) === index);
    li.querySelector(".result-legs").hidden = Number(li.dataset.index) !== index;
  });

  const legsEl = document.querySelector(`.results li[data-index="${index}"] .result-legs`);
  legsEl.textContent = "Loading routes…";

  const params = new URLSearchParams({ toLat: c.lat, toLon: c.lon });
  results.points.forEach((p) => params.append("from", `${p.lat},${p.lon}`));
  // Same departure anchor as the search, so these routes explain the ranked
  // minutes instead of being re-planned from "now".
  if (results.time) params.set("time", results.time);

  const data = await fetch(`/api/routes?${params}`).then((r) => r.json());

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

  legsEl.innerHTML = data.itineraries
    .map((it, i) => {
      const p = results.points[i];
      if (!it) return `<div>${escapeHtml(p.label)}: no route found</div>`;
      const chips = it.legs
        .filter((l) => l.mode !== "WALK")
        .map((l) => `<span class="leg-chip">${escapeHtml(l.route ?? l.mode)}</span>`)
        .join(" → ");
      // Minutes from the shared anchor (waiting included), matching the
      // ranked list; the leave/arrive clock times make the wait visible.
      const total = anchorMs
        ? Math.max(Math.round((Date.parse(it.endTime) - anchorMs) / 60000), 0)
        : Math.round(it.duration / 60);
      return `<div><strong style="color:${p.color}">${escapeHtml(p.label)}</strong> ${total} min
        (leave ${clock(it.startTime)} → arrive ${clock(it.endTime)}): ${chips || "walk"}</div>`;
    })
    .join("");
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
initRoom();
