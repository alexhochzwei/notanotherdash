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
