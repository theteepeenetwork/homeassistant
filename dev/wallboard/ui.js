// =============================================================================
//  ui.js — render layer
// -----------------------------------------------------------------------------
//  render() is a PURE function of the ha.js cache: it reads current entity
//  states and writes them into the static DOM (built once in index.html).
//  It never creates/destroys the energy-flow SVG or gauges, so CSS animations
//  don't restart and there's nothing to leak over weeks of uptime.
// =============================================================================

import { CONFIG, ENTITIES } from './config.js';
import * as ha from './ha.js';
import { weatherIcon } from './icons.js';

const $ = (id) => document.getElementById(id);

// Forecast is fetched on a slow timer by app.js and handed in here.
let forecastData = [];
export function setForecast(arr) { forecastData = Array.isArray(arr) ? arr : []; }

const EV_MAX_KW = 7.4;       // Ohme single-phase ceiling, for the gauge scale
const FLOW_MIN_W = 20;       // ignore sub-20W noise so flow lines don't flicker

// ---- formatting helpers -----------------------------------------------------
const round = (n, d = 0) => (n == null ? null : Number(n).toFixed(d));
const fmtTemp = (n) => (n == null ? '—' : `${Math.round(n)}°`);
const fmtPct  = (n) => (n == null ? '—' : `${Math.round(n)}%`);
const fmtMoney = (n) => (n == null ? '—' : new Intl.NumberFormat(CONFIG.locale,
  { style: 'currency', currency: CONFIG.currency }).format(n));

