// Sauger-Panel für den Roborock (offizielle HA-Integration).
// Räume: HA-Bereiche, denen in den Einstellungen eine Roborock-Raum-ID zugeordnet ist.
// Raumreinigung: vacuum.send_command mit app_segment_clean (Format aus der Roborock-Doku von HA).
// Weitere Bedienelemente kommen aus dem Gerät selbst: Select-Entitäten (z. B. Wischintensität)
// und Dauer-Sensoren (Restlaufzeit von Filter, Bürsten usw.).

import { icon } from "./icons.js";
import { fmtNum, shortName, presenceOf } from "./model.js";

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

// Verschleißteile der Roborock-Integration (Übersetzungsschlüssel → Name).
const PARTS = {
  filter_time_left: "Filter",
  main_brush_time_left: "Hauptbürste",
  side_brush_time_left: "Seitenbürste",
  sensor_time_left: "Sensoren",
  dock_strainer_time_left: "Sieb der Station",
  dock_cleaning_brush_time_left: "Reinigungsbürste der Station"
};

// Teile, die bei Ablauf gereinigt statt getauscht werden.
const CLEAN_ONLY = { sensor_time_left: true };

// Reset-Knöpfe der Roborock-Integration je Verschleißteil (Übersetzungsschlüssel).
const RESETS = {
  filter_time_left: "reset_air_filter_consumable",
  main_brush_time_left: "reset_main_brush_consumable",
  side_brush_time_left: "reset_side_brush_consumable",
  sensor_time_left: "reset_sensor_consumable"
};

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]; // Index wie Python weekday(): 0 = Montag

function pad(n) {
  return ("0" + n).slice(-2);
}

