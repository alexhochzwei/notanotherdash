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

const WHEEL_PX = 28; // Soll-Rad in der Klima-Übersicht: Pixel je Kelvin

/** Striche des Soll-Rads, mittig um t (viewBox -90…90 × 10), alle 0,5 K, ganze Grad länger. */
function wheelTicks(t) {
  let minor = "";
  let major = "";
  for (let k = Math.ceil((t - 4) * 2) / 2; k <= t + 4; k += 0.5) {
    const x = ((k - t) * WHEEL_PX).toFixed(1);
    if (Math.abs(x) > 90) continue;
    if (k % 1 === 0) major += "M" + x + " 1 L" + x + " 10 ";
    else minor += "M" + x + " 5 L" + x + " 10 ";
  }
  return (
    '<path d="' + (minor || "M0 0") + '" stroke="#f5eee9" stroke-opacity=".3" stroke-width="1.2" vector-effect="non-scaling-stroke"/>' +
    '<path d="' + (major || "M0 0") + '" stroke="#f5eee9" stroke-opacity=".6" stroke-width="1.6" vector-effect="non-scaling-stroke"/>' +
    '<path d="M0 0 L0 10" stroke="#ff9a6b" stroke-width="2" vector-effect="non-scaling-stroke"/>'
  );
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
    // Während am Soll-Rad gezogen wird, nicht neu zeichnen (sonst reißt die Geste ab).
    if (this.drag) {
      this.dirty = true;
      return;
    }
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
          '<div class="ctarget" data-cwheel="' + esc(r.id) + '" aria-label="' + esc(r.name) + ': Solltemperatur ziehen, nach rechts wärmer"><span>Soll</span><b>' + (target != null ? fmtNum(target, 1) + "°" : "–") + "</b>" +
          (target != null ? '<svg class="cticks" viewBox="-90 0 180 10" preserveAspectRatio="none" aria-hidden="true">' + wheelTicks(target) + "</svg>" : "") +
          "</div>" +
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
    q("[data-cwheel]").forEach((w) => this.bindWheel(w, rooms.filter((x) => x.id === w.getAttribute("data-cwheel"))[0]));
    q("[data-allpreset]").forEach((b) => (b.onclick = () => {
      const ids = all.filter((id) => states[id] && (states[id].attributes.preset_modes || []).indexOf(b.getAttribute("data-allpreset")) >= 0);
      this.call("climate", "set_preset_mode", { entity_id: ids, preset_mode: b.getAttribute("data-allpreset") });
      this.host.toast("Alle Räume: " + b.textContent);
    }));
  }

  /** Soll-Rad: waagrecht ziehen, WHEEL_PX px je Kelvin; beim Loslassen einmal senden. */
  bindWheel(w, r) {
    if (!r) return;
    const b = w.querySelector("b");
    const svg = w.querySelector(".cticks");
    w.addEventListener("pointerdown", (e) => {
      const range = climateRange(this.hass.states[r.climates[0]]);
      if (range.target == null && !this.pending[r.id]) return;
      try {
        w.setPointerCapture(e.pointerId);
      } catch (err) {}
      const t0 = this.pending[r.id] ? this.pending[r.id].t : range.target;
      this.drag = { x0: e.clientX, t0: t0, t: t0, range: range, moved: false };
    });
    w.addEventListener("pointermove", (e) => {
      const g = this.drag;
      if (!g) return;
      if (!g.moved && Math.abs(e.clientX - g.x0) < 4) return;
      g.moved = true;
      const raw = Math.max(g.range.min, Math.min(g.range.max, g.t0 + (e.clientX - g.x0) / WHEEL_PX));
      g.t = snap(raw, g.range.step, g.range.min, g.range.max);
      b.textContent = fmtNum(g.t, 1) + "°";
      if (svg) svg.innerHTML = wheelTicks(raw);
    });
    const end = () => {
      const g = this.drag;
      if (!g) return;
      this.drag = null;
      if (g.moved && g.t !== g.t0) {
        this.pending[r.id] = { t: g.t, until: Date.now() + 8000 };
        this.call("climate", "set_temperature", { entity_id: r.climates, temperature: g.t });
        this.host.toast(r.name + ": " + fmtNum(g.t, 1) + "°");
      }
      this.dirty = false;
      this.render();
    };
    w.addEventListener("pointerup", end);
    w.addEventListener("pointercancel", end);
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

// ---------- Szenen ----------

export class ScenesView extends BaseView {
  watched() {
    const m = this.host.model();
    if (!m) return [];
    return roomsWith(m, "scenes").reduce((a, r) => a.concat(r.scenes), []).concat(m.looseScenes || []);
  }

  render() {
    const m = this.host.model();
    const states = this.hass.states;
    const groups = roomsWith(m, "scenes").map((r) => ({ id: r.id, name: r.name, scenes: r.scenes }));
    const loose = ((m && m.looseScenes) || []).filter((id) => states[id]);
    if (loose.length) groups.push({ id: null, name: "Ohne Raum", scenes: loose });
    const el = this.host.el;
    if (!groups.length) {
      el.innerHTML = '<div class="ehint">Keine Szenen gefunden.</div>';
      return;
    }
    const count = groups.reduce((n, g) => n + g.scenes.length, 0);
    el.innerHTML =
      '<div class="phead"><div><div class="ptitle">Szenen</div><div class="cap">' + count + " Szenen</div></div></div>" +
      groups
        .map(
          (g) =>
            '<section class="lroom">' +
            (g.id ? '<button class="cname" data-openroom="' + esc(g.id) + '">' + esc(g.name) + icon("chev") + "</button>" : '<div class="cname">' + esc(g.name) + "</div>") +
            '<div class="scgrid">' +
            g.scenes
              .map((id) => {
                const st = states[id];
                const name = shortName(st ? st.attributes.friendly_name || id : id, g.id ? g.name : "");
                return '<button class="sc" data-scene="' + esc(id) + '"><span class="scic">' + icon("play") + '</span><span class="nm">' + esc(name) + "</span></button>";
              })
              .join("") +
            "</div></section>"
        )
        .join("");
    this.bindRoomLinks();
    Array.prototype.forEach.call(el.querySelectorAll("[data-scene]"), (b) => {
      b.onclick = () => {
        this.call("scene", "turn_on", { entity_id: b.getAttribute("data-scene") });
        b.classList.add("fired");
        setTimeout(() => b.classList.remove("fired"), 900);
        this.host.toast(b.querySelector(".nm").textContent + " aktiviert");
      };
    });
  }
}

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