function fmtWatts(w) {
  if (w == null) return '—';
  const a = Math.abs(w);
  if (a >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
}
function fmtWithUnit(id) {
  const n = ha.getNumber(id);
  if (n == null) return '—';
  const u = ha.getAttr(id, 'unit_of_measurement', '');
  return `${n}${u ? ' ' + u : ''}`;
}

// Read a power entity and normalise to WATTS regardless of its native unit.
// Sigenergy reports power in kW; some integrations use W or MW. fmtWatts then
// renders W as integer watts and ≥1 kW with two decimals.
function powerW(id) {
  const n = ha.getNumber(id);
  if (n == null) return null;
  const u = String(ha.getAttr(id, 'unit_of_measurement', '') || '').toLowerCase();
  if (u === 'kw') return n * 1000;
  if (u === 'mw') return n * 1e6;
  return n; // assume already watts
}

// =============================================================================
//  Sections
// =============================================================================

function renderHeader() {
  const w = ENTITIES.weather;
  const cond = ha.getState(w);
  const temp = ha.getNumber(w) ?? ha.getAttr(w, 'temperature');

  $('wx-icon').innerHTML = weatherIcon(cond);
  $('wx-temp').textContent = fmtTemp(temp);
  $('wx-cond').textContent = cond ? cond.replace(/-/g, ' ') : '—';

  // Today hi/lo + 3-day chips come from the daily forecast (slow timer).
  const days = forecastData.slice(0, 4);
  if (days.length) {
    const today = days[0];
    const hi = today.temperature ?? today.native_temperature;
    const lo = today.templow ?? today.native_templow;
    $('wx-hilo').textContent = `H ${fmtTemp(hi)}   L ${fmtTemp(lo)}`;

    const fc = $('wx-forecast');
    fc.innerHTML = days.slice(1, 4).map((d) => {
      const name = new Date(d.datetime).toLocaleDateString(CONFIG.locale, { weekday: 'short' });
      const dhi = d.temperature ?? d.native_temperature;
      const dlo = d.templow ?? d.native_templow;
      return `<div class="wx-day">
        <div class="d-name">${name}</div>
        <div class="d-icon">${weatherIcon(d.condition)}</div>
        <div class="d-hilo"><span class="d-hi">${fmtTemp(dhi)}</span>
          <span class="d-lo">${fmtTemp(dlo)}</span></div>
      </div>`;
    }).join('');
  }
}

function renderEnergy() {
  const S = ENTITIES.sigen;
  const signs = ENTITIES.sigenSigns;

  const solarW = powerW(S.solarPower);
  const houseW = powerW(S.houseLoad);
  const battSoc = ha.getNumber(S.batterySoc);
  let battW = powerW(S.batteryPower);
  let gridW = powerW(S.gridPower);

  const anyAvailable = [S.solarPower, S.batterySoc, S.batteryPower, S.gridPower, S.houseLoad]
    .some((id) => ha.isAvailable(id));

  const badge = $('sigen-badge');
  if (!anyAvailable) {
    badge.className = 'badge badge-warn';
    badge.textContent = 'awaiting Sigen';
  } else {
    badge.className = 'badge badge-ok';
    badge.textContent = 'live';
  }

  // Node values + dim when unavailable
  setNode('solar-val', solarW != null ? fmtWatts(solarW) : '—', S.solarPower);
  setNode('home-val',  houseW != null ? fmtWatts(houseW) : '—', S.houseLoad);
  setNode('grid-val',  gridW  != null ? fmtWatts(Math.abs(gridW)) : '—', S.gridPower);
  setNode('batt-val',  battSoc != null ? fmtPct(battSoc) : '—', S.batterySoc);

  // Battery SOC ring
  const ring = $('batt-ring');
  const soc = battSoc == null ? 0 : Math.max(0, Math.min(100, battSoc));
  ring.setAttribute('stroke-dasharray', `${soc} ${100 - soc}`);
  ring.style.stroke = soc < 20 ? 'var(--amber)' : 'var(--green)';

  // Normalise signs to: battW>0 = charging, gridW>0 = importing
  if (battW != null && !signs.batteryPositiveMeansCharging) battW = -battW;
  if (gridW != null && !signs.gridPositiveMeansImport) gridW = -gridW;

  // Flow animations
  flowLine('flow-solar', solarW != null && solarW > FLOW_MIN_W, 'solar', false);

  if (gridW == null) flowLine('flow-grid', false);
  else if (gridW > FLOW_MIN_W) flowLine('flow-grid', true, 'import', false);
  else if (gridW < -FLOW_MIN_W) flowLine('flow-grid', true, 'export', true);
  else flowLine('flow-grid', false);

  if (battW == null) flowLine('flow-batt', false);
  else if (battW > FLOW_MIN_W) flowLine('flow-batt', true, 'charge', false);   // home -> battery
  else if (battW < -FLOW_MIN_W) flowLine('flow-batt', true, 'discharge', true); // battery -> home
  else flowLine('flow-batt', false);
}

function setNode(textId, value, availId) {
  const el = $(textId);
  el.textContent = value;
  const node = el.closest('.node');
  if (node) node.classList.toggle('dim', !ha.isAvailable(availId));
}

function flowLine(id, active, cls, reverse) {
  const el = $(id);
  el.classList.remove('solar', 'import', 'export', 'charge', 'discharge', 'reverse');
  el.classList.toggle('active', !!active);
  if (active && cls) el.classList.add(cls);
  if (active && reverse) el.classList.add('reverse');
}

function renderEV() {
  const E = ENTITIES.ev, O = ENTITIES.octopus;

  // Status badge
  const status = ha.getState(E.status) || '—';
  const badge = $('ev-status');
  badge.textContent = status.replace(/_/g, ' ');
  badge.className = 'badge ' + ({
    charging: 'badge-ok',
    plugged_in: 'badge-warn',
    pending_approval: 'badge-warn',
    finished: 'badge-info',
  }[status] || '');

  // Power gauge
  const kw = ha.getNumber(E.power);
  const pct = kw == null ? 0 : Math.max(0, Math.min(100, (kw / EV_MAX_KW) * 100));
  const g = $('ev-gauge');
  g.setAttribute('stroke-dasharray', `${pct} ${100 - pct}`);
  g.style.stroke = status === 'charging' ? 'var(--green)' : 'var(--fg-mute)';
  $('ev-power').textContent = kw == null ? '— kW' : `${kw.toFixed(1)} kW`;

  $('ev-veh').textContent = fmtPct(ha.getNumber(E.vehicleBatt));
  $('ev-kwh').textContent = (() => {
    const n = ha.getNumber(E.energy);
    return n == null ? '—' : `${n.toFixed(2)} kWh`;
  })();
  $('ev-mode').textContent = (ha.getState(E.chargeMode) || '—').replace(/_/g, ' ');

  // ---- Accurate off-peak cost (see README) -------------------------------
  // cost = cost-tracker `total_consumption` kWh  x  off-peak (current_day_min_rate)
  const offPeak = ha.getAttr(O.importRate, 'current_day_min_rate');
  const rateNow = ha.getNumber(O.importRate);
  $('ev-rate').textContent = rateNow == null ? '—' : fmtMoney(rateNow) + '/kWh';

  const kwhToday = ha.getAttr(O.costTrackerToday, 'total_consumption');
  const kwhWeek  = ha.getAttr(O.costTrackerWeek, 'total_consumption');
  const kwhMonth = ha.getAttr(O.costTrackerMonth, 'total_consumption');

  const cost = (kwh) => (offPeak != null && kwh != null ? Number(kwh) * Number(offPeak) : null);
  $('ev-cost-today').textContent = fmtMoney(cost(kwhToday));
  const w = cost(kwhWeek), m = cost(kwhMonth);
  $('ev-cost-wm').textContent = (w == null && m == null) ? '—'
    : `${fmtMoney(w)} / ${fmtMoney(m)}`;
}

function renderClimate() {
  const C = ENTITIES.climate;
  const hp = C.heatPump;

  const mode = ha.getAttr(hp, 'hvac_action') || ha.getState(hp) || '—';
  const badge = $('hp-mode');
  badge.textContent = String(mode).replace(/_/g, ' ');
  badge.className = 'badge ' + (
    /heat/.test(mode) ? 'badge-ok' : /off|idle/.test(mode) ? '' : 'badge-info');

  $('hp-target').textContent  = fmtTemp(ha.getAttr(hp, 'temperature'));
  $('hp-flow').textContent    = fmtTemp(ha.getNumber(C.flowTemp));
  $('hp-dhw').textContent     = fmtTemp(ha.getNumber(C.dhwTankTemp));
  $('hp-outdoor').textContent = fmtTemp(ha.getNumber(C.outdoorTemp));
  // Onecta exposes no instantaneous power, so show today's electricity:
  // space-heating + hot-water daily kWh, summed.
  let elec = null;
  for (const id of (C.elecDaily || [])) {
    const n = ha.getNumber(id);
    if (n != null) elec = (elec || 0) + n;
  }
  $('hp-power').textContent = elec == null ? '—' : `${elec.toFixed(1)} kWh`;

  renderRooms();
}

function renderRooms() {
  // Build the list of rooms: curated first, then auto-discovered (safety net).
  const used = collectUsedEntityIds();
  let rooms = ENTITIES.rooms.map((r) => ({
    name: r.name,
    temp: ha.getNumber(r.temp),
    hum: r.humidity ? ha.getNumber(r.humidity) : null,
  }));

  if (CONFIG.autoDiscoverRooms) {
    const exclude = /outdoor|cpu|server|ohme|flow|tank|dhw|fridge|freezer|battery/i;
    for (const e of ha.allEntities()) {
      if (!e.entity_id.startsWith('sensor.')) continue;
      if (e.attributes?.device_class !== 'temperature') continue;
      const unit = e.attributes?.unit_of_measurement || '';
      if (!/°?C/i.test(unit)) continue;
      if (used.has(e.entity_id)) continue;
      if (exclude.test(e.entity_id)) continue;
      const name = (e.attributes?.friendly_name || e.entity_id)
        .replace(/\s*temperature$/i, '').trim();
      rooms.push({ name, temp: ha.getNumber(e.entity_id), hum: pairedHumidity(e.entity_id) });
    }
  }

  rooms = rooms.filter((r) => r.temp != null).slice(0, 8);

  const grid = $('rooms-grid');
  if (!rooms.length) {
    grid.innerHTML = '<div class="room-empty">No room sensors found yet.</div>';
    return;
  }
  grid.innerHTML = rooms.map((r) => `
    <div class="room">
      <div class="r-name">${escapeHtml(r.name)}</div>
      <div class="r-vals">
        <span class="r-temp tnum">${fmtTemp(r.temp)}</span>
        ${r.hum != null ? `<span class="r-hum tnum">${fmtPct(r.hum)} RH</span>` : ''}
      </div>
    </div>`).join('');
}

function pairedHumidity(tempId) {
  const guess = tempId.replace(/temperature/i, 'humidity');
  return guess !== tempId ? ha.getNumber(guess) : null;
}

function collectUsedEntityIds() {
  const ids = new Set();
  const walk = (o) => {
    if (!o) return;
    if (typeof o === 'string') { ids.add(o); return; }
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o === 'object') Object.values(o).forEach(walk);
  };
  walk(ENTITIES);
  return ids;
}

