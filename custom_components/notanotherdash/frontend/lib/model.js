// Datenmodell: baut Räume und Stockwerke aus den Registern von Home Assistant.
// Feste Regeln statt Raten:
//  - Ein Gerät/eine Entität gehört zu dem Bereich, der in HA eingetragen ist (Entität vor Gerät).
//  - Ausgeblendet wird, was in HA versteckt ist, eine Entitätskategorie hat oder das Label aus den Einstellungen trägt.
//  - Raumtemperatur und -feuchte kommen aus der Bereichseinstellung in HA; sonst aus dem Thermostat des Raums.
// Reine Funktionen ohne DOM, damit sie sich in Node testen lassen.

export const DEFAULT_HIDE_LABEL = "dashboard_aus";

const WINDOW_CLASSES = ["window", "opening"];
const PRESENCE_CLASSES = ["motion", "occupancy", "presence"];

export function domainOf(entityId) {
  return entityId.slice(0, entityId.indexOf("."));
}

/** Ordnet Entitäten Bereichen zu und sortiert sie in Raum-Gruppen. */
export function buildModel(reg, settings, states) {
  settings = settings || {};
  states = states || {};
  const hideLabel = settings.hide_label || DEFAULT_HIDE_LABEL;
  const hiddenRooms = settings.hidden_rooms || [];
  const deviceArea = {};
  const hiddenDevices = {};
  (reg.devices || []).forEach((d) => {
    deviceArea[d.id] = d.area_id || null;
    if (d.disabled_by || (d.labels || []).indexOf(hideLabel) >= 0) hiddenDevices[d.id] = true;
  });

  const rooms = {};
  (reg.areas || []).forEach((a) => {
    if (hiddenRooms.indexOf(a.area_id) >= 0) return;
    if ((a.labels || []).indexOf(hideLabel) >= 0) return;
    rooms[a.area_id] = {
      id: a.area_id,
      name: a.name,
      floor: a.floor_id || null,
      tempSensor: a.temperature_entity_id || null,
      humSensor: a.humidity_entity_id || null,
      lights: [],
      covers: [],
      climates: [],
      windows: [],
      presence: [],
      cameras: [],
      scenes: [],
      co2: []
    };
  });

  (reg.entities || []).forEach((e) => {
    if (e.disabled_by || e.hidden_by || e.entity_category) return;
    if ((e.labels || []).indexOf(hideLabel) >= 0) return;
    if (e.device_id && hiddenDevices[e.device_id]) return;
    const areaId = e.area_id || (e.device_id ? deviceArea[e.device_id] : null);
    const room = areaId && rooms[areaId];
    if (!room) return;
    const id = e.entity_id;
    const domain = domainOf(id);
    const st = states[id];
    const deviceClass =
      e.device_class || e.original_device_class || (st && st.attributes && st.attributes.device_class) || null;
    if (domain === "light") room.lights.push(id);
    else if (domain === "cover") room.covers.push(id);
    else if (domain === "climate") room.climates.push(id);
    else if (domain === "camera") room.cameras.push(id);
    else if (domain === "scene") room.scenes.push(id);
    else if (domain === "sensor" && deviceClass === "carbon_dioxide") room.co2.push(id);
    else if (domain === "binary_sensor" && deviceClass) {
      if (WINDOW_CLASSES.indexOf(deviceClass) >= 0) room.windows.push(id);
      else if (PRESENCE_CLASSES.indexOf(deviceClass) >= 0) room.presence.push(id);
    }
  });

  const floorsById = {};
  const floors = (reg.floors || []).map((f) => (floorsById[f.floor_id] = { id: f.floor_id, name: f.name, level: f.level, rooms: [] }));
  const noFloor = { id: null, name: floors.length ? "Ohne Stockwerk" : "", level: null, rooms: [] };

  const order = settings.room_order || [];
  const rank = (r) => {
    const i = order.indexOf(r.id);
    return i < 0 ? 9999 : i;
  };
  Object.keys(rooms)
    .map((k) => rooms[k])
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "de"))
    .forEach((r) => (floorsById[r.floor] || noFloor).rooms.push(r));

  // Reihenfolge: Erdgeschoss, dann aufwärts, dann Keller, dann Stockwerke ohne Ebene.
  const sorted = floors.slice().sort((a, b) => floorRank(a.level) - floorRank(b.level));
  const result = sorted.filter((f) => f.rooms.length);
  if (noFloor.rooms.length) result.push(noFloor);
  return { floors: result, rooms: rooms };
}

