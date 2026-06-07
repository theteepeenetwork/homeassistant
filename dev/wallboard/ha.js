// =============================================================================
//  ha.js — Home Assistant data layer
// -----------------------------------------------------------------------------
//  Single responsibility: keep a fresh in-memory cache of HA entity states by
//  polling /api/states (same-origin; Caddy injects the Bearer token), with
//  exponential backoff and a "stale" flag. The UI never talks to HA directly —
//  it reads from this cache. Render is a pure function of the cache.
// =============================================================================

import { CONFIG } from './config.js';

// entity_id -> state object { entity_id, state, attributes, last_updated }
const cache = new Map();

const status = {
  lastSuccessMs: 0,     // wall-clock of the last good poll (0 = never)
  lastErrorText: '',
  consecutiveErrors: 0,
  connected: false,     // got at least one good poll recently
};

const listeners = new Set();

/** Subscribe to "data changed" ticks. Returns an unsubscribe fn. */
export function onUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (e) { console.error('[wallboard] listener error', e); }
  }
}

/** Get a raw HA state object by entity_id, or null if unknown/never seen. */
export function getEntity(id) {
  if (!id) return null;
  return cache.get(id) || null;
}

/** Get the .state string, or null. */
export function getState(id) {
  const e = getEntity(id);
  return e ? e.state : null;
}

/** Get a numeric state, or null if missing / unavailable / NaN. */
export function getNumber(id) {
  const s = getState(id);
  if (s == null || s === 'unavailable' || s === 'unknown' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Get a single attribute, or fallback. */
export function getAttr(id, attr, fallback = null) {
  const e = getEntity(id);
  if (!e || !e.attributes) return fallback;
  const v = e.attributes[attr];
  return v === undefined ? fallback : v;
}

/** True if the entity exists and isn't unavailable/unknown. */
export function isAvailable(id) {
  const s = getState(id);
  return s != null && s !== 'unavailable' && s !== 'unknown';
}

/** Connection health snapshot for the footer indicator. */
export function getStatus() {
  const age = status.lastSuccessMs ? Date.now() - status.lastSuccessMs : Infinity;
  return {
    everConnected: status.lastSuccessMs > 0,
    stale: age > CONFIG.staleAfterMs,
    ageMs: age,
    lastSuccessMs: status.lastSuccessMs,
    consecutiveErrors: status.consecutiveErrors,
    lastErrorText: status.lastErrorText,
  };
}

/** All currently-cached entity objects (used for room auto-discovery). */
export function allEntities() {
  return Array.from(cache.values());
}

// ---- Polling ----------------------------------------------------------------

async function fetchStatesOnce() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(`${CONFIG.apiBase}/states`, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    if (!Array.isArray(arr)) throw new Error('unexpected payload');
    // Replace cache wholesale so removed entities drop out, but keep the same
    // Map instance for cheap reads.
    cache.clear();
    for (const e of arr) cache.set(e.entity_id, e);
    return true;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch a daily forecast via the weather.get_forecasts action.
 * Uses ?return_response so HA returns the forecast payload in the body.
 * Falls back to the entity's `forecast` attribute if the action shape varies.
 * Returns an array of forecast entries (possibly empty).
 */
export async function getForecast(entityId, type = 'daily') {
  if (!entityId) return [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(`${CONFIG.apiBase}/services/weather/get_forecasts?return_response`, {
      method: 'POST',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ type, entity_id: entityId }),
    });
    if (res.ok) {
      const data = await res.json();
      const sr = data.service_response || data;
      const ent = (sr && (sr[entityId] || Object.values(sr)[0])) || null;
      if (ent && Array.isArray(ent.forecast) && ent.forecast.length) return ent.forecast;
    }
  } catch (e) {
    console.warn('[wallboard] forecast fetch failed:', e && e.message);
  } finally {
    clearTimeout(t);
  }
  // Fallback: some integrations still expose a `forecast` attribute.
  const attr = getAttr(entityId, 'forecast');
  return Array.isArray(attr) ? attr : [];
}

let timer = null;
let stopped = false;

async function loop() {
  if (stopped) return;
  let delay = CONFIG.pollIntervalMs;
  try {
    await fetchStatesOnce();
    status.lastSuccessMs = Date.now();
    status.consecutiveErrors = 0;
    status.lastErrorText = '';
    status.connected = true;
  } catch (err) {
    status.consecutiveErrors += 1;
    status.lastErrorText = (err && err.message) || String(err);
    // Keep last-known values in cache (do NOT clear) and back off.
    const b = CONFIG.backoff;
    delay = Math.min(b.maxMs, b.baseMs * 2 ** (status.consecutiveErrors - 1));
    console.warn('[wallboard] poll failed:', status.lastErrorText, '— retry in', delay, 'ms');
  } finally {
    // Always re-render so the stale indicator and ages update.
    emit();
    if (!stopped) timer = setTimeout(loop, delay);
  }
}

/** Start polling. Renders fire via onUpdate(). */
export function startPolling() {
  if (timer) return;
  stopped = false;
  loop();
}

export function stopPolling() {
  stopped = true;
  if (timer) { clearTimeout(timer); timer = null; }
}
