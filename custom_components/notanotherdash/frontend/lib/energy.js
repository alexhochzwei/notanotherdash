// Energie-Panel: Gas mit Prognose aus der Außentemperatur, Strom heute.
// Daten aus den Langzeit-Statistiken des Recorders (keine eigene Speicherung).

import { fmtNum } from "./model.js";
import { dailyRows, regression, expected, forecastSum, monthTotals, sumChange, niceMax, barPath, hdd } from "./energycalc.js";

const DAYS = 30;
const REFRESH_MS = 10 * 60000;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function midnight(ms, offsetDays) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (offsetDays || 0));
  return d.getTime();
}

export class EnergyView {
  constructor(host) {
    // host: { el, hass(), settings(), forecast(), toast() }
    this.host = host;
    this.data = null;
    this.hover = null;
    this.loading = false;
  }

  get hass() {
    return this.host.hass();
  }

  show() {
    this.render();
    this.load();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.load(), REFRESH_MS);
  }

  hide() {
    clearInterval(this.timer);
    this.timer = null;
  }

  watched() {
    const p = this.host.settings().power_entity;
    return p ? [p] : [];
  }

  async stats(ids, period, start, end, types) {
    if (!ids.length) return {};
    try {
      return await this.hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        statistic_ids: ids,
        period: period,
        types: types
      });
    } catch (e) {
      return {};
    }
  }

  /** Preise aus den Energie-Einstellungen von HA: fester Preis oder Preis-Entität, je Zähler. */
  async prices(gas, el) {
    try {
      const prefs = await this.hass.callWS({ type: "energy/get_prefs" });
      const out = {};
      const states = this.hass.states;
      (prefs.energy_sources || []).forEach((src) => {
        let price = src.number_energy_price;
        if (src.entity_energy_price && states[src.entity_energy_price]) {
          const v = parseFloat(states[src.entity_energy_price].state);
          if (isFinite(v)) price = v;
        }
        if (price == null || !isFinite(price)) return;
        if (src.type === "gas" && src.stat_energy_from === gas) out.gas = price;
        if (src.type === "grid" && src.stat_energy_from === el) out.el = price;
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  async load() {
    const st = this.host.settings();
    if (this.loading) return;
    this.loading = true;
    const now = Date.now();
    const gas = st.gas_entity;
    const temp = st.outdoor_temp_entity;
    const el = st.electricity_entity;
    const r = await Promise.all([
      this.stats(gas ? [gas] : [], "day", midnight(now, -DAYS), now, ["change"]),
      this.stats(temp ? [temp] : [], "day", midnight(now, -DAYS), now, ["mean"]),
      this.stats(el ? [el] : [], "hour", midnight(now), now, ["change"]),
      this.stats(el ? [el] : [], "hour", midnight(now, -1), now - 86400000, ["change"]),
      this.prices(gas, el)
    ]);
    this.loading = false;
    this.data = {
      gas: gas ? r[0][gas] || [] : [],
      temp: temp ? r[1][temp] || [] : [],
      elToday: el ? r[2][el] || [] : [],
      elYesterday: el ? r[3][el] || [] : [],
      prices: r[4] || {},
      at: now
    };
    this.render();
  }

  render() {
    const st = this.host.settings();
    const el = this.host.el;
    if (!st.gas_entity && !st.electricity_entity && !st.power_entity) {
      el.innerHTML =
        '<div class="ehint">Wähle in den Einstellungen unter „Energie &amp; Sauger“ deinen Gaszähler, Stromzähler und die Außentemperatur. Das Zahnrad unten rechts gedrückt halten.</div>';
      return;
    }
    const states = this.hass.states;
    const gasUnit = st.gas_entity && states[st.gas_entity] ? states[st.gas_entity].attributes.unit_of_measurement || "" : "";
    const d = this.data || { gas: [], temp: [], elToday: [], elYesterday: [] };
    const base = st.hdd_base || 15;
    const rows = dailyRows(d.gas, d.temp, base);
    const todayStart = midnight(Date.now());
    const past = rows.filter((x) => x.start < todayStart);
    const today = rows.filter((x) => x.start >= todayStart)[0] || null;
    const model = regression(past);
    const month = monthTotals(rows, model, Date.now());
    const fc = forecastSum(model, this.host.forecast(), 7, base);

    const power = st.power_entity && states[st.power_entity] ? parseFloat(states[st.power_entity].state) : null;
    const powerUnit = st.power_entity && states[st.power_entity] ? states[st.power_entity].attributes.unit_of_measurement || "W" : "W";
    const elT = sumChange(d.elToday);
    const elY = sumChange(d.elYesterday);
    const elUnit = st.electricity_entity && states[st.electricity_entity] ? states[st.electricity_entity].attributes.unit_of_measurement || "kWh" : "kWh";

    const pr = d.prices || {};
    const eur = (amount, price, unit) =>
      price != null && amount != null && isFinite(amount)
        ? '<div class="eur">' + fmtNum(amount * price, 2) + " €<small>" + fmtNum(price, price < 1 ? 3 : 2) + " €/" + esc(unit) + "</small></div>"
        : "";
    const kpi = (cap, val, unit, sub, cost) =>
      '<div class="card kpi"><div class="cap">' + cap + '</div><div class="v">' + val + "<small>" + esc(unit) + "</small></div>" + (cost || "") + '<div class="s">' + sub + "</div></div>";
    const expToday = today && today.hdd != null ? expected(model, today.hdd) : null;
    let devTxt = "";
    if (month.deviation != null) {
      const p = Math.round(month.deviation * 100);
      devTxt = Math.abs(p) + " % " + (p <= 0 ? "unter" : "über") + " Erwartung";
    }
    const monthName = new Date().toLocaleDateString("de-DE", { month: "long" });

    el.innerHTML =
      '<div class="ekpis">' +
      (st.gas_entity
        ? kpi("Gas heute", today ? fmtNum(today.gas, 1) : "–", gasUnit, expToday != null ? "Erwartet " + fmtNum(expToday, 1) + " " + esc(gasUnit) + (today.temp != null ? " bei " + fmtNum(today.temp, 1) + "°" : "") : "Noch keine Prognose", eur(today ? today.gas : null, pr.gas, gasUnit)) +
          kpi("Gas " + monthName, fmtNum(month.actual, 0), gasUnit, devTxt || "Erwartung braucht 5 Tage Verlauf", eur(month.actual, pr.gas, gasUnit))
        : "") +
      (st.electricity_entity ? kpi("Strom heute", fmtNum(elT, 1), elUnit, d.elYesterday.length ? "Gestern um diese Zeit " + fmtNum(elY, 1) + " " + esc(elUnit) : "", eur(elT, pr.el, elUnit)) : "") +
      (st.power_entity ? kpi("Strom jetzt", power != null && isFinite(power) ? fmtNum(power, 0) : "–", powerUnit, "") : "") +
      "</div>" +
      (st.gas_entity
        ? '<div class="erow"><div class="card echart">' + this.gasChart(rows, model, gasUnit) + "</div>" +
          '<div class="card escatter">' + this.scatter(past, model, gasUnit) + "</div></div>"
        : "") +
      '<div class="erow">' +
      (st.electricity_entity ? '<div class="card ebars">' + this.elChart(d.elToday, elUnit) + "</div>" : "<div></div>") +
      (st.gas_entity
        ? '<div class="card efc"><div class="ctitle">Prognose nächste ' + (fc ? fc.days : 7) + ' Tage</div><div class="v">' +
          (fc ? "~ " + fmtNum(fc.sum, 0) + "<small>" + esc(gasUnit) + " Gas</small>" : "–") +
          "</div>" + (fc && pr.gas != null ? '<div class="eur">~ ' + fmtNum(fc.sum * pr.gas, 0) + " €</div>" : "") + '<div class="cap">' + (fc ? "Aus Wettervorhersage, Ø " + fmtNum(fc.mean, 0) + "° außen" : "Braucht Wettervorhersage und 5 Tage Verlauf") + "</div></div>"
        : "") +
      "</div>";
    this.bind(rows, model, gasUnit);
  }

  gasChart(rows, model, unit) {
    const W = 600;
    const H = 180;
    const x0 = 0;
    const n = Math.max(rows.length, 1);
    const slot = W / n;
    const bw = Math.max(2, slot - 5);
    // Vier gleiche, runde Schritte für die Gitterlinien.
    const maxV = 4 * niceMax(Math.max.apply(null, rows.map((r) => Math.max(r.gas, expected(model, r.hdd) || 0)).concat([1])) / 4);
    const base = H - 1;
    const gy = (v) => base - (v / maxV) * (H - 8);
    let bars = "";
    let exp = "";
    rows.forEach((r, i) => {
      const x = x0 + i * slot + (slot - bw) / 2;
      bars += barPath(x, gy(r.gas), bw, base);
      const e = expected(model, r.hdd);
      if (e != null) exp += (exp ? " L" : "M") + (x + bw / 2).toFixed(1) + " " + gy(e).toFixed(1);
    });
    const temps = rows.filter((r) => r.temp != null);
    let tLine = "";
    let tMin = 0;
    let tMax = 10;
    if (temps.length) {
      tMin = Math.floor(Math.min.apply(null, temps.map((r) => r.temp)) - 1);
      tMax = Math.ceil(Math.max.apply(null, temps.map((r) => r.temp)) + 1);
      const ty = (t) => 76 - ((t - tMin) / (tMax - tMin)) * 68;
      rows.forEach((r, i) => {
        if (r.temp == null) return;
        tLine += (tLine ? " L" : "M") + (i * slot + slot / 2).toFixed(1) + " " + ty(r.temp).toFixed(1);
      });
    }
    const hi = this.hover != null && rows[this.hover] ? this.hover : null;
    const hiBar = hi != null ? "M" + (hi * slot).toFixed(1) + " 0 h" + slot.toFixed(1) + " v" + H + " h" + (-slot).toFixed(1) + " Z" : "";
    const grid = [0.25, 0.5, 0.75].map((f) => "M0 " + (base - f * (H - 8)).toFixed(1) + " H" + W).join(" ");
    let tip = "";
    if (hi != null) {
      const r = rows[hi];
      const e = expected(model, r.hdd);
      const left = ((hi + 0.5) / n) * 100;
      tip =
        '<div class="tip" style="' + (left > 70 ? "right:" + (100 - left + 3) + "%" : "left:" + (left + 3) + "%") + '"><b>' +
        new Date(r.start).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" }) +
        "</b><br>Verbrauch " + fmtNum(r.gas, 1) + " " + esc(unit) +
        (e != null ? "<br>Erwartet " + fmtNum(e, 1) + " " + esc(unit) : "") +
        (r.temp != null ? "<br>Außen " + fmtNum(r.temp, 1) + "°" : "") + "</div>";
    }
    const first = rows[0] ? new Date(rows[0].start).toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : "";
    const mid = rows[Math.floor(rows.length / 2)] ? new Date(rows[Math.floor(rows.length / 2)].start).toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : "";
    return (
      '<div class="chead"><div class="ctitle">Gasverbrauch pro Tag</div><div class="leg"><span><i class="sw2" style="background:#e0683a"></i>Verbrauch</span>' +
      (model ? '<span><i class="dash"></i>Erwartet aus Außentemperatur</span>' : "") + "</div></div>" +
      '<div class="plot"><div class="yax"><span>' + fmtNum(maxV, 0) + "</span><span>" + fmtNum(maxV * 0.75, 0) + "</span><span>" + fmtNum(maxV * 0.5, 0) + "</span><span>" + fmtNum(maxV * 0.25, 0) + "</span><span>0</span></div>" +
      '<div class="pwrap"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Gasverbrauch der letzten Tage">' +
      '<path d="' + grid + '" stroke="rgba(245,238,233,.08)" vector-effect="non-scaling-stroke"/>' +
      '<path d="M0 ' + base + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' +
      (hiBar ? '<path d="' + hiBar + '" fill="rgba(245,238,233,.07)"/>' : "") +
      '<path d="' + (bars || "M0 0") + '" fill="#e0683a"/>' +
      (exp ? '<path d="' + exp + '" fill="none" stroke="#f5eee9" stroke-opacity=".8" stroke-width="2" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>' : "") +
      "</svg>" +
      '<div class="hov">' + rows.map((r, i) => '<span data-day="' + i + '"></span>').join("") + "</div>" + tip + "</div></div>" +
      (temps.length
        ? '<div class="chead small"><i class="sw2" style="background:#5a86e8"></i><span class="cap">Außentemperatur, Tagesmittel</span><span class="cap" style="margin-left:auto">' + tMin + "° bis " + tMax + "°</span></div>" +
          '<div class="pwrap t"><svg viewBox="0 0 ' + W + ' 80" preserveAspectRatio="none" aria-hidden="true">' +
          (tMin < 0 && tMax > 0 ? '<path d="M0 ' + (76 - ((0 - tMin) / (tMax - tMin)) * 68).toFixed(1) + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' : "") +
          '<path d="' + tLine + '" fill="none" stroke="#5a86e8" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>'
        : "") +
      '<div class="xax"><span>' + first + "</span><span>" + mid + "</span><span>heute</span></div>"
    );
  }

  scatter(rows, model, unit) {
    const pts = rows.filter((r) => r.hdd != null);
    const W = 284;
    const H = 190;
    const maxX = Math.max(10, Math.ceil(Math.max.apply(null, pts.map((r) => r.hdd).concat([0])) / 2) * 2);
    const maxY = niceMax(Math.max.apply(null, pts.map((r) => r.gas).concat([1])));
    const sx = (h) => 24 + (h / maxX) * (W - 28);
    const sy = (g) => H - 12 - (g / maxY) * (H - 24);
    let dots = "";
    pts.forEach((r) => {
      const cx = sx(r.hdd);
      const cy = Math.max(5, sy(r.gas));
      dots += "M" + (cx - 4.5).toFixed(1) + " " + cy.toFixed(1) + " a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0 ";
    });
    const reg = model ? "M" + sx(0) + " " + sy(Math.max(0, model.base)).toFixed(1) + " L" + sx(maxX) + " " + Math.max(4, sy(expected(model, maxX))).toFixed(1) : "";
    return (
      '<div class="ctitle">Verbrauch je Heizgradtag</div>' +
      '<svg width="100%" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Gasverbrauch gegen Heizgradtage">' +
      '<path d="M24 ' + (H - 11.5) + " H" + W + '" stroke="rgba(245,238,233,.25)"/>' +
      '<text class="tk" x="0" y="' + (sy(maxY) + 4).toFixed(0) + '">' + fmtNum(maxY, 0) + '</text><text class="tk" x="0" y="' + (sy(maxY / 2) + 4).toFixed(0) + '">' + fmtNum(maxY / 2, 0) + "</text>" +
      '<text class="tk" x="24" y="' + H + '">0</text><text class="tk" x="' + (W - 16) + '" y="' + H + '">' + maxX + "</text>" +
      (reg ? '<path d="' + reg + '" stroke="#f5eee9" stroke-opacity=".8" stroke-width="2" stroke-dasharray="5 5"/>' : "") +
      '<path d="' + (dots || "M0 0") + '" fill="#e0683a" stroke="#262024" stroke-width="2"/></svg>' +
      '<div class="cap" style="text-align:right">Heizgradtage (' + (this.host.settings().hdd_base || 15) + " °C − Tagesmittel)</div>" +
      '<div class="estats">' +
      (model
        ? '<div><span>Grundlast (Warmwasser)</span><span>' + fmtNum(model.base, 1) + " " + esc(unit) + "/Tag</span></div>" +
          "<div><span>Je Heizgradtag</span><span>" + fmtNum(model.slope, 1) + " " + esc(unit) + "</span></div>" +
          "<div><span>Passgenauigkeit (R²)</span><span>" + fmtNum(model.r2, 2) + "</span></div>"
        : '<div class="cap">Für die Ausgleichsgerade braucht es mindestens 5 Tage mit Gas- und Temperaturwerten.</div>') +
      "</div>"
    );
  }

  elChart(stats, unit) {
    const W = 600;
    const H = 84;
    const vals = new Array(24).fill(0);
    (stats || []).forEach((r) => {
      const h = new Date(typeof r.start === "number" ? r.start : Date.parse(r.start)).getHours();
      if (r.change != null && isFinite(r.change)) vals[h] += Math.max(0, r.change);
    });
    const maxV = Math.max.apply(null, vals.concat([0.01]));
    const top = niceMax(maxV);
    const slot = W / 24;
    let bars = "";
    vals.forEach((v, i) => {
      bars += barPath(i * slot + 2, H - 1 - (v / top) * (H - 4), slot - 4, H - 1);
    });
    return (
      '<div class="chead"><div class="ctitle">Strom heute je Stunde</div><span class="cap" style="margin-left:auto">max. ' + fmtNum(maxV, 2) + " " + esc(unit) + "</span></div>" +
      '<div class="pwrap t"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Stromverbrauch heute pro Stunde">' +
      '<path d="M0 ' + (H - 0.5) + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + (bars || "M0 0") + '" fill="#2f9e7e"/></svg></div>' +
      '<div class="xax"><span>0 Uhr</span><span>6</span><span>12</span><span>18</span><span>24</span></div>'
    );
  }

  bind() {
    const el = this.host.el;
    Array.prototype.forEach.call(el.querySelectorAll("[data-day]"), (s) => {
      const i = parseInt(s.getAttribute("data-day"), 10);
      const on = () => {
        if (this.hover !== i) {
          this.hover = i;
          this.render();
        }
      };
      s.addEventListener("pointerenter", on);
      s.addEventListener("pointerdown", on);
    });
    const hov = el.querySelector(".hov");
    if (hov)
      hov.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse" && this.hover != null) {
          this.hover = null;
          this.render();
        }
      });
  }
}

export { hdd };