function floorRank(level) {
  if (level == null) return 50;
  return level >= 0 ? level : 100 - level;
}

/** Alle Entitäten, die eine Raumkachel braucht (für gezielte Aktualisierung). */
export function roomEntities(room) {
  const ids = [].concat(room.lights, room.covers, room.climates, room.windows, room.presence, room.cameras, room.co2);
  if (room.tempSensor) ids.push(room.tempSensor);
  if (room.humSensor) ids.push(room.humSensor);
  return ids;
}

function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

/** Zusammenfassung eines Raums aus den aktuellen Zuständen. */
export function roomSummary(room, states, now) {
  const st = (id) => states[id];
  let temp = room.tempSensor && st(room.tempSensor) ? num(st(room.tempSensor).state) : null;
  const hum = room.humSensor && st(room.humSensor) ? num(st(room.humSensor).state) : null;
  if (temp == null) {
    for (let i = 0; i < room.climates.length; i++) {
      const c = st(room.climates[i]);
      if (c && c.attributes && num(c.attributes.current_temperature) != null) {
        temp = num(c.attributes.current_temperature);
        break;
      }
    }
  }

  const lights = room.lights.map(st).filter(Boolean);
  const lightsOn = lights.filter((s) => s.state === "on").length;

  const positions = room.covers
    .map(st)
    .filter((s) => s && s.attributes && num(s.attributes.current_position) != null)
    .map((s) => num(s.attributes.current_position));
  const coverStates = room.covers.map(st).filter(Boolean);
  let cover = null;
  if (positions.length) {
    const avg = Math.round(positions.reduce((a, b) => a + b, 0) / positions.length);
    cover = avg >= 100 ? "Offen" : avg <= 0 ? "Zu" : avg + " %";
  } else if (coverStates.length) {
    const open = coverStates.filter((s) => s.state === "open").length;
    cover = open === coverStates.length ? "Offen" : open === 0 ? "Zu" : open + "/" + coverStates.length + " offen";
  }

  let heating = false;
  let target = null;
  room.climates.map(st).forEach((c) => {
    if (!c || !c.attributes) return;
    if (c.attributes.hvac_action === "heating") heating = true;
    if (target == null && num(c.attributes.temperature) != null) target = num(c.attributes.temperature);
  });

  const windowsOpen = room.windows.map(st).filter((s) => s && s.state === "on").length;

  let presence = null;
  const pres = room.presence.map(st).filter(Boolean);
  if (pres.some((s) => s.state === "on")) presence = "Jetzt";
  else if (pres.length) {
    const last = Math.max.apply(null, pres.map((s) => Date.parse(s.last_changed) || 0));
    if (last) presence = ago(now - last);
  }

  return {
    temp: temp,
    hum: hum,
    lightsOn: lightsOn,
    lightsTotal: lights.length,
    cover: cover,
    heating: heating,
    target: target,
    windowsOpen: windowsOpen,
    presence: presence,
    cameras: room.cameras.length
  };
}

export function ago(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "gerade";
  if (min < 60) return "vor " + min + " Min.";
  const h = Math.round(min / 60);
  if (h < 24) return "vor " + h + " Std.";
  return "vor " + Math.round(h / 24) + " T.";
}

