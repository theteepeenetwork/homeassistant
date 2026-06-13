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

// Long-term statistics, fetched on a slow timer by app.js (ha.getStatistics).
// Shape: { [statistic_id]: [{ start, end, change, sum, state }, ...] }.
let statsData = {};
export function setStats(obj) { statsData = (obj && typeof obj === 'object') ? obj : {}; }
function hasStats() { return Object.keys(statsData).length > 0; }

// Solar history (Sigenergy portal) JSON, fetched on a slow timer by app.js.
// Shape: { asOf, rates, periods: { mtd: {...}, ytd: {...} } } — see sigen-portal.py.
let solarHistory = null;
export function setSolarHistory(obj) { solarHistory = (obj && typeof obj === 'object') ? obj : null; }

// ---- Period windows ---------------------------------------------------------
//  All budget figures are aligned to COMPLETED days (grid cost is only final
//  ~24h late), so every window ends at local midnight today (today excluded).
//  Three columns: yesterday, month-to-date, year-to-date. Order here is also
//  the column order in the budget table.
const PERIODS = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'month',     label: 'Month', sub: 'to date' },
  { key: 'year',      label: 'Year',  sub: 'to date' },
];

function periodWindows(now = new Date()) {
  const dayMs = 86400000;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const mk = (start, end) => ({ start, end, days: Math.max(0, Math.round((end - start) / dayMs)) });
  return {
    yesterday: mk(todayStart - dayMs, todayStart),
    month:     mk(monthStart, todayStart),  // month-to-date (today excluded)
    year:      mk(yearStart, todayStart),   // year-to-date (today excluded)
    todayStart,
  };
}

// Sum a statistic's per-day `change` over [startMs, endMs). Falls back to the
// difference of cumulative `sum` across the window edges if `change` is absent.
// Returns null when no usable data lands in the window.
function sumChange(rows, startMs, endMs) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let total = null, firstSum = null, lastSum = null, sawChange = false;
  for (const r of rows) {
    const t = typeof r.start === 'number' ? r.start : Date.parse(r.start);
    if (t == null || Number.isNaN(t) || t < startMs || t >= endMs) continue;
    if (r.change != null && Number.isFinite(Number(r.change))) {
      total = (total || 0) + Number(r.change); sawChange = true;
    }
    if (r.sum != null && Number.isFinite(Number(r.sum))) {
      if (firstSum == null) firstSum = Number(r.sum);
      lastSum = Number(r.sum);
    }
  }
  if (sawChange) return total;
  if (firstSum != null && lastSum != null) return lastSum - firstSum;
  return null;
}

// Sum a configured statistic id over a window, or null if unwired/unavailable.
function statSum(statId, win) {
  if (!statId) return null;
  return sumChange(statsData[statId], win.start, win.end);
}

// The query app.js sends to ha.getStatistics: all wired stat ids over the widest
// window we need (earliest period start -> now).
export function statsQuery() {
  const S = ENTITIES.stats || {};
  const ids = Array.from(new Set(Object.values(S).filter(Boolean)));
  const w = periodWindows();
  // Earliest start across all periods (yesterday can precede year-start on Jan 1).
  const start = Math.min(w.yesterday.start, w.year.start);
  return { ids, start: new Date(start).toISOString(), end: new Date(w.todayStart).toISOString() };
}

const EV_MAX_KW = 7.4;       // Ohme single-phase ceiling, for the gauge scale
const FLOW_MIN_W = 20;       // ignore sub-20W noise so flow lines don't flicker

// ---- formatting helpers -----------------------------------------------------
const round = (n, d = 0) => (n == null ? null : Number(n).toFixed(d));
const fmtTemp = (n) => (n == null ? '—' : `${Math.round(n)}°`);
const fmtPct  = (n) => (n == null ? '—' : `${Math.round(n)}%`);
const fmtMoney = (n) => (n == null ? '—' : new Intl.NumberFormat(CONFIG.locale,
  { style: 'currency', currency: CONFIG.currency }).format(n));
