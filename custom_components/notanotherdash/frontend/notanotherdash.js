// Not Another Dash – Übersicht (Schritt 1).
// Ein Web Component ohne Build-Schritt. Ziel ist Safari 15 (iPad Air 2):
// keine privaten Klassenfelder, kein @container, kein structuredClone.
// Aktualisiert wird gezielt: nur die Kacheln, deren Entitäten sich geändert haben.

import { CSS, TINTS } from "./lib/styles.js";
import { icon, weatherIcon } from "./lib/icons.js";
import {
  buildModel,
  roomEntities,
  roomSummary,
  totals,
  fmtNum,
  conditionText,
  wasteItems,
  departures,
  domainOf
} from "./lib/model.js";

const LONG_PRESS_MS = 600;
const REGISTRY_EVENTS = ["area_registry_updated", "floor_registry_updated", "device_registry_updated", "entity_registry_updated"];
const SOON = "Folgt in einem der nächsten Schritte";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function local(key, value) {
  try {
    if (value === undefined) return window.localStorage.getItem("notanotherdash." + key);
    window.localStorage.setItem("notanotherdash." + key, value);
  } catch (e) {
    return null;
  }
  return value;
}

function oldIpad() {
  const m = /OS (\d+)_\d+(?:_\d+)? like Mac OS X/.exec(navigator.userAgent || "");
  return !!(m && parseInt(m[1], 10) < 16);
}

function loadFont() {
  if (document.getElementById("notanotherdash-font")) return;
  const link = document.createElement("link");
  link.id = "notanotherdash-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap";
  document.head.appendChild(link);
}

class NotAnotherDashPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._started = false;
    this._reg = null;
    this._settings = {};
    this._model = null;
    this._watch = {}; // entity_id -> [Raum-IDs]
    this._last = {}; // entity_id -> zuletzt gesehenes Zustandsobjekt
    this._unsubs = [];
    this._forecast = null;
    this._waste = [];
    this._tab = "side";
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._start();
    else if (this._model) this._update();
  }

  get hass() {
    return this._hass;
  }

  set narrow(v) {}
  set route(v) {}
  set panel(v) {}

  connectedCallback() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), 10000);
    this._wasteTimer = setInterval(() => this._loadWaste(), 30 * 60000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    clearInterval(this._wasteTimer);
    this._timer = null;
    this._unsubs.forEach((u) => Promise.resolve(u).then((f) => f && f()));
    this._unsubs = [];
    this._started = false;
    this._hass = null;
  }

  // ---------- Laden ----------

  async _start() {
    if (this._started) return;
    this._started = true;
    loadFont();
    this._renderShell();
    try {
      const res = await this._hass.callWS({ type: "notanotherdash/settings/get" });
      this._settings = res.settings || {};
    } catch (e) {
      this._settings = {};
    }
    await this._loadRegistries();
    this._applyLook();
    this._rebuild();
    this._subscribe();
    this._subscribeForecast();
    this._loadWaste();
  }

  async _loadRegistries() {
    const ws = (type) => this._hass.callWS({ type: type }).catch(() => []);
    const r = await Promise.all([
      ws("config/area_registry/list"),
      ws("config/floor_registry/list"),
      ws("config/device_registry/list"),
      ws("config/entity_registry/list")
    ]);
    this._reg = { areas: r[0], floors: r[1], devices: r[2], entities: r[3] };
  }

  _subscribe() {
    const conn = this._hass.connection;
    let pending = null;
    const reload = () => {
      clearTimeout(pending);
      pending = setTimeout(async () => {
        await this._loadRegistries();
        this._rebuild();
      }, 1000);
    };
    REGISTRY_EVENTS.forEach((ev) => this._unsubs.push(conn.subscribeEvents(reload, ev)));
    this._unsubs.push(
      conn.subscribeMessage(
        (msg) => {
          this._settings = msg.settings || {};
          this._applyLook();
          this._rebuild();
          this._subscribeForecast();
          this._loadWaste();
        },
        { type: "notanotherdash/settings/subscribe" }
      )
    );
  }

  _weatherEntity() {
    const s = this._settings.weather_entity;
    if (s && this._hass.states[s]) return s;
    const ids = Object.keys(this._hass.states).filter((id) => domainOf(id) === "weather");
    return ids[0] || null;
  }

  _subscribeForecast() {
    if (this._forecastUnsub) {
      Promise.resolve(this._forecastUnsub).then((f) => f && f());
      this._forecastUnsub = null;
    }
    this._forecast = null;
    const id = this._weatherEntity();
    if (!id) return;
    this._forecastUnsub = this._hass.connection
      .subscribeMessage(
        (msg) => {
          this._forecast = (msg && msg.forecast) || null;
          this._renderWeather();
        },
        { type: "weather/subscribe_forecast", forecast_type: "daily", entity_id: id }
      )
      .catch(() => null);
  }

  async _loadWaste() {
    const id = this._settings.waste_calendar;
    if (!id || !this._hass) {
      this._waste = [];
      this._renderSide();
      return;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 15 * 86400000);
    try {
      this._waste = await this._hass.callApi(
        "GET",
        "calendars/" + id + "?start=" + encodeURIComponent(start.toISOString()) + "&end=" + encodeURIComponent(end.toISOString())
      );
    } catch (e) {
      this._waste = [];
    }
    this._renderSide();
  }

  // ---------- Aufbau ----------

  _rebuild() {
    if (!this._reg) return;
    this._model = buildModel(this._reg, this._settings, this._hass.states);
    this._watch = {};
    Object.keys(this._model.rooms).forEach((rid) => {
      roomEntities(this._model.rooms[rid]).forEach((eid) => {
        (this._watch[eid] = this._watch[eid] || []).push(rid);
      });
    });
    this._last = {};
    Object.keys(this._watch).forEach((eid) => (this._last[eid] = this._hass.states[eid]));
    this._renderRooms();
    this._renderChips();
    this._renderWeather();
    this._renderSide();
  }

  _update() {
    const states = this._hass.states;
    const dirty = {};
    let any = false;
    Object.keys(this._watch).forEach((eid) => {
      if (states[eid] !== this._last[eid]) {
        this._last[eid] = states[eid];
        this._watch[eid].forEach((rid) => (dirty[rid] = true));
        any = true;
      }
    });
    Object.keys(dirty).forEach((rid) => this._renderTile(rid));
    if (any) this._renderChips();

    const side = [this._weatherEntity(), this._settings.outdoor_temp_entity, this._settings.departures_entity];
    let sideDirty = false;
    side.forEach((eid) => {
      if (eid && states[eid] !== this._last["side:" + eid]) {
        this._last["side:" + eid] = states[eid];
        sideDirty = true;
      }
    });
    if (sideDirty) {
      this._renderWeather();
      this._renderSide();
    }
  }

  _tick() {
    const el = this._q(".clock");
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    this._q(".date").textContent = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
    // Abfahrten zählen Minuten herunter, auch ohne neuen Zustand.
    if (this._settings.departures_entity) this._renderSide();
  }

  _q(sel) {
    return this.shadowRoot.querySelector(sel);
  }

  _applyLook() {
    const mode = local("lite") || "auto";
    const lite = mode === "on" || (mode === "auto" && oldIpad());
    const root = this._q(".root");
    if (!root) return;
    root.classList.toggle("lite", lite);
    this._q(".glow").style.background = TINTS[this._settings.tint] || TINTS.plum;
  }

  // ---------- Darstellung ----------

  _renderShell() {
    this.shadowRoot.innerHTML =
      "<style>" +
      CSS +
      "</style>" +
      '<div class="root">' +
      '<div class="glow" aria-hidden="true"></div>' +
      '<header><div><div class="lbl date"></div><div class="clock"></div></div>' +
      '<div class="weather"></div><div class="chips"></div></header>' +
      '<div class="body"><aside class="side" aria-label="Erinnerungen und Abfahrten"></aside><main class="rooms"></main></div>' +
      '<nav class="dock" aria-label="Bereiche">' +
      this._dockBtn("home", "Übersicht", true) +
      this._dockBtn("thermo", "Klima") +
      this._dockBtn("bulb", "Licht") +
      this._dockBtn("camera", "Kameras") +
      this._dockBtn("bolt", "Energie") +
      this._dockBtn("vacuum", "Sauger") +
      "</nav>" +
      '<button class="gear" aria-label="Einstellungen, gedrückt halten">' +
      '<svg class="ring" viewBox="0 0 58 58" aria-hidden="true"><circle cx="29" cy="29" r="27"></circle></svg>' +
      icon("gear", "gic") +
      "</button>" +
      '<div class="toast" role="status"></div>' +
      '<section class="settings" aria-label="Einstellungen"></section>' +
      "</div>";
    this._tick();

    const sr = this.shadowRoot;
    sr.querySelector(".rooms").addEventListener("click", (e) => {
      const t = e.target.closest ? e.target.closest(".tile") : null;
      if (t) this._toast("Raumansicht folgt in Schritt 2");
    });
    sr.querySelector("nav.dock").addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest(".dockbtn") : null;
      if (b && !b.classList.contains("act")) this._toast(SOON);
    });
    this._bindGear(sr.querySelector(".gear"));
  }

  _dockBtn(ic, label, active) {
    return (
      '<button class="dockbtn' + (active ? " act" : "") + '"' + (active ? ' aria-current="page"' : "") + ">" + icon(ic) + esc(label) + "</button>"
    );
  }

  _bindGear(btn) {
    let timer = null;
    let pressing = false;
    const down = (e) => {
      e.preventDefault();
      pressing = true;
      btn.classList.add("press");
      timer = setTimeout(() => {
        pressing = false;
        btn.classList.remove("press");
        this._openSettings();
      }, LONG_PRESS_MS);
    };
    const up = () => {
      if (!pressing) return;
      pressing = false;
      clearTimeout(timer);
      btn.classList.remove("press");
      this._toast("Gedrückt halten für Einstellungen");
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _toast(text) {
    const t = this._q(".toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
  }

  _renderRooms() {
    const main = this._q(".rooms");
    const floors = this._model.floors;
    if (!floors.length) {
      main.innerHTML =
        '<div class="empty">Keine Bereiche gefunden. Lege in Home Assistant unter Einstellungen → Bereiche Räume an und ordne ihnen Geräte zu.</div>';
      return;
    }
    main.innerHTML = floors
      .map(
        (f) =>
          '<section class="floor">' +
          (f.name ? '<div class="lbl">' + esc(f.name) + "</div>" : "") +
          '<div class="grid">' +
          f.rooms.map((r) => '<button class="tile" data-room="' + esc(r.id) + '"></button>').join("") +
          "</div></section>"
      )
      .join("");
    Object.keys(this._model.rooms).forEach((rid) => this._renderTile(rid));
  }

  _renderTile(rid) {
    const room = this._model.rooms[rid];
    const el = this.shadowRoot.querySelector('.tile[data-room="' + (window.CSS && window.CSS.escape ? window.CSS.escape(rid) : rid) + '"]');
    if (!room || !el) return;
    const s = roomSummary(room, this._hass.states, Date.now());
    const sub = [];
    if (s.temp != null) sub.push(fmtNum(s.temp, 1) + "°");
    if (s.hum != null) sub.push(Math.round(s.hum) + " %");
    const pills = [];
    if (s.lightsOn) pills.push('<span class="pill light">' + icon("bulb") + s.lightsOn + "/" + s.lightsTotal + "</span>");
    if (s.cover) pills.push('<span class="pill">' + icon("shade") + esc(s.cover) + "</span>");
    if (s.heating) pills.push('<span class="pill heat">' + icon("flame") + (s.target != null ? fmtNum(s.target, 0) + "°" : "Heizt") + "</span>");
    if (s.windowsOpen) pills.push('<span class="pill alert">' + icon("window") + (s.windowsOpen > 1 ? s.windowsOpen + " Fenster" : "Fenster") + "</span>");
    if (s.presence) pills.push('<span class="pill">' + icon("person") + esc(s.presence) + "</span>");
    if (s.cameras && pills.length < 3) pills.push('<span class="pill">' + icon("camera") + "Kamera</span>");
    pills.length = Math.min(pills.length, 3);
    el.classList.toggle("on", s.lightsOn > 0);
    el.setAttribute("aria-label", room.name + " öffnen");
    el.innerHTML =
      '<div><div class="tname">' + esc(room.name) + '</div><div class="tsub">' + esc(sub.join(" · ")) + "</div></div>" +
      '<div class="pills">' + pills.join("") + "</div>";
  }

  _renderChips() {
    const rooms = this._model.rooms;
    const t = totals(Object.keys(rooms).map((rid) => roomSummary(rooms[rid], this._hass.states, Date.now())));
    this._q(".chips").innerHTML =
      '<span class="chip">' + icon("bulb").replace('class="ic"', 'class="ic" style="color:#f2a65a"') + "Licht <small>" + t.lights + " an</small></span>" +
      '<span class="chip">' + icon("flame").replace('class="ic"', 'class="ic" style="color:#ff8f5c"') + "Heizung <small>" + t.heating + " aktiv</small></span>" +
      '<span class="chip">' + icon("window").replace('class="ic"', 'class="ic" style="color:#a9c6ff"') + "Fenster <small>" + (t.windows ? t.windows + " offen" : "alle zu") + "</small></span>";
  }

  _renderWeather() {
    const el = this._q(".weather");
    if (!el || !this._hass) return;
    const wid = this._weatherEntity();
    const w = wid ? this._hass.states[wid] : null;
    const out = this._settings.outdoor_temp_entity ? this._hass.states[this._settings.outdoor_temp_entity] : null;
    let temp = null;
    if (out && isFinite(parseFloat(out.state))) temp = parseFloat(out.state);
    else if (w && w.attributes && w.attributes.temperature != null) temp = parseFloat(w.attributes.temperature);
    if (!w && temp == null) {
      el.innerHTML = "";
      return;
    }
    const parts = [];
    if (w) parts.push(conditionText(w.state));
    const f = this._forecast && this._forecast[0];
    if (f && f.temperature != null) parts.push((f.templow != null ? Math.round(f.templow) + "° / " : "") + Math.round(f.temperature) + "°");
    el.innerHTML =
      icon(weatherIcon(w ? w.state : "")) +
      '<div style="display:flex;flex-direction:column"><span class="t">' + (temp != null ? Math.round(temp) + "°" : "–") + '</span><span class="s">' +
      esc(parts.filter(Boolean).join(" · ")) + "</span></div>";
  }

  _renderSide() {
    const el = this._q(".side");
    if (!el || !this._hass) return;
    const st = this._settings;
    let html = "";
    if (st.waste_calendar) {
      const items = wasteItems(this._waste, Date.now(), 3);
      html +=
        '<div style="display:flex;flex-direction:column;gap:8px">' +
        (items.length
          ? items
              .map(
                (i) =>
                  '<div class="rem' + (i.soon ? " soon" : "") + '"><span class="badge">' + icon("bin") + '</span><span class="t">' + esc(i.title) + '</span><span class="s">' + esc(i.when) + "</span></div>"
              )
              .join("")
          : '<div class="empty">Keine Abholung in den nächsten zwei Wochen</div>') +
        "</div>";
    }
    if (st.departures_entity) {
      const so = this._hass.states[st.departures_entity];
      const list = departures(so, Date.now(), st.departures_count || 3);
      const name = so ? (so.attributes.friendly_name || st.departures_entity) : st.departures_entity;
      if (html) html += '<div class="sep"></div>';
      html +=
        '<div style="display:flex;flex-direction:column;gap:11px"><div class="stop">' + icon("bus") + esc(name) + "</div>" +
        (list.length
          ? list
              .map(
                (d) =>
                  '<div class="dep"><span class="line">' + esc(d.line) + '</span><span class="to">' + esc(d.to) + '</span><span class="min' + (d.delay > 0 ? " late" : "") + '">' +
                  (d.minutes == null ? "" : d.minutes < 1 ? "jetzt" : d.minutes + " Min.") + "</span></div>"
              )
              .join("")
          : '<div class="empty">Keine Abfahrten gefunden</div>') +
        "</div>";
    }
    if (!html) html = '<div class="empty">Müllkalender und Abfahrten wählst du in den Einstellungen (Zahnrad unten rechts gedrückt halten).</div>';
    el.innerHTML = html;
  }

  // ---------- Einstellungen ----------

  _openSettings() {
    this._draft = JSON.parse(JSON.stringify(this._settings || {}));
    this._q(".settings").classList.add("open");
    this._renderSettings();
  }

  _closeSettings() {
    this._q(".settings").classList.remove("open");
  }

  async _saveSettings() {
    try {
      await this._hass.callWS({ type: "notanotherdash/settings/save", settings: this._draft });
      this._settings = this._draft;
      this._applyLook();
      this._rebuild();
      this._subscribeForecast();
      this._loadWaste();
      this._closeSettings();
    } catch (e) {
      this._toast("Speichern fehlgeschlagen");
    }
  }

  _entityOptions(filter, current) {
    const states = this._hass.states;
    const ids = Object.keys(states).filter((id) => filter(id, states[id])).sort();
    return (
      '<option value="">– keine –</option>' +
      ids
        .map((id) => {
          const n = states[id].attributes.friendly_name || id;
          return '<option value="' + esc(id) + '"' + (id === current ? " selected" : "") + ">" + esc(n) + " (" + esc(id) + ")</option>";
        })
        .join("")
    );
  }

  _renderSettings() {
    const d = this._draft;
    const tabs = [
      ["side", "Kopfzeile & Leiste"],
      ["rooms", "Räume"],
      ["look", "Darstellung"]
    ];
    let page = "";
    if (this._tab === "side") {
      page =
        '<div class="group">' +
        this._entRow("weather_entity", "Wetter", "Kopfzeile; ohne Auswahl die erste Wetter-Entität", (id) => domainOf(id) === "weather") +
        this._entRow("outdoor_temp_entity", "Außentemperatur", "Ersetzt die Temperatur des Wetterdienstes", (id, s) => domainOf(id) === "sensor" && (s.attributes.device_class === "temperature" || s.attributes.unit_of_measurement === "°C")) +
        this._entRow("waste_calendar", "Müllkalender", "Termine der nächsten zwei Wochen", (id) => domainOf(id) === "calendar") +
        this._entRow("departures_entity", "Abfahrten", "Sensor mit einer Abfahrtsliste", (id, s) => domainOf(id) === "sensor" && (Array.isArray(s.attributes.departures) || Array.isArray(s.attributes.next_departures) || Array.isArray(s.attributes.journeys))) +
        '<div class="row"><div><div class="t">Anzahl Abfahrten</div></div><div class="seg" data-seg="departures_count">' +
        [2, 3, 4].map((n) => '<button data-val="' + n + '" class="' + ((d.departures_count || 3) === n ? "on" : "") + '">' + n + "</button>").join("") +
        "</div></div></div>";
    } else if (this._tab === "rooms") {
      const hidden = d.hidden_rooms || [];
      page =
        '<div class="note">Räume kommen aus den Bereichen in Home Assistant. Einzelne Geräte oder Entitäten blendest du aus, indem du ihnen in HA das Label „Dashboard aus“ gibst.</div>' +
        '<div class="group">' +
        (this._reg.areas || [])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, "de"))
          .map((a) => {
            const on = hidden.indexOf(a.area_id) < 0;
            return '<div class="row"><div class="t">' + esc(a.name) + '</div><button class="sw' + (on ? " on" : "") + '" role="switch" aria-checked="' + on + '" aria-label="' + esc(a.name) + ' anzeigen" data-room="' + esc(a.area_id) + '"></button></div>';
          })
          .join("") +
        "</div>";
    } else {
      const lite = local("lite") || "auto";
      page =
        '<div class="group">' +
        '<div class="row"><div><div class="t">Lite-Modus</div><div class="d">Nur dieses Gerät · ohne Unschärfe und Schatten</div></div><div class="seg" data-local="lite">' +
        [["auto", "Auto"], ["on", "An"], ["off", "Aus"]].map((o) => '<button data-val="' + o[0] + '" class="' + (lite === o[0] ? "on" : "") + '">' + o[1] + "</button>").join("") +
        "</div></div>" +
        '<div class="row"><div class="t">Hintergrund-Farbton</div><div style="margin-left:auto;display:flex;gap:10px">' +
        Object.keys(TINTS).map((k) => '<button class="tint' + ((d.tint || "plum") === k ? " on" : "") + '" data-tint="' + k + '" aria-label="' + k + '" style="background:' + TINTS[k] + '"></button>').join("") +
        "</div></div></div>";
    }
    const el = this._q(".settings");
    el.innerHTML =
      '<header><h1>Einstellungen</h1><button class="done">Fertig</button></header>' +
      '<nav class="snav">' + tabs.map((t) => '<button class="nav' + (this._tab === t[0] ? " on" : "") + '" data-tab="' + t[0] + '">' + t[1] + "</button>").join("") + "</nav>" +
      '<div class="spage">' + page + "</div>";

    el.querySelector(".done").onclick = () => this._saveSettings();
    el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { this._tab = b.getAttribute("data-tab"); this._renderSettings(); }));
    el.querySelectorAll("select[data-key]").forEach((s) => (s.onchange = () => { d[s.getAttribute("data-key")] = s.value || null; }));
    el.querySelectorAll("[data-seg] button").forEach((b) => (b.onclick = () => { d[b.parentNode.getAttribute("data-seg")] = parseInt(b.getAttribute("data-val"), 10); this._renderSettings(); }));
    el.querySelectorAll("[data-local] button").forEach((b) => (b.onclick = () => { local(b.parentNode.getAttribute("data-local"), b.getAttribute("data-val")); this._applyLook(); this._renderSettings(); }));
    el.querySelectorAll("[data-tint]").forEach((b) => (b.onclick = () => { d.tint = b.getAttribute("data-tint"); this._renderSettings(); }));
    el.querySelectorAll(".sw[data-room]").forEach((b) => (b.onclick = () => {
      const id = b.getAttribute("data-room");
      const list = (d.hidden_rooms = d.hidden_rooms || []);
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else list.push(id);
      this._renderSettings();
    }));
  }

  _entRow(key, title, desc, filter) {
    return (
      '<div class="row"><div><div class="t">' + esc(title) + '</div><div class="d">' + esc(desc) + "</div></div>" +
      '<select class="ent" data-key="' + key + '" aria-label="' + esc(title) + '">' + this._entityOptions(filter, this._draft[key]) + "</select></div>"
    );
  }
}

if (!customElements.get("notanotherdash-panel")) customElements.define("notanotherdash-panel", NotAnotherDashPanel);