// ---- Running budget ---------------------------------------------------------
//  Grid import/export come from the *previous complete day* (meter lags ~24h).
//  Car spend is the live cost tracker (month-to-date), priced off-peak.
//  net incl. car = import + standing − export  (the real bill for that day,
//  which already includes any car charging that day).
//  net excl. car = net incl. car − car spend  (car priced off-peak).
//  Negative net = credit (you earned more than you paid).
function renderBudget() {
  const B = ENTITIES.budget, O = ENTITIES.octopus, S = ENTITIES.sigen;

  const importCost     = ha.getNumber(B.importCost);
  const importKwh      = ha.getNumber(B.importKwh);
  const importStanding = ha.getNumber(B.importStanding) ?? 0;
  const exportInc      = ha.getNumber(B.exportIncome);
  const exportKwh      = ha.getNumber(B.exportKwh);
  const exportStanding = ha.getNumber(B.exportStanding) ?? 0;
  const standing       = importStanding + exportStanding;

  // Car priced at off-peak (per the OHME dispatch caveat): kWh × off-peak rate.
  const offPeak    = ha.getAttr(O.importRate, 'current_day_min_rate');
  const carKwhMo   = ha.getAttr(B.carMonth, 'total_consumption');
  const carKwhDay  = ha.getAttr(B.carToday, 'total_consumption');
  const carCostMo  = (offPeak != null && carKwhMo  != null) ? Number(carKwhMo)  * Number(offPeak) : null;
  const carCostDay = (offPeak != null && carKwhDay != null) ? Number(carKwhDay) * Number(offPeak) : null;

  // Rows
  $('b-import').textContent     = fmtMoney(importCost);
  $('b-import-kwh').textContent = importKwh == null ? '—' : `${importKwh.toFixed(1)} kWh`;
  $('b-export').textContent     = exportInc == null ? '—' : '+' + fmtMoney(exportInc);
  $('b-export-kwh').textContent = exportKwh == null ? '—' : `${exportKwh.toFixed(1)} kWh`;
  $('b-standing').textContent   = fmtMoney(standing);
  $('b-car').textContent        = fmtMoney(carCostMo);
  $('b-car-kwh').textContent    = carKwhMo == null ? '—' : `${Number(carKwhMo).toFixed(1)} kWh`;

  // Generation — live once Sigen exposes a daily PV energy sensor, else placeholder.
  const genKwh = ha.getNumber(B.genDailyKwh);
  const genLive = ha.isAvailable(B.genDailyKwh) || ha.isAvailable(S.solarPower);
  $('b-gen').textContent     = genLive && genKwh != null ? `${genKwh.toFixed(1)} kWh` : 'awaiting Sigen';
  $('b-gen-kwh').textContent = '';

  // Nets (yesterday grid basis)
  const netIncl = (importCost != null && exportInc != null) ? importCost + standing - exportInc : null;
  const netExcl = (netIncl != null && carCostDay != null) ? netIncl - carCostDay : null;
  setNet('b-net-incl', netIncl);
  setNet('b-net-excl', netExcl);

  const badge = $('budget-badge');
  badge.className = 'badge ' + (genLive ? 'badge-ok' : 'badge-warn');
  badge.textContent = genLive ? 'live' : 'yest + month';
}

