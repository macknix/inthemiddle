/* in the middle — frontend. Leaflet map + calls to the local Flask API.
 *
 * Two modes:
 *  - "room" (default): the page is a shareable session (?room=<id>). Everyone
 *    who opens the link joins with their own pin; pins sync by polling and
 *    search results are shared with the whole room.
 *  - "classic": the original single-screen mode — type two addresses.
 */

"use strict";

/* One colour per participant, assigned by join order (classic uses 0 and 1). */
const COLORS = ["#7fb4ff", "#ff8fb8", "#ffd479", "#9ef0a8", "#c9a2ff"];
const POLL_MS = 3000;

const state = {
  mode: "room",
  classic: { a: null, b: null, markers: { a: null, b: null } },
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
  if (state.mode === "room") {
    setMyLocation(e.latlng.lat, e.latlng.lng, `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
    return;
  }
  const which = !state.classic.a ? "a" : !state.classic.b ? "b" : null;
  if (!which) return;
  setClassicPin(which, e.latlng.lat, e.latlng.lng, `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
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

function setupAutocomplete(inputId, boxId, onPick) {
  const input = document.getElementById(inputId);
  const box = document.getElementById(boxId);

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

setupAutocomplete("input-you", "suggestions-you", (r) => setMyLocation(r.lat, r.lon, r.name));
setupAutocomplete("input-a", "suggestions-a", (r) => setClassicPin("a", r.lat, r.lon, r.name));
setupAutocomplete("input-b", "suggestions-b", (r) => setClassicPin("b", r.lat, r.lon, r.name));

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
  toggleMarkers([state.classic.markers.a, state.classic.markers.b], !room);

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
const copyBtn = document.getElementById("copy-link");
const nameInput = document.getElementById("input-name");
const youInput = document.getElementById("input-you");

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareLink.value);
  } catch {
    shareLink.select();
    document.execCommand("copy");
  }
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
});

nameInput.addEventListener(
  "input",
  debounce(() => {
    const name = nameInput.value.trim();
    if (!name || !state.room.pid) return;
    api(`/api/rooms/${state.room.id}/participants/${state.room.pid}`, {
      method: "PATCH",
      body: { name },
    }).catch(() => {});
  }, 600)
);

async function initRoom() {
  try {
    const params = new URLSearchParams(location.search);
    let id = params.get("room");
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
    history.replaceState(null, "", `?room=${id}`);
    shareLink.value = location.href;

    // sessionStorage is per-tab, so every tab is its own participant —
    // handy for testing a whole room from one browser.
    const storageKey = `itm-pid-${id}`;
    let pid = sessionStorage.getItem(storageKey);
    if (pid) {
      const view = await api(`/api/rooms/${id}`);
      if (!view.participants.some((p) => p.id === pid)) pid = null;
    }
    if (!pid) {
      const me = await api(`/api/rooms/${id}/participants`, { method: "POST", body: {} });
      pid = me.id;
      sessionStorage.setItem(storageKey, pid);
    }
    state.room.pid = pid;

    // If the user dropped a pin before the join finished, sync it now.
    if (state.room.youSet && state.room.youMarker) {
      const pos = state.room.youMarker.getLatLng();
      setMyLocation(pos.lat, pos.lng, youInput.value);
    }

    if (!invited) setStatus("Room created — copy the link and send it to your friends.");
    startPolling();
    requestGeolocation();
  } catch (err) {
    setStatus("Could not reach the local server to create a room.", true);
  }
}

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
    const icon = pinIcon(initials(p.name), COLORS[colorIndex(p)]);
    if (existing) {
      existing.setLatLng([p.lat, p.lon]);
      existing.setIcon(icon);
    } else {
      const marker = L.marker([p.lat, p.lon], { icon });
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

/* ---------- classic mode ---------- */

function setClassicPin(which, lat, lon, label) {
  state.classic[which] = { lat, lon };
  const color = which === "a" ? COLORS[0] : COLORS[1];
  if (state.classic.markers[which]) {
    state.classic.markers[which].setLatLng([lat, lon]);
  } else {
    const marker = L.marker([lat, lon], {
      icon: pinIcon(which.toUpperCase(), color),
      draggable: true,
    }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      state.classic[which] = { lat: pos.lat, lon: pos.lng };
      document.getElementById(`input-${which}`).value = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
      clearResults();
      updateFindButton();
    });
    state.classic.markers[which] = marker;
  }
  if (label) document.getElementById(`input-${which}`).value = label;
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
    findBtn.disabled = !(state.classic.a && state.classic.b);
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
      const points = [state.classic.a, state.classic.b];
      const data = await api("/api/meet", { method: "POST", body: { points, ...options } });
      renderResults({
        ...data,
        points: points.map((p, i) => ({ ...p, label: i === 0 ? "A" : "B", color: COLORS[i] })),
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

  const departInput = document.getElementById("depart").value;
  const params = new URLSearchParams({ toLat: c.lat, toLon: c.lon });
  results.points.forEach((p) => params.append("from", `${p.lat},${p.lon}`));
  if (departInput) params.set("time", new Date(departInput).toISOString());

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

  legsEl.innerHTML = data.itineraries
    .map((it, i) => {
      const p = results.points[i];
      if (!it) return `<div>${escapeHtml(p.label)}: no route found</div>`;
      const chips = it.legs
        .filter((l) => l.mode !== "WALK")
        .map((l) => `<span class="leg-chip">${escapeHtml(l.route ?? l.mode)}</span>`)
        .join(" → ");
      return `<div><strong style="color:${p.color}">${escapeHtml(p.label)}</strong> ${Math.round(it.duration / 60)} min: ${chips || "walk"}</div>`;
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

initRoom();
