import { test } from "node:test";
import assert from "node:assert/strict";
import { hdd, dailyRows, regression, expected, forecastSum, monthTotals, sumChange, niceMax } from "../custom_components/notanotherdash/frontend/lib/energycalc.js";
import { parseRooms, hoursLeft } from "../custom_components/notanotherdash/frontend/lib/vacuum.js";

const day = (n) => new Date(2026, 10, n).getTime();

test("Heizgradtage", () => {
  assert.equal(hdd(5), 10);
  assert.equal(hdd(20), 0);
  assert.equal(hdd(5, 12), 7);
});

test("Tageszeilen verbinden Gas und Temperatur", () => {
  const rows = dailyRows(
    [{ start: day(2), change: 30 }, { start: day(1), change: 20 }, { start: day(3), change: null }],
    [{ start: day(1), mean: 10 }, { start: new Date(day(2)).toISOString(), mean: 5 }]
  );
  assert.deepEqual(rows.map((r) => [r.gas, r.temp, r.hdd]), [[20, 10, 5], [30, 5, 10]]);
});

test("Regression findet Grundlast und Steigung", () => {
  const rows = [0, 2, 4, 6, 8, 10].map((h, i) => ({ start: day(i + 1), gas: 8 + 3 * h, hdd: h }));
  const m = regression(rows);
  assert.ok(Math.abs(m.base - 8) < 1e-9);
  assert.ok(Math.abs(m.slope - 3) < 1e-9);
  assert.ok(Math.abs(m.r2 - 1) < 1e-9);
  assert.equal(expected(m, 5), 23);
  assert.equal(regression(rows.slice(0, 4)), null);
});

test("Prognose aus Wettervorhersage", () => {
  const m = { base: 8, slope: 3 };
  const f = forecastSum(m, [{ temperature: 7, templow: 3 }, { temperature: 5 }], 7);
  assert.equal(f.days, 2);
  assert.equal(f.sum, 8 + 3 * 10 + 8 + 3 * 10);
  assert.equal(forecastSum(null, [], 7), null);
});

test("Monatssumme und Abweichung", () => {
  const m = { base: 10, slope: 0 };
  const rows = [{ start: new Date(2026, 9, 31).getTime(), gas: 99, hdd: 1 }];
  for (let i = 1; i <= 4; i++) rows.push({ start: day(i), gas: 9, hdd: 2 });
  rows.push({ start: day(5), gas: 3, hdd: 2 }); // heute, angebrochen
  const t = monthTotals(rows, m, day(5) + 3600000);
  assert.equal(t.actual, 39); // ganzer Monat inkl. heute
  assert.equal(t.expected, 40); // nur volle Tage
  assert.ok(Math.abs(t.deviation + 0.1) < 1e-9);
  // Stichtag: Abweichung erst ab Stichtag, Summe trotzdem ganzer Monat
  const s = monthTotals(rows, m, day(5) + 3600000, day(3));
  assert.equal(s.actual, 39);
  assert.equal(s.deviation, null); // nur 2 volle Tage ab Stichtag
});

test("Hilfsfunktionen", () => {
  assert.equal(sumChange([{ change: 1.5 }, { change: -1 }, { change: null }, { change: 2 }]), 3.5);
  assert.equal(niceMax(43), 50);
  assert.equal(niceMax(0.7), 1);
});

test("Roborock-Räume aus get_maps", () => {
  const resp = { "vacuum.robbi": { maps: [{ flag: 0, name: "EG", rooms: { "16": "Wohnzimmer", "17": "Küche" } }] } };
  assert.deepEqual(parseRooms(resp), [{ id: "16", name: "Wohnzimmer" }, { id: "17", name: "Küche" }]);
  assert.deepEqual(parseRooms(null), []);
});

test("Restlaufzeit in Stunden", () => {
  assert.equal(hoursLeft({ state: "7200", attributes: { unit_of_measurement: "s" } }), 2);
  assert.equal(hoursLeft({ state: "90", attributes: { unit_of_measurement: "min" } }), 1.5);
  assert.equal(hoursLeft({ state: "unknown", attributes: {} }), null);
});

import { calibrate, segmentList } from "../custom_components/notanotherdash/frontend/lib/vacuum.js";

