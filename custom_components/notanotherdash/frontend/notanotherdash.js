// Not Another Dash – Übersicht (Schritt 1).
// Ein Web Component ohne Build-Schritt. Ziel ist Safari 15 (iPad Air 2):
// keine privaten Klassenfelder, kein @container, kein structuredClone.
// Aktualisiert wird gezielt: nur die Kacheln, deren Entitäten sich geändert haben.

import { CSS, TINTS } from "./lib/styles.js";
import { icon, weatherIcon } from "./lib/icons.js";
import { RoomView } from "./lib/room.js";
import { EnergyView } from "./lib/energy.js";
import { VacuumView } from "./lib/vacuum.js";
import { ClimateView, LightView, CameraView, ScenesView } from "./lib/panels.js";
import {
  buildModel,
  roomEntities,
  roomSummary,
  totals,
  fmtNum,
  conditionText,
  wasteItems,
  departures,
  departuresMulti,
  hasDepartures,
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

const LINE_COLORS = { SUBWAY: "#6f9ff0", TRAM: "#f2a65a", BUS: "#e0786a", REGIONAL_RAIL: "#9fd38a", SUBURBAN: "#5ec8a8", RAIL: "#c9b6f2" };

function lineColor(transport) {
  const t = String(transport || "").toUpperCase();
  for (const k in LINE_COLORS) if (t.indexOf(k) >= 0) return LINE_COLORS[k];
  return "#f2a65a";
}

/** Schwarz oder Weiß, je nachdem was auf der Hintergrundfarbe besser lesbar ist. */
function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#141012";
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? "#141012" : "#ffffff";
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
    const open = this._roomView && this._roomView.room;
    if (open) {
      if (this._model.rooms[open.id]) this._roomView.refresh(this._model.rooms[open.id]);
      else this._roomView.close();
    }
    const cv = this._views && this._views[this._view];
    if (cv) cv.show();
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
    const open = this._roomView && this._roomView.room;
    if (open && dirty[open.id]) this._roomView.refresh(this._model.rooms[open.id]);
    if (any) this._renderChips();

    const side = [this._weatherEntity(), this._settings.outdoor_temp_entity].concat(this._depSource().ids);
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
    this._viewChanged(states);
  }

  _tick() {
    const el = this._q(".clock");
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    this._q(".date").textContent = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
    // Abfahrten zählen Minuten herunter, auch ohne neuen Zustand.
    if (this._depSource().ids.length) this._renderSide();
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
    const tint = TINTS[this._settings.tint] || TINTS.plum;
    this._q(".glow").style.background = "radial-gradient(closest-side, " + tint + " 0%, " + tint + " 96%, rgba(0,0,0,0) 100%)";
  }

  // ---------- Darstellung ----------

  _renderShell() {
    this.shadowRoot.innerHTML =
      "<style>" +
      CSS +
      "</style>" +
      '<div class="root" lang="de">' +
      '<div class="glow" aria-hidden="true"></div>' +
      '<header><div><div class="lbl date"></div><div class="clock"></div></div>' +
      '<div class="weather"></div><div class="chips"></div></header>' +
      '<div class="body"><aside class="side" aria-label="Erinnerungen und Abfahrten"></aside><main class="rooms"></main></div>' +
      '<section class="view" aria-live="polite"></section>' +
      '<nav class="dock" aria-label="Bereiche">' +
      this._dockBtn("home", "Übersicht", "home", true) +
      this._dockBtn("thermo", "Klima", "climate") +
      this._dockBtn("bulb", "Licht", "light") +
      this._dockBtn("bolt", "Energie", "energy") +
      this._dockBtn("vacuum", "Sauger", "vacuum") +
      "</nav>" +
      '<button class="gear" aria-label="Einstellungen, gedrückt halten">' +
      '<svg class="ring" viewBox="0 0 58 58" aria-hidden="true"><circle cx="29" cy="29" r="27"></circle></svg>' +
      icon("gear", "gic") +
      "</button>" +
      '<section class="roomsheet"></section>' +
      '<div class="toast" role="status"></div>' +
      '<section class="settings" aria-label="Einstellungen"></section>' +
      "</div>";
    this._tick();

    const sr = this.shadowRoot;
    sr.querySelector(".rooms").addEventListener("click", (e) => {
      const t = e.target.closest ? e.target.closest(".tile") : null;
      if (t && this._model && this._model.rooms[t.getAttribute("data-room")]) this._roomView.open(this._model.rooms[t.getAttribute("data-room")]);
    });
    sr.querySelector("nav.dock").addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest(".dockbtn") : null;
      if (!b || b.classList.contains("act")) return;
      const view = b.getAttribute("data-view");
      if (view) this._showView(view);
      else this._toast(SOON);
    });
    sr.querySelector(".chips").addEventListener("click", (e) => {
      const c = e.target.closest ? e.target.closest("[data-chip]") : null;
      if (c && c.getAttribute("data-chip") === "scenes") this._showView("scenes");
    });
    this._bindGear(sr.querySelector(".gear"));
    this._roomView = new RoomView({
      el: sr.querySelector(".roomsheet"),
      hass: () => this._hass,
      toast: (text) => this._toast(text),
      showGraph: () => this._settings.show_graph !== false,
      floorName: (id) => {
        const f = (this._reg && this._reg.floors ? this._reg.floors : []).filter((x) => x.floor_id === id)[0];
        return f ? f.name : "";
      }
    });
    const viewEl = sr.querySelector(".view");
    const panelHost = {
      el: viewEl,
      hass: () => this._hass,
      model: () => this._model,
      settings: () => this._settings,
      toast: (text) => this._toast(text),
      openRoom: (id) => {
        if (this._model && this._model.rooms[id]) this._roomView.open(this._model.rooms[id]);
      }
    };
    this._views = {
      energy: new EnergyView({
        el: viewEl,
        hass: () => this._hass,
        settings: () => this._settings,
        forecast: () => this._forecast,
        toast: (text) => this._toast(text)
      }),
      climate: new ClimateView(panelHost),
      light: new LightView(panelHost),
      camera: new CameraView(panelHost),
      scenes: new ScenesView(panelHost),
      vacuum: new VacuumView({
        el: viewEl,
        hass: () => this._hass,
        settings: () => this._settings,
        reg: () => this._reg || {},
        areas: () => ((this._reg && this._reg.areas) || []).slice().sort((a, b) => a.name.localeCompare(b.name, "de")),
        toast: (text) => this._toast(text)
      })
    };
    this._view = "home";
  }

  _dockBtn(ic, label, view, active) {
    return (
      '<button class="dockbtn' + (active ? " act" : "") + '"' + (view ? ' data-view="' + view + '"' : "") + (active ? ' aria-current="page"' : "") + ">" + icon(ic) + esc(label) + "</button>"
    );
  }

  _showView(view) {
    const old = this._views[this._view];
    if (old) old.hide();
    this._view = view;
    const root = this._q(".root");
    root.classList.toggle("inview", view !== "home");
    Array.prototype.forEach.call(this.shadowRoot.querySelectorAll(".dockbtn"), (b) => {
      const on = (b.getAttribute("data-view") || "") === view;
      b.classList.toggle("act", on);
      if (on) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (this._roomView && this._roomView.isOpen()) this._roomView.close();
    const v = this._views[view];
    this._q(".view").scrollTop = 0;
    if (v && this._hass && this._reg) v.show();
  }

  _viewChanged(states) {
    const v = this._views && this._views[this._view];
    if (!v) return;
    const ids = v.watched ? v.watched() : [];
    let changed = false;
    ids.forEach((id) => {
      if (states[id] !== this._last["view:" + id]) {
        this._last["view:" + id] = states[id];
        changed = true;
      }
    });
    if (changed) v.render();
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
    // Ist/Soll: Zahlen orange, wenn geheizt wird (nur bei Räumen mit Thermostat).
    let temp = "";
    if (s.temp != null) {
      temp = fmtNum(s.temp, 1) + "°";
      if (room.climates.length) {
        temp =
          '<span class="ttemp' + (s.heating ? " on" : "") + '" aria-label="' + (s.heating ? "heizt" : "heizt nicht") + '">' +
          temp + (s.target != null ? '<span class="tgt">/' + fmtNum(s.target, s.target % 1 ? 1 : 0) + "°</span>" : "") +
          "</span>";
      }
    }
    const sub = [temp];
    if (s.hum != null) sub.push(Math.round(s.hum) + " %");
    const pills = [];
    if (s.lightsOn) pills.push('<span class="pill light">' + icon("bulb") + s.lightsOn + "/" + s.lightsTotal + "</span>");
    if (s.cover) pills.push('<span class="pill">' + icon("shade") + esc(s.cover) + "</span>");
    if (s.windowsOpen) pills.push('<span class="pill alert">' + icon("window") + (s.windowsOpen > 1 ? s.windowsOpen + " Fenster" : "Fenster") + "</span>");
    if (s.presence) pills.push('<span class="pill">' + icon("person") + esc(s.presence) + "</span>");
    if (s.cameras && pills.length < 3) pills.push('<span class="pill">' + icon("camera") + "Kamera</span>");
    pills.length = Math.min(pills.length, 3);
    el.classList.toggle("on", s.lightsOn > 0);
    el.setAttribute("aria-label", room.name + " öffnen");
    el.innerHTML =
      '<div><div class="tname">' + esc(room.name) + '</div><div class="tsub">' + sub.filter(Boolean).join('<span class="dot">·</span>') + "</div></div>" +
      '<div class="pills">' + pills.join("") + "</div>";
  }

  _renderChips() {
    const rooms = this._model.rooms;
    const t = totals(Object.keys(rooms).map((rid) => roomSummary(rooms[rid], this._hass.states, Date.now())));
    this._q(".chips").innerHTML =
      '<span class="chip">' + icon("bulb").replace('class="ic"', 'class="ic" style="color:#f2a65a"') + "Licht <small>" + t.lights + " an</small></span>" +
      '<span class="chip">' + icon("flame").replace('class="ic"', 'class="ic" style="color:#ff8f5c"') + "Heizung <small>" + t.heating + " aktiv</small></span>" +
      '<button class="chip" data-chip="scenes">' + icon("play").replace('class="ic"', 'class="ic" style="color:#c9a6ff"') + "Szenen</button>" +
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
        '<div class="waste">' +
        (items.length
          ? items
              .map(
                (i) =>
                  '<div class="rem' + (i.soon ? " soon" : "") + '"><span class="badge">' + icon(i.icon) + '</span><span class="t">' + esc(i.title) + '</span><span class="s">' + esc(i.when) + "</span></div>"
              )
              .join("")
          : '<div class="empty">Keine Abholung in den nächsten zwei Wochen</div>') +
        "</div>";
    }
    const src = this._depSource();
    if (src.ids.length) {
      const now = Date.now();
      const list = departuresMulti(src.ids.map((id) => this._hass.states[id]), now, st.departures_count || 3);
      const name = src.name;
      if (html) html += '<div class="sep"></div>';
      html +=
        '<div class="deps"><div class="stop">' + icon("bus") + esc(name) + "</div>" +
        (list.length
          ? list
              .map(
                (d) =>
                  '<div class="dep' + (d.cancelled ? " gone" : "") + '"><span class="line" style="' + this._lineStyle(d) + '">' + esc(d.line) + '</span><span class="to">' + esc(d.to) + '</span><span class="min' + (d.delay > 0 ? " late" : "") + '">' +
                  (d.cancelled
                    ? "fällt aus"
                    : d.minutes == null
                    ? ""
                    : d.minutes < 1
                    ? "jetzt"
                    : d.minutes > 59
                    ? new Date(d.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
                    : d.minutes + " Min.") +
                  (d.delay > 0 && !d.cancelled ? " <small>+" + d.delay + "</small>" : "") +
                  "</span></div>"
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
      ["energy", "Energie & Sauger"],
      ["look", "Darstellung"]
    ];
    let page = "";
    if (this._tab === "side") {
      page =
        '<div class="group">' +
        this._entRow("weather_entity", "Wetter", "Kopfzeile; ohne Auswahl die erste Wetter-Entität", (id) => domainOf(id) === "weather") +
        this._entRow("outdoor_temp_entity", "Außentemperatur", "Ersetzt die Temperatur des Wetterdienstes", (id, s) => domainOf(id) === "sensor" && (s.attributes.device_class === "temperature" || s.attributes.unit_of_measurement === "°C")) +
        this._entRow("waste_calendar", "Müllkalender", "Termine der nächsten zwei Wochen", (id) => domainOf(id) === "calendar") +
        this._depRow() +
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
    } else if (this._tab === "energy") {
      const isTotal = (s) => s.attributes.state_class === "total_increasing" || s.attributes.state_class === "total";
      const map = d.vacuum_rooms || {};
      const robot = this._robotRooms;
      page =
        '<div class="group">' +
        this._entRow("gas_entity", "Gaszähler", "Zählerstand (kWh oder m³) mit Langzeitstatistik", (id, s) => domainOf(id) === "sensor" && isTotal(s) && (s.attributes.device_class === "gas" || s.attributes.device_class === "energy")) +
        this._entRow("electricity_entity", "Stromzähler", "Zählerstand in kWh", (id, s) => domainOf(id) === "sensor" && isTotal(s) && s.attributes.device_class === "energy") +
        this._entRow("power_entity", "Aktuelle Leistung", "Strom jetzt in W", (id, s) => domainOf(id) === "sensor" && s.attributes.device_class === "power") +
        this._entRow("energy_temp_entity", "Außentemperatur für Energie", "Mit Langzeitstatistik. Leer = wie Kopfzeile", (id, s) => domainOf(id) === "sensor" && (s.attributes.device_class === "temperature" || s.attributes.unit_of_measurement === "°C")) +
        '<div class="row"><div><div class="t">Heizgrenze</div><div class="d">Ab dieser Außentemperatur wird nicht mehr geheizt (Basis der Heizgradtage). Auto: aus dem Verlauf gelernt</div></div><div class="seg" data-seg="hdd_base">' +
        [0, 12, 15, 18].map((n) => '<button data-val="' + n + '" class="' + ((d.hdd_base || 0) === n ? "on" : "") + '">' + (n ? n + "°" : "Auto") + "</button>").join("") +
        "</div></div></div>" +
        '<div class="group">' +
        this._entRow("vacuum_entity", "Saugroboter", "Roborock oder anderer Saugroboter", (id) => domainOf(id) === "vacuum") +
        '<div class="row"><div><div class="t">Räume zuordnen</div><div class="d">Lädt die Räume aus der Roborock-Karte. Danach jedem Bereich seinen Roborock-Raum zuweisen.</div></div>' +
        '<button class="scene" style="margin-left:auto" data-loadrooms="1">' + (robot ? "Neu laden" : "Räume laden") + "</button></div>" +
        (robot === false ? '<div class="row"><div class="d">Räume konnten nicht geladen werden. Ist die Roborock-Integration eingerichtet und der Sauger ausgewählt?</div></div>' : "") +
        (robot
          ? (this._reg.areas || [])
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, "de"))
              .map(
                (a) =>
                  '<div class="row"><div class="t">' + esc(a.name) + '</div><select class="ent" data-room-map="' + esc(a.area_id) + '"><option value="">– nicht zugeordnet –</option>' +
                  robot.map((r) => '<option value="' + esc(r.id) + '"' + (String(map[a.area_id]) === String(r.id) ? " selected" : "") + ">" + esc(r.name) + " (" + esc(r.id) + ")</option>").join("") +
                  "</select></div>"
              )
              .join("")
          : Object.keys(map).length
          ? '<div class="row"><div class="d">' + Object.keys(map).length + " Bereiche zugeordnet</div></div>"
          : "") +
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
        "</div></div>" +
        '<div class="row"><div class="t">Temperaturverlauf in der Heizungskarte</div><button class="sw' + (d.show_graph !== false ? " on" : "") + '" role="switch" aria-checked="' + (d.show_graph !== false) + '" aria-label="Temperaturverlauf anzeigen" data-flag="show_graph"></button></div>' +
        "</div>";
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
    el.querySelectorAll("input[data-linecolor]").forEach((i) => (i.onchange = () => {
      d.line_colors = d.line_colors || {};
      d.line_colors[i.getAttribute("data-linecolor")] = i.value;
    }));
    el.querySelectorAll("select[data-key]").forEach((sel) => {
      if (sel.getAttribute("data-key") === "departures_source")
        sel.addEventListener("change", () => this._renderSettings());
    });
    el.querySelectorAll("select[data-room-map]").forEach((s) => (s.onchange = () => {
      const m = (d.vacuum_rooms = d.vacuum_rooms || {});
      if (s.value) m[s.getAttribute("data-room-map")] = s.value;
      else delete m[s.getAttribute("data-room-map")];
    }));
    el.querySelectorAll("[data-loadrooms]").forEach((b) => (b.onclick = async () => {
      if (!d.vacuum_entity) {
        this._toast("Erst den Saugroboter auswählen");
        return;
      }
      b.textContent = "Lädt …";
      const rooms = await this._views.vacuum.loadRobotRooms(d.vacuum_entity);
      this._robotRooms = rooms && rooms.length ? rooms : false;
      this._renderSettings();
    }));
    el.querySelectorAll(".sw[data-flag]").forEach((b) => (b.onclick = () => {
      const k = b.getAttribute("data-flag");
      d[k] = d[k] === false;
      this._renderSettings();
    }));
    el.querySelectorAll(".sw[data-room]").forEach((b) => (b.onclick = () => {
      const id = b.getAttribute("data-room");
      const list = (d.hidden_rooms = d.hidden_rooms || []);
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else list.push(id);
      this._renderSettings();
    }));
  }

  /** Quelle der Abfahrten: ganze Haltestelle (Gerät) oder einzelner Sensor. */
  _depSource() {
    const st = this._settings || {};
    const src = st.departures_source || (st.departures_entity ? "entity:" + st.departures_entity : "");
    if (!src || !this._hass) return { ids: [], name: "" };
    if (src.indexOf("device:") === 0) {
      const dev = src.slice(7);
      const d = ((this._reg && this._reg.devices) || []).filter((x) => x.id === dev)[0];
      const ids = ((this._reg && this._reg.entities) || [])
        .filter((e) => e.device_id === dev && !e.disabled_by && hasDepartures(this._hass.states[e.entity_id]))
        .map((e) => e.entity_id);
      return { ids: ids, name: d ? d.name_by_user || d.name : "Haltestelle" };
    }
    const id = src.slice(7);
    const so = this._hass.states[id];
    return { ids: [id], name: so ? so.attributes.friendly_name || id : id };
  }

  /** Linienfarbe: eigene Farbe aus den Einstellungen, sonst nach Verkehrsmittel; Schrift hell oder dunkel nach Kontrast. */
  _lineStyle(d) {
    const own = (this._settings.line_colors || {})[d.line];
    const bg = own || lineColor(d.transport);
    return "background:" + bg + ";color:" + textOn(bg);
  }

  _depRow() {
    const d = this._draft;
    const cur = d.departures_source || (d.departures_entity ? "entity:" + d.departures_entity : "");
    const states = this._hass.states;
    const reg = this._reg || {};
    const devs = {};
    (reg.entities || []).forEach((e) => {
      if (e.device_id && hasDepartures(states[e.entity_id])) devs[e.device_id] = (devs[e.device_id] || 0) + 1;
    });
    const devOpts = (reg.devices || [])
      .filter((x) => devs[x.id])
      .map((x) => '<option value="device:' + esc(x.id) + '"' + (cur === "device:" + x.id ? " selected" : "") + ">" + esc(x.name_by_user || x.name) + " (" + devs[x.id] + " Linien)</option>")
      .join("");
    const entOpts = Object.keys(states)
      .filter((id) => domainOf(id) === "sensor" && hasDepartures(states[id]))
      .sort()
      .map((id) => '<option value="entity:' + esc(id) + '"' + (cur === "entity:" + id ? " selected" : "") + ">" + esc(states[id].attributes.friendly_name || id) + "</option>")
      .join("");
    return (
      '<div class="row"><div><div class="t">Abfahrten</div><div class="d">Ganze Haltestelle (alle Linien) oder einzelne Linie</div></div>' +
      '<select class="ent" data-key="departures_source" aria-label="Abfahrten"><option value="">– keine –</option>' +
      (devOpts ? '<optgroup label="Haltestellen">' + devOpts + "</optgroup>" : "") +
      (entOpts ? '<optgroup label="Einzelne Linien">' + entOpts + "</optgroup>" : "") +
      "</select></div>" +
      this._lineColorRows()
    );
  }

  _lineColorRows() {
    const d = this._draft;
    const saved = this._settings;
    this._settings = d;
    const src = this._depSource();
    this._settings = saved;
    const lines = [];
    src.ids.forEach((id) => {
      const so = this._hass.states[id];
      const n = so && so.attributes.line_name;
      if (n && lines.indexOf(n) < 0) lines.push(n);
    });
    if (!lines.length) return "";
    const colors = d.line_colors || {};
    return (
      '<div class="row"><div><div class="t">Linienfarben</div><div class="d">Farbe je Linie für die Abfahrten</div></div><div class="lcolors">' +
      lines
        .sort((a, b) => a.localeCompare(b, "de", { numeric: true }))
        .map((n) => '<label class="lcol"><span>' + esc(n) + '</span><input type="color" value="' + esc(colors[n] || "#f2a65a") + '" data-linecolor="' + esc(n) + '"></label>')
        .join("") +
      "</div></div>"
    );
  }

  _entRow(key, title, desc, filter) {
    return (
      '<div class="row"><div><div class="t">' + esc(title) + '</div><div class="d">' + esc(desc) + "</div></div>" +
      '<select class="ent" data-key="' + key + '" aria-label="' + esc(title) + '">' + this._entityOptions(filter, this._draft[key]) + "</select></div>"
    );
  }
}

if (!customElements.get("notanotherdash-panel")) customElements.define("notanotherdash-panel", NotAnotherDashPanel);
