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
  const rows = [{ start: new Date(2026, 9, 31).getTime(), gas: 99, hdd: 1 }, { start: day(1), gas: 9, hdd: 2 }, { start: day(2), gas: 9, hdd: 2 }];
  const t = monthTotals(rows, m, day(2));
  assert.equal(t.actual, 18);
  assert.equal(t.expected, 20);
  assert.ok(Math.abs(t.deviation + 0.1) < 1e-9);
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
