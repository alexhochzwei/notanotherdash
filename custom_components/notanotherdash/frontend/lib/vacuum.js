// Sauger-Panel für den Roborock (offizielle HA-Integration).
// Räume: HA-Bereiche, denen in den Einstellungen eine Roborock-Raum-ID zugeordnet ist.
// Raumreinigung: vacuum.send_command mit app_segment_clean (Format aus der Roborock-Doku von HA).
// Weitere Bedienelemente kommen aus dem Gerät selbst: Select-Entitäten (z. B. Wischintensität)
// und Dauer-Sensoren (Restlaufzeit von Filter, Bürsten usw.).

import { icon } from "./icons.js";
import { fmtNum, shortName } from "./model.js";

const STATES = {
  docked: "Angedockt",
  cleaning: "Reinigt",
  returning: "Fährt zur Station",
  paused: "Pausiert",
  idle: "Bereit",
  error: "Fehler",
  unavailable: "Nicht erreichbar"
};

const FAN = { off: "Aus", quiet: "Leise", balanced: "Normal", turbo: "Turbo", max: "Max", max_plus: "Max+", custom: "Eigene", gentle: "Sanft", silent: "Leise", standard: "Normal", strong: "Stark" };

const OPTION = {
  off: "Aus", low: "Wenig", mild: "Wenig", medium: "Mittel", moderate: "Mittel", high: "Viel", intense: "Viel", extreme: "Maximal",
  standard: "Standard", deep: "Gründlich", deep_plus: "Gründlich+", fast: "Schnell", custom: "Eigene", custom_water_flow: "Eigene", smart_mode: "Smart"
};

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function label(map, v) {
  return map[v] || String(v).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Sucht in der Antwort von roborock.get_maps alle Räume ({ "16": "Wohnzimmer" }). */
export function parseRooms(resp) {
  const out = {};
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.rooms && typeof o.rooms === "object" && !Array.isArray(o.rooms)) {
      Object.keys(o.rooms).forEach((k) => {
        const v = o.rooms[k];
        out[k] = typeof v === "string" ? v : (v && v.name) || k;
      });
    }
    Object.keys(o).forEach((k) => walk(o[k]));
  };
  walk(resp);
  return Object.keys(out).map((id) => ({ id: id, name: out[id] }));
}

/** Restlaufzeit in Stunden aus einem Dauer-Sensor. */
export function hoursLeft(s) {
  const v = parseFloat(s && s.state);
  if (!isFinite(v)) return null;
  const u = (s.attributes && s.attributes.unit_of_measurement) || "s";
  if (u === "h") return v;
  if (u === "min") return v / 60;
  if (u === "d") return v * 24;
  return v / 3600;
}

export class VacuumView {
  constructor(host) {
    // host: { el, hass(), settings(), reg(), areas(), toast() }
    this.host = host;
    this.selected = {};
  }

  get hass() {
    return this.host.hass();
  }

  show() {
    this.render();
  }

  hide() {}

  /** Nur neu zeichnen, wenn sich Entitäten des Saugers geändert haben. */
  watched() {
    const id = this.host.settings().vacuum_entity;
    return id ? [id].concat(this.siblings(id).map((e) => e.entity_id)) : [];
  }

  siblings(id) {
    const reg = this.host.reg();
    const ent = (reg.entities || []).filter((e) => e.entity_id === id)[0];
    if (!ent || !ent.device_id) return [];
    return (reg.entities || []).filter((e) => e.device_id === ent.device_id && e.entity_id !== id && !e.disabled_by && !e.hidden_by);
  }

  call(domain, service, data) {
    return this.hass.callService(domain, service, data).catch(() => this.host.toast("Befehl fehlgeschlagen"));
  }

