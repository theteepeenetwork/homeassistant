// =============================================================================
//  app.js — orchestration
// -----------------------------------------------------------------------------
//  Wires the data layer to the renderer and runs the always-on housekeeping:
//    - clock (client-side; HA is never polled for time)
//    - night dimming (CSS brightness)
//    - daily silent reload watchdog (~04:00) against memory leaks
//    - slow weather-forecast refresh
//  Everything is defensive: a throw anywhere is logged, never shown as a dialog.
// =============================================================================

import { CONFIG, ENTITIES } from './config.js';
import * as ha from './ha.js';
import { render, setForecast, setStats, statsQuery } from './ui.js';

// Never let an uncaught error surface as a browser dialog on the wall.
window.addEventListener('error', (e) => console.error('[wallboard] window error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[wallboard] rejection', e.reason));

// ---- Clock ------------------------------------------------------------------
function tickClock() {
  const now = new Date();
  const clock = document.getElementById('clock');
  const date = document.getElementById('date');
  if (clock) clock.textContent = now.toLocaleTimeString(CONFIG.locale, { hour: '2-digit', minute: '2-digit' });
  if (date) date.textContent = now.toLocaleDateString(CONFIG.locale,
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ---- Night dim --------------------------------------------------------------
function applyNightDim() {
  const screen = document.getElementById('screen');
  if (!screen) return;
  const cfg = CONFIG.nightDim;
  if (!cfg.enabled) { screen.classList.remove('night'); return; }
  const h = new Date().getHours();
  // Window may wrap past midnight (e.g. 23 -> 6).
  const night = cfg.startHour > cfg.endHour
    ? (h >= cfg.startHour || h < cfg.endHour)
    : (h >= cfg.startHour && h < cfg.endHour);
  screen.style.setProperty('--night-brightness', String(cfg.brightness));
  screen.classList.toggle('night', night);
}

// ---- Daily reload watchdog --------------------------------------------------
//  Reload once, shortly after the configured hour:minute. Guard so we only fire
//  inside a small window and not repeatedly within the same minute.
let lastReloadDay = -1;
function maybeDailyReload() {
  if (!CONFIG.dailyReload.enabled) return;
  const now = new Date();
  const { atHour, atMinute } = CONFIG.dailyReload;
  if (now.getHours() === atHour && now.getMinutes() === atMinute && now.getDate() !== lastReloadDay) {
    lastReloadDay = now.getDate();
    console.info('[wallboard] daily watchdog reload');
    location.reload();
  }
}

// ---- Forecast (slow refresh) ------------------------------------------------
async function refreshForecast() {
  const fc = await ha.getForecast(ENTITIES.weather, 'daily');
  if (fc.length) { setForecast(fc); render(); }
}

// ---- Statistics (slow refresh) ----------------------------------------------
//  Multi-period budget + heat-pump month cost come from HA long-term statistics.
//  Fetched here on a slow timer and handed to ui.js; render() buckets per period.
async function refreshStats() {
  const q = statsQuery();
  if (!q.ids.length) return;
  const data = await ha.getStatistics(q.ids, q.start, q.end, 'day');
  setStats(data);
  render();
}

// ---- Boot -------------------------------------------------------------------
function boot() {
  tickClock();
  applyNightDim();

  // Re-render whenever fresh data lands.
  ha.onUpdate(render);
  ha.startPolling();

  // First forecast pull once HA is reachable, then every 15 min.
  refreshForecast();
  setInterval(refreshForecast, 15 * 60 * 1000);

  // Statistics (multi-period budget + heat-pump month cost), slow refresh.
  refreshStats();
  setInterval(refreshStats, CONFIG.statsRefreshMs);

  // 1s housekeeping tick for clock / night-dim / watchdog (cheap, no leaks).
  setInterval(() => {
    tickClock();
    applyNightDim();
    maybeDailyReload();
  }, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
