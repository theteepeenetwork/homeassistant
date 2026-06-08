// =============================================================================
//  config.js — Wallboard configuration & entity map
// -----------------------------------------------------------------------------
//  THIS IS THE ONLY FILE YOU SHOULD NEED TO EDIT TO RE-WIRE THE DASHBOARD.
//
//  Every logical thing the UI shows maps to a Home Assistant entity_id here.
//  Change an id, the UI follows — no other code edits required.
//
//  How to confirm the real ids on your server (Caddy proxy injects the token):
//      curl -s http://wallboard.home/api/states | jq -r '.[].entity_id' | sort
//  ...or run ./discover-entities.sh on macserver. See README.md.
//
//  Entity ids marked "CONFIRMED" came from the build brief and are live.
//  Ids marked "PENDING" / "VERIFY" are best guesses — confirm and adjust.
// =============================================================================

export const CONFIG = {
  // ---- Data layer -----------------------------------------------------------
  apiBase: '/api',          // same-origin; Caddy adds the Bearer token server-side
  pollIntervalMs: 4000,     // /api/states poll cadence (brief: 3–5 s)
  requestTimeoutMs: 8000,   // abort a hung request after this long
  staleAfterMs: 15000,      // no successful poll within this window => "stale"
  backoff: { baseMs: 2000, maxMs: 30000 }, // exponential backoff on failure

  // ---- Watchdog reload (memory-leak insurance for weeks-long uptime) --------
  dailyReload: { enabled: true, atHour: 4, atMinute: 0 }, // silent full reload ~04:00

  // ---- Night dimming (CSS brightness) ---------------------------------------
  nightDim: {
    enabled: true,
    startHour: 23,          // dim from 23:00 ...
    endHour: 6,             // ... until 06:00
    brightness: 0.55,       // 0..1 multiplier applied to the whole UI
  },

  // ---- Locale / formatting --------------------------------------------------
  locale: 'en-GB',
  currency: 'GBP',
  timeZoneNote: 'rendered from the browser clock; HA is not polled for time',

  // ---- Rooms auto-discovery safety net --------------------------------------
  //  If true, any sensor with device_class "temperature" (°C) that is NOT
  //  already referenced elsewhere in ENTITIES gets shown in the rooms grid,
  //  even before you curate ENTITIES.rooms below. Set false once curated.
  autoDiscoverRooms: true,
};