  render() {
    const st = this.host.settings();
    const el = this.host.el;
    const id = st.vacuum_entity;
    const v = id ? this.hass.states[id] : null;
    if (!v) {
      el.innerHTML = '<div class="ehint">Wähle in den Einstellungen unter „Energie &amp; Sauger“ deinen Saugroboter und ordne seine Räume deinen Bereichen zu. Das Zahnrad unten rechts gedrückt halten.</div>';
      return;
    }
    const a = v.attributes || {};
    const states = this.hass.states;
    const sib = this.siblings(id)
      .map((e) => (states[e.entity_id] ? Object.assign({ id: e.entity_id, key: e.translation_key || "" }, states[e.entity_id]) : null))
      .filter(Boolean);
    const battery = a.battery_level != null ? a.battery_level : (sib.filter((s) => s.attributes.device_class === "battery")[0] || {}).state;
    const map = st.vacuum_rooms || {};
    const areas = this.host.areas().filter((ar) => map[ar.area_id] != null && map[ar.area_id] !== "");
    const sel = areas.filter((ar) => this.selected[ar.area_id]);
    const cleaning = v.state === "cleaning";
    const paused = v.state === "paused";

    const rooms = areas.length
      ? areas
          .map(
            (ar) =>
              '<button class="vroom' + (this.selected[ar.area_id] ? " sel" : "") + '" data-area="' + esc(ar.area_id) + '">' +
              (this.selected[ar.area_id] ? '<span class="chk">' + icon("check") + "</span>" : "") +
              '<span class="n">' + esc(ar.name) + "</span></button>"
          )
          .join("")
      : '<div class="ehint small">Noch keine Räume zugeordnet. In den Einstellungen unter „Energie &amp; Sauger“ lädst du die Räume des Roborock und ordnest sie deinen Bereichen zu.</div>';

    const fans = (a.fan_speed_list || [])
      .map((f) => '<button class="opt' + (a.fan_speed === f ? " on" : "") + '" data-fan="' + esc(f) + '">' + esc(label(FAN, f)) + "</button>")
      .join("");

    const selects = sib
      .filter((s) => s.id.indexOf("select.") === 0 && Array.isArray(s.attributes.options) && s.attributes.options.length && s.attributes.options.length <= 6)
      .map(
        (s) =>
          '<div class="vseg"><div class="vsl">' + esc(shortName(s.attributes.friendly_name || s.id, a.friendly_name || "")) + "</div><div class=\"vopts\">" +
          s.attributes.options
            .map((o) => '<button class="opt' + (s.state === o ? " on" : "") + '" data-select="' + esc(s.id) + '" data-option="' + esc(o) + '">' + esc(label(OPTION, o)) + "</button>")
            .join("") +
          "</div></div>"
      )
      .join("");

    const maint = sib
      // Restlaufzeiten erkennt die Roborock-Integration am Übersetzungsschlüssel (…_time_left).
      .filter((s) => s.id.indexOf("sensor.") === 0 && /_time_left$/.test(s.key))
      .map((s) => {
        const h = hoursLeft(s);
        return (
          '<div class="mrow"><span>' + esc(shortName(s.attributes.friendly_name || s.id, a.friendly_name || "")) + '</span><span class="' + (h != null && h < 10 ? "low" : "") + '">' +
          (h == null ? "–" : h >= 48 ? fmtNum(h / 24, 0) + " Tage" : fmtNum(h, 0) + " Std.") + "</span></div>"
        );
      })
      .join("");

    const startTxt = paused ? "Fortsetzen" : cleaning ? "Läuft …" : sel.length ? "Auswahl reinigen" : "Alles reinigen";
    el.innerHTML =
      '<div class="vgrid">' +
      '<section class="card vmap"><div class="ctitle">' + (sel.length ? sel.length + (sel.length === 1 ? " Raum" : " Räume") + " ausgewählt" : "Räume antippen zum Auswählen") + "</div>" +
      '<div class="vrooms">' + rooms + "</div></section>" +
      '<div class="vside">' +
      '<section class="card vstatus"><div class="vhead"><span class="vic">' + icon("vacuum") + '</span><div><div class="vst">' + esc(STATES[v.state] || v.state) + "</div>" +
      '<div class="cap">' + esc(a.friendly_name || id) + (battery != null ? " · Akku " + Math.round(battery) + " %" : "") + "</div></div></div>" +
      (battery != null ? '<div class="vbar"><i style="width:' + Math.max(0, Math.min(100, battery)) + '%"></i></div>' : "") +
      '<div class="vacts"><button class="vact pri" data-start="1"' + (cleaning ? " disabled" : "") + ">" + icon("play") + esc(startTxt) + "</button>" +
      '<button class="vact" data-pause="1" aria-label="Pause">' + icon("pause") + "</button>" +
      '<button class="vact" data-home="1" aria-label="Zur Station">' + icon("home") + "</button></div></section>" +
      (fans || selects
        ? '<section class="card vset">' + (fans ? '<div class="vseg"><div class="vsl">Saugkraft</div><div class="vopts">' + fans + "</div></div>" : "") + selects + "</section>"
        : "") +
      (maint ? '<section class="card vmaint">' + maint + "</section>" : "") +
      "</div></div>";
    this.bind(id, areas, paused);
  }

  bind(id, areas, paused) {
    const el = this.host.el;
    const q = (s) => Array.prototype.slice.call(el.querySelectorAll(s));
    const map = this.host.settings().vacuum_rooms || {};
    q("[data-area]").forEach((b) => (b.onclick = () => {
      const k = b.getAttribute("data-area");
      this.selected[k] = !this.selected[k];
      this.render();
    }));
    q("[data-fan]").forEach((b) => (b.onclick = () => this.call("vacuum", "set_fan_speed", { entity_id: id, fan_speed: b.getAttribute("data-fan") })));
    q("[data-select]").forEach((b) => (b.onclick = () => this.call("select", "select_option", { entity_id: b.getAttribute("data-select"), option: b.getAttribute("data-option") })));
    q("[data-pause]").forEach((b) => (b.onclick = () => this.call("vacuum", "pause", { entity_id: id })));
    q("[data-home]").forEach((b) => (b.onclick = () => this.call("vacuum", "return_to_base", { entity_id: id })));
    q("[data-start]").forEach((b) => (b.onclick = () => {
      const segs = areas.filter((ar) => this.selected[ar.area_id]).map((ar) => parseInt(map[ar.area_id], 10)).filter((n) => isFinite(n));
      if (paused || !segs.length) {
        this.call("vacuum", "start", { entity_id: id });
        this.host.toast(paused ? "Reinigung fortgesetzt" : "Reinigung gestartet");
      } else {
        this.call("vacuum", "send_command", { entity_id: id, command: "app_segment_clean", params: [{ segments: segs, repeat: 1 }] });
        this.host.toast(segs.length + (segs.length === 1 ? " Raum" : " Räume") + " werden gereinigt");
        this.selected = {};
      }
    }));
  }

  /** Räume des Roborock über roborock.get_maps laden (für die Zuordnung in den Einstellungen). */
  async loadRobotRooms(id) {
    try {
      const res = await this.hass.callService("roborock", "get_maps", {}, { entity_id: id }, false, true);
      return parseRooms(res && res.response ? res.response : res);
    } catch (e) {
      return null;
    }
  }
}