export function fmtNum(n, digits) {
  if (n == null) return "";
  return n.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Summen für die Chips in der Kopfzeile. */
export function totals(summaries) {
  let lights = 0;
  let heating = 0;
  let windows = 0;
  summaries.forEach((s) => {
    lights += s.lightsOn;
    if (s.heating) heating += 1;
    windows += s.windowsOpen;
  });
  return { lights: lights, heating: heating, windows: windows };
}

const CONDITIONS = {
  "clear-night": "Klar",
  cloudy: "Bewölkt",
  exceptional: "Unwetter",
  fog: "Nebel",
  hail: "Hagel",
  lightning: "Gewitter",
  "lightning-rainy": "Gewitter",
  partlycloudy: "Teils bewölkt",
  pouring: "Starkregen",
  rainy: "Regen",
  snowy: "Schnee",
  "snowy-rainy": "Schneeregen",
  sunny: "Sonnig",
  windy: "Windig",
  "windy-variant": "Windig"
};

export function conditionText(c) {
  return CONDITIONS[c] || "";
}

/** Nächste Termine aus Kalenderereignissen: Titel plus „Heute“, „Morgen“ oder Wochentag. */
export function wasteItems(events, now, max) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return (events || [])
    .map((ev) => {
      const raw = (ev.start && (ev.start.date || ev.start.dateTime)) || ev.start;
      const d = typeof raw === "string" && raw.length === 10 ? new Date(raw + "T00:00:00") : new Date(raw);
      return { title: ev.summary || ev.message || "", date: d };
    })
    .filter((x) => !isNaN(x.date) && x.date >= today)
    .sort((a, b) => a.date - b.date)
    .slice(0, max || 3)
    .map((x) => {
      const day = new Date(x.date);
      day.setHours(0, 0, 0, 0);
      const diff = Math.round((day - today) / 86400000);
      const when =
        diff === 0
          ? "Heute"
          : diff === 1
          ? "Morgen"
          : diff < 7
          ? day.toLocaleDateString("de-DE", { weekday: "long" })
          : day.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
      return { title: x.title, when: when, soon: diff <= 1 };
    });
}

/**
 * Abfahrten aus einer Sensor-Entität. Die Integrationen liefern unterschiedliche Formen;
 * unterstützt wird eine Liste in einem Attribut (departures, next_departures, journeys)
 * mit Linie, Ziel und Abfahrtszeit oder Minuten.
 */
export function departures(stateObj, now, max) {
  if (!stateObj || !stateObj.attributes) return [];
  const a = stateObj.attributes;
  const list = a.departures || a.next_departures || a.journeys || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((d) => {
      const line = d.line || d.number || d.name || d.route || "";
      const to = d.direction || d.destination || d.to || "";
      let minutes = num(d.minutes != null ? d.minutes : d.time_left != null ? d.time_left : d.in);
      const at = d.departure || d.time || d.planned || d.departure_time || d.scheduled;
      if (minutes == null && at) {
        const t = Date.parse(at);
        if (!isNaN(t)) minutes = Math.round((t - now) / 60000);
      }
      const delay = num(d.delay);
      return { line: String(line), to: String(to), minutes: minutes, delay: delay };
    })
    .filter((d) => d.minutes == null || d.minutes >= 0)
    .slice(0, max || 3);
}

// ---------- Raumansicht ----------

export const COVER_SET_POSITION = 4;
export const LIGHT_DIMMABLE_MODES = ["brightness", "color_temp", "hs", "xy", "rgb", "rgbw", "rgbww", "white"];

export function lightInfo(s) {
  const a = (s && s.attributes) || {};
  const modes = a.supported_color_modes || [];
  const dimmable = modes.some((m) => LIGHT_DIMMABLE_MODES.indexOf(m) >= 0);
  const on = !!s && s.state === "on";
  const bri = on && a.brightness != null ? Math.max(1, Math.round((a.brightness / 255) * 100)) : on ? 100 : 0;
  return { on: on, bri: bri, dimmable: dimmable, unavailable: !s || s.state === "unavailable" };
}

export function coverInfo(s) {
  const a = (s && s.attributes) || {};
  const settable = !!((a.supported_features || 0) & COVER_SET_POSITION);
  let pos = num(a.current_position);
  if (pos == null) pos = s && (s.state === "open" || s.state === "opening") ? 100 : 0;
  return {
    pos: pos,
    settable: settable,
    opening: !!s && s.state === "opening",
    closing: !!s && s.state === "closing"
  };
}

/** Mehrere Rollläden als Gruppe: mittlere Position, fährt wenn einer fährt. */
export function coverGroup(list) {
  const infos = list.map(coverInfo);
  const pos = infos.length ? Math.round(infos.reduce((a, i) => a + i.pos, 0) / infos.length) : 0;
  return {
    pos: pos,
    settable: infos.length > 0 && infos.every((i) => i.settable),
    opening: infos.some((i) => i.opening),
    closing: infos.some((i) => i.closing)
  };
}

