// Tests für das Datenmodell: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildModel,
  roomSummary,
  totals,
  wasteItems,
  departures
} from "../custom_components/notanotherdash/frontend/lib/model.js";

const reg = {
  floors: [
    { floor_id: "og", name: "Obergeschoss", level: 1 },
    { floor_id: "eg", name: "Erdgeschoss", level: 0 },
    { floor_id: "ug", name: "Keller", level: -1 }
  ],
  areas: [
    { area_id: "wohn", name: "Wohnzimmer", floor_id: "eg", temperature_entity_id: "sensor.wohn_temp", humidity_entity_id: "sensor.wohn_hum" },
    { area_id: "bad", name: "Bad", floor_id: "og" },
    { area_id: "keller", name: "Keller", floor_id: "ug" },
    { area_id: "garten", name: "Garten" },
    { area_id: "geheim", name: "Abstellraum", labels: ["dashboard_aus"] }
  ],
  devices: [
    { id: "d1", area_id: "wohn" },
    { id: "d2", area_id: "bad" },
    { id: "d3", area_id: "wohn", labels: ["dashboard_aus"] }
  ],
  entities: [
    { entity_id: "light.decke", device_id: "d1" },
    { entity_id: "light.steh", area_id: "wohn" },
    { entity_id: "light.versteckt", area_id: "wohn", hidden_by: "user" },
    { entity_id: "sensor.diag", device_id: "d1", entity_category: "diagnostic" },
    { entity_id: "light.label", area_id: "wohn", labels: ["dashboard_aus"] },
    { entity_id: "light.geraet_aus", device_id: "d3" },
    { entity_id: "cover.sued", area_id: "wohn" },
    { entity_id: "cover.west", area_id: "wohn" },
    { entity_id: "climate.bad", device_id: "d2" },
    { entity_id: "binary_sensor.fenster_bad", device_id: "d2" },
    { entity_id: "binary_sensor.bewegung_bad", device_id: "d2", original_device_class: "motion" },
    { entity_id: "light.bad", device_id: "d2", area_id: "wohn" },
    { entity_id: "camera.garten", area_id: "garten" }
  ]
};

const states = {
  "sensor.wohn_temp": { state: "21.44", attributes: {} },
  "sensor.wohn_hum": { state: "47.6", attributes: {} },
  "light.decke": { state: "on", attributes: {} },
  "light.steh": { state: "off", attributes: {} },
  "light.bad": { state: "on", attributes: {} },
  "cover.sued": { state: "open", attributes: { current_position: 30 } },
  "cover.west": { state: "open", attributes: { current_position: 50 } },
  "climate.bad": { state: "heat", attributes: { current_temperature: 22.3, temperature: 23, hvac_action: "heating" } },
  "binary_sensor.fenster_bad": { state: "on", attributes: { device_class: "window" } },
  "binary_sensor.bewegung_bad": { state: "off", last_changed: new Date(Date.now() - 5 * 60000).toISOString(), attributes: {} },
  "camera.garten": { state: "idle", attributes: {} }
};

test("Stockwerke: Erdgeschoss, aufwärts, Keller, ohne Stockwerk zuletzt", () => {
  const m = buildModel(reg, {}, states);
  assert.deepEqual(m.floors.map((f) => f.name), ["Erdgeschoss", "Obergeschoss", "Keller", "Ohne Stockwerk"]);
});

test("Zuordnung: Entitäts-Bereich vor Geräte-Bereich, Ausblenden per HA und Label", () => {
  const m = buildModel(reg, {}, states);
  assert.deepEqual(m.rooms.wohn.lights.sort(), ["light.bad", "light.decke", "light.steh"]);
  assert.equal(m.rooms.geheim, undefined);
  assert.deepEqual(m.rooms.bad.windows, ["binary_sensor.fenster_bad"]);
  assert.deepEqual(m.rooms.bad.presence, ["binary_sensor.bewegung_bad"]);
});

test("Räume per Einstellung ausblenden und sortieren", () => {
  const m = buildModel(reg, { hidden_rooms: ["keller"], room_order: ["garten"] }, states);
  assert.equal(m.rooms.keller, undefined);
  assert.equal(m.floors.length, 3);
});

test("Zusammenfassung Wohnzimmer", () => {
  const m = buildModel(reg, {}, states);
  const s = roomSummary(m.rooms.wohn, states, Date.now());
  assert.equal(s.temp, 21.44);
  assert.equal(s.hum, 47.6);
  assert.equal(s.lightsOn, 2);
  assert.equal(s.lightsTotal, 3);
  assert.equal(s.cover, "40 %");
});

test("Zusammenfassung Bad: Temperatur aus Thermostat, heizt, Fenster offen, Bewegung", () => {
  const m = buildModel(reg, {}, states);
  const s = roomSummary(m.rooms.bad, states, Date.now());
  assert.equal(s.temp, 22.3);
  assert.equal(s.heating, true);
  assert.equal(s.target, 23);
  assert.equal(s.windowsOpen, 1);
  assert.equal(s.presence, "vor 5 Min.");
  const t = totals([roomSummary(m.rooms.wohn, states, Date.now()), s]);
  assert.deepEqual(t, { lights: 2, heating: 1, windows: 1 });
});

test("Müllkalender: Heute, Morgen, sortiert, Vergangenes weg", () => {
  const now = new Date(2026, 10, 13, 9, 0).getTime();
  const items = wasteItems(
    [
      { summary: "Restmüll", start: { date: "2026-11-17" } },
      { summary: "Gelber Sack", start: { date: "2026-11-14" } },
      { summary: "Alt", start: { date: "2026-11-10" } },
      { summary: "Papier", start: { dateTime: "2026-11-13T06:00:00+01:00" } }
    ],
    now,
    3
  );
  assert.deepEqual(items.map((i) => [i.title, i.when]), [["Papier", "Heute"], ["Gelber Sack", "Morgen"], ["Restmüll", "Dienstag"]]);
});

test("Abfahrten aus Minuten und aus Zeitstempeln", () => {
  const now = Date.parse("2026-11-13T09:00:00Z");
  const a = departures({ attributes: { departures: [{ line: "U5", direction: "Killesberg", minutes: 4 }] } }, now, 3);
  assert.deepEqual(a, [{ line: "U5", to: "Killesberg", minutes: 4, delay: null }]);
  const b = departures({ attributes: { next_departures: [{ number: "42", destination: "Hbf", departure: "2026-11-13T09:07:00Z", delay: 2 }] } }, now, 3);
  assert.equal(b[0].minutes, 7);
  assert.equal(b[0].delay, 2);
  assert.deepEqual(departures({ attributes: {} }, now, 3), []);
});