/** Lokale Zeit als „YYYY-MM-DDTHH:MM“ (Vergleich im Planer der Integration). */
function stamp(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/** „Mo Mi Fr“, „täglich“, „Mo–Fr“, „Sa So“. */
export function daysText(days) {
  const d = (days || []).slice().sort();
  if (d.length === 7) return "täglich";
  if (d.join() === "0,1,2,3,4") return "Mo–Fr";
  if (!d.length) return "nie";
  return d.map((i) => DAYS[i]).join(" ");
}

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
    this.sheet = null; // "maint" | "plan"
    this.plan = null; // Entwurf des Reinigungsplans
    this.planState = null;
    this.editing = false;
  }

  get hass() {
    return this.host.hass();
  }

  show() {
    this.render();
    this.loadPlanState();
    clearInterval(this.planTimer);
    this.planTimer = setInterval(() => this.loadPlanState(), 60000);
  }

  hide() {
    clearInterval(this.planTimer);
    this.sheet = null;
    this.plan = null;
    this.editing = false;
    if (this.ro) this.ro.disconnect();
  }

  async loadPlanState() {
    try {
      this.planState = await this.hass.callWS({ type: "notanotherdash/schedule/state" });
    } catch (e) {
      this.planState = null;
    }
    if (!this.sheet) this.render();
  }

  /** Nur neu zeichnen, wenn sich Entitäten des Saugers geändert haben. */
  watched() {
    const id = this.host.settings().vacuum_entity;
    if (!id) return [];
    const m = this.mapEntity();
    const p = this.host.settings().presence_entity;
    return [id].concat(this.siblings(id).map((e) => e.entity_id)).concat(m ? [m] : [], p ? [p] : []);
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
    // Während im Zeitplan eine Uhrzeit eingegeben wird, nicht neu zeichnen.
    if (this.editing) return;
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

    // Restlaufzeiten erkennt die Roborock-Integration am Übersetzungsschlüssel (…_time_left).
    const parts = sib.filter((s) => s.id.indexOf("sensor.") === 0 && /_time_left$/.test(s.key));
    const due = parts.filter((s) => {
      const h = hoursLeft(s);
      return h != null && h < 10;
    }).length;

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
      '<button class="vact" data-home="1" aria-label="Zur Station">' + icon("home") + "</button>" +
      (parts.length ? '<button class="vact" data-sheet="maint" aria-label="Wartung">' + icon("wrench") + (due ? '<i class="vdot"></i>' : "") + "</button>" : "") +
      "</div></section>" +
      (fans || selects
        ? '<section class="card vset">' + (fans ? '<div class="vseg"><div class="vsl">Saugkraft</div><div class="vopts">' + fans + "</div></div>" : "") + selects + "</section>"
        : "") +
      this.planCard(segs) +
      "</div></div>" +
      (this.sheet === "maint" ? this.maintSheet(parts, a.friendly_name || "") : "") +
      (this.sheet === "plan" ? this.planSheet(segs) : "");
    this.bind(id, segs, paused);
    this.fitMap();
  }

  // ---------- Wartung ----------

  /** Reset-Knopf zum Sensor (gleiches Gerät, auch wenn in HA deaktiviert). */
  resetButton(sensorId, key) {
    const want = RESETS[key];
    if (!want) return null;
    const reg = this.host.reg();
    const ent = (reg.entities || []).filter((e) => e.entity_id === sensorId)[0];
    if (!ent || !ent.device_id) return null;
    const b = (reg.entities || []).filter((e) => e.device_id === ent.device_id && e.translation_key === want)[0];
    return b ? { id: b.entity_id, disabled: !!b.disabled_by || !this.hass.states[b.entity_id] } : null;
  }

  maintSheet(parts, robotName) {
    let hint = false;
    const rows = parts
      .map((s) => {
        const h = hoursLeft(s);
        const txt = h == null ? "–" : h <= 0 ? (CLEAN_ONLY[s.key] ? "jetzt reinigen" : "jetzt tauschen") : h >= 48 ? fmtNum(h / 24, 0) + " Tage" : fmtNum(h, 0) + " Std.";
        const b = this.resetButton(s.id, s.key);
        if (b && b.disabled) hint = true;
        const ask = b && this.confirmReset === b.id;
        return (
          '<div class="row"><div class="t">' + esc(PARTS[s.key] || shortName(s.attributes.friendly_name || s.id, robotName)) + '</div><span class="mval' + (h != null && h < 10 ? " low" : "") + '">' + txt + "</span>" +
          (b && !b.disabled ? '<button class="scene sm' + (ask ? " warn" : "") + '" data-reset="' + esc(b.id) + '">' + (ask ? "Wirklich zurücksetzen?" : "Zurücksetzen") + "</button>" : "") +
          "</div>"
        );
      })
      .join("");
    return this.sheetShell(
      "Wartung",
      '<div class="group">' + rows + '</div><div class="note">Restlaufzeit der Verschleißteile. Nach dem Tausch zurücksetzen; zur Sicherheit zweimal tippen.' +
        (hint ? " Einige Reset-Knöpfe sind in Home Assistant deaktiviert; unter Geräte → Saugroboter aktivieren." : "") + "</div>"
    );
  }

  sheetShell(title, body, foot) {
    return (
      '<div class="edetail"><div class="sheet edsheet">' +
      '<div class="chead"><div class="ptitle">' + esc(title) + '</div>' + (foot || "") + '<button class="round"' + (foot ? ' style="margin-left:12px"' : "") + ' data-closesheet="1" aria-label="Schließen">' + icon("close") + "</button></div>" +
      '<div class="edbody">' + body + "</div></div></div>"
    );
  }

  // ---------- Reinigungsplan ----------
  // Ausgeführt wird der Plan von der Integration (schedule.py), nicht vom Dashboard.

  planCard(segs) {
    const st = this.host.settings();
    const plan = st.vacuum_schedule || [];
    const ps = this.planState || {};
    const runs = ps.runs || {};
    const waiting = ps.waiting || [];
    const home = st.presence_entity ? presenceOf(this.hass.states[st.presence_entity]) : null;
    const names = {};
    segs.forEach((g) => (names[g.id] = g.name));
    const rows = plan
      .map((e) => {
        const run = runs[e.id];
        const stat =
          e.enabled === false ? "aus" :
          run && run.status === "done" ? "heute " + esc(String(run.at || "").slice(11, 16)) + " ✓" :
          waiting.indexOf(e.id) >= 0 ? '<span class="low">' + (home !== false && st.presence_entity ? "wartet bis du weg bist" : "startet gleich") + "</span>" : "";
        const rooms = (e.segments || []).length ? e.segments.map((id) => names[id] || id).join(", ") : "alle Räume";
        return (
          '<div class="prow' + (e.enabled === false ? " off" : "") + '"><b>' + esc(e.time || "–") + "</b><div><div>" + esc(daysText(e.days)) + " · " + esc(rooms) + "</div>" +
          (stat ? '<div class="cap">' + stat + "</div>" : "") + "</div></div>"
        );
      })
      .join("");
    return (
      '<section class="card vplan"><div class="chead"><div class="ctitle">Zeitplan</div><button class="scene sm" style="margin-left:auto" data-sheet="plan">' + (plan.length ? "Bearbeiten" : "Anlegen") + "</button></div>" +
      (rows || '<div class="cap">Kein Zeitplan</div>') +
      (plan.length && st.presence_entity ? '<div class="cap">Bei Anwesenheit wird bis zur nächsten Abwesenheit gewartet, längstens bis Mitternacht.</div>' : "") +
      "</section>"
    );
  }

  planSheet(segs) {
    const st = this.host.settings();
    const plan = this.plan || [];
    const blocks = plan
      .map((e, i) => {
        const on = e.enabled !== false;
        const sel = e.segments || [];
        return (
          '<div class="group pentry">' +
          '<div class="row"><button class="sw' + (on ? " on" : "") + '" style="margin-left:0" role="switch" aria-checked="' + on + '" aria-label="Eintrag aktiv" data-pen="' + i + '"></button>' +
          '<input type="time" class="dinput" style="margin-left:0" data-ptime="' + i + '" value="' + esc(e.time || "10:00") + '">' +
          '<button class="round" style="margin-left:auto" data-pdel="' + i + '" aria-label="Eintrag löschen">' + icon("bin") + "</button></div>" +
          '<div class="row"><div class="vopts">' +
          DAYS.map((d, k) => '<button class="opt' + ((e.days || []).indexOf(k) >= 0 ? " on" : "") + '" data-pday="' + i + "," + k + '">' + d + "</button>").join("") +
          "</div></div>" +
          (segs.length
            ? '<div class="row"><div class="vopts">' +
              '<button class="opt' + (!sel.length ? " on" : "") + '" data-pall="' + i + '">Alle Räume</button>' +
              segs.map((g) => '<button class="opt' + (sel.indexOf(String(g.id)) >= 0 ? " on" : "") + '" data-pseg="' + i + "," + esc(g.id) + '">' + esc(g.name) + "</button>").join("") +
              "</div></div>"
            : "") +
          "</div>"
        );
      })
      .join("");
    const note = st.presence_entity
      ? "Ist jemand zuhause, wartet der Eintrag bis zur nächsten Abwesenheit, längstens bis Mitternacht. Anwesenheit: " + esc((this.hass.states[st.presence_entity] || { attributes: {} }).attributes.friendly_name || st.presence_entity) + "."
      : "Ohne Anwesenheits-Entität (Einstellungen → Anwesenheit) startet die Reinigung immer zur Uhrzeit.";
    return this.sheetShell(
      "Zeitplan",
      blocks + '<button class="scene" data-padd="1">+ Eintrag</button><div class="note">' + note + " Läuft in Home Assistant, auch wenn das Dashboard zu ist.</div>",
      '<button class="scene pri" style="margin-left:auto" data-psave="1">Speichern</button>'
    );
  }

  bindPlan() {
    const el = this.host.el;
    const q = (s) => Array.prototype.slice.call(el.querySelectorAll(s));
    const plan = this.plan;
    const at = (attr, b) => b.getAttribute(attr).split(",");
    const redraw = () => this.render();
    q("[data-pen]").forEach((b) => (b.onclick = () => {
      const e = plan[+b.getAttribute("data-pen")];
      e.enabled = e.enabled === false;
      redraw();
    }));
    q("[data-pdel]").forEach((b) => (b.onclick = () => {
      plan.splice(+b.getAttribute("data-pdel"), 1);
      redraw();
    }));
    q("[data-pday]").forEach((b) => (b.onclick = () => {
      const p = at("data-pday", b);
      const e = plan[+p[0]];
      const k = +p[1];
      const days = (e.days = e.days || []);
      const j = days.indexOf(k);
      if (j >= 0) days.splice(j, 1);
      else days.push(k);
      days.sort();
      redraw();
    }));
    q("[data-pall]").forEach((b) => (b.onclick = () => {
      plan[+b.getAttribute("data-pall")].segments = [];
      redraw();
    }));
    q("[data-pseg]").forEach((b) => (b.onclick = () => {
      const p = at("data-pseg", b);
      const e = plan[+p[0]];
      const segs = (e.segments = e.segments || []);
      const j = segs.indexOf(p[1]);
      if (j >= 0) segs.splice(j, 1);
      else segs.push(p[1]);
      redraw();
    }));
    q("[data-ptime]").forEach((i) => {
      i.addEventListener("focus", () => (this.editing = true));
      i.addEventListener("change", () => (plan[+i.getAttribute("data-ptime")].time = i.value || "10:00"));
      i.addEventListener("blur", () => {
        this.editing = false;
        redraw();
      });
    });
    q("[data-padd]").forEach((b) => (b.onclick = () => {
      plan.push({ id: "p" + Date.now().toString(36), enabled: true, days: [0, 2, 4], time: "10:00", segments: [] });
      redraw();
    }));
    q("[data-psave]").forEach((b) => (b.onclick = async () => {
      const old = {};
      (this.host.settings().vacuum_schedule || []).forEach((e) => (old[e.id] = e));
      const now = stamp(new Date());
      const next = plan.map((e) => {
        const o = old[e.id];
        const same = o && JSON.stringify(Object.assign({}, o, { since: null })) === JSON.stringify(Object.assign({}, e, { since: null }));
        // Neue oder geänderte Einträge: heute nicht rückwirkend nachholen (siehe schedule.py).
        return Object.assign({}, e, { since: same ? o.since || null : now });
      });
      try {
        await this.host.saveSettings({ vacuum_schedule: next });
        this.host.toast("Zeitplan gespeichert");
        this.sheet = null;
        this.plan = null;
        this.render();
        this.loadPlanState();
      } catch (err) {
        this.host.toast("Speichern fehlgeschlagen");
      }
    }));
  }

  // ---------- Karte ----------

  /** Kartenausschnitt so groß wie möglich, ohne die Ansicht scrollen zu müssen. */
  fitMap() {
    const el = this.host.el;
    const wrap = el.querySelector(".vmapwrap");
    const crop = el.querySelector(".vcrop");
    if (!wrap || !crop) return;
    const ratio = parseFloat(crop.getAttribute("data-ratio"));
    const apply = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h || !isFinite(ratio)) return;
      crop.style.width = Math.floor(Math.min(w, h / ratio)) + "px";
    };
    apply();
    if (window.ResizeObserver) {
      if (this.ro) this.ro.disconnect();
      this.ro = new ResizeObserver(apply);
      this.ro.observe(wrap);
    }
  }

  bind(id, segs, paused) {
    const el = this.host.el;
    const q = (s) => Array.prototype.slice.call(el.querySelectorAll(s));
    q("[data-sheet]").forEach((b) => (b.onclick = () => {
      this.sheet = b.getAttribute("data-sheet");
      if (this.sheet === "plan") this.plan = JSON.parse(JSON.stringify(this.host.settings().vacuum_schedule || []));
      this.render();
    }));
    const closeSheet = () => {
      this.sheet = null;
      this.plan = null;
      this.editing = false;
      this.render();
    };
    q("[data-closesheet]").forEach((b) => (b.onclick = closeSheet));
    const ov = el.querySelector(".edetail");
    if (ov) ov.addEventListener("click", (e) => { if (e.target === ov) closeSheet(); });
    if (this.sheet === "plan") this.bindPlan();
    q("[data-reset]").forEach((b) => (b.onclick = () => {
      const bid = b.getAttribute("data-reset");
      clearTimeout(this.confirmTimer);
      if (this.confirmReset !== bid) {
        this.confirmReset = bid;
        this.confirmTimer = setTimeout(() => {
          this.confirmReset = null;
          this.render();
        }, 4000);
      } else {
        this.confirmReset = null;
        this.call("button", "press", { entity_id: bid });
        this.host.toast("Zurückgesetzt");
      }
      this.render();
    }));
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
    // Die Bild-URL (Token) bleibt gleich, wenn sich die Karte ändert; der Zustand (Zeitpunkt der
    // letzten Aktualisierung) hängt daher als Parameter dran, sonst zeigt der Browser das Bild aus dem Cache.
    const pic = mapState.attributes.entity_picture;
    const url = pic + (pic.indexOf("?") >= 0 ? "&" : "?") + "v=" + encodeURIComponent(mapState.state || "");
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
      '<div class="vmapwrap"><div class="vcrop" data-ratio="' + ratio.toFixed(4) + '"><div style="padding-top:' + (ratio * 100).toFixed(3) + '%"></div>' +
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
