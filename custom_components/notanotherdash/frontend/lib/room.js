// Raumansicht: liegt als Blatt über der Übersicht.
// Ein Tipp schaltet, Ziehen stellt ein; gesendet wird beim Loslassen.
// Während einer Geste wird nicht neu gezeichnet, damit der Finger nicht „springt“.

import { icon } from "./icons.js";
import {
  roomSummary,
  fmtNum,
  lightInfo,
  coverInfo,
  coverGroup,
  coverText,
  climateModes,
  climateRange,
  snap,
  historyPoints,
  graphPaths,
  shortName
} from "./model.js";

const DRAG_START_PX = 8;
const DIAL = { cx: 138, cy: 400, r: 330, degPerK: 7, pxPerK: 40 };
const HISTORY_HOURS = 24;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class RoomView {
  constructor(host) {
    // host: { el, hass(), floorName(id), toast(text) }
    this.host = host;
    this.room = null;
    this.expanded = false;
    this.gesture = null;
    this.dialT = null;
    this.pendingRender = false;
    this.history = null;
    this.pendingTarget = null; // {t, until}: gesendeter Sollwert, bis HA ihn bestätigt
  }

  get hass() {
    return this.host.hass();
  }

  open(room) {
    this.room = room;
    this.expanded = false;
    this.dialT = null;
    this.pendingTarget = null;
    this.history = null;
    this.host.el.classList.add("open");
    this.render();
    this.loadHistory();
  }

  close() {
    this.room = null;
    this.host.el.classList.remove("open");
    this.host.el.innerHTML = "";
  }

  isOpen() {
    return !!this.room;
  }

  /** Von außen aufgerufen, wenn sich Zustände des Raums geändert haben. */
  refresh(room) {
    if (!this.room) return;
    if (room) this.room = room;
    if (this.gesture) {
      this.pendingRender = true;
      return;
    }
    this.render();
  }

  call(domain, service, data) {
    return this.hass.callService(domain, service, data).catch(() => this.host.toast("Befehl fehlgeschlagen"));
  }

  // ---------- Daten ----------

  async loadHistory() {
    const room = this.room;
    if (!room) return;
    const id = room.tempSensor || room.climates[0];
    if (!id) return;
    const isClimate = !room.tempSensor;
    const end = new Date();
    const start = new Date(end.getTime() - HISTORY_HOURS * 3600000);
    try {
      const res = await this.hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [id],
        minimal_response: !isClimate,
        no_attributes: !isClimate,
        significant_changes_only: false
      });
      if (this.room !== room) return;
      this.history = { points: historyPoints(res[id], isClimate ? "current_temperature" : null), start: start.getTime(), end: end.getTime() };
      this.refresh();
    } catch (e) {
      this.history = null;
    }
  }

  // ---------- Darstellung ----------

  render() {
    this.pendingRender = false;
    const room = this.room;
    if (!room) return;
    const states = this.hass.states;
    const s = roomSummary(room, states, Date.now());
    const sub = [];
    const floor = this.host.floorName(room.floor);
    if (floor) sub.push(floor);
    if (s.temp != null) sub.push(fmtNum(s.temp, 1) + "°");
    if (s.hum != null) sub.push(Math.round(s.hum) + " %");
    if (s.presence === "Jetzt") sub.push("Anwesend");

    const scenes = room.scenes
      .filter((id) => states[id])
      .map((id) => '<button class="scene" data-scene="' + esc(id) + '">' + esc(shortName(states[id].attributes.friendly_name || id, room.name)) + "</button>")
      .join("");
    const allOff = room.lights.length ? '<button class="scene" data-alloff="1">Alles aus</button>' : "";

    const hasHeat = room.climates.length > 0;
    const right = this.lightsHtml() + this.coversHtml();
    this.host.el.innerHTML =
      '<div class="backdrop"></div>' +
      '<div class="sheet" role="dialog" aria-label="' + esc(room.name) + '">' +
      '<div class="shead"><div><div class="sname">' + esc(room.name) + '</div><div class="ssub">' + esc(sub.join(" · ")) + "</div></div>" +
      '<div class="scenes">' + scenes + allOff + "</div>" +
      '<button class="round" data-close="1" aria-label="Schließen">' + icon("close") + "</button></div>" +
      '<div class="sbody' + (hasHeat ? "" : " noheat") + '">' +
      (hasHeat ? this.heatHtml(s) : "") +
      '<div class="sright">' + (right || (hasHeat ? "" : '<div class="empty">Keine steuerbaren Geräte in diesem Raum.</div>')) + "</div>" +
      "</div></div>";
    this.bind();
  }

  heatHtml(s) {
    const room = this.room;
    const states = this.hass.states;
    const main = states[room.climates[0]];
    const range = climateRange(main);
    const p = this.pendingTarget;
    if (p && (Date.now() > p.until || range.target === p.t)) this.pendingTarget = null;
    const shown = this.pendingTarget ? this.pendingTarget.t : range.target;
    const target = this.dialT != null ? snap(this.dialT, range.step, range.min, range.max) : shown;
    const t = this.dialT != null ? this.dialT : target != null ? target : 20;
    const heating = room.climates.some((id) => states[id] && states[id].attributes.hvac_action === "heating");
    const ist = s.temp != null ? "Ist " + fmtNum(s.temp, 1) + "°" : "";
    const status = heating ? '<span class="hot">heizt</span>' : main && main.state === "off" ? "aus" : "";

    let graph = "";
    if (this.host.showGraph() && this.history) {
      const g = graphPaths(this.history.points, target, this.history.start, this.history.end, 276, 250);
      if (g) {
        graph =
          '<div class="graph" aria-hidden="true"><svg viewBox="0 0 276 250" preserveAspectRatio="none">' +
          '<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8f5c" stop-opacity=".30"/><stop offset="1" stop-color="#ff8f5c" stop-opacity="0"/></linearGradient></defs>' +
          '<path d="' + g.area + '" fill="url(#tg)"/>' +
          '<path d="' + g.line + '" fill="none" stroke="#ff9a6b" stroke-opacity=".7" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
          (g.target ? '<path d="' + g.target + '" fill="none" stroke="#f5eee9" stroke-opacity=".25" stroke-width="1.2" stroke-dasharray="4 5" vector-effect="non-scaling-stroke"/>' : "") +
          '</svg><span class="axis">24 h</span></div>';
      }
    }

    const modes = climateModes(main)
      .map((m) => '<button class="mode' + (m.on ? " act" : "") + '" data-mode="' + esc(m.kind + ":" + m.value) + '">' + esc(m.label) + "</button>")
      .join("");

    const radiators =
      room.climates.length > 1
        ? '<div class="rads">' +
          room.climates
            .map((id) => {
              const c = states[id];
              if (!c) return "";
              const cur = c.attributes.current_temperature;
              return (
                '<div class="srow">' + icon("thermo") + esc(shortName(c.attributes.friendly_name || id, room.name)) +
                '<span class="v">' + (cur != null ? fmtNum(cur, 1) + "°" : "") + (c.attributes.hvac_action === "heating" ? ' · <span class="hot">heizt</span>' : "") + "</span></div>"
              );
            })
            .join("") +
          "</div>"
        : "";

    const sensors = [];
    if (s.hum != null) sensors.push('<div class="srow">' + icon("drop") + Math.round(s.hum) + " %</div>");
    if (room.windows.length) sensors.push('<div class="srow">' + icon("window") + (s.windowsOpen ? '<span class="isopen">offen</span>' : "zu") + "</div>");
    room.co2.forEach((id) => {
      const c = states[id];
      if (c && isFinite(parseFloat(c.state))) sensors.push('<div class="srow">' + icon("gauge") + Math.round(parseFloat(c.state)) + " ppm</div>");
    });

    return (
      '<section class="card heat" aria-label="Heizung">' +
      graph +
      '<button class="more" data-more="heat" aria-label="Heizung Details">' + icon("chev") + "</button>" +
      '<div class="target"><div class="tval">' + (target != null ? fmtNum(target, 1) + "°" : "–") + '</div><div class="tist">' + [ist, status].filter(Boolean).join(" · ") + "</div></div>" +
      '<div class="dialwrap">' +
      '<button class="dial" aria-label="Solltemperatur drehen: nach rechts wärmer, nach links kälter">' + this.dialSvg(t) + "</button>" +
      '<button class="dialend" style="left:10px" data-step="-1" aria-label="Kälter">' + icon("chevl") + "</button>" +
      '<button class="dialend" style="right:10px" data-step="1" aria-label="Wärmer">' + icon("chev") + "</button>" +
      "</div>" +
      (modes ? '<div class="modes">' + modes + "</div>" : "") +
      radiators +
      (sensors.length ? '<div class="sensors">' + sensors.join("") + "</div>" : "") +
      "</section>"
    );
  }

  dialSvg(t) {
    let minor = "";
    let major = "";
    for (let k = 5; k <= 30; k += 0.5) {
      const a = (t - k) * DIAL.degPerK;
      if (Math.abs(a) > 30) continue;
      const rad = (a * Math.PI) / 180;
      const s = Math.sin(rad);
      const c = Math.cos(rad);
      const big = k % 1 === 0;
      const r1 = DIAL.r - 2;
      const r2 = big ? DIAL.r - 26 : DIAL.r - 16;
      const seg =
        "M" + (DIAL.cx + s * r1).toFixed(1) + " " + (DIAL.cy - c * r1).toFixed(1) + " L" + (DIAL.cx + s * r2).toFixed(1) + " " + (DIAL.cy - c * r2).toFixed(1) + " ";
      if (big) major += seg;
      else minor += seg;
    }
    return (
      '<svg viewBox="0 0 276 118" aria-hidden="true">' +
      '<defs><linearGradient id="dg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7fa8ff" stop-opacity=".55"/><stop offset=".5" stop-color="#f5eee9" stop-opacity=".18"/><stop offset="1" stop-color="#ff8f5c" stop-opacity=".65"/></linearGradient></defs>' +
      '<path d="M -20 126.3 A 316 316 0 0 1 296 126.3" fill="none" stroke="url(#dg)" stroke-width="30"/>' +
      '<path class="ticks-minor" d="' + (minor || "M0 0") + '" stroke="#f5eee9" stroke-opacity=".38" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path class="ticks-major" d="' + (major || "M0 0") + '" stroke="#f5eee9" stroke-opacity=".85" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M138 66 L138 98" stroke="#f5eee9" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M131 55 L145 55 L138 63 Z" fill="#f5eee9"/>' +
      "</svg>"
    );
  }

  lightsHtml() {
    const room = this.room;
    const states = this.hass.states;
    if (!room.lights.length) return "";
    return (
      '<div class="lights">' +
      room.lights
        .map((id) => {
          const st = states[id];
          const li = lightInfo(st);
          const name = shortName(st ? st.attributes.friendly_name : id, room.name);
          const state = li.unavailable ? "Nicht erreichbar" : li.on ? (li.dimmable ? li.bri + " %" : "An") : "Aus";
          return (
            '<button class="lt' + (li.on ? " on" : "") + (li.dimmable ? " dim" : "") + '" data-light="' + esc(id) + '" aria-label="' + esc(name) + '">' +
            '<span class="fill" style="width:' + (li.on ? (li.dimmable ? li.bri : 100) : 0) + '%"></span>' +
            '<span class="bulb">' + icon("bulb") + "</span>" +
            '<span class="ltx"><span class="nm">' + esc(name) + '</span><span class="st">' + state + "</span></span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  coversHtml() {
    const room = this.room;
    const states = this.hass.states;
    if (!room.covers.length) return "";
    const cols = [];
    const all = room.covers.map((id) => states[id]).filter(Boolean);
    if (room.covers.length > 1) cols.push(this.coverCol("all", "Alle " + room.covers.length + " Rollläden", coverGroup(all), true));
    if (room.covers.length === 1 || this.expanded) {
      room.covers.forEach((id) => {
        const st = states[id];
        cols.push(this.coverCol(id, shortName(st ? st.attributes.friendly_name : id, room.name), coverInfo(st), false));
      });
    }
    return '<div class="covers">' + cols.join("") + "</div>";
  }

  coverCol(id, name, g, group) {
    const drag = this.gesture && this.gesture.kind === "cover" && this.gesture.id === id && this.gesture.moved ? this.gesture.value : null;
    const text = drag != null ? "Ziel " + drag + " %" : coverText(g);
    return (
      '<div class="col' + (group ? " grp" : "") + '">' +
      '<button class="vz' + (g.settable ? "" : " fixed") + '" data-cover="' + esc(id) + '" aria-label="' + esc(name) + ' Position">' +
      '<span class="cover" style="height:' + (100 - g.pos) + '%"></span>' +
      (drag != null ? '<span class="ghost" style="top:calc(' + (100 - drag) + '% - 1px)"></span>' : "") +
      '<span class="nm">' + esc(name) + '</span><span class="st">' + esc(text) + "</span></button>" +
      '<div class="btnrow">' +
      '<button class="round' + (g.opening ? " stop" : "") + '" data-cmd="up" data-target="' + esc(id) + '" aria-label="' + (g.opening ? "Anhalten" : "Öffnen") + '">' + icon(g.opening ? "stopsq" : "up") + "</button>" +
      '<button class="round' + (g.closing ? " stop" : "") + '" data-cmd="down" data-target="' + esc(id) + '" aria-label="' + (g.closing ? "Anhalten" : "Schließen") + '">' + icon(g.closing ? "stopsq" : "down") + "</button>" +
      "</div></div>"
    );
  }

  coverIds(id) {
    return id === "all" ? this.room.covers.slice() : [id];
  }

  // ---------- Bedienung ----------

  bind() {
    const el = this.host.el;
    const q = (sel) => Array.prototype.slice.call(el.querySelectorAll(sel));
    el.querySelector(".backdrop").onclick = () => this.close();
    q("[data-close]").forEach((b) => (b.onclick = () => this.close()));
    q("[data-scene]").forEach((b) => (b.onclick = () => {
      this.call("scene", "turn_on", { entity_id: b.getAttribute("data-scene") });
      this.host.toast(b.textContent);
    }));
    q("[data-alloff]").forEach((b) => (b.onclick = () => {
      this.call("light", "turn_off", { entity_id: this.room.lights });
      this.host.toast("Alles aus");
    }));
    q("[data-more]").forEach((b) => (b.onclick = () => this.host.toast("Details folgen in einem späteren Schritt")));
    q("[data-mode]").forEach((b) => (b.onclick = () => {
      const v = b.getAttribute("data-mode").split(":");
      if (v[0] === "preset") this.call("climate", "set_preset_mode", { entity_id: this.room.climates, preset_mode: v[1] });
      else this.call("climate", "set_hvac_mode", { entity_id: this.room.climates, hvac_mode: v[1] });
      this.host.toast("Modus " + b.textContent);
    }));
    q("[data-step]").forEach((b) => (b.onclick = () => this.stepTarget(parseInt(b.getAttribute("data-step"), 10))));
    q("[data-cmd]").forEach((b) => (b.onclick = () => this.coverCmd(b.getAttribute("data-target"), b.getAttribute("data-cmd"), b.classList.contains("stop"))));
    q("[data-light]").forEach((b) => this.bindDrag(b, "light", b.getAttribute("data-light"), "x"));
    q("[data-cover]").forEach((b) => this.bindDrag(b, "cover", b.getAttribute("data-cover"), "y"));
    const dial = el.querySelector(".dial");
    if (dial) this.bindDial(dial);
  }

  bindDrag(btn, kind, id, axis) {
    btn.addEventListener("pointerdown", (e) => {
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {}
      this.gesture = { kind: kind, id: id, axis: axis, x0: e.clientX, y0: e.clientY, rect: btn.getBoundingClientRect(), moved: false, value: null, el: btn };
    });
    btn.addEventListener("pointermove", (e) => {
      const g = this.gesture;
      if (!g || g.el !== btn) return;
      const delta = axis === "y" ? e.clientY - g.y0 : e.clientX - g.x0;
      if (!g.moved && Math.abs(delta) < DRAG_START_PX) return;
      if (kind === "light" && !btn.classList.contains("dim")) return;
      if (kind === "cover" && btn.classList.contains("fixed")) return;
      g.moved = true;
      const f = axis === "y" ? (e.clientY - g.rect.top) / g.rect.height : (e.clientX - g.rect.left) / g.rect.width;
      const pct = Math.max(0, Math.min(100, Math.round(f * 100)));
      if (kind === "light") {
        g.value = Math.max(1, pct);
        btn.classList.add("on");
        btn.querySelector(".fill").style.width = g.value + "%";
        btn.querySelector(".st").textContent = g.value + " %";
      } else {
        g.value = 100 - pct;
        btn.querySelector(".st").textContent = "Ziel " + g.value + " %";
        let ghost = btn.querySelector(".ghost");
        if (!ghost) {
          ghost = document.createElement("span");
          ghost.className = "ghost";
          btn.insertBefore(ghost, btn.querySelector(".nm"));
        }
        ghost.style.top = "calc(" + pct + "% - 1px)";
      }
    });
    const end = (cancel) => {
      const g = this.gesture;
      if (!g || g.el !== btn) return;
      this.gesture = null;
      if (!cancel) {
        if (kind === "light") this.lightRelease(id, g);
        else this.coverRelease(id, g);
      }
      if (this.pendingRender || g.moved || (kind === "cover" && id === "all")) this.render();
    };
    btn.addEventListener("pointerup", () => end(false));
    btn.addEventListener("pointercancel", () => end(true));
  }

  lightRelease(id, g) {
    const name = btnName(g.el);
    if (g.moved && g.value != null) {
      this.call("light", "turn_on", { entity_id: id, brightness_pct: g.value });
      this.host.toast(name + " → " + g.value + " %");
    } else {
      this.call("light", "toggle", { entity_id: id });
    }
  }

  coverRelease(id, g) {
    if (g.moved && g.value != null) {
      this.call("cover", "set_cover_position", { entity_id: this.coverIds(id), position: g.value });
      this.host.toast(btnName(g.el).replace(/ Position$/, "") + " → " + g.value + " %");
    } else if (id === "all") {
      this.expanded = !this.expanded;
    }
  }

  coverCmd(id, cmd, stopping) {
    const ids = this.coverIds(id);
    if (stopping) this.call("cover", "stop_cover", { entity_id: ids });
    else this.call("cover", cmd === "up" ? "open_cover" : "close_cover", { entity_id: ids });
  }

  stepTarget(dir) {
    const main = this.hass.states[this.room.climates[0]];
    const r = climateRange(main);
    const base = r.target != null ? r.target : 20;
    const t = snap((this.pendingTarget ? this.pendingTarget.t : base) + dir * r.step, r.step, r.min, r.max);
    this.pendingTarget = { t: t, until: Date.now() + 8000 };
    this.render();
    this.call("climate", "set_temperature", { entity_id: this.room.climates, temperature: t });
    this.host.toast("Solltemperatur " + fmtNum(t, 1) + "°");
  }

  bindDial(dial) {
    dial.addEventListener("pointerdown", (e) => {
      const main = this.hass.states[this.room.climates[0]];
      const r = climateRange(main);
      try {
        dial.setPointerCapture(e.pointerId);
      } catch (err) {}
      this.gesture = { kind: "dial", x0: e.clientX, t0: this.pendingTarget ? this.pendingTarget.t : r.target != null ? r.target : 20, range: r, el: dial, moved: false };
    });
    dial.addEventListener("pointermove", (e) => {
      const g = this.gesture;
      if (!g || g.kind !== "dial") return;
      if (!g.moved && Math.abs(e.clientX - g.x0) < 4) return;
      g.moved = true;
      const raw = Math.max(g.range.min, Math.min(g.range.max, g.t0 + (e.clientX - g.x0) / DIAL.pxPerK));
      this.dialT = raw;
      // Nur Striche und Zahl aktualisieren, nicht das ganze Blatt.
      dial.innerHTML = this.dialSvg(raw);
      const tv = this.host.el.querySelector(".tval");
      if (tv) tv.textContent = fmtNum(snap(raw, g.range.step, g.range.min, g.range.max), 1) + "°";
    });
    const end = () => {
      const g = this.gesture;
      if (!g || g.kind !== "dial") return;
      this.gesture = null;
      if (g.moved && this.dialT != null) {
        const t = snap(this.dialT, g.range.step, g.range.min, g.range.max);
        if (t !== g.t0) {
          this.pendingTarget = { t: t, until: Date.now() + 8000 };
          this.call("climate", "set_temperature", { entity_id: this.room.climates, temperature: t });
          this.host.toast((this.room.climates.length > 1 ? "Alle Heizkörper: " : "Solltemperatur ") + fmtNum(t, 1) + "°");
        }
      }
      this.dialT = null;
      this.render();
    };
    dial.addEventListener("pointerup", end);
    dial.addEventListener("pointercancel", end);
  }
}

function btnName(el) {
  return (el && el.getAttribute("aria-label")) || "";
}
