// Rechenlogik fürs Energie-Panel, ohne DOM (testbar in Node).
// Gas-Prognose über Heizgradtage: Verbrauch pro Tag = Grundlast + k × max(0, Basis − Tagesmittel außen).

export const HDD_BASE = 15;

export function hdd(mean, base) {
  return Math.max(0, (base == null ? HDD_BASE : base) - mean);
}

function dayKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function startMs(row) {
  return typeof row.start === "number" ? row.start : Date.parse(row.start);
}

/**
 * Tageszeilen aus Recorder-Statistiken (period "day").
 * gas: [{start, change}], temp: [{start, mean}] → [{start, key, gas, temp, hdd}]
 */
export function dailyRows(gasStats, tempStats, base) {
  const temps = {};
  (tempStats || []).forEach((r) => {
    if (r.mean != null && isFinite(r.mean)) temps[dayKey(startMs(r))] = r.mean;
  });
  return (gasStats || [])
    .filter((r) => r.change != null && isFinite(r.change))
    .map((r) => {
      const s = startMs(r);
      const key = dayKey(s);
      const t = key in temps ? temps[key] : null;
      return { start: s, key: key, gas: Math.max(0, r.change), temp: t, hdd: t == null ? null : hdd(t, base) };
    })
    .sort((a, b) => a.start - b.start);
}

/** Lineare Regression gas ~ a + b·hdd (kleinste Quadrate). Braucht mindestens 5 Tage mit Streuung. */
export function regression(rows) {
  const pts = rows.filter((r) => r.hdd != null && r.gas != null);
  if (pts.length < 5) return null;
  const n = pts.length;
  const mx = pts.reduce((a, r) => a + r.hdd, 0) / n;
  const my = pts.reduce((a, r) => a + r.gas, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  pts.forEach((r) => {
    sxy += (r.hdd - mx) * (r.gas - my);
    sxx += (r.hdd - mx) * (r.hdd - mx);
    syy += (r.gas - my) * (r.gas - my);
  });
  if (sxx < 1e-9) return null;
  const slope = sxy / sxx;
  const base = my - slope * mx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { base: base, slope: slope, r2: r2, n: n };
}

/**
 * Robuste Regression: Tage ohne Verbrauch fliegen raus, dann einmal fitten,
 * Ausreißer (Residuum > 2,5 σ) entfernen und neu fitten.
 */
export function robustRegression(rows) {
  const pts = rows.filter((r) => r.hdd != null && r.gas != null && r.gas > 0);
  const first = regression(pts);
  if (!first) return null;
  const res = pts.map((r) => r.gas - (first.base + first.slope * r.hdd));
  const sd = Math.sqrt(res.reduce((a, v) => a + v * v, 0) / res.length);
  if (!(sd > 0)) return Object.assign(first, { excluded: rows.length - pts.length });
  const kept = pts.filter((r, i) => Math.abs(res[i]) <= 2.5 * sd);
  const second = regression(kept) || first;
  return Object.assign(second, { excluded: rows.length - (second === first ? pts.length : kept.length) });
}

/**
 * Modell anpassen. Mit fester Heizgrenze wie gehabt; ohne (auto) wird die Heizgrenze
 * zwischen 12 und 18 °C in 0,5er-Schritten so gewählt, dass R² am größten ist.
 * Ergebnis: { model (mit baseT), rows } – rows mit hdd zur gewählten Heizgrenze.
 */
export function fitModel(gasStats, tempStats, base, before) {
  const cands = base ? [base] : [];
  if (!base) for (let b = 12; b <= 18.001; b += 0.5) cands.push(Math.round(b * 10) / 10);
  // Heizgrenze nach R² der einfachen Regression wählen (Ausreißerfilter würde den Vergleich verzerren),
  // das Modell selbst dann robust anpassen.
  let best = null;
  cands.forEach((b) => {
    const rows = dailyRows(gasStats, tempStats, b);
    const past = before != null ? rows.filter((r) => r.start < before) : rows;
    const m = regression(past.filter((r) => r.gas > 0));
    if (m && (!best || m.r2 > best.r2 + 1e-9)) best = { r2: m.r2, b: b, rows: rows, past: past };
  });
  if (best) {
    const m = robustRegression(best.past);
    if (m) best = { model: Object.assign(m, { baseT: best.b }), rows: best.rows };
    else best = null;
  }
  if (best) return best;
  const fallback = base || HDD_BASE;
  return { model: null, rows: dailyRows(gasStats, tempStats, fallback), baseT: fallback };
}

export function expected(model, hddValue) {
  if (!model || hddValue == null) return null;
  return Math.max(0, model.base + model.slope * hddValue);
}

/** Prognose aus Tagesvorhersagen (temperature/templow): Summe der erwarteten Tage. */
export function forecastSum(model, forecast, days, base) {
  if (!model || !Array.isArray(forecast)) return null;
  const list = forecast.slice(0, days || 7).filter((f) => f && f.temperature != null);
  if (!list.length) return null;
  let sum = 0;
  list.forEach((f) => {
    const mean = f.templow != null ? (f.temperature + f.templow) / 2 : f.temperature;
    sum += expected(model, hdd(mean, base));
  });
  return { sum: sum, days: list.length, mean: list.reduce((a, f) => a + (f.templow != null ? (f.temperature + f.templow) / 2 : f.temperature), 0) / list.length };
}

/** Monatssumme (ab dem 1.) und erwartete Monatssumme für die Tage mit Temperatur. */
export function monthTotals(rows, model, now) {
  const d = new Date(now);
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const inMonth = rows.filter((r) => r.start >= first);
  const actual = inMonth.reduce((a, r) => a + r.gas, 0);
  const withT = inMonth.filter((r) => r.hdd != null);
  const exp = model && withT.length ? withT.reduce((a, r) => a + expected(model, r.hdd), 0) : null;
  const actT = withT.reduce((a, r) => a + r.gas, 0);
  return { actual: actual, expected: exp, deviation: exp ? actT / exp - 1 : null, days: inMonth.length };
}

/** Summe der Stundenwerte (period "hour", change). */
export function sumChange(stats) {
  return (stats || []).reduce((a, r) => a + (r.change != null && isFinite(r.change) ? Math.max(0, r.change) : 0), 0);
}

export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const steps = [1, 2, 2.5, 5, 10];
  for (let i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
  return 10 * p;
}

/** Säulen mit oben abgerundeten Ecken als ein Pfad. */
export function barPath(x, y, w, baseY) {
  const h = baseY - y;
  if (h <= 0.5) return "";
  const r = Math.min(4, h / 2, w / 2);
  return (
    "M" + x.toFixed(1) + " " + baseY + " V" + (y + r).toFixed(1) +
    " Q" + x.toFixed(1) + " " + y.toFixed(1) + " " + (x + r).toFixed(1) + " " + y.toFixed(1) +
    " H" + (x + w - r).toFixed(1) +
    " Q" + (x + w).toFixed(1) + " " + y.toFixed(1) + " " + (x + w).toFixed(1) + " " + (y + r).toFixed(1) +
    " V" + baseY + " Z "
  );
}

// ---------- Stundenwerte und Tagesprognose ----------

const HOUR = 3600000;

function localMidnight(ms, offsetDays) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (offsetDays || 0));
  return d.getTime();
}

