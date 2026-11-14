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


/** Affine Abbildung Roborock-Koordinaten → Bildpixel aus drei Kalibrierungspunkten (Map-Card-Format). */
export function calibrate(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const p = points.slice(0, 3).map((c) => [c.vacuum.x, c.vacuum.y, c.map.x, c.map.y]);
  const det = p[0][0] * (p[1][1] - p[2][1]) - p[0][1] * (p[1][0] - p[2][0]) + (p[1][0] * p[2][1] - p[2][0] * p[1][1]);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (k) => {
    const v0 = p[0][k], v1 = p[1][k], v2 = p[2][k];
    const a = (v0 * (p[1][1] - p[2][1]) - p[0][1] * (v1 - v2) + (v1 * p[2][1] - v2 * p[1][1])) / det;
    const b = (p[0][0] * (v1 - v2) - v0 * (p[1][0] - p[2][0]) + (p[1][0] * v2 - p[2][0] * v1)) / det;
    const c = (p[0][0] * (p[1][1] * v2 - p[2][1] * v1) - p[0][1] * (p[1][0] * v2 - p[2][0] * v1) + v0 * (p[1][0] * p[2][1] - p[2][0] * p[1][1])) / det;
    return [a, b, c];
  };
  const X = solve(2);
  const Y = solve(3);
  return (vx, vy) => [X[0] * vx + X[1] * vy + X[2], Y[0] * vx + Y[1] * vy + Y[2]];
}

