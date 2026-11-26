// Tests für Anwesenheit, Rückkehrtermin und Zeitplan-Texte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { presenceOf, returnTime, fmtWhen } from "../custom_components/notanotherdash/frontend/lib/model.js";
import { daysText } from "../custom_components/notanotherdash/frontend/lib/vacuum.js";

test("presenceOf versteht Schalter, Personen und Zonen", () => {
  const p = (state) => presenceOf({ state: state });
  assert.equal(p("on"), true);
  assert.equal(p("off"), false);
  assert.equal(p("home"), true);
  assert.equal(p("not_home"), false);
  assert.equal(p("Arbeit"), false);
  assert.equal(p("2"), true);
  assert.equal(p("0"), false);
  assert.equal(p("unavailable"), null);
  assert.equal(presenceOf(null), null);
});

test("returnTime liest input_datetime mit Datum", () => {
  const d = returnTime({ state: "2026-11-27 22:00:00", attributes: { has_date: true, has_time: true, year: 2026, month: 11, day: 27, hour: 22, minute: 0 } });
  assert.equal(d.getDate(), 27);
  assert.equal(d.getHours(), 22);
  assert.equal(returnTime({ state: "22:00:00", attributes: { has_date: false, has_time: true } }), null);
});

test("fmtWhen: heute, morgen, Wochentag", () => {
  const now = new Date(2026, 10, 26, 11, 0); // Donnerstag
  assert.equal(fmtWhen(new Date(2026, 10, 26, 18, 0), now), "heute 18:00");
  assert.equal(fmtWhen(new Date(2026, 10, 27, 22, 0), now), "morgen 22:00");
  assert.equal(fmtWhen(new Date(2026, 10, 29, 9, 5), now), "So 09:05");
});

test("daysText fasst Wochentage zusammen", () => {
  assert.equal(daysText([0, 1, 2, 3, 4, 5, 6]), "täglich");
  assert.equal(daysText([4, 0, 2]), "Mo Mi Fr");
  assert.equal(daysText([0, 1, 2, 3, 4]), "Mo–Fr");
  assert.equal(daysText([]), "nie");
});