const fmtKwh = (n) => (n == null ? '—' : `${Number(n).toFixed(1)} kWh`);

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

  // Today hi/lo + 7-day chips come from the daily forecast (slow timer).
  const days = forecastData.slice(0, 8);
  if (days.length) {
    const today = days[0];
    const hi = today.temperature ?? today.native_temperature;
    const lo = today.templow ?? today.native_templow;
    $('wx-hilo').textContent = `H ${fmtTemp(hi)}   L ${fmtTemp(lo)}`;

    const fc = $('wx-forecast');
    fc.innerHTML = days.slice(1, 8).map((d) => {
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
  const heatToday = ha.getNumber(C.elecDaily && C.elecDaily[0]);
  const dhwToday  = ha.getNumber(C.elecDaily && C.elecDaily[1]);
  const elec = (heatToday == null && dhwToday == null) ? null : (heatToday || 0) + (dhwToday || 0);
  $('hp-power').textContent = elec == null ? '—' : `${elec.toFixed(1)} kWh`;

  // ---- Cost of heating vs hot water (today + month-to-date) ----------------
  //  HP exposes only kWh, so cost = kWh × blended £/kWh (CONFIG.heatPump). Month
  //  = completed-day statistics + today's live value. Upper-bound grid price
  //  (ignores solar self-use); see config comment.
  const rate = (CONFIG.heatPump && CONFIG.heatPump.blendedRatePerKwh) || null;
  const ST = ENTITIES.stats || {};
  const month = periodWindows().month;
  const monthKwh = (statId, todayKwh) => {
    const past = statSum(statId, month);          // completed days this month
    if (past == null && todayKwh == null) return null;
    return (past || 0) + (todayKwh || 0);          // + today's partial (live)
  };
  const cost = (kwh) => (rate != null && kwh != null ? kwh * rate : null);

  setText('hp-heat-cost-today', fmtMoney(cost(heatToday)));
  setText('hp-heat-cost-month', fmtMoney(cost(monthKwh(ST.heatingKwh, heatToday))));
  setText('hp-dhw-cost-today',  fmtMoney(cost(dhwToday)));
  setText('hp-dhw-cost-month',  fmtMoney(cost(monthKwh(ST.dhwKwh, dhwToday))));

  renderRooms();
}

function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

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
//  A period × metric table (yesterday · month-to-date · year-to-date).
//  Figures come from HA long-term statistics (ha.getStatistics, bucketed per
//  period). The "yesterday" column also falls back to the live previous-day
//  budget.* sensors, so it still works before statistics/WS are wired.
//
//  Cost basis:
//    import £ = grid import cost · export £ = export income (a credit)
//    standing £ = £/day × completed days in the period
//    car £   = car kWh × off-peak rate (per the OHME dispatch caveat)
//    net WITH car = import + standing − export  (already includes car charging)
//    net WITHOUT car = net with car − car £
//  Negative net = credit (you earned more than you paid).
function renderBudget() {
  const B = ENTITIES.budget, O = ENTITIES.octopus, S = ENTITIES.sigen, ST = ENTITIES.stats || {};
  const win = periodWindows();

  const offPeak  = ha.getAttr(O.importRate, 'current_day_min_rate');
  const standingPerDay = (ha.getNumber(B.importStanding) ?? 0) + (ha.getNumber(B.exportStanding) ?? 0);

  // Live "yesterday" fallback from the previous-day accumulative sensors.
  const live = {
    importCost: ha.getNumber(B.importCost),
    importKwh:  ha.getNumber(B.importKwh),
    exportCost: ha.getNumber(B.exportIncome),
    exportKwh:  ha.getNumber(B.exportKwh),
    genKwh:     ha.getNumber(B.genDailyKwh),
    carKwh:     toNum(ha.getAttr(B.carToday, 'total_consumption')),
  };
  const genLive = ha.isAvailable(B.genDailyKwh) || ha.isAvailable(S.solarPower);

  // Month/Year-to-date import, export and generation come from the Sigenergy
  // portal history (solar-history.json) when present — real figures without the
  // HA statistics WebSocket. £ = portal kWh priced at the JSON's import/export
  // rates. Yesterday stays on the live previous-day sensors / HA stats.
  const portal = solarHistory && solarHistory.periods;
  const pRates = (solarHistory && solarHistory.rates) || {};
  const importRate = toNum(pRates.import);
  const exportRate = toNum(pRates.export);
  const portalFor = (key) => (!portal ? null
    : key === 'month' ? (portal.mtd || null)
    : key === 'year'  ? (portal.ytd || null) : null);

  // Build one metrics object per period.
  const cols = PERIODS.map(({ key }) => {
    const w = win[key];
    const yest = key === 'yesterday';
    const ph = portalFor(key);

    // import / export / generation: portal (month/year) → HA stats → live (yest)
    let importCost, importKwh, exportCost, exportKwh, genKwh;
    if (ph) {
      importKwh  = toNum(ph.import);
      exportKwh  = toNum(ph.export);
      genKwh     = toNum(ph.pv);
      importCost = (importKwh != null && importRate != null) ? importKwh * importRate : null;
      exportCost = (exportKwh != null && exportRate != null) ? exportKwh * exportRate : null;
    } else {
      importCost = statSum(ST.importCost, w) ?? (yest ? live.importCost : null);
      importKwh  = statSum(ST.importKwh,  w) ?? (yest ? live.importKwh  : null);
      exportCost = statSum(ST.exportCost, w) ?? (yest ? live.exportCost : null);
      exportKwh  = statSum(ST.exportKwh,  w) ?? (yest ? live.exportKwh  : null);
      genKwh     = statSum(ST.generationKwh, w) ?? (yest && genLive ? live.genKwh : null);
    }

    // car: HA stats → live yesterday → live month cost-tracker (month column)
    let carKwh = statSum(ST.carKwh, w) ?? (yest ? live.carKwh : null);
    if (carKwh == null && key === 'month') carKwh = toNum(ha.getAttr(B.carMonth, 'total_consumption'));
    const carCost  = (offPeak != null && carKwh != null) ? carKwh * Number(offPeak) : null;
    const standing = w.days > 0 ? standingPerDay * w.days : (yest ? standingPerDay : null);
    const netIncl = (importCost != null && exportCost != null)
      ? importCost + (standing || 0) - exportCost : null;
    const netExcl = (netIncl != null && carCost != null) ? netIncl - carCost : null;
    return { importCost, importKwh, exportCost, exportKwh, genKwh, carKwh, carCost, standing, netIncl, netExcl };
  });

  // Render the table.
  const head = `<tr><th class="bt-corner"></th>${
    PERIODS.map((p) => `<th>${p.label}${p.sub ? `<em>${p.sub}</em>` : ''}</th>`).join('')}</tr>`;

  const cell = (main, sub, cls = '') =>
    `<td class="${cls}"><span class="bt-amt tnum">${main}</span>${
      sub ? `<span class="bt-sub tnum">${sub}</span>` : ''}</td>`;

  const moneyRow = (label, pick, { credit = false } = {}) => `<tr>
    <th class="bt-lbl">${label}</th>${cols.map((c) => {
      const v = pick(c);
      if (v == null) return cell('—', '');
      const txt = credit ? '+' + fmtMoney(v) : fmtMoney(v);
      return cell(txt, '', credit ? 'bt-credit' : '');
    }).join('')}</tr>`;

  const importRow = `<tr><th class="bt-lbl">Import</th>${
    cols.map((c) => cell(fmtMoney(c.importCost), fmtKwhOrBlank(c.importKwh))).join('')}</tr>`;
  const exportRow = `<tr><th class="bt-lbl">Export</th>${
    cols.map((c) => cell(c.exportCost == null ? '—' : '+' + fmtMoney(c.exportCost),
      fmtKwhOrBlank(c.exportKwh), 'bt-credit')).join('')}</tr>`;
  const genRow = `<tr><th class="bt-lbl">Generation</th>${
    cols.map((c) => cell(c.genKwh == null ? (genLive ? '—' : 'n/a') : fmtKwh(c.genKwh), '', 'bt-muted')).join('')}</tr>`;
  const carRow = `<tr><th class="bt-lbl">Car</th>${
    cols.map((c) => cell(fmtMoney(c.carCost), fmtKwhOrBlank(c.carKwh))).join('')}</tr>`;
  const standingRow = moneyRow('Standing', (c) => c.standing);
  const netInclRow = `<tr class="bt-net"><th class="bt-lbl">Net <em>with car</em></th>${
    cols.map((c) => netCell(c.netIncl)).join('')}</tr>`;
  const netExclRow = `<tr class="bt-net"><th class="bt-lbl">Net <em>no car</em></th>${
    cols.map((c) => netCell(c.netExcl)).join('')}</tr>`;

  $('budget-grid').innerHTML =
    `<table class="budget-table tnum"><thead>${head}</thead><tbody>` +
    importRow + exportRow + genRow + carRow + standingRow + netInclRow + netExclRow +
    `</tbody></table>`;

  const badge = $('budget-badge');
  const live2 = hasStats() || !!portal;
  badge.className = 'badge ' + (live2 ? 'badge-ok' : 'badge-warn');
  badge.textContent = hasStats() ? 'live'
    : portal ? 'MTD/YTD from portal' : 'yesterday only';
}

// ---- Solar to-date (Sigenergy portal history) -------------------------------
//  True month-to-date / year-to-date generation + revenue from the Sigen cloud
//  portal (HA only has recent data). Fed from data/solar-history.json, produced
//  by sigen-portal.py off the portal's daily "Energy (kWh)" export. Net grid is
//  the portal kWh priced at the Octopus rates baked into the JSON (negative =
//  earned). Degrades to a hint when the JSON is absent.
function renderSolarHistory() {
  const grid = $('solar-hist');
  const badge = $('solar-hist-badge');
  if (!grid || !badge) return;

  const h = solarHistory;
  const p = h && h.periods;
  if (!p || (!p.mtd && !p.ytd)) {
    badge.className = 'badge badge-warn';
    badge.textContent = 'no data';
    grid.innerHTML = '<div class="sh-empty">Run sigen-portal.py on a portal export to populate.</div>';
    return;
  }

  badge.className = 'badge badge-ok';
  badge.textContent = h.asOf ? `as of ${h.asOf}` : 'live';

  const net = (v) => (v == null ? '—'
    : v < -0.005 ? `+${fmtMoney(-v)}` : fmtMoney(v));
  const netCls = (v) => (v == null ? '' : v < -0.005 ? 'sh-credit' : 'sh-spend');

  const col = (per) => {
    if (!per) return '';
    return `<div class="sh-col">
      <div class="sh-label">${escapeHtml(per.label || '')}</div>
      <div class="sh-pv tnum">${fmtKwh(per.pv)}</div>
      <div class="sh-pv-cap">generated</div>
      <div class="sh-rows tnum">
        <div><span>Export</span><span>${fmtKwh(per.export)}</span></div>
        <div><span>Revenue</span><span class="sh-credit">${per.revenue == null ? '—' : fmtMoney(per.revenue)}</span></div>
        <div><span>Grid net</span><span class="${netCls(per.netGridCost)}">${net(per.netGridCost)}</span></div>
      </div>
    </div>`;
  };

  grid.innerHTML = col(p.mtd) + col(p.ytd);
}

const toNum = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const fmtKwhOrBlank = (n) => (n == null ? '' : fmtKwh(n));

// A net cell: credit (+, green) when negative, spend (amber) when positive.
function netCell(val) {
  if (val == null) return `<td><span class="bt-amt tnum">—</span></td>`;
  const credit = val < -0.005;
  const txt = credit ? '+' + fmtMoney(-val) : fmtMoney(val);
  return `<td class="${credit ? 'bt-net-credit' : 'bt-net-spend'}"><span class="bt-amt tnum">${txt}</span></td>`;
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
  safe('solar',   renderSolarHistory);
  safe('footer',  renderFooter);
}