export function coverText(g) {
  if (g.opening) return "Fährt auf · " + g.pos + " %";
  if (g.closing) return "Fährt zu · " + g.pos + " %";
  return g.pos >= 100 ? "Offen" : g.pos <= 0 ? "Zu" : g.pos + " % offen";
}

const PRESETS = { comfort: "Komfort", eco: "Eco", away: "Abwesend", home: "Zuhause", boost: "Boost", sleep: "Schlafen", activity: "Aktiv", none: "Manuell" };
const HVAC = { auto: "Auto", heat: "Heizen", cool: "Kühlen", heat_cool: "Auto", off: "Aus", dry: "Trocknen", fan_only: "Lüften" };

/** Modus-Chips der Heizung: Presets, wenn das Thermostat welche hat, sonst Betriebsarten. */
export function climateModes(s) {
  const a = (s && s.attributes) || {};
  if (Array.isArray(a.preset_modes) && a.preset_modes.length) {
    return a.preset_modes.slice(0, 4).map((m) => ({ kind: "preset", value: m, label: PRESETS[m] || m, on: a.preset_mode === m }));
  }
  return (a.hvac_modes || []).filter((m) => HVAC[m]).slice(0, 4).map((m) => ({ kind: "hvac", value: m, label: HVAC[m], on: s.state === m }));
}

export function climateRange(s) {
  const a = (s && s.attributes) || {};
  return {
    min: num(a.min_temp) != null ? num(a.min_temp) : 5,
    max: num(a.max_temp) != null ? num(a.max_temp) : 30,
    step: num(a.target_temp_step) || 0.5,
    target: num(a.temperature)
  };
}

export function snap(v, step, min, max) {
  return Math.max(min, Math.min(max, Math.round(v / step) * step));
}

/** Verlauf aus history/history_during_period (kompakte oder volle Antwort) in [Zeit ms, Wert]. */
export function historyPoints(rows, attr) {
  return (rows || [])
    .map((r) => {
      const t = r.lu != null ? r.lu * 1000 : r.lc != null ? r.lc * 1000 : Date.parse(r.last_updated || r.last_changed);
      const raw = attr ? (r.a || r.attributes || {})[attr] : r.s != null ? r.s : r.state;
      return [t, num(raw)];
    })
    .filter((p) => p[1] != null && isFinite(p[0]));
}

/** Pfade für den Temperaturverlauf: Linie, Fläche und Sollwertlinie in einer W×H-Box. */
export function graphPaths(points, target, start, end, W, H) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p[1]).concat(target != null ? [target] : []);
  let lo = Math.min.apply(null, vals) - 0.6;
  let hi = Math.max.apply(null, vals) + 0.6;
  const top = H * 0.16;
  const bottom = H * 0.92;
  const x = (t) => ((Math.max(start, t) - start) / (end - start)) * W;
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const pts = points.map((p) => [x(p[0]), y(p[1])]);
  pts.push([W, pts[pts.length - 1][1]]);
  let line = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const mx = ((p0[0] + p1[0]) / 2).toFixed(1);
    line += " C" + mx + " " + p0[1].toFixed(1) + " " + mx + " " + p1[1].toFixed(1) + " " + p1[0].toFixed(1) + " " + p1[1].toFixed(1);
  }
  const ty = target != null ? y(target).toFixed(1) : null;
  return {
    line: line,
    area: line + " L" + W + " " + H + " L0 " + H + " Z",
    target: ty != null ? "M0 " + ty + " L" + W + " " + ty : ""
  };
}

/** Kurzname eines Geräts im Raum: Raumname vorne abschneiden („Wohnzimmer Decke“ → „Decke“). */
export function shortName(name, roomName) {
  if (!name) return "";
  const n = String(name);
  if (roomName && n.toLowerCase().indexOf(roomName.toLowerCase()) === 0) {
    const rest = n.slice(roomName.length).replace(/^[\s\-–:]+/, "");
    if (rest) return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return n;
}
