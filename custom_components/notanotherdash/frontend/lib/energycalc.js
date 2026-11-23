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

/**
 * Lineare Regression gas ~ a + b·hdd (gewichtete kleinste Quadrate, Gewicht r.w, Standard 1).
 * Braucht mindestens 5 Tage mit Streuung.
 */
export function regression(rows) {
  const pts = rows.filter((r) => r.hdd != null && r.gas != null);
  if (pts.length < 5) return null;
  const n = pts.length;
  const wt = (r) => (r.w == null ? 1 : r.w);
  const W = pts.reduce((a, r) => a + wt(r), 0);
  if (!(W > 0)) return null;
  const mx = pts.reduce((a, r) => a + wt(r) * r.hdd, 0) / W;
  const my = pts.reduce((a, r) => a + wt(r) * r.gas, 0) / W;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  pts.forEach((r) => {
    const w = wt(r);
    sxy += w * (r.hdd - mx) * (r.gas - my);
    sxx += w * (r.hdd - mx) * (r.hdd - mx);
    syy += w * (r.gas - my) * (r.gas - my);
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
  const wt = (r) => (r.w == null ? 1 : r.w);
  const W = pts.reduce((a, r) => a + wt(r), 0);
  const sd = Math.sqrt(pts.reduce((a, r, i) => a + wt(r) * res[i] * res[i], 0) / W);
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
export function fitModel(gasStats, tempStats, base, before, halfLifeDays, since) {
  // Gewichtung: Tage verlieren mit dem Alter an Gewicht (Halbwertszeit), damit das Modell
  // Änderungen an Heizung/Regelung folgt. Ohne Halbwertszeit zählen alle Tage gleich.
  const ref = before != null ? before : Date.now();
  const weigh = (rows) => {
    if (!halfLifeDays) return rows;
    rows.forEach((r) => {
      r.w = Math.pow(0.5, Math.max(0, (ref - r.start) / 86400000) / halfLifeDays);
    });
    return rows;
  };
  const cands = base ? [base] : [];
  if (!base) for (let b = 12; b <= 18.001; b += 0.5) cands.push(Math.round(b * 10) / 10);
  // Heizgrenze nach R² der einfachen Regression wählen (Ausreißerfilter würde den Vergleich verzerren),
  // das Modell selbst dann robust anpassen.
  let best = null;
  cands.forEach((b) => {
    const rows = weigh(dailyRows(gasStats, tempStats, b));
    const past = rows.filter((r) => (before == null || r.start < before) && (since == null || r.start >= since));
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
  return { model: null, rows: weigh(dailyRows(gasStats, tempStats, fallback)), baseT: fallback };
}

/** Tagesmittel zweier Temperatur-Statistiken zusammenführen: `primary` wo vorhanden, sonst `fallback`. */
export function mergeTemps(primary, fallback) {
  const out = {};
  (fallback || []).forEach((r) => {
    if (r.mean != null && isFinite(r.mean)) out[dayKey(startMs(r))] = r;
  });
  (primary || []).forEach((r) => {
    if (r.mean != null && isFinite(r.mean)) out[dayKey(startMs(r))] = r;
  });
  return Object.keys(out)
    .map((k) => out[k])
    .sort((a, b) => startMs(a) - startMs(b));
}

/**
 * Tagesprognose aus Modell und bisherigem Verlauf mischen.
 * done: Anteil des typischen Tagesverbrauchs, der bis jetzt üblicherweise schon angefallen ist (0…1).
 * Hochrechnung = bisher / done; Gewicht der Hochrechnung wächst mit done.
 */
export function blendToday(modelExp, actual, done) {
  if (actual == null || !isFinite(actual)) return modelExp;
  const p = Math.max(0, Math.min(1, done || 0));
  if (modelExp == null) return p > 0.15 ? actual / p : null;
  if (p < 0.05) return Math.max(modelExp, actual);
  const runRate = actual / p;
  return Math.max(actual, (1 - p) * modelExp + p * runRate);
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
export function monthTotals(rows, model, now, since) {
  const d = new Date(now);
  // Abweichung nur über Tage, für die das Modell gilt (ab Stichtag).
  const first = Math.max(new Date(d.getFullYear(), d.getMonth(), 1).getTime(), since || 0);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const actual = rows.filter((r) => r.start >= monthStart).reduce((a, r) => a + r.gas, 0);
  const inMonth = rows.filter((r) => r.start >= first);
  // Abweichung nur über volle Tage (heute ist noch nicht vorbei), frühestens ab 3 Tagen.
  const withT = inMonth.filter((r) => r.hdd != null && r.start < todayStart);
  const exp = model && withT.length ? withT.reduce((a, r) => a + expected(model, r.hdd), 0) : null;
  const actT = withT.reduce((a, r) => a + r.gas, 0);
  return { actual: actual, expected: exp, deviation: exp && withT.length >= 3 ? actT / exp - 1 : null, days: inMonth.length };
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

// ---------- Korrektur alter Gasdaten (Prellen des Impulszählers) ----------

/**
 * Korrekturen normalisieren: [{ until: "2026-10-24T05:56", factor: 1.62 }, …] → [{ until: ms, factor }],
 * aufsteigend sortiert. Für einen Zeitpunkt gilt der Faktor des ersten Eintrags mit t < until, danach 1.
 */
export function parseCorrections(list) {
  return (list || [])
    .map((c) => ({ until: typeof c.until === "number" ? c.until : Date.parse(c.until), factor: Number(c.factor) }))
    .filter((c) => isFinite(c.until) && c.factor > 0)
    .sort((a, b) => a.until - b.until);
}

export function factorAt(corr, t) {
  for (let i = 0; i < corr.length; i++) if (t < corr[i].until) return corr[i].factor;
  return 1;
}

/** Stundenwerte korrigieren: change / Faktor zum Stundenbeginn (Grenzstunde anteilig). */
export function correctHours(stats, corr) {
  if (!corr.length) return stats;
  return (stats || []).map((r) => {
    if (r.change == null) return r;
    const s = startMs(r);
    const e = s + 3600000;
    let v = 0;
    // Stunde an den Grenzen zeitanteilig aufteilen.
    let a = s;
    corr.concat([{ until: Infinity, factor: 1 }]).forEach((c) => {
      if (a >= e || c.until <= a) return;
      const b = Math.min(e, c.until);
      v += (r.change * (b - a)) / 3600000 / factorAt(corr, a);
      a = b;
    });
    return Object.assign({}, r, { change: v });
  });
}

/**
 * Tageswerte korrigieren. Tage komplett vor einer Grenze: change / Faktor. Tage mit einer Grenze:
 * aus den Stundenwerten dieses Tages (boundaryHours) neu summieren, ohne Stundenwerte zeitanteilig.
 */
export function correctDays(stats, corr, boundaryHours) {
  if (!corr.length) return stats;
  const hours = correctHours(boundaryHours || [], corr);
  return (stats || []).map((r) => {
    if (r.change == null) return r;
    const s = startMs(r);
    const e = s + 86400000;
    const crosses = corr.some((c) => c.until > s && c.until < e);
    if (!crosses) return Object.assign({}, r, { change: r.change / factorAt(corr, s) });
    const hs = hours.filter((h) => startMs(h) >= s && startMs(h) < e && h.change != null);
    if (hs.length) return Object.assign({}, r, { change: hs.reduce((a, h) => a + h.change, 0) });
    let v = 0;
    let a = s;
    corr.concat([{ until: Infinity, factor: 1 }]).forEach((c) => {
      if (a >= e || c.until <= a) return;
      const b = Math.min(e, c.until);
      v += (r.change * (b - a)) / 86400000 / factorAt(corr, a);
      a = b;
    });
    return Object.assign({}, r, { change: v });
  });
}
