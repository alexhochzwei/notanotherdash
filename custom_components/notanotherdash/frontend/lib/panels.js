// Panels Klima, Licht und Kameras (untere Leiste).
// Sie zeigen alle Geräte eines Typs nach Räumen; ein Tipp auf den Raumnamen öffnet die Raumansicht.

import { icon } from "./icons.js";
import { fmtNum, lightInfo, climateModes, climateRange, snap, shortName, roomSummary } from "./model.js";

const DRAG_START_PX = 8;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function roomsWith(model, key) {
  if (!model) return [];
  const out = [];
  model.floors.forEach((f) => f.rooms.forEach((r) => r[key].length && out.push(r)));
  return out;
}

class BaseView {
  constructor(host) {
    // host: { el, hass(), model(), settings(), toast(), openRoom(id) }
    this.host = host;
  }
  get hass() {
    return this.host.hass();
  }
  show() {
    this.render();
  }
  hide() {}
  call(domain, service, data) {
    return this.hass.callService(domain, service, data).catch(() => this.host.toast("Befehl fehlgeschlagen"));
  }
  bindRoomLinks() {
    Array.prototype.forEach.call(this.host.el.querySelectorAll("[data-openroom]"), (b) => (b.onclick = () => this.host.openRoom(b.getAttribute("data-openroom"))));
  }
}

// ---------- Klima ----------

export class ClimateView extends BaseView {
  constructor(host) {
    super(host);
    this.pending = {}; // entity_id -> {t, until}
  }

  watched() {
    return roomsWith(this.host.model(), "climates").reduce((a, r) => a.concat(r.climates, r.windows, r.tempSensor ? [r.tempSensor] : []), []);
  }

  render() {
    const rooms = roomsWith(this.host.model(), "climates");
    const el = this.host.el;
    if (!rooms.length) {
      el.innerHTML = '<div class="ehint">Keine Thermostate in deinen Bereichen gefunden.</div>';
      return;
    }
    const states = this.hass.states;
    const all = rooms.reduce((a, r) => a.concat(r.climates), []);
    const heating = all.filter((id) => states[id] && states[id].attributes.hvac_action === "heating").length;
    // Presets, die mindestens ein Thermostat kennt (Reihenfolge des ersten Vorkommens).
    const presets = [];
    all.forEach((id) =>
      climateModes(states[id])
        .filter((m) => m.kind === "preset" && m.value !== "none")
        .forEach((m) => presets.filter((x) => x.value === m.value).length || presets.push(m))
    );
    const now = Date.now();

    const cards = rooms
      .map((r) => {
        const s = roomSummary(r, states, now);
        const main = states[r.climates[0]];
        if (!main) return "";
        const range = climateRange(main);
        const p = this.pending[r.id];
        if (p && (now > p.until || range.target === p.t)) delete this.pending[r.id];
        const target = this.pending[r.id] ? this.pending[r.id].t : range.target;
        const hot = r.climates.some((id) => states[id] && states[id].attributes.hvac_action === "heating");
        const off = main.state === "off";
        const preset = climateModes(main).filter((m) => m.on)[0];
        return (
          '<div class="card ccard' + (hot ? " hot" : "") + '">' +
          '<button class="cname" data-openroom="' + esc(r.id) + '">' + esc(r.name) + icon("chev") + "</button>" +
          '<div class="cnow">' + (s.temp != null ? fmtNum(s.temp, 1) + "°" : "–") + "</div>" +
          '<div class="cstate">' +
          (off ? "Aus" : hot ? '<span class="hot">heizt</span>' : "hält") +
          (preset ? " · " + esc(preset.label) : "") +
          (s.windowsOpen ? ' · <span class="isopen">Fenster offen</span>' : "") +
          (s.hum != null ? " · " + Math.round(s.hum) + " %" : "") +
          "</div>" +
          '<div class="cset"><button class="round" data-cstep="-1" data-room="' + esc(r.id) + '" aria-label="' + esc(r.name) + ' kälter">' + icon("chevl") + "</button>" +
          '<div class="ctarget"><span>Soll</span>' + (target != null ? fmtNum(target, 1) + "°" : "–") + "</div>" +
          '<button class="round" data-cstep="1" data-room="' + esc(r.id) + '" aria-label="' + esc(r.name) + ' wärmer">' + icon("chev") + "</button></div>" +
          "</div>"
        );
      })
      .join("");

    el.innerHTML =
      '<div class="phead"><div><div class="ptitle">Klima</div><div class="cap">' + heating + " von " + rooms.length + " Räumen heizen</div></div>" +
      (presets.length
        ? '<div class="pacts"><span class="cap">Alle:</span>' + presets.map((m) => '<button class="scene" data-allpreset="' + esc(m.value) + '">' + esc(m.label) + "</button>").join("") + "</div>"
        : "") +
      "</div>" +
      '<div class="cgrid">' + cards + "</div>";

    const q = (s) => Array.prototype.slice.call(el.querySelectorAll(s));
    this.bindRoomLinks();
    q("[data-cstep]").forEach((b) => (b.onclick = () => {
      const r = rooms.filter((x) => x.id === b.getAttribute("data-room"))[0];
      const main = states[r.climates[0]];
      const range = climateRange(main);
      const base = this.pending[r.id] ? this.pending[r.id].t : range.target != null ? range.target : 20;
      const t = snap(base + parseInt(b.getAttribute("data-cstep"), 10) * range.step, range.step, range.min, range.max);
      this.pending[r.id] = { t: t, until: Date.now() + 8000 };
      this.render();
      clearTimeout(this.sendTimer && this.sendTimer[r.id]);
      this.sendTimer = this.sendTimer || {};
      // Mehrere Tipps hintereinander zusammenfassen und einmal senden.
      this.sendTimer[r.id] = setTimeout(() => {
        this.call("climate", "set_temperature", { entity_id: r.climates, temperature: t });
        this.host.toast(r.name + ": " + fmtNum(t, 1) + "°");
      }, 700);
    }));
    q("[data-allpreset]").forEach((b) => (b.onclick = () => {
      const ids = all.filter((id) => states[id] && (states[id].attributes.preset_modes || []).indexOf(b.getAttribute("data-allpreset")) >= 0);
      this.call("climate", "set_preset_mode", { entity_id: ids, preset_mode: b.getAttribute("data-allpreset") });
      this.host.toast("Alle Räume: " + b.textContent);
    }));
  }
}

