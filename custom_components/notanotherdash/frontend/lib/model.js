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
      cameras: []
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
  const ids = [].concat(room.lights, room.covers, room.climates, room.windows, room.presence, room.cameras);
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
