// Energie-Panel: Gas 30 Tage mit Erwartung, Temperatur und Tagesprognose, Gas und Strom heute je Stunde
// mit Prognose bis Mitternacht, Prognose 7 Tage. Aufschlüsselung und Regressionsmodell liegen in einer
// zweiten Ebene („Analyse“).
// Daten aus den Langzeit-Statistiken des Recorders (keine eigene Speicherung).

import { fmtNum } from "./model.js";
import { icon } from "./icons.js";
import { fitModel, mergeTemps, blendToday, expected, forecastSum, monthTotals, sumChange, niceMax, barPath, hdd, hourMap, hourProfile, restOfDay, breakdown } from "./energycalc.js";

const DAYS = 365; // Lernfenster fürs Modell
const HALF_LIFE_DAYS = 21; // Gewichtung: ein Tag zählt nach 3 Wochen noch halb
const CHART_DAYS = 30; // Tage in den Detailansichten
const PROFILE_DAYS = 7; // Tage für das Stundenprofil der Prognose
const REFRESH_MS = 10 * 60000;
const COLORS = { el: "#2f9e7e", gas: "#e0683a" };
const PART_COLORS = ["#e0683a", "#f2a65a", "#c9a6ff", "#5a86e8", "#2f9e7e", "#d47fa6", "#a9c6ff", "#8c8c8c"];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function midnight(ms, offsetDays) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (offsetDays || 0));
  return d.getTime();
}

function startOf(r) {
  return typeof r.start === "number" ? r.start : Date.parse(r.start);
}