// ---------- Licht ----------

export class LightView extends BaseView {
  constructor(host) {
    super(host);
    this.gesture = null;
    this.pendingRender = false;
  }

  watched() {
    return roomsWith(this.host.model(), "lights").reduce((a, r) => a.concat(r.lights), []);
  }

  render() {
    if (this.gesture) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    const rooms = roomsWith(this.host.model(), "lights");
    const el = this.host.el;
    if (!rooms.length) {
      el.innerHTML = '<div class="ehint">Keine Lichter in deinen Bereichen gefunden.</div>';
      return;
    }
    const states = this.hass.states;
    const all = rooms.reduce((a, r) => a.concat(r.lights), []);
    const on = all.filter((id) => states[id] && states[id].state === "on");
    el.innerHTML =
      '<div class="phead"><div><div class="ptitle">Licht</div><div class="cap">' + on.length + " von " + all.length + " an</div></div>" +
      '<div class="pacts">' + (on.length ? '<button class="scene" data-alloff="1">Alle aus</button>' : "") + "</div></div>" +
      rooms
        .map(
          (r) =>
            '<section class="lroom"><button class="cname" data-openroom="' + esc(r.id) + '">' + esc(r.name) + icon("chev") + "</button>" +
            '<div class="lights">' +
            r.lights
              .map((id) => {
                const st = states[id];
                const li = lightInfo(st);
                const name = shortName(st ? st.attributes.friendly_name : id, r.name);
                const txt = li.unavailable ? "Nicht erreichbar" : li.on ? (li.dimmable ? li.bri + " %" : "An") : "Aus";
                return (
                  '<button class="lt' + (li.on ? " on" : "") + (li.dimmable ? " dim" : "") + (li.unavailable ? " na" : "") + '" data-light="' + esc(id) + '" aria-label="' + esc(name) + '">' +
                  '<span class="fill" style="width:' + (li.on ? (li.dimmable ? li.bri : 100) : 0) + '%"></span>' +
                  '<span class="bulb">' + icon("bulb") + "</span>" +
                  '<span class="ltx"><span class="nm">' + esc(name) + '</span><span class="st">' + txt + "</span></span></button>"
                );
              })
              .join("") +
            "</div></section>"
        )
        .join("");
    this.bindRoomLinks();
    const ao = el.querySelector("[data-alloff]");
    if (ao)
      ao.onclick = () => {
        this.call("light", "turn_off", { entity_id: on });
        this.host.toast("Alle Lichter aus");
      };
    Array.prototype.forEach.call(el.querySelectorAll("[data-light]"), (b) => this.bindLight(b));
  }