test("Kalibrierung Roborock → Bildpixel (Map-Card-Format)", () => {
  const tf = calibrate([
    { vacuum: { x: 25500, y: 25500 }, map: { x: 448, y: 976 } },
    { vacuum: { x: 35500, y: 25500 }, map: { x: 1248, y: 976 } },
    { vacuum: { x: 25500, y: 35500 }, map: { x: 448, y: 176 } }
  ]);
  const p = tf(30500, 30500);
  assert.ok(Math.abs(p[0] - 848) < 1e-6 && Math.abs(p[1] - 576) < 1e-6);
  assert.equal(calibrate([]), null);
});

test("Raumliste: Namen aus Bereichs-Zuordnung, sonst eigener Name oder Nummer", () => {
  const segs = segmentList(
    { rooms: { "16": { number: 16, name: "Unknown", x0: 1, y0: 2, x1: 3, y1: 4 }, "17": { number: 17, name: "Badezimmer" }, "18": { number: 18, name: "Unknown" } } },
    { wohn: "16" },
    [{ area_id: "wohn", name: "Wohnzimmer" }]
  );
  assert.deepEqual(segs.map((g) => [g.id, g.name]), [["17", "Badezimmer"], ["18", "Raum 18"], ["16", "Wohnzimmer"]]);
  assert.deepEqual(segmentList(null, { wohn: "16" }, [{ area_id: "wohn", name: "Wohnzimmer" }]).map((g) => g.id), ["16"]);
});

import { fitModel, robustRegression } from "../custom_components/notanotherdash/frontend/lib/energycalc.js";

test("robustRegression ignoriert Ausreißer und Nulltage", () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ hdd: i % 12, gas: 10 + 3 * (i % 12) });
  rows.push({ hdd: 5, gas: 200 }); // Ausreißer
  rows.push({ hdd: 6, gas: 0 }); // Lücke
  const m = robustRegression(rows);
  assert.ok(Math.abs(m.slope - 3) < 0.01);
  assert.ok(Math.abs(m.base - 10) < 0.05);
  assert.equal(m.excluded, 2);
});

test("fitModel lernt die Heizgrenze", () => {
  const day = 86400000;
  const gas = [];
  const temp = [];
  for (let i = 0; i < 60; i++) {
    const t = -2 + (i % 20);
    const start = Date.UTC(2026, 0, 1) + i * day;
    temp.push({ start: start, mean: t });
    gas.push({ start: start, change: 8 + 2.5 * Math.max(0, 16 - t) });
  }
  const fit = fitModel(gas, temp, null);
  assert.equal(fit.model.baseT, 16);
  assert.ok(fit.model.r2 > 0.999);
  assert.equal(fitModel(gas, temp, 15).model.baseT, 15);
});

import { blendToday, mergeTemps } from "../custom_components/notanotherdash/frontend/lib/energycalc.js";

test("Gewichtung folgt neueren Tagen", () => {
  const day = 86400000;
  const now = Date.UTC(2026, 10, 23);
  const gas = [];
  const temp = [];
  for (let i = 120; i >= 1; i--) {
    const start = now - i * day;
    const t = 2 + (i % 10);
    temp.push({ start: start, mean: t });
    const slope = i > 20 ? 3 : 1.5; // früher doppelt so viel je Heizgradtag
    gas.push({ start: start, change: 5 + slope * Math.max(0, 15 - t) });
  }
  const flat = fitModel(gas, temp, 15, now);
  const w = fitModel(gas, temp, 15, now, 7);
  assert.ok(flat.model.slope > 2.5);
  assert.ok(Math.abs(w.model.slope - 1.5) < 0.4);
});

test("blendToday mischt Modell und Ist", () => {
  assert.equal(blendToday(28, 0, 0), 28);
  assert.ok(Math.abs(blendToday(28, 5, 0.5) - 19) < 1e-9);
  assert.ok(blendToday(28, 30, 0.9) >= 30);
  assert.equal(blendToday(null, 6, 0.5), 12);
});

test("mergeTemps bevorzugt den ersten Sensor", () => {
  const a = [{ start: 1000, mean: 1 }];
  const b = [{ start: 1000, mean: 5 }, { start: 1000 + 86400000, mean: 6 }];
  const m = mergeTemps(a, b);
  assert.equal(m.length, 2);
  assert.equal(m[0].mean, 1);
});
