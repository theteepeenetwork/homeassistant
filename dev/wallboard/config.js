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
  wsBase: '/api/websocket', // HA WebSocket API — used ONLY for long-term
                            // statistics (multi-period budget / heat-pump cost).
                            // Needs a token in the WS auth message (Caddy can't
                            // inject it like it does for REST) — see DEPLOY +
                            // CONFIG.haToken / window.__HA_TOKEN below.
  pollIntervalMs: 4000,     // /api/states poll cadence (brief: 3–5 s)
  statsRefreshMs: 900000,   // 15 min — statistics refresh cadence (slow/cheap)
  requestTimeoutMs: 8000,   // abort a hung request after this long
  staleAfterMs: 15000,      // no successful poll within this window => "stale"
  backoff: { baseMs: 2000, maxMs: 30000 }, // exponential backoff on failure

  // Token for the WebSocket statistics auth step only. Leave null and inject at
  // deploy as window.__HA_TOKEN (kiosk, trusted LAN). If absent, the live board
  // still works; multi-period columns fall back to "yesterday" only. See DEPLOY.
  haToken: null,

  // ---- Watchdog reload (memory-leak insurance for weeks-long uptime) --------
  dailyReload: { enabled: true, atHour: 4, atMinute: 0 }, // silent full reload ~04:00

  // ---- Night dimming (CSS brightness) ---------------------------------------
  nightDim: {
    enabled: true,
    startHour: 23,          // dim from 23:00 ...
    endHour: 6,             // ... until 06:00
    brightness: 0.55,       // 0..1 multiplier applied to the whole UI
  },

  // ---- Solar history (Sigenergy portal) -------------------------------------
  //  The Sigen cloud portal holds the real long history (back to install);
  //  HA only has recent live data. Export the daily "Energy (kWh)" report from
  //  the portal, run sigen-portal.py to produce this JSON, and the wallboard
  //  shows true month-to-date / year-to-date generation + revenue. Static file
  //  served same-origin by Caddy; refreshed on the slow stats timer. Set to
  //  null to hide the Solar-to-date card.
  solarHistoryUrl: 'data/solar-history.json',

  // ---- Locale / formatting --------------------------------------------------
  locale: 'en-GB',
  currency: 'GBP',
  timeZoneNote: 'rendered from the browser clock; HA is not polled for time',

  // ---- Heat-pump cost estimate ----------------------------------------------
  //  The Daikin exposes only kWh (heating + hot water), not £. To show a cost we
  //  multiply by a single blended £/kWh — a combined peak/off-peak average you
  //  tune to your tariff. NB the heat pump also runs partly on solar, so this is
  //  an upper-bound grid-priced estimate, not the exact bill.
  heatPump: { blendedRatePerKwh: 0.245 },

  // ---- Rooms auto-discovery safety net --------------------------------------
  //  If true, any sensor with device_class "temperature" (°C) that is NOT
  //  already referenced elsewhere in ENTITIES gets shown in the rooms grid,
  //  even before you curate ENTITIES.rooms below. Set false once curated.
  //  Curated rooms below are now the real ones (Hall/Stairs/Poly Tunnel), so
  //  auto-discovery is OFF — it was surfacing heat-pump/Sigen/server temps.
  autoDiscoverRooms: false,
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
    vehicleBatt:   'sensor.ioniq_5_ev_battery_level',      // % — true pack SOC from the car (Kia Uvo/Bluelink); was sensor.ohme_home_pro_vehicle_battery
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

  // ---- Running budget — CONFIRMED ------------------------------------------
  //  Octopus smart-meter data lags ~24h, so import/export are read from the
  //  *previous complete day* accumulative sensors (the freshest accurate grid
  //  figures). Car spend is the live cost tracker (month-to-date), priced at
  //  the off-peak rate (octopus.importRate -> current_day_min_rate attr).
  //  Generation stays a placeholder until Sigen (energy section) is live.
  //  MPANs: import 2700007457948, export 2700010881501 (Octopus Outgoing).
  budget: {
    importCost:     'sensor.octopus_energy_electricity_23j0328210_2700007457948_previous_accumulative_cost',          // £ yesterday
    importKwh:      'sensor.octopus_energy_electricity_23j0328210_2700007457948_previous_accumulative_consumption',   // kWh yesterday
    importStanding: 'sensor.octopus_energy_electricity_23j0328210_2700007457948_current_standing_charge',             // £/day
    exportIncome:   'sensor.octopus_energy_electricity_23j0328210_2700010881501_export_previous_accumulative_cost',          // £ yesterday (income)
    exportKwh:      'sensor.octopus_energy_electricity_23j0328210_2700010881501_export_previous_accumulative_consumption',   // kWh yesterday
    exportStanding: 'sensor.octopus_energy_electricity_23j0328210_2700010881501_export_current_standing_charge',            // £/day (usually 0)
    // Car spend: off-peak £ = cost-tracker total_consumption (kWh) x off-peak rate.
    carMonth:       'sensor.octopus_energy_cost_tracker_ev_charger_month',  // read total_consumption attr
    carToday:       'sensor.octopus_energy_cost_tracker_ev_charger',        // read total_consumption attr (daily car proxy for net excl. car)
    // Generation (PV daily energy) — Sigen LIVE 2026-06-09.
    genDailyKwh:    'sensor.sigen_plant_daily_pv_energy',  // kWh today
  },

  // ---- Multi-period statistics — VERIFY ALL IDS -----------------------------
  //  Read via HA long-term statistics (ha.getStatistics, WebSocket) and bucketed
  //  in ui.js into yesterday / month-to-date / year-to-date. Each id
  //  MUST be a CUMULATIVE sensor that records long-term statistics (i.e. shows
  //  up in the HA Energy dashboard / Developer Tools → Statistics) so its
  //  per-day `change` is meaningful. Confirm the real ids on the server:
  //      ./discover-entities.sh stats
  //  Any id that is wrong/missing simply renders "—" for that metric; the
  //  "yesterday" column still falls back to the live budget.* sensors above.
  stats: {
    importCost:    'sensor.octopus_energy_electricity_23j0328210_2700007457948_accumulative_cost',          // VERIFY £ cumulative
    importKwh:     'sensor.octopus_energy_electricity_23j0328210_2700007457948_accumulative_consumption',   // VERIFY kWh cumulative
    exportCost:    'sensor.octopus_energy_electricity_23j0328210_2700010881501_export_accumulative_cost',          // VERIFY £ cumulative (income)
    exportKwh:     'sensor.octopus_energy_electricity_23j0328210_2700010881501_export_accumulative_consumption',   // VERIFY kWh cumulative
    generationKwh: 'sensor.sigen_plant_accumulated_pv_energy',  // VERIFY lifetime PV energy (kWh)
    carKwh:        'sensor.ohme_home_pro_energy',               // VERIFY session kWh records stats (total_increasing)
    heatingKwh:    'sensor.heating_climatecontrol_heating_daily_electrical_consumption',     // daily kWh — change/day summed
    dhwKwh:        'sensor.heating_domestichotwatertank_heating_daily_electrical_consumption', // daily kWh — change/day summed
  },

  // ---- Solar / battery / grid: Sigenergy — LIVE (Modbus open) ---------------
  //  NB all Sigen power sensors report in kW (device_class power); ui.js
  //  converts kW->W for display. Confirmed live 2026-06-09.
  sigen: {
    solarPower:    'sensor.sigen_plant_pv_power',                // kW
    batterySoc:    'sensor.sigen_plant_battery_state_of_charge', // %
    batteryPower:  'sensor.sigen_plant_battery_power',           // kW (+charge / -discharge)
    gridPower:     'sensor.sigen_plant_grid_active_power',       // kW (sign: see below)
    houseLoad:     'sensor.sigen_plant_total_load_power',        // kW
  },
  //  Power sign conventions (flip if your integration reports the opposite).
  //  gridPositiveMeansImport UNVERIFIED — was 0.0 kW when wired; confirm/flip
  //  once there is real grid flow (import should light amber, export teal).
  sigenSigns: {
    batteryPositiveMeansCharging: true,
    gridPositiveMeansImport:      true,
  },

  // ---- Climate: Daikin Altherma (Onecta) — CONFIRMED 2026-06-09 -------------
  climate: {
    heatPump:      'climate.heating_room_temperature',                       // target via `temperature` attr, current via `current_temperature`
    flowTemp:      'sensor.heating_climatecontrol_leaving_water_temperature', // °C
    dhwTankTemp:   'sensor.heating_domestichotwatertank_tank_temperature',    // °C (hot water)
    outdoorTemp:   'sensor.heating_climatecontrol_outdoor_temperature',       // °C
    // No instantaneous power from Onecta — show today's electricity instead
    // (space heating + hot water daily kWh, summed in ui.js).
    elecDaily: [
      'sensor.heating_climatecontrol_heating_daily_electrical_consumption',
      'sensor.heating_domestichotwatertank_heating_daily_electrical_consumption',
    ],
  },

  // ---- Rooms: temperature / humidity — VERIFY (auto-discovery fills gaps) ----
  //  Curate this list with real ids once known. Each: { name, temp, humidity? }.
  //  Until then, autoDiscoverRooms (CONFIG) surfaces temperature sensors found
  //  at runtime so the tile is never empty.
  rooms: [
    { name: 'Hall',        temp: 'sensor.hall_temperature' },
    { name: 'Stairs',      temp: 'sensor.stairs_temperature' },
    { name: 'Poly Tunnel', temp: 'sensor.timmerflotte_temp_hmd_sensor_temperature', humidity: 'sensor.timmerflotte_temp_hmd_sensor_humidity' },
  ],

  // ---- Server / system health — CONFIRMED -----------------------------------
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
};