/** Stundenwerte (change) nach Startzeit. */
export function hourMap(stats) {
  const m = {};
  (stats || []).forEach((r) => {
    if (r.change != null && isFinite(r.change)) m[startMs(r)] = Math.max(0, r.change);
  });
  return m;
}

/** Mittlerer Verbrauch je Uhrzeit (0–23) aus Stundenwerten vor `before`. */
export function hourProfile(stats, before) {
  const sum = new Array(24).fill(0);
  const cnt = new Array(24).fill(0);
  (stats || []).forEach((r) => {
    const s = startMs(r);
    if (s >= before || r.change == null || !isFinite(r.change)) return;
    const h = new Date(s).getHours();
    sum[h] += Math.max(0, r.change);
    cnt[h]++;
  });
  return sum.map((v, h) => (cnt[h] ? v / cnt[h] : 0));
}

/**
 * Prognose für die restlichen Stunden des Tages.
 * Verteilt `restTotal` (falls angegeben) nach dem Tagesprofil, sonst gilt das Profil selbst.
 * Ergebnis: { [startMs]: Wert } für alle Stunden ab der aktuellen bis Mitternacht.
 */
export function restOfDay(profile, now, restTotal) {
  const out = {};
  const hourStart = Math.floor(now / HOUR) * HOUR;
  const end = localMidnight(now, 1);
  const hours = [];
  for (let t = hourStart; t < end; t += HOUR) hours.push(t);
  const weights = hours.map((t) => profile[new Date(t).getHours()] || 0);
  const wsum = weights.reduce((a, b) => a + b, 0);
  hours.forEach((t, i) => {
    let v = weights[i];
    if (restTotal != null) v = wsum > 0 ? (restTotal * weights[i]) / wsum : restTotal / hours.length;
    out[t] = Math.max(0, v);
  });
  return out;
}

/** Aufteilung mit Rest: parts [{name, value}] gegen Gesamtwert, sortiert, kleine Posten zu „Sonstige“. */
export function breakdown(total, parts, restName, maxItems) {
  const clean = parts.filter((p) => p.value != null && isFinite(p.value) && p.value > 0).sort((a, b) => b.value - a.value);
  const sum = clean.reduce((a, p) => a + p.value, 0);
  let items = clean.slice();
  const limit = maxItems || 6;
  if (items.length > limit) {
    const extra = items.slice(limit - 1).reduce((a, p) => a + p.value, 0);
    items = items.slice(0, limit - 1).concat([{ name: "Weitere Geräte", value: extra }]);
  }
  const rest = total != null && isFinite(total) ? Math.max(0, total - sum) : null;
  if (rest != null && rest > Math.max(sum, total) * 0.005) items.push({ name: restName, value: rest, rest: true });
  const all = rest != null ? Math.max(total, sum) : sum;
  return items.map((p) => Object.assign({}, p, { share: all > 0 ? p.value / all : 0 }));
}