/** Räume des Saugers: aus der Karte (falls vorhanden), Namen aus der Zuordnung zu HA-Bereichen. */
export function segmentList(mapAttrs, mapping, areas) {
  const byId = {};
  (areas || []).forEach((a) => (byId[a.area_id] = a.name));
  const nameOf = {};
  Object.keys(mapping || {}).forEach((areaId) => {
    if (mapping[areaId] != null && byId[areaId]) nameOf[String(mapping[areaId])] = byId[areaId];
  });
  const rooms = mapAttrs && mapAttrs.rooms;
  if (rooms && typeof rooms === "object") {
    return Object.keys(rooms).map((k) => {
      const r = rooms[k];
      const own = r.name && r.name !== "Unknown" ? r.name : null;
      return { id: String(r.number != null ? r.number : k), name: nameOf[String(r.number != null ? r.number : k)] || own || "Raum " + k, box: [r.x0, r.y0, r.x1, r.y1] };
    }).sort((a, b) => a.name.localeCompare(b.name, "de"));
  }
  return Object.keys(nameOf).map((id) => ({ id: id, name: nameOf[id], box: null })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export class VacuumView {
  constructor(host) {
    // host: { el, hass(), settings(), reg(), areas(), toast() }
    this.host = host;
    this.selected = {};
    this.imgSize = null;
    this.imgUrl = null;
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
    if (!id) return [];
    const m = this.mapEntity();
    return [id].concat(this.siblings(id).map((e) => e.entity_id)).concat(m ? [m] : []);
  }

  /** Karten-Entität: aus den Einstellungen, sonst die erste Bild-Entität mit Kalibrierung (RoborockCustomMap). */
  mapEntity() {
    const st = this.host.settings();
    const states = this.hass.states;
    if (st.vacuum_map_entity && states[st.vacuum_map_entity]) return st.vacuum_map_entity;
    const ids = Object.keys(states).filter((k) => k.indexOf("image.") === 0 && states[k].attributes && Array.isArray(states[k].attributes.calibration_points));
    return ids[0] || null;
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
    const mapId = this.mapEntity();
    const mapState = mapId ? states[mapId] : null;
    const segs = segmentList(mapState && mapState.attributes, st.vacuum_rooms || {}, this.host.areas());
    const sel = segs.filter((g) => this.selected[g.id]);
    const cleaning = v.state === "cleaning";
    const paused = v.state === "paused";

    let rooms;
    if (mapState && mapState.attributes.entity_picture) {
      rooms = this.mapHtml(mapState, segs);
    } else if (segs.length) {
      rooms =
        '<div class="vrooms">' +
        segs
          .map(
            (g) =>
              '<button class="vroom' + (this.selected[g.id] ? " sel" : "") + '" data-seg="' + esc(g.id) + '">' +
              (this.selected[g.id] ? '<span class="chk">' + icon("check") + "</span>" : "") +
              '<span class="n">' + esc(g.name) + "</span></button>"
          )
          .join("") +
        "</div>";
    } else {
      rooms = '<div class="ehint small">Noch keine Räume zugeordnet. In den Einstellungen unter „Energie &amp; Sauger“ lädst du die Räume des Roborock und ordnest sie deinen Bereichen zu.</div>';
    }

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
      rooms + "</section>" +
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
    this.bind(id, segs, paused);
  }

  bind(id, segs, paused) {
    const el = this.host.el;
    const q = (s) => Array.prototype.slice.call(el.querySelectorAll(s));
    q("[data-seg]").forEach((b) => (b.onclick = () => {
      const k = b.getAttribute("data-seg");
      this.selected[k] = !this.selected[k];
      this.render();
    }));
    const img = el.querySelector(".vimg");
    if (img) {
      const done = () => {
        if (!img.naturalWidth) return;
        const size = [img.naturalWidth, img.naturalHeight];
        if (!this.imgSize || this.imgSize[0] !== size[0] || this.imgSize[1] !== size[1]) {
          this.imgSize = size;
          this.render();
        }
      };
      if (img.complete) done();
      else img.addEventListener("load", done);
    }
    q("[data-fan]").forEach((b) => (b.onclick = () => this.call("vacuum", "set_fan_speed", { entity_id: id, fan_speed: b.getAttribute("data-fan") })));
    q("[data-select]").forEach((b) => (b.onclick = () => this.call("select", "select_option", { entity_id: b.getAttribute("data-select"), option: b.getAttribute("data-option") })));
    q("[data-pause]").forEach((b) => (b.onclick = () => this.call("vacuum", "pause", { entity_id: id })));
    q("[data-home]").forEach((b) => (b.onclick = () => this.call("vacuum", "return_to_base", { entity_id: id })));
    q("[data-start]").forEach((b) => (b.onclick = () => {
      const ids = segs.filter((g) => this.selected[g.id]).map((g) => parseInt(g.id, 10)).filter((n) => isFinite(n));
      if (paused || !ids.length) {
        this.call("vacuum", "start", { entity_id: id });
        this.host.toast(paused ? "Reinigung fortgesetzt" : "Reinigung gestartet");
      } else {
        this.call("vacuum", "send_command", { entity_id: id, command: "app_segment_clean", params: [{ segments: ids, repeat: 1 }] });
        this.host.toast(ids.length + (ids.length === 1 ? " Raum" : " Räume") + " werden gereinigt");
        this.selected = {};
      }
    }));
  }

  /** Karte mit antippbaren Räumen: Raumnamen sitzen auf der Mitte ihres Umrisses. */
  mapHtml(mapState, segs) {
    const url = mapState.attributes.entity_picture;
    const tf = calibrate(mapState.attributes.calibration_points);
    const size = this.imgSize;
    const boxes = segs.filter((g) => g.box);
    if (!tf || !size || !boxes.length) {
      return '<div class="vmapwrap"><div class="vmapbox"><img class="vimg" alt="Karte" src="' + esc(url) + '"></div></div>';
    }
    // Pixel-Rechtecke der Räume; der sichtbare Ausschnitt umschließt alle Räume mit etwas Rand.
    const rects = boxes.map((g) => {
      const p0 = tf(g.box[0], g.box[1]);
      const p1 = tf(g.box[2], g.box[3]);
      return { g: g, x: Math.min(p0[0], p1[0]), y: Math.min(p0[1], p1[1]), w: Math.abs(p1[0] - p0[0]), h: Math.abs(p1[1] - p0[1]) };
    });
    const pad = 40;
    const cx = Math.max(0, Math.min.apply(null, rects.map((r) => r.x)) - pad);
    const cy = Math.max(0, Math.min.apply(null, rects.map((r) => r.y)) - pad);
    const cw = Math.min(size[0], Math.max.apply(null, rects.map((r) => r.x + r.w)) + pad) - cx;
    const ch = Math.min(size[1], Math.max.apply(null, rects.map((r) => r.y + r.h)) + pad) - cy;
    const ratio = ch / cw;
    const pct = (v, total) => ((v / total) * 100).toFixed(3) + "%";
    const overlay = rects
      .map((r) => {
        const on = !!this.selected[r.g.id];
        const l = r.x - cx;
        const t = r.y - cy;
        return (
          (on ? '<span class="vsel" style="left:' + pct(l, cw) + ";top:" + pct(t, ch) + ";width:" + pct(r.w, cw) + ";height:" + pct(r.h, ch) + '"></span>' : "") +
          '<button class="vchip' + (on ? " on" : "") + '" data-seg="' + esc(r.g.id) + '" style="left:' + pct(l + r.w / 2, cw) + ";top:" + pct(t + r.h / 2, ch) + '">' +
          (on ? icon("check") : "") + esc(r.g.name) + "</button>"
        );
      })
      .join("");
    return (
      '<div class="vmapwrap"><div class="vcrop" style="width:calc(min(100%, ' + (540 / ratio).toFixed(0) + 'px))"><div style="padding-top:' + (ratio * 100).toFixed(3) + '%"></div>' +
      '<img class="vimg crop" alt="Karte" src="' + esc(url) + '" style="width:' + pct(size[0], cw) + ";left:" + pct(-cx, cw) + ";top:" + pct(-cy, ch) + '">' +
      '<div class="vov">' + overlay + "</div></div></div>"
    );
  }

  /** Räume des Roborock laden: aus der Karte (RoborockCustomMap) und über roborock.get_maps. */
  async loadRobotRooms(id) {
    const out = {};
    const m = this.mapEntity();
    const st = m ? this.hass.states[m] : null;
    const rooms = st && st.attributes.rooms;
    if (rooms) Object.keys(rooms).forEach((k) => (out[k] = rooms[k].name && rooms[k].name !== "Unknown" ? rooms[k].name : "Raum " + k));
    try {
      const res = await this.hass.callService("roborock", "get_maps", {}, { entity_id: id }, false, true);
      parseRooms(res && res.response ? res.response : res).forEach((r) => (out[r.id] = r.name));
    } catch (e) {
      // ohne get_maps bleiben die Räume aus der Karte
    }
    const list = Object.keys(out).map((k) => ({ id: k, name: out[k] }));
    return list.length ? list : null;
  }
}