  bindLight(btn) {
    const id = btn.getAttribute("data-light");
    btn.addEventListener("pointerdown", (e) => {
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {}
      this.gesture = { x0: e.clientX, rect: btn.getBoundingClientRect(), moved: false, value: null };
    });
    btn.addEventListener("pointermove", (e) => {
      const g = this.gesture;
      if (!g || !btn.classList.contains("dim")) return;
      if (!g.moved && Math.abs(e.clientX - g.x0) < DRAG_START_PX) return;
      g.moved = true;
      g.value = Math.max(1, Math.min(100, Math.round(((e.clientX - g.rect.left) / g.rect.width) * 100)));
      btn.classList.add("on");
      btn.querySelector(".fill").style.width = g.value + "%";
      btn.querySelector(".st").textContent = g.value + " %";
    });
    const end = (cancel) => {
      const g = this.gesture;
      if (!g) return;
      this.gesture = null;
      if (!cancel) {
        if (g.moved && g.value != null) {
          this.call("light", "turn_on", { entity_id: id, brightness_pct: g.value });
          this.host.toast(btn.getAttribute("aria-label") + " → " + g.value + " %");
        } else this.call("light", "toggle", { entity_id: id });
      }
      if (this.pendingRender || g.moved) this.render();
    };
    btn.addEventListener("pointerup", () => end(false));
    btn.addEventListener("pointercancel", () => end(true));
  }
}

// ---------- Kameras ----------

const CAMERA_REFRESH_MS = 10000;

export class CameraView extends BaseView {
  constructor(host) {
    super(host);
    this.live = null;
  }

  watched() {
    return [];
  }

  cameras() {
    const m = this.host.model();
    const out = [];
    if (m)
      m.floors.forEach((f) =>
        f.rooms.forEach((r) => r.cameras.forEach((id) => out.push({ id: id, room: r })))
      );
    return out;
  }

  show() {
    this.render();
    clearInterval(this.timer);
    // Standbilder regelmäßig neu laden, nicht bei jeder Zustandsänderung.
    this.timer = setInterval(() => this.refreshStills(), CAMERA_REFRESH_MS);
  }

  hide() {
    clearInterval(this.timer);
    this.timer = null;
    this.live = null;
  }

  url(id, stream) {
    const st = this.hass.states[id];
    const token = st && st.attributes.access_token;
    if (!token) return "";
    return "/api/" + (stream ? "camera_proxy_stream/" : "camera_proxy/") + id + "?token=" + token + (stream ? "" : "&t=" + Date.now());
  }

  refreshStills() {
    Array.prototype.forEach.call(this.host.el.querySelectorAll("img[data-cam]"), (img) => {
      const u = this.url(img.getAttribute("data-cam"), false);
      if (u) img.src = u;
    });
  }

  render() {
    const el = this.host.el;
    const cams = this.cameras();
    if (!cams.length) {
      el.innerHTML = '<div class="ehint">Keine Kameras in deinen Bereichen gefunden. Sobald eine Kamera einem Bereich zugeordnet ist, erscheint sie hier.</div>';
      return;
    }
    const states = this.hass.states;
    el.innerHTML =
      '<div class="phead"><div><div class="ptitle">Kameras</div><div class="cap">Antippen für Live-Bild</div></div></div>' +
      '<div class="camgrid">' +
      cams
        .map((c) => {
          const st = states[c.id];
          const name = shortName(st ? st.attributes.friendly_name : c.id, c.room.name);
          return (
            '<button class="card cam" data-live="' + esc(c.id) + '"><img data-cam="' + esc(c.id) + '" alt="' + esc(name) + '" src="' + esc(this.url(c.id, false)) + '">' +
            '<span class="camname">' + esc(c.room.name) + (name && name !== c.room.name ? " · " + esc(name) : "") + "</span></button>"
          );
        })
        .join("") +
      "</div>" +
      (this.live
        ? '<div class="camlive"><img alt="Live" src="' + esc(this.url(this.live, true)) + '"><button class="round" data-closelive="1" aria-label="Schließen">' + icon("close") + "</button></div>"
        : "");
    Array.prototype.forEach.call(el.querySelectorAll("[data-live]"), (b) => (b.onclick = () => {
      this.live = b.getAttribute("data-live");
      this.render();
    }));
    const cl = el.querySelector("[data-closelive]");
    if (cl)
      cl.onclick = () => {
        this.live = null;
        this.render();
      };
  }
}