// Show a net as credit (+, green) when negative, or spend (plain) when positive.
function setNet(id, val) {
  const el = $(id);
  if (val == null) { el.textContent = '—'; el.className = 'net-val tnum'; return; }
  const credit = val < -0.005;
  el.textContent = credit ? '+' + fmtMoney(-val) : fmtMoney(val);
  el.className = 'net-val tnum ' + (credit ? 'credit' : 'spend');
}

function relativeOrState(id) {
  const e = ha.getEntity(id);
  if (!e || e.state === 'unknown' || e.state === 'unavailable') return '—';
  // If the state parses as a timestamp, show "Nh ago"; else show raw state.
  const t = Date.parse(e.state);
  if (!Number.isNaN(t)) {
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }
  return e.state;
}

function renderFooter() {
  const st = ha.getStatus();
  const live = $('live');
  const text = $('live-text');
  const updated = $('updated');

  if (!st.everConnected) {
    live.className = 'live down'; text.textContent = 'connecting…';
    updated.textContent = 'last update —';
    return;
  }
  updated.textContent = 'last update ' + new Date(st.lastSuccessMs)
    .toLocaleTimeString(CONFIG.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (st.consecutiveErrors > 0 && st.stale) {
    live.className = 'live down'; text.textContent = 'offline — retrying';
  } else if (st.stale) {
    live.className = 'live stale'; text.textContent = 'stale';
  } else {
    live.className = 'live ok'; text.textContent = 'live';
  }
}

// ---- misc -------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// =============================================================================
//  Top-level render — called on every data tick. Each section is isolated so a
//  bad value in one place can't blank the rest of the board.
// =============================================================================
export function render() {
  const safe = (label, fn) => { try { fn(); } catch (e) { console.error(`[wallboard] render ${label}`, e); } };
  safe('header',  renderHeader);
  safe('energy',  renderEnergy);
  safe('ev',      renderEV);
  safe('climate', renderClimate);
  safe('budget',  renderBudget);
  safe('footer',  renderFooter);
}
