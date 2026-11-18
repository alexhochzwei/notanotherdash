// Energie-Panel: Strom links, Gas rechts. Je Karte: heute stündlich (mit Prognose bis Mitternacht),
// davor 28 Tage logarithmisch gestaucht, darunter die Aufschlüsselung. Regression und Details
// liegen in einer zweiten Ebene („Analyse“).
// Daten aus den Langzeit-Statistiken des Recorders (keine eigene Speicherung).

import { fmtNum } from "./model.js";
import { icon } from "./icons.js";
import {
  fitModel,
  expected,
  forecastSum,
  monthTotals,
  sumChange,
  niceMax,
  barPath,
  hdd,
  hourMap,
  hourProfile,
  restOfDay,
  timeline,
  breakdown
} from "./energycalc.js";

const DAYS = 365; // Lernfenster fürs Modell
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
    this.hover = null; // { chart, i }
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

  async load() {
    const st = this.host.settings();
    if (this.loading) return;
    this.loading = true;
    const now = Date.now();
    const gas = st.gas_entity;
    // Energie kann einen eigenen Außensensor haben (z. B. solange ein neuer Helfer noch keine Historie hat).
    const temp = st.energy_temp_entity || st.outdoor_temp_entity;
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
      this.stats(parts, "day", midnight(now, -CHART_DAYS), now, ["change"], { energy: "kWh" })
    ]);
    this.loading = false;
    this.data = {
      gas: gas ? r[0][gas] || [] : [],
      temp: temp ? r[1][temp] || [] : [],
      elHours: el ? r[2][el] || [] : [],
      gasHours: gas ? r[3][gas] || [] : [],
      elDays: el ? r[4][el] || [] : [],
      prices: r[5] || {},
      parts: r[6] || {},
      meters: m,
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
    const fit = fitModel(d.gas, d.temp, st.hdd_base || null, todayStart);
    const model = fit.model;
    const base = model ? model.baseT : fit.baseT;
    this.baseT = base;
    const rows = fit.rows;
    const past = rows.filter((x) => x.start < todayStart);
    const today = rows.filter((x) => x.start >= todayStart)[0] || null;
    const month = monthTotals(rows, model, now);
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
    const gasExp = model && tToday != null ? expected(model, hdd(tToday, base)) : null;
    const gasProfile = hourProfile(d.gasHours, todayStart);
    const gasCur = gasH[curHour] || 0;
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

    // Aufschlüsselung heute.
    const meters = d.meters || { heat: [], plugs: [] };
    const elParts = breakdown(elToday, this.partSums(meters.plugs, todayStart), "Sonstiges (ohne Messung)", 6);
    const gasParts = this.gasSplit(gasToday, model, meters.heat, todayStart, (now - todayStart) / 86400000);

    let html =
      '<div class="ekpis">' +
      (st.electricity_entity ? kpi("Strom heute", fmtNum(elToday, 1), elUnit, d.elHours.length ? "Gestern um diese Zeit " + fmtNum(elYesterday, 1) + " " + esc(elUnit) : "", eur(elToday, pr.el, elUnit)) : "") +
      (st.power_entity ? kpi("Strom jetzt", power != null && isFinite(power) ? fmtNum(power, 0) : "–", powerUnit, "") : "") +
      (st.gas_entity
        ? kpi("Gas heute", today ? fmtNum(today.gas, 1) : "–", gasUnit, gasExp != null ? "Erwartet " + fmtNum(gasExp, 1) + " " + esc(gasUnit) + (tToday != null ? " bei " + fmtNum(tToday, 1) + "°" : "") : "Noch keine Prognose", eur(today ? today.gas : null, pr.gas, gasUnit)) +
          kpi("Gas " + monthName, fmtNum(month.actual, 0), gasUnit, devTxt || "Erwartung braucht 5 Tage Verlauf", eur(month.actual, pr.gas, gasUnit))
        : "") +
      "</div>" +
      '<div class="egrid">' +
      (st.electricity_entity
        ? this.card("el", "Strom", elUnit, timeline(d.elDays, elH, elFc, now, 0.5), elToday, elFcTotal, pr.el, elParts, "Messsteckdosen heute")
        : "<div></div>") +
      (st.gas_entity
        ? this.card(
            "gas",
            "Gas",
            gasUnit,
            timeline(d.gas, gasH, gasFc, now, 0.5),
            gasToday,
            gasFcTotal,
            pr.gas,
            gasParts,
            "Heute nach Verwendung",
            fc7 ? "Nächste " + fc7.days + " Tage ~ " + fmtNum(fc7.sum, 0) + " " + esc(gasUnit) + (pr.gas != null ? " · ~ " + fmtNum(fc7.sum * pr.gas, 0) + " €" : "") : ""
          )
        : "<div></div>") +
      "</div>";

    if (this.detail === "gas" && st.gas_entity) html += this.gasDetail(rows, past, model, gasUnit, fc7, pr, meters, now);
    if (this.detail === "el" && st.electricity_entity) html += this.elDetail(d.elDays, elUnit, pr, meters, now);
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

  /** Eine Energiekarte: Kopf, Zeitachse, Aufschlüsselung. */
  card(kind, title, unit, tl, todayVal, fcTotal, price, parts, partsTitle, extra) {
    const color = COLORS[kind];
    return (
      '<div class="card ecard">' +
      '<div class="chead"><div class="ctitle">' + title + "</div>" +
      '<button class="emore" data-detail="' + kind + '">Analyse' + icon("chev") + "</button></div>" +
      '<div class="esum"><span><b>' + fmtNum(todayVal, 1) + "</b> " + esc(unit) + " heute</span>" +
      (fcTotal != null ? '<span class="efc2">Prognose ' + fmtNum(fcTotal, 1) + " " + esc(unit) + (price != null ? " · " + fmtNum(fcTotal * price, 2) + " €" : "") + "</span>" : "") +
      "</div>" +
      this.timelineChart(kind, tl, unit, color) +
      (extra ? '<div class="cap efc7">' + extra + "</div>" : "") +
      '<div class="cap eptitle">' + partsTitle + "</div>" +
      this.partsList(parts, unit) +
      "</div>"
    );
  }

  timelineChart(kind, tl, unit, color) {
    const W = 600;
    const H = 150;
    const base = H - 1;
    const vals = tl.slots.map((s) => Math.max(s.value || 0, s.forecast || 0));
    const maxV = 4 * niceMax(Math.max.apply(null, vals.concat([0.001])) / 4);
    const gy = (v) => base - (v / maxV) * (H - 8);
    let bars = "";
    let fbars = "";
    tl.slots.forEach((s) => {
      const x = s.x0 * W;
      const w = (s.x1 - s.x0) * W;
      const gap = s.kind === "day" ? Math.min(3, w * 0.25) : Math.min(1.5, w * 0.2);
      const bw = Math.max(1, w - gap);
      if (s.value != null && s.value > 0) bars += barPath(x + gap / 2, gy(s.value), bw, base);
      if (s.forecast != null && s.forecast > (s.value || 0)) fbars += barPath(x + gap / 2, gy(s.forecast), bw, base);
    });
    const grid = [0.25, 0.5, 0.75].map((f) => "M0 " + (base - f * (H - 8)).toFixed(1) + " H" + W).join(" ");
    const nowX = (tl.nowX * W).toFixed(1);
    const sep = (0.5 * W).toFixed(1);
    const todayX = (tl.todayX * W).toFixed(1);
    const h = this.hover && this.hover.chart === kind ? tl.slots[this.hover.i] : null;
    let hiBar = "";
    let tip = "";
    if (h) {
      hiBar = "M" + (h.x0 * W).toFixed(1) + " 0 H" + (h.x1 * W).toFixed(1) + " V" + H + " H" + (h.x0 * W).toFixed(1) + " Z";
      const left = ((h.x0 + h.x1) / 2) * 100;
      const date = new Date(h.start);
      const label =
        h.kind === "day"
          ? date.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })
          : date.toLocaleDateString("de-DE", { weekday: "short" }) + ", " + date.getHours() + "–" + (date.getHours() + 1) + " Uhr";
      let body = "";
      if (h.kind === "day") body = h.total != null ? fmtNum(h.total, 1) + " " + esc(unit) + "<br>Ø " + fmtNum(h.value, 2) + " " + esc(unit) + "/h" : "Keine Daten";
      else {
        if (h.value != null) body += fmtNum(h.value, 2) + " " + esc(unit) + (h.current ? " bisher" : "");
        if (h.forecast != null) body += (body ? "<br>" : "") + "Prognose " + fmtNum(h.forecast, 2) + " " + esc(unit);
        if (!body) body = "Keine Daten";
      }
      tip = '<div class="tip" style="' + (left > 60 ? "right:" + (100 - left + 2) + "%" : "left:" + (left + 2) + "%") + '"><b>' + label + "</b><br>" + body + "</div>";
    }
    const lbl = (x, text, cls) => '<span class="' + (cls || "") + '" style="left:' + (x * 100).toFixed(2) + '%">' + text + "</span>";
    return (
      '<div class="plot"><div class="yax s"><span>' + fmtNum(maxV, maxV < 1 ? 2 : 1) + "</span><span>" + fmtNum(maxV / 2, maxV < 1 ? 2 : 1) + "</span><span>0</span></div>" +
      '<div class="pwrap s"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Verbrauch je Stunde, Historie gestaucht">' +
      '<path d="' + grid + '" stroke="rgba(245,238,233,.08)" vector-effect="non-scaling-stroke"/>' +
      '<path d="M0 ' + base + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' +
      '<path d="M' + sep + " 0 V" + H + '" stroke="rgba(245,238,233,.18)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>' +
      '<path d="M' + todayX + " 0 V" + H + '" stroke="rgba(245,238,233,.12)" vector-effect="non-scaling-stroke"/>' +
      (hiBar ? '<path d="' + hiBar + '" fill="rgba(245,238,233,.07)"/>' : "") +
      (fbars ? '<path d="' + fbars + '" fill="' + color + '" fill-opacity=".3"/>' : "") +
      '<path d="' + (bars || "M0 0") + '" fill="' + color + '"/>' +
      '<path d="M' + nowX + " 0 V" + H + '" stroke="#f5eee9" stroke-opacity=".7" vector-effect="non-scaling-stroke"/>' +
      "</svg>" +
      '<div class="hov abs">' +
      tl.slots.map((s, i) => '<span data-slot="' + kind + ":" + i + '" style="left:' + (s.x0 * 100).toFixed(3) + "%;width:" + ((s.x1 - s.x0) * 100).toFixed(3) + '%"></span>').join("") +
      "</div>" + tip + "</div></div>" +
      '<div class="xax abs">' +
      lbl(0, "4 Wo.") + lbl(tl.ageX(14), "2 Wo.") + lbl(tl.ageX(7), "1 Wo.") +
      lbl(0.5, "gestern") + lbl(tl.todayX, "heute") + lbl(tl.nowX, "jetzt", "now") +
      "</div>" +
      '<div class="cap eunit">' + esc(unit) + " je Stunde · links Tagesmittel, rechts stündlich · hell = Prognose</div>"
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

  gasDetail(rows, past, model, unit, fc7, pr, meters, now) {
    const chartRows = rows.filter((x) => x.start >= midnight(now, -CHART_DAYS));
    const parts = this.gasSplit(sumChange(chartRows.map((r) => ({ change: r.gas }))), model, meters.heat, midnight(now, -CHART_DAYS), CHART_DAYS);
    return this.detailShell(
      "Gas – Analyse",
      '<div class="erow"><div class="card echart">' + this.gasChart(chartRows, model, unit) + "</div>" +
        '<div class="card escatter">' + this.scatter(past, model, unit) + "</div></div>" +
        '<div class="erow"><div class="card"><div class="ctitle">Letzte ' + CHART_DAYS + " Tage nach Verwendung</div>" + this.partsList(parts, unit) + "</div>" +
        '<div class="card efc"><div class="ctitle">Prognose nächste ' + (fc7 ? fc7.days : 7) + ' Tage</div><div class="v">' +
        (fc7 ? "~ " + fmtNum(fc7.sum, 0) + "<small>" + esc(unit) + "</small>" : "–") +
        "</div>" + (fc7 && pr.gas != null ? '<div class="eur">~ ' + fmtNum(fc7.sum * pr.gas, 0) + " €</div>" : "") +
        '<div class="cap">' + (fc7 ? "Aus Wettervorhersage, Ø " + fmtNum(fc7.mean, 0) + "° außen" : "Braucht Wettervorhersage und 5 Tage Verlauf") + "</div></div></div>"
    );
  }

  elDetail(days, unit, pr, meters, now) {
    const from = midnight(now, -CHART_DAYS);
    const list = (days || []).filter((r) => startOf(r) >= from && r.change != null);
    const total = sumChange(list);
    const parts = breakdown(total, this.partSums(meters.plugs, from), "Sonstiges (ohne Messung)", 8);
    const W = 600;
    const H = 150;
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
        '<div class="plot"><div class="yax s"><span>' + fmtNum(maxV, 0) + "</span><span>" + fmtNum(maxV / 2, 0) + "</span><span>0</span></div>" +
        '<div class="pwrap s"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Strom pro Tag">' +
        '<path d="M0 ' + (H - 0.5) + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' +
        '<path d="' + (bars || "M0 0") + '" fill="' + COLORS.el + '"/></svg></div></div>' +
        '<div class="xax"><span>' + first + "</span><span>heute</span></div></div></div>" +
        '<div class="erow one"><div class="card"><div class="ctitle">Letzte ' + CHART_DAYS + " Tage nach Gerät</div>" +
        '<div class="esum"><span><b>' + fmtNum(total, 0) + "</b> " + esc(unit) + "</span>" + (pr.el != null ? "<span>" + fmtNum(total * pr.el, 2) + " €</span>" : "") + "</div>" +
        this.partsList(parts, unit) + "</div></div>"
    );
  }

  gasChart(rows, model, unit) {
    const W = 600;
    const H = 150;
    const n = Math.max(rows.length, 1);
    const slot = W / n;
    const bw = Math.max(2, slot - 5);
    const maxV = 4 * niceMax(Math.max.apply(null, rows.map((r) => Math.max(r.gas, expected(model, r.hdd) || 0)).concat([1])) / 4);
    const base = H - 1;
    const gy = (v) => base - (v / maxV) * (H - 8);
    let bars = "";
    let exp = "";
    rows.forEach((r, i) => {
      const x = i * slot + (slot - bw) / 2;
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
      const ty = (t) => 56 - ((t - tMin) / (tMax - tMin)) * 50;
      rows.forEach((r, i) => {
        if (r.temp == null) return;
        tLine += (tLine ? " L" : "M") + (i * slot + slot / 2).toFixed(1) + " " + ty(r.temp).toFixed(1);
      });
    }
    const grid = [0.25, 0.5, 0.75].map((f) => "M0 " + (base - f * (H - 8)).toFixed(1) + " H" + W).join(" ");
    const first = rows[0] ? new Date(rows[0].start).toLocaleDateString("de-DE", { day: "numeric", month: "short" }) : "";
    return (
      '<div class="chead"><div class="ctitle">Gas pro Tag</div><div class="leg"><span><i class="sw2" style="background:' + COLORS.gas + '"></i>Verbrauch</span>' +
      (model ? '<span><i class="dash"></i>Erwartet</span>' : "") + "</div></div>" +
      '<div class="plot"><div class="yax s"><span>' + fmtNum(maxV, 0) + "</span><span>" + fmtNum(maxV / 2, 0) + "</span><span>0</span></div>" +
      '<div class="pwrap s"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Gasverbrauch der letzten Tage">' +
      '<path d="' + grid + '" stroke="rgba(245,238,233,.08)" vector-effect="non-scaling-stroke"/>' +
      '<path d="M0 ' + base + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + (bars || "M0 0") + '" fill="' + COLORS.gas + '"/>' +
      (exp ? '<path d="' + exp + '" fill="none" stroke="#f5eee9" stroke-opacity=".8" stroke-width="2" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>' : "") +
      "</svg></div></div>" +
      (temps.length
        ? '<div class="chead small"><i class="sw2" style="background:#5a86e8"></i><span class="cap">Außentemperatur, Tagesmittel</span><span class="cap" style="margin-left:auto">' + tMin + "° bis " + tMax + "°</span></div>" +
          '<div class="pwrap t"><svg viewBox="0 0 ' + W + ' 60" preserveAspectRatio="none" aria-hidden="true">' +
          (tMin < 0 && tMax > 0 ? '<path d="M0 ' + (56 - ((0 - tMin) / (tMax - tMin)) * 50).toFixed(1) + " H" + W + '" stroke="rgba(245,238,233,.25)" vector-effect="non-scaling-stroke"/>' : "") +
          '<path d="' + tLine + '" fill="none" stroke="#5a86e8" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>'
        : "") +
      '<div class="xax"><span>' + first + "</span><span>heute</span></div>"
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
          "<div><span>Passgenauigkeit (R²)</span><span>" + fmtNum(model.r2, 2) + " · " + model.n + " Tage" + (model.excluded ? ", " + model.excluded + " ausgelassen" : "") + "</span></div>"
        : '<div class="cap">Für die Ausgleichsgerade braucht es mindestens 5 Tage mit Gas- und Temperaturwerten.</div>') +
      "</div>"
    );
  }

  bind() {
    const el = this.host.el;
    Array.prototype.forEach.call(el.querySelectorAll("[data-slot]"), (s) => {
      const parts = s.getAttribute("data-slot").split(":");
      const h = { chart: parts[0], i: parseInt(parts[1], 10) };
      const on = () => {
        if (!this.hover || this.hover.chart !== h.chart || this.hover.i !== h.i) {
          this.hover = h;
          this.render();
        }
      };
      s.addEventListener("pointerenter", on);
      s.addEventListener("pointerdown", on);
    });
    Array.prototype.forEach.call(el.querySelectorAll(".hov"), (hov) =>
      hov.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse" && this.hover) {
          this.hover = null;
          this.render();
        }
      })
    );
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