/** Lesbarer Name aus friendly_name: Zusätze wie „Energy“ oder „VT“ entfernen. */
function partName(st, id) {
  let n = (st && st.attributes && st.attributes.friendly_name) || id;
  n = n.replace(/\b(energy|energie|verbrauch)\b/gi, "").replace(/\bVT\b/g, "").replace(/^\s*Heizung\s+/i, "").replace(/[_]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return n || id;
}

export class EnergyView {
  constructor(host) {
    // host: { el, hass(), settings(), forecast(), toast() }
    this.host = host;
    this.data = null;
    this.hover = null; // Index des Tages im Gasdiagramm
    this.detail = null; // "el" | "gas"
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
    this.detail = null;
  }

  watched() {
    const p = this.host.settings().power_entity;
    return p ? [p] : [];
  }

  async stats(ids, period, start, end, types, units) {
    if (!ids.length) return {};
    const msg = {
      type: "recorder/statistics_during_period",
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      statistic_ids: ids,
      period: period,
      types: types
    };
    if (units) msg.units = units;
    try {
      return await this.hass.callWS(msg);
    } catch (e) {
      return {};
    }
  }

  /** Preise aus den Energie-Einstellungen von HA: fester Preis oder Preis-Entität, je Zähler. */
  async prices(gas, el) {
    try {
      const prefs = await this.hass.callWS({ type: "energy/get_prefs" });
      const states = this.hass.states;
      const srcs = prefs.energy_sources || [];
      const priceOf = (src) => {
        let price = src.number_energy_price;
        if (src.entity_energy_price && states[src.entity_energy_price]) {
          const v = parseFloat(states[src.entity_energy_price].state);
          if (isFinite(v)) price = v;
        }
        return price != null && isFinite(price) ? price : null;
      };
      // Passender Zähler zuerst; sonst die einzige Quelle dieses Typs (z. B. anderer Sensor für denselben Zähler).
      const pick = (type, id) => {
        const list = srcs.filter((x) => x.type === type);
        const exact = list.filter((x) => x.stat_energy_from === id)[0];
        const src = exact || (list.length === 1 ? list[0] : null);
        return src ? priceOf(src) : null;
      };
      const out = {};
      const g = pick("gas", gas);
      const e = pick("grid", el);
      if (g != null) out.gas = g;
      if (e != null) out.el = e;
      return out;
    } catch (e) {
      return {};
    }
  }

  /**
   * Teilzähler automatisch finden.
   * heat: Energie-Schätzungen der Thermostate (sensor.<climate>_energy, z. B. Versatile Thermostat),
   * plugs: alle übrigen kWh-Zähler (Messsteckdosen) ohne Tages-/Monats-/Rückspeise-Varianten.
   */
  meters() {
    const st = this.host.settings();
    const states = this.hass.states;
    const heat = [];
    Object.keys(states).forEach((id) => {
      if (id.indexOf("climate.") !== 0) return;
      const e = "sensor." + id.slice(8) + "_energy";
      if (states[e]) heat.push(e);
    });
    const skip = /_(today|yesterday|month|week|year|returned|export|produced)$/;
    const plugs = Object.keys(states).filter((id) => {
      if (id.indexOf("sensor.") !== 0 || skip.test(id) || heat.indexOf(id) >= 0) return false;
      if (id === st.electricity_entity || id === st.gas_entity) return false;
      const a = states[id].attributes || {};
      if (a.device_class !== "energy") return false;
      if (a.state_class !== "total_increasing" && a.state_class !== "total") return false;
      return /^(k?Wh|MWh)$/.test(a.unit_of_measurement || "");
    });
    return { heat: heat, plugs: plugs };
  }

  /** Stündliche Wettervorhersage (für die Temperatur im Heute-Diagramm). */
  async hourlyForecast() {
    const id = this.host.weatherEntity ? this.host.weatherEntity() : null;
    if (!id) return [];
    try {
      const res = await this.hass.callService("weather", "get_forecasts", { type: "hourly" }, { entity_id: id }, false, true);
      const r = res && res.response && res.response[id];
      return (r && r.forecast) || [];
    } catch (e) {
      return [];
    }
  }

  async load() {
    const st = this.host.settings();
    if (this.loading) return;
    this.loading = true;
    const now = Date.now();
    const gas = st.gas_entity;
    // Außentemperatur fürs Modell: der Sensor der Kopfzeile, wo er Tageswerte hat; für ältere Tage
    // ergänzt um den Energie-Sensor (z. B. solange ein neuer Helfer noch keine lange Historie hat).
    const temp = st.outdoor_temp_entity || st.energy_temp_entity;
    const tempOld = st.energy_temp_entity && st.energy_temp_entity !== temp ? st.energy_temp_entity : null;
    const el = st.electricity_entity;
    const m = this.meters();
    const parts = m.heat.concat(m.plugs);
    const r = await Promise.all([
      this.stats(gas ? [gas] : [], "day", midnight(now, -DAYS), now, ["change"]),
      this.stats(temp ? [temp] : [], "day", midnight(now, -DAYS), now, ["mean"]),
      this.stats(el ? [el] : [], "hour", midnight(now, -PROFILE_DAYS - 1), now, ["change"]),
      this.stats(gas ? [gas] : [], "hour", midnight(now, -PROFILE_DAYS - 1), now, ["change"]),
      this.stats(el ? [el] : [], "day", midnight(now, -CHART_DAYS), now, ["change"]),
      this.prices(gas, el),
      this.stats(parts, "day", midnight(now, -CHART_DAYS), now, ["change"], { energy: "kWh" }),
      this.stats(temp ? [temp] : [], "hour", midnight(now), now, ["mean"]),
      this.hourlyForecast(),
      this.stats(tempOld ? [tempOld] : [], "day", midnight(now, -DAYS), now, ["mean"])
    ]);
    this.loading = false;
    this.data = {
      gas: gas ? r[0][gas] || [] : [],
      temp: mergeTemps(temp ? r[1][temp] || [] : [], tempOld ? r[9][tempOld] || [] : []),
      elHours: el ? r[2][el] || [] : [],
      gasHours: gas ? r[3][gas] || [] : [],
      elDays: el ? r[4][el] || [] : [],
      prices: r[5] || {},
      parts: r[6] || {},
      meters: m,
      tempHours: temp ? r[7][temp] || [] : [],
      tempFc: r[8] || [],
      at: now
    };
    this.render();
  }

  /** Summe je Teilzähler: heute bzw. über alle geladenen Tage. */
  partSums(ids, fromMs) {
    const d = this.data || {};
    const states = this.hass.states;
    return ids.map((id) => ({
      id: id,
      name: partName(states[id], id),
      value: sumChange(((d.parts || {})[id] || []).filter((x) => startOf(x) >= fromMs))
    }));
  }

  render() {
    const st = this.host.settings();
    const el = this.host.el;
    if (!st.gas_entity && !st.electricity_entity && !st.power_entity) {
      el.innerHTML =
        '<div class="ehint">Wähle in den Einstellungen unter „Energie &amp; Sauger“ deinen Gaszähler, Stromzähler und die Außentemperatur. Das Zahnrad unten rechts gedrückt halten.</div>';
      return;
    }
    const now = Date.now();
    const states = this.hass.states;
    const unitOf = (id, def) => (id && states[id] ? states[id].attributes.unit_of_measurement || def : def);
    const gasUnit = unitOf(st.gas_entity, "");
    const elUnit = unitOf(st.electricity_entity, "kWh");
    const d = this.data || { gas: [], temp: [], elHours: [], gasHours: [], elDays: [], prices: {}, parts: {}, meters: { heat: [], plugs: [] } };
    const todayStart = midnight(now);
    const pr = d.prices || {};

    // Gasmodell (Heizgrenze fest oder gelernt).
    // Stichtag „Modell ab“: nur Tage ab diesem Datum lernen (lokale Mitternacht).
    let since = null;
    if (st.model_since && /^\d{4}-\d{2}-\d{2}$/.test(st.model_since)) {
      const p = st.model_since.split("-").map(Number);
      since = new Date(p[0], p[1] - 1, p[2]).getTime();
    }
    this.since = since;
    const fit = fitModel(d.gas, d.temp, st.hdd_base || null, todayStart, HALF_LIFE_DAYS, since);
    const model = fit.model;
    const base = model ? model.baseT : fit.baseT;
    this.baseT = base;
    const rows = fit.rows;
    const past = rows.filter((x) => x.start < todayStart);
    const today = rows.filter((x) => x.start >= todayStart)[0] || null;
    const month = monthTotals(rows, model, now, since);
    const fcList = this.host.forecast();
    const fc7 = forecastSum(model, fcList, 7, base);

    // Strom heute + Prognose aus dem Stundenprofil der letzten 7 Tage.
    const elH = hourMap(d.elHours);
    const elToday = sumChange((d.elHours || []).filter((x) => startOf(x) >= todayStart));
    const elYesterday = sumChange((d.elHours || []).filter((x) => startOf(x) >= midnight(now, -1) && startOf(x) < now - 86400000));
    const elProfile = hourProfile(d.elHours, todayStart);
    const elFc = restOfDay(elProfile, now, null);
    const curHour = Math.floor(now / 3600000) * 3600000;
    const elCur = elH[curHour] || 0;
    const elRest = Object.keys(elFc).reduce((a, k) => a + elFc[k], 0);
    const elFcTotal = d.elHours.length ? elToday - elCur + Math.max(elRest, elCur) : null;

    // Gas heute + Prognose: Erwartung aus dem Modell (Wettervorhersage für heute), Rest nach Stundenprofil verteilt.
    const gasH = hourMap(d.gasHours);
    const gasToday = today ? today.gas : sumChange((d.gasHours || []).filter((x) => startOf(x) >= todayStart));
    const fToday = (fcList || []).filter((f) => {
      const t = Date.parse(f.datetime);
      return t >= todayStart && t < midnight(now, 1);
    })[0];
    let tToday = null;
    if (fToday && fToday.temperature != null) tToday = fToday.templow != null ? (fToday.temperature + fToday.templow) / 2 : fToday.temperature;
    else if (today && today.temp != null) tToday = today.temp;
    const gasModelExp = model && tToday != null ? expected(model, hdd(tToday, base)) : null;
    const gasProfile = hourProfile(d.gasHours, todayStart);
    const gasCur = gasH[curHour] || 0;
    // Anteil des typischen Tagesverbrauchs, der bis jetzt üblicherweise schon angefallen ist.
    const profSum = gasProfile.reduce((a, v) => a + v, 0);
    const hNow = new Date(now).getHours() + new Date(now).getMinutes() / 60;
    let profDone = 0;
    gasProfile.forEach((v, h) => (profDone += v * Math.max(0, Math.min(1, hNow - h))));
    const done = profSum > 0 ? profDone / profSum : hNow / 24;
    const gasExp = d.gasHours.length ? blendToday(gasModelExp, gasToday, done) : gasModelExp;
    const gasRestTarget = gasExp != null ? Math.max(0, gasExp - (gasToday - gasCur)) : null;
    const gasFc = restOfDay(gasProfile, now, gasRestTarget);
    const gasFcTotal = d.gasHours.length
      ? gasExp != null
        ? Math.max(gasExp, gasToday)
        : gasToday - gasCur + Math.max(Object.keys(gasFc).reduce((a, k) => a + gasFc[k], 0), gasCur)
      : null;

    const power = st.power_entity && states[st.power_entity] ? parseFloat(states[st.power_entity].state) : null;
    const powerUnit = unitOf(st.power_entity, "W");

    const eur = (amount, price, unit) =>
      price != null && amount != null && isFinite(amount)
        ? '<div class="eur">' + fmtNum(amount * price, 2) + " €<small>" + fmtNum(price, price < 1 ? 3 : 2) + " €/" + esc(unit) + "</small></div>"
        : "";
    const kpi = (cap, val, unit, sub, cost) =>
      '<div class="card kpi"><div class="cap">' + cap + '</div><div class="v">' + val + "<small>" + esc(unit) + "</small></div>" + (cost || "") + '<div class="s">' + sub + "</div></div>";
    let devTxt = "";
    if (month.deviation != null) {
      const p = Math.round(month.deviation * 100);
      devTxt = Math.abs(p) + " % " + (p <= 0 ? "unter" : "über") + " Erwartung";
    }
    const monthName = new Date().toLocaleDateString("de-DE", { month: "long" });

    const meters = d.meters || { heat: [], plugs: [] };
    const chartRows = rows.filter((x) => x.start >= midnight(now, -CHART_DAYS));
    const todayHours = (map) => {
      const out = {};
      Object.keys(map).forEach((k) => {
        if (+k >= todayStart) out[k] = map[k];
      });
      return out;
    };

    // Strom heute: aktuelle Leistung (falls vorhanden) mit in die Kachel.
    const powerTxt = power != null && isFinite(power) ? "Jetzt " + fmtNum(power, 0) + " " + esc(powerUnit) : "";
    const elSub = [powerTxt, d.elHours.length ? (powerTxt ? "gestern " : "Gestern um diese Zeit ") + fmtNum(elYesterday, 1) + " " + esc(elUnit) : ""].filter(Boolean).join(" · ");

    let html =
      '<div class="ekpis">' +
      (st.electricity_entity ? kpi("Strom heute", fmtNum(elToday, 1), elUnit, elSub, eur(elToday, pr.el, elUnit)) : st.power_entity ? kpi("Strom jetzt", powerTxt ? fmtNum(power, 0) : "–", powerUnit, "") : "") +
      (st.gas_entity
        ? kpi("Gas heute", today ? fmtNum(today.gas, 1) : "–", gasUnit, gasExp != null ? "Prognose " + fmtNum(gasExp, 1) + " " + esc(gasUnit) + (tToday != null ? " bei " + fmtNum(tToday, 1) + "°" : "") : "Noch keine Prognose", eur(today ? today.gas : null, pr.gas, gasUnit)) +
          kpi("Gas " + monthName, fmtNum(month.actual, 0), gasUnit, devTxt || "Erwartung braucht 5 Tage Verlauf", eur(month.actual, pr.gas, gasUnit)) +
          kpi(
            "Prognose " + (fc7 ? fc7.days : 7) + " Tage",
            fc7 ? "~ " + fmtNum(fc7.sum, 0) : "–",
            gasUnit + " Gas",
            fc7 ? "Vorhersage Ø " + fmtNum(fc7.mean, 0) + "° außen" : "Braucht Vorhersage und 5 Tage Verlauf",
            fc7 && pr.gas != null ? '<div class="eur">~ ' + fmtNum(fc7.sum * pr.gas, 0) + " €</div>" : ""
          )
        : "") +
      "</div>" +
      (st.gas_entity
        ? '<div class="erow one"><div class="card echart">' +
          this.gasChart(chartRows, model, gasUnit, gasFcTotal, true, {
            hours: todayHours(gasH),
            fc: gasFc,
            now: now,
            tMeas: (d.tempHours || []).filter((x) => x.mean != null).map((x) => [startOf(x) + 1800000, x.mean]),
            tFc: (d.tempFc || [])
              .map((f) => [Date.parse(f.datetime) + 1800000, f.temperature])
              .filter((p) => p[1] != null && p[0] >= now && p[0] < midnight(now, 1)),
            sub: gasFcTotal != null ? "Prognose heute " + fmtNum(gasFcTotal, 1) + " " + esc(gasUnit) + (pr.gas != null ? " · " + fmtNum(gasFcTotal * pr.gas, 2) + " €" : "") : ""
          }) +
          "</div></div>"
        : "") +
      (st.electricity_entity
        ? '<div class="erow one"><div class="card ebars">' +
          this.hourChart("el", "Strom heute je Stunde", todayHours(elH), elFc, elUnit, now, 70, elFcTotal != null ? "Prognose heute " + fmtNum(elFcTotal, 1) + " " + esc(elUnit) + (pr.el != null ? " · " + fmtNum(elFcTotal * pr.el, 2) + " €" : "") : "", true) +
          "</div></div>"
        : "");

    if (this.detail === "gas" && st.gas_entity) html += this.gasDetail(past, model, gasUnit, gasToday, meters, now);
    if (this.detail === "el" && st.electricity_entity) html += this.elDetail(d.elDays, elUnit, elToday, pr, meters, now);
    el.innerHTML = html;
    this.bind();
  }

  /** Gas aufteilen: Warmwasser (Grundlast, anteilig zur Tageszeit) und Heizung nach Thermostat-Energie je Raum. */
  gasSplit(total, model, heatIds, fromMs, days) {
    if (total == null || !isFinite(total)) return [];
    const ww = model ? Math.min(total, Math.max(0, model.base) * days) : 0;
    const heating = Math.max(0, total - ww);
    const rooms = this.partSums(heatIds, fromMs).filter((p) => p.value > 0);
    const sum = rooms.reduce((a, p) => a + p.value, 0);
    let parts = [];
    if (model) parts.push({ name: "Warmwasser", value: ww });
    if (sum > 0) parts = parts.concat(rooms.map((p) => ({ name: p.name, value: (heating * p.value) / sum })));
    else parts.push({ name: "Heizung", value: heating });
    return breakdown(total, parts, "Heizung (ohne Zuordnung)", 7);
  }

  /** SVG-Stundenbalken für heute (0–24 Uhr), Prognose für die restlichen Stunden hell. */
  hourSvg(kind, hours, fc, now, H, label, extra) {
    const W = 600;
    const day0 = midnight(now);
    const vals = [];
    const fvals = [];
    for (let i = 0; i < 24; i++) {
      const t = day0 + i * 3600000;
      vals.push(t in hours ? hours[t] : null);
      fvals.push(t in fc ? fc[t] : null);
    }
    const maxV = Math.max.apply(null, vals.concat(fvals).map((v) => v || 0).concat([0.01]));
    const top = niceMax(maxV);
    const slot = W / 24;
    let bars = "";
    let fbars = "";
    for (let i = 0; i < 24; i++) {
      if (vals[i] != null && vals[i] > 0) bars += barPath(i * slot + 2, H - 1 - (vals[i] / top) * (H - 4), slot - 4, H - 1);
      if (fvals[i] != null && fvals[i] > (vals[i] || 0)) fbars += barPath(i * slot + 2, H - 1 - (fvals[i] / top) * (H - 4), slot - 4, H - 1);
    }
    const nowX = (((now - day0) / 86400000) * W).toFixed(1);
    return {
      max: maxV,
      html:
        '<div class="pwrap" style="height:' + H + 'px"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">' +
        '<path d="M0 ' + (H - 0.5) + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' +
        (fbars ? '<path d="' + fbars + '" fill="' + COLORS[kind] + '" fill-opacity=".3"/>' : "") +
        '<path d="' + (bars || "M0 0") + '" fill="' + COLORS[kind] + '"/>' +
        (extra || "") +
        '<path d="M' + nowX + " 0 V" + H + '" stroke="#f5eee9" stroke-opacity=".55" vector-effect="non-scaling-stroke"/></svg></div>'
    };
  }

  /** Karte „heute je Stunde“ (Strom). */
  hourChart(kind, title, hours, fc, unit, now, H, sub, analyse) {
    const h = this.hourSvg(kind, hours, fc, now, H, title);
    return (
      '<div class="chead"><div class="ctitle">' + title + '</div><span class="cap">max. ' + fmtNum(h.max, 2) + " " + esc(unit) + "/h</span>" +
      (analyse ? '<button class="emore" data-detail="' + kind + '">Analyse' + icon("chev") + "</button>" : "") +
      "</div>" +
      (sub ? '<div class="cap">' + sub + "</div>" : "") +
      '<div style="margin-top:6px">' + h.html + "</div>" +
      '<div class="xax" style="padding-left:0"><span>0 Uhr</span><span>6</span><span>12</span><span>18</span><span>24</span></div>'
    );
  }

  partsList(parts, unit) {
    if (!parts.length) return '<div class="cap">Keine Teilzähler gefunden.</div>';
    return (
      '<div class="eparts">' +
      parts
        .map(
          (p, i) =>
            '<div class="epart' + (p.rest ? " rest" : "") + '"><span class="nm">' + esc(p.name) + "</span>" +
            '<span class="bar"><i style="width:' + Math.max(1, p.share * 100).toFixed(1) + "%;background:" + (p.rest ? "rgba(245,238,233,.3)" : PART_COLORS[i % PART_COLORS.length]) + '"></i></span>' +
            '<span class="val">' + fmtNum(p.value, p.value < 10 ? 2 : 1) + " " + esc(unit) + '</span><span class="pct">' + Math.round(p.share * 100) + " %</span></div>"
        )
        .join("") +
      "</div>"
    );
  }

  // ---------- Zweite Ebene ----------

  detailShell(title, body) {
    return (
      '<div class="edetail"><div class="sheet edsheet">' +
      '<div class="chead"><div class="ptitle">' + title + '</div><button class="round" data-closedetail="1" aria-label="Schließen">' + icon("close") + "</button></div>" +
      '<div class="edbody">' + body + "</div></div></div>"
    );
  }

  gasDetail(past, model, unit, gasToday, meters, now) {
    const todayStart = midnight(now);
    const from = midnight(now, -CHART_DAYS);
    const last = past.filter((r) => r.start >= from);
    const total30 = last.reduce((a, r) => a + r.gas, 0) + (gasToday || 0);
    const p30 = this.gasSplit(total30, model, meters.heat, from, (now - from) / 86400000);
    const pToday = this.gasSplit(gasToday, model, meters.heat, todayStart, (now - todayStart) / 86400000);
    return this.detailShell(
      "Gas – Analyse",
      '<div class="erow"><div class="card">' +
        '<div class="ctitle">Nach Verwendung · heute</div>' + this.partsList(pToday, unit) +
        '<div class="ctitle" style="margin-top:16px">Letzte ' + CHART_DAYS + " Tage</div>" + this.partsList(p30, unit) +
        '<div class="cap" style="margin-top:12px">Warmwasser = Grundlast aus dem Modell; der Rest wird nach der geschätzten Heizenergie der Thermostate auf die Räume verteilt.</div></div>' +
        '<div class="card escatter">' + this.scatter(past, model, unit) + "</div></div>"
    );
  }

  elDetail(days, unit, elToday, pr, meters, now) {
    const todayStart = midnight(now);
    const from = midnight(now, -CHART_DAYS);
    const list = (days || []).filter((r) => startOf(r) >= from && r.change != null);
    const total = sumChange(list);
    const p30 = breakdown(total, this.partSums(meters.plugs, from), "Sonstiges (ohne Messung)", 8);
    const pToday = breakdown(elToday, this.partSums(meters.plugs, todayStart), "Sonstiges (ohne Messung)", 8);
    const W = 600;
    const H = 130;
    const vals = list.map((r) => Math.max(0, r.change));
    const maxV = 4 * niceMax(Math.max.apply(null, vals.concat([0.01])) / 4);
    const slot = W / Math.max(1, list.length);
    let bars = "";
    vals.forEach((v, i) => (bars += barPath(i * slot + 2, H - 1 - (v / maxV) * (H - 8), Math.max(1, slot - 4), H - 1)));
    const avg = list.length ? total / list.length : null;
    const first = list[0] ? new Date(startOf(list[0])).toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : "";
    return this.detailShell(
      "Strom – Analyse",
      '<div class="erow one"><div class="card echart"><div class="chead"><div class="ctitle">Strom pro Tag</div><span class="cap" style="margin-left:auto">Ø ' + fmtNum(avg, 1) + " " + esc(unit) + "/Tag" +
        (pr.el != null && avg != null ? " · " + fmtNum(avg * pr.el, 2) + " €/Tag" : "") + "</span></div>" +
        '<div class="plot"><div class="yax s" style="height:' + H + 'px"><span>' + fmtNum(maxV, 0) + "</span><span>" + fmtNum(maxV / 2, 0) + "</span><span>0</span></div>" +
        '<div class="pwrap" style="height:' + H + 'px"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Strom pro Tag">' +
        '<path d="M0 ' + (H - 0.5) + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' +
        '<path d="' + (bars || "M0 0") + '" fill="' + COLORS.el + '"/></svg></div></div>' +
        '<div class="xax"><span>' + first + "</span><span>heute</span></div></div></div>" +
        '<div class="erow half"><div class="card"><div class="ctitle">Nach Gerät · heute</div>' + this.partsList(pToday, unit) + "</div>" +
        '<div class="card"><div class="ctitle">Letzte ' + CHART_DAYS + " Tage</div>" +
        '<div class="esum"><span><b>' + fmtNum(total, 0) + "</b> " + esc(unit) + "</span>" + (pr.el != null ? "<span>" + fmtNum(total * pr.el, 2) + " €</span>" : "") + "</div>" +
        this.partsList(p30, unit) + "</div></div>"
    );
  }

  gasChart(rows, model, unit, todayFc, analyse, today) {
    const W = 600;
    const H = 180;
    const x0 = 0;
    const n = Math.max(rows.length, 1);
    const slot = W / n;
    const bw = Math.max(2, slot - 5);
    // Vier gleiche, runde Schritte für die Gitterlinien.
    const maxV = 4 * niceMax(Math.max.apply(null, rows.map((r) => Math.max(r.gas, expected(model, r.hdd) || 0)).concat([1, todayFc || 0])) / 4);
    const base = H - 1;
    const gy = (v) => base - (v / maxV) * (H - 8);
    let bars = "";
    let fbars = "";
    let exp = "";
    const todayStart = midnight(Date.now());
    rows.forEach((r, i) => {
      const x = x0 + i * slot + (slot - bw) / 2;
      bars += barPath(x, gy(r.gas), bw, base);
      // Heute: Prognose bis Mitternacht hell hinter dem bisherigen Verbrauch.
      if (r.start >= todayStart && todayFc != null && todayFc > r.gas) fbars += barPath(x, gy(todayFc), bw, base);
      const e = expected(model, r.hdd);
      if (e != null) exp += (exp ? " L" : "M") + (x + bw / 2).toFixed(1) + " " + gy(e).toFixed(1);
    });
    // Außentemperatur auf derselben Fläche, eigene Achse rechts (°C).
    const temps = rows.filter((r) => r.temp != null);
    const tToday = today ? (today.tMeas || []).concat(today.tFc || []) : [];
    let tLine = "";
    let tMin = 0;
    let tMax = 10;
    let ty = null;
    if (temps.length || tToday.length) {
      const all = temps.map((r) => r.temp).concat(tToday.map((p) => p[1]));
      tMin = Math.floor(Math.min.apply(null, all) - 1);
      tMax = Math.ceil(Math.max.apply(null, all) + 1);
      while ((tMax - tMin) % 4) tMax += 1;
      ty = (t) => base - ((t - tMin) / (tMax - tMin)) * (H - 8);
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
        (r.start >= todayStart && todayFc != null ? "<br>Prognose heute " + fmtNum(todayFc, 1) + " " + esc(unit) : "") +
        (r.temp != null ? "<br>Außen " + fmtNum(r.temp, 1) + "°" : "") + "</div>";
    }
    const first = rows[0] ? new Date(rows[0].start).toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : "";
    const mid = rows[Math.floor(rows.length / 2)] ? new Date(rows[Math.floor(rows.length / 2)].start).toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : "";
    let tExtra = "";
    if (today && ty) {
      const day0 = midnight(today.now);
      const px = (t) => (((t - day0) / 86400000) * W).toFixed(1);
      const line = (pts) => pts.map((p, i) => (i ? " L" : "M") + px(p[0]) + " " + ty(p[1]).toFixed(1)).join("");
      const meas = (today.tMeas || []).slice().sort((a, b) => a[0] - b[0]);
      let fcp = (today.tFc || []).slice().sort((a, b) => a[0] - b[0]);
      if (meas.length && fcp.length) fcp = [meas[meas.length - 1]].concat(fcp);
      if (meas.length > 1) tExtra += '<path d="' + line(meas) + '" fill="none" stroke="#5a86e8" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
      if (fcp.length > 1) tExtra += '<path d="' + line(fcp) + '" fill="none" stroke="#5a86e8" stroke-width="2" stroke-dasharray="4 4" stroke-opacity=".8" vector-effect="non-scaling-stroke"/>';
    }
    const th = today ? this.hourSvg("gas", today.hours, today.fc, today.now, H, "Gas heute je Stunde", tExtra) : null;
    return (
      '<div class="chead"><div class="ctitle">Gasverbrauch pro Tag</div><div class="leg"><span><i class="sw2" style="background:#e0683a"></i>Verbrauch</span>' +
      (model ? '<span><i class="dash"></i>Erwartet</span>' : "") +
      (temps.length ? '<span><i class="tln"></i>Außen, Tagesmittel</span>' : "") + "</div>" +
      (analyse ? '<button class="emore" data-detail="gas">Analyse' + icon("chev") + "</button>" : "") + "</div>" +
      '<div class="gplot"><div class="gdays">' +
      '<div class="plot"><div class="yax"><span>' + fmtNum(maxV, 0) + "</span><span>" + fmtNum(maxV * 0.75, 0) + "</span><span>" + fmtNum(maxV * 0.5, 0) + "</span><span>" + fmtNum(maxV * 0.25, 0) + "</span><span>0</span></div>" +
      '<div class="pwrap"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Gasverbrauch und Außentemperatur der letzten Tage">' +
      '<path d="' + grid + '" stroke="rgba(245,238,233,.08)" vector-effect="non-scaling-stroke"/>' +
      '<path d="M0 ' + base + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' +
      (hiBar ? '<path d="' + hiBar + '" fill="rgba(245,238,233,.07)"/>' : "") +
      (fbars ? '<path d="' + fbars + '" fill="#e0683a" fill-opacity=".3"/>' : "") +
      '<path d="' + (bars || "M0 0") + '" fill="#e0683a"/>' +
      (exp ? '<path d="' + exp + '" fill="none" stroke="#f5eee9" stroke-opacity=".8" stroke-width="2" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>' : "") +
      (ty && tMin < 0 && tMax > 0 ? '<path d="M0 ' + ty(0).toFixed(1) + " H" + W + '" stroke="#5a86e8" stroke-opacity=".35" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>' : "") +
      (tLine ? '<path d="' + tLine + '" fill="none" stroke="#5a86e8" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' : "") +
      "</svg>" +
      '<div class="hov">' + rows.map((r, i) => '<span data-day="' + i + '"></span>').join("") + "</div>" + tip + "</div>" +
      (temps.length
        ? '<div class="yax r"><span>' + tMax + "°</span><span>" + Math.round(tMin + (tMax - tMin) * 0.75) + "°</span><span>" + Math.round((tMin + tMax) / 2) + "°</span><span>" + Math.round(tMin + (tMax - tMin) * 0.25) + "°</span><span>" + tMin + "°</span></div>"
        : "") +
      "</div>" +
      '<div class="xax' + (temps.length ? " tr" : "") + '"><span>' + first + "</span><span>" + mid + "</span><span>heute</span></div></div>" +
      (th
        ? '<div class="gtoday"><div class="gtl"><span>Heute je Stunde</span><span>max. ' + fmtNum(th.max, 2) + " " + esc(unit) + "/h</span></div>" + th.html +
          '<div class="xax" style="padding-left:0"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>' +
          (today.sub ? '<div class="cap gsub">' + today.sub + "</div>" : "") + "</div>"
        : "") +
      "</div>"
    );
  }

  scatter(rows, model, unit) {
    const pts = rows.filter((r) => r.hdd != null);
    const W = 284;
    const H = 170;
    const maxX = Math.max(10, Math.ceil(Math.max.apply(null, pts.map((r) => r.hdd).concat([0])) / 2) * 2);
    const maxY = niceMax(Math.max.apply(null, pts.map((r) => r.gas).concat([1])));
    const sx = (h) => 24 + (h / maxX) * (W - 28);
    const sy = (g) => H - 12 - (g / maxY) * (H - 24);
    let dots = "";
    pts.forEach((r) => {
      const cx = sx(r.hdd);
      const cy = Math.max(5, sy(r.gas));
      dots += "M" + (cx - 4).toFixed(1) + " " + cy.toFixed(1) + " a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 ";
    });
    const reg = model ? "M" + sx(0) + " " + sy(Math.max(0, model.base)).toFixed(1) + " L" + sx(maxX) + " " + Math.max(4, sy(expected(model, maxX))).toFixed(1) : "";
    return (
      '<div class="ctitle">Verbrauch je Heizgradtag</div>' +
      '<svg width="100%" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Gasverbrauch gegen Heizgradtage">' +
      '<path d="M24 ' + (H - 11.5) + " H" + W + '" stroke="rgba(245,238,233,.25)"/>' +
      '<text class="tk" x="0" y="' + (sy(maxY) + 4).toFixed(0) + '">' + fmtNum(maxY, 0) + '</text><text class="tk" x="0" y="' + (sy(maxY / 2) + 4).toFixed(0) + '">' + fmtNum(maxY / 2, 0) + "</text>" +
      '<text class="tk" x="24" y="' + H + '">0</text><text class="tk" x="' + (W - 16) + '" y="' + H + '">' + maxX + "</text>" +
      (reg ? '<path d="' + reg + '" stroke="#f5eee9" stroke-opacity=".8" stroke-width="2" stroke-dasharray="5 5"/>' : "") +
      '<path d="' + (dots || "M0 0") + '" fill="' + COLORS.gas + '" stroke="#262024" stroke-width="2"/></svg>' +
      '<div class="cap" style="text-align:right">Heizgradtage (' + fmtNum(this.baseT || 15, 1) + " °C − Tagesmittel)</div>" +
      '<div class="estats">' +
      (model
        ? '<div><span>Grundlast (Warmwasser)</span><span>' + fmtNum(model.base, 1) + " " + esc(unit) + "/Tag</span></div>" +
          "<div><span>Je Heizgradtag</span><span>" + fmtNum(model.slope, 1) + " " + esc(unit) + "</span></div>" +
          "<div><span>Heizgrenze" + (this.host.settings().hdd_base ? "" : " (gelernt)") + "</span><span>" + fmtNum(model.baseT, 1) + " °C</span></div>" +
          "<div><span>Gewichtung</span><span>" + (this.since ? "ab " + new Date(this.since).toLocaleDateString("de-DE", { day: "numeric", month: "numeric", year: "2-digit" }) + ", " : "") + "Halbwertszeit " + HALF_LIFE_DAYS + " Tage</span></div>" +
          "<div><span>Passgenauigkeit (R²)</span><span>" + fmtNum(model.r2, 2) + " · " + model.n + " Tage" + (model.excluded ? ", " + model.excluded + " ausgelassen" : "") + "</span></div>"
        : '<div class="cap">Für die Ausgleichsgerade braucht es mindestens 5 Tage mit Gas- und Temperaturwerten.</div>') +
      "</div>"
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
    Array.prototype.forEach.call(el.querySelectorAll("[data-detail]"), (b) => {
      b.onclick = () => {
        this.detail = b.getAttribute("data-detail");
        this.hover = null;
        this.render();
      };
    });
    Array.prototype.forEach.call(el.querySelectorAll("[data-closedetail]"), (b) => {
      b.onclick = () => {
        this.detail = null;
        this.render();
      };
    });
    const ov = el.querySelector(".edetail");
    if (ov)
      ov.addEventListener("click", (e) => {
        if (e.target === ov) {
          this.detail = null;
          this.render();
        }
      });
  }
}

export { hdd };