// -----------------------------------------------------------------------------
//  ENTITIES — logical name -> Home Assistant entity_id
// -----------------------------------------------------------------------------
export const ENTITIES = {

  // ---- Weather (Met.no) — CONFIRMED present, VERIFY exact id ----------------
  weather: 'weather.forecast_home',   // VERIFY: run discover; common id, adjust if different

  // ---- EV charger: Ohme Home Pro — CONFIRMED -------------------------------
  ev: {
    status:        'sensor.ohme_home_pro_status',          // charging/plugged_in/unplugged/pending_approval/finished
    power:         'sensor.ohme_home_pro_power',           // kW
    energy:        'sensor.ohme_home_pro_energy',          // session kWh (total_increasing)
    vehicleBatt:   'sensor.ohme_home_pro_vehicle_battery', // %
    current:       'sensor.ohme_home_pro_current',         // A
    voltage:       'sensor.ohme_home_pro_voltage',         // V
    chargeMode:    'select.ohme_home_pro_charge_mode',     // display only
  },

  // ---- Octopus / Intelligent Octopus Go — CONFIRMED ------------------------
  octopus: {
    // state = current import £/kWh; attribute current_day_min_rate = off-peak rate
    importRate:    'sensor.octopus_energy_electricity_23j0328210_2700007457948_current_rate',
    dispatching:   'binary_sensor.octopus_energy_00000000_0009_4000_8020_00000004ff90_intelligent_dispatching',
    // Cost-tracker sensors: read their `total_consumption` attribute (kWh),
    // then multiply by the off-peak rate ourselves (see app logic / README).
    costTrackerToday: 'sensor.octopus_energy_cost_tracker_ev_charger',
    costTrackerWeek:  'sensor.octopus_energy_cost_tracker_ev_charger_week',
    costTrackerMonth: 'sensor.octopus_energy_cost_tracker_ev_charger_month',
  },

  // ---- Solar / battery / grid: Sigenergy — PENDING (Modbus closed) ----------
  //  These ids DO NOT EXIST YET. The energy section shows "awaiting Sigen"
  //  placeholders until they resolve. When the installer re-enables Modbus TCP,
  //  run discover-entities.sh, paste the real ids here, done. Sign convention:
  //  battery power +charging/-discharging, grid +import/-export (adjust below).
  sigen: {
    solarPower:    'sensor.sigen_plant_pv_power',          // PENDING — W
    batterySoc:    'sensor.sigen_plant_battery_soc',       // PENDING — %
    batteryPower:  'sensor.sigen_plant_battery_power',     // PENDING — W (+charge/-discharge)
    gridPower:     'sensor.sigen_plant_grid_active_power',  // PENDING — W (+import/-export)
    houseLoad:     'sensor.sigen_plant_consumed_power',    // PENDING — W
  },
  //  Power sign conventions (flip if your integration reports the opposite):
  sigenSigns: {
    batteryPositiveMeansCharging: true,
    gridPositiveMeansImport:      true,
  },

  // ---- Climate: Daikin Altherma (Onecta) — VERIFY ids -----------------------
  climate: {
    heatPump:      'climate.altherma',          // VERIFY: enumerate climate.*
    flowTemp:      'sensor.altherma_flow_temperature',     // VERIFY
    dhwTankTemp:   'sensor.altherma_tank_temperature',     // VERIFY (hot water)
    outdoorTemp:   'sensor.altherma_outdoor_temperature',  // VERIFY
    power:         'sensor.altherma_power_consumption',    // VERIFY (optional)
  },

  // ---- Rooms: temperature / humidity — VERIFY (auto-discovery fills gaps) ----
  //  Curate this list with real ids once known. Each: { name, temp, humidity? }.
  //  Until then, autoDiscoverRooms (CONFIG) surfaces temperature sensors found
  //  at runtime so the tile is never empty.
  rooms: [
    // { name: 'Living Room', temp: 'sensor.timmerflotte_living_temperature', humidity: 'sensor.timmerflotte_living_humidity' },
    // { name: 'Bedroom',     temp: 'sensor.govee_bedroom_temperature',       humidity: 'sensor.govee_bedroom_humidity' },
  ],

  // ---- Server / system health — CONFIRMED -----------------------------------
  //  NOTE: the server + containers tile was replaced by the Running Budget tile
  //  (column 3). These ids are kept here, unused by the UI, so they're handy if
  //  you ever want the server tile back. Safe to delete if not.
  server: {
    cpuTemp:        'sensor.server_cpu_temperature',
    containersRunning: 'sensor.server_containers_running',
    diskFreeRoot:   'sensor.server_disk_free_root',
    battery:        'sensor.server_battery',          // UPS/host battery %
    batteryStatus:  'sensor.server_battery_status',   // charging/discharging/etc
    containerProblem: 'binary_sensor.server_container_problem',
    // last backup freshness — VERIFY exact id (enumerate *backup*)
    lastBackup:     'sensor.server_last_backup',      // VERIFY
  },

  // Per-container up/down — CONFIRMED. label is what shows under the dot.
  containers: [
    { label: 'caddy',         entity: 'binary_sensor.container_caddy' },
    { label: 'homeassistant', entity: 'binary_sensor.container_homeassistant' },
    { label: 'mariadb',       entity: 'binary_sensor.container_mariadb' },
    { label: 'partyplanner',  entity: 'binary_sensor.container_partyplanner' },
    { label: 'pihole',        entity: 'binary_sensor.container_pihole' },
    { label: 'timemachine',   entity: 'binary_sensor.container_timemachine' },
  ],

  // ---- Running Budget (replaces the server tile) ----------------------------
  //  A period x metric matrix. For each metric/period a source is:
  //      { entity: 'sensor.x' }            -> reads the entity STATE as a number
  //      { entity: 'sensor.x', attr: 'y' } -> reads attribute y as a number
  //      { entity: null }                  -> shows "—" until you wire it
  //
  //  Costs are read as money: if the entity's unit is pence ('p'/'GBp') it's
  //  auto-divided by 100. Car COST is computed = car kWh x off-peak rate
  //  (octopus.importRate -> current_day_min_rate), matching the EV panel logic.
  //
  //  Net per period:
  //      Net (incl. car) = import cost − export income
  //      Net (excl. car) = import cost − car cost − export income
  //
  //  What I could wire from the brief vs. what you must confirm/create:
  //   * import TODAY  — best-guess Octopus "current accumulative" sensors below
  //                     (same serial/MPAN as the rate sensor). Marked VERIFY.
  //   * car TODAY/MONTH — reuse the Octopus EV cost trackers (CONFIRMED).
  //   * import MONTH/YTD, export (all), solar (all), car YTD — need sensors I
  //     can't see from here: an export MPAN, Sigen (still pending), and
  //     monthly/yearly utility_meter or cost-tracker helpers. See README §
  //     "Wiring the Running Budget". Leave as null until they exist.
  budget: {
    periods: [
      { key: 'today', label: 'Today' },
      { key: 'month', label: 'Month' },
      { key: 'ytd',   label: 'YTD' },
    ],

    import: {
      cost: {
        today: { entity: 'sensor.octopus_energy_electricity_23j0328210_2700007457948_current_accumulative_cost' }, // VERIFY
        month: { entity: null }, // create a monthly utility_meter/cost-tracker on import cost — see README
        ytd:   { entity: null }, // create a yearly  utility_meter/cost-tracker on import cost
      },
      energy: {
        today: { entity: 'sensor.octopus_energy_electricity_23j0328210_2700007457948_current_accumulative_consumption' }, // VERIFY
        month: { entity: null },
        ytd:   { entity: null },
      },
    },

    export: {
      // Export meter has its OWN serial/MPAN — run discover and grep "_export_".
      income: {
        today: { entity: null }, // e.g. sensor.octopus_energy_electricity_<EXPSERIAL>_<EXPMPAN>_export_current_accumulative_cost
        month: { entity: null },
        ytd:   { entity: null },
      },
      energy: {
        today: { entity: null }, // e.g. ..._export_current_accumulative_consumption
        month: { entity: null },
        ytd:   { entity: null },
      },
    },

    solar: {
      // Sigen PV energy (kWh) — PENDING until Modbus opens. Daily/total sensors.
      energy: {
        today: { entity: null }, // e.g. sensor.sigen_plant_pv_daily_generation
        month: { entity: null }, // e.g. utility_meter on PV total
        ytd:   { entity: null },
      },
    },

    car: {
      // kWh per period from the Octopus EV cost trackers; cost = kWh x off-peak.
      energy: {
        today: { entity: 'sensor.octopus_energy_cost_tracker_ev_charger',       attr: 'total_consumption' }, // CONFIRMED
        month: { entity: 'sensor.octopus_energy_cost_tracker_ev_charger_month', attr: 'total_consumption' }, // CONFIRMED
        ytd:   { entity: null }, // no YTD tracker by default — create one or leave "—"
      },
      // Optional: if you have a direct car COST sensor per period, set it here to
      // override the kWh x off-peak calculation. Leave null to use the calc.
      cost: {
        today: { entity: null },
        month: { entity: null },
        ytd:   { entity: null },
      },
    },

    // ---- House consumption split by SOURCE (kWh) ----------------------------
    //  "What we used to POWER THE HOUSE", split by where it came from.
    //  IMPORTANT: this is house LOAD only — it EXCLUDES energy used to charge
    //  the battery (and the EV). So "from grid" is the grid->house portion, NOT
    //  the meter import (which also includes battery/EV charging). That split
    //  can only come from Sigen's flow/energy sensors, so these are PENDING
    //  until Modbus opens — they show "—" until wired.
    //   * grid    — Sigen grid->load energy (NOT the Octopus import meter).
    //   * battery — Sigen battery discharge->load energy.
    //   * solar   — Sigen solar self-consumption->load energy.
    //   * total   — optional Sigen house-load energy sensor. If null, it's
    //               computed as grid + battery + solar, but only when ALL three
    //               are present (otherwise "—", to avoid a false total).
    consumption: {
      grid: {
        today: { entity: null }, // Sigen grid->load energy (daily). NOT meter import.
        month: { entity: null }, // utility_meter (monthly) on the above
        ytd:   { entity: null }, // utility_meter (yearly)  on the above
      },
      battery: {
        today: { entity: null }, // e.g. sensor.sigen_plant_battery_discharge_energy_daily
        month: { entity: null },
        ytd:   { entity: null },
      },
      solar: {
        today: { entity: null }, // e.g. sensor.sigen_plant_pv_self_consumption_daily
        month: { entity: null },
        ytd:   { entity: null },
      },
      total: {
        today: { entity: null }, // e.g. sensor.sigen_plant_consumed_energy_daily (else summed)
        month: { entity: null },
        ytd:   { entity: null },
      },
    },
  },
};
