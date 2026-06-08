# Wallboard — 1080p Home Assistant wall dashboard

A self-contained, display-only dashboard for a fixed **1920×1080** screen,
running full-screen in Chromium kiosk on a Raspberry Pi. Vanilla HTML/CSS/JS,
**no build step**, no runtime internet dependency. It polls Home Assistant's
REST API through Caddy (which injects the token server-side, so the browser
never sees it), shows last-known values with a "stale" indicator if HA blips,
and silently reloads once a day as memory-leak insurance.

```
dev/wallboard/
├── index.html            # static layout: header / energy / climate / budget / footer
├── style.css             # dark 1080p grid, flow + gauge animations, night dim
├── config.js             # ★ ENTITIES map + CONFIG — the only file you edit to re-wire
├── ha.js                 # data layer: poll /api/states, cache, backoff, staleness, forecast
├── ui.js                 # render(): pure function of the cache -> DOM
├── icons.js              # inline SVG weather icons (no network)
├── app.js                # clock, night-dim, daily-reload watchdog, forecast timer
├── vendor/               # (empty) local third-party libs would go here, never a CDN
├── discover-entities.sh  # list/verify real HA entity ids on macserver
├── pi-kiosk-setup.sh     # one-shot Raspberry Pi kiosk installer
└── pi-kiosk.md           # Pi kiosk docs (Wayland + X11)
```

> **Heads-up on entity IDs.** This was built from the entity IDs in the brief.
> The Ohme, Octopus rate/cost-tracker IDs are confirmed; **Sigen
> (solar/battery/grid) is not live yet** and shows "awaiting Sigen" placeholders;
> weather, heat-pump and room-sensor IDs are best-guesses marked `VERIFY` in
> `config.js`. Run `discover-entities.sh` on macserver and fix any mismatches —
> it's all in one config object, so re-wiring is a one-line change per entity.
>
> **Column 3 is the Running Budget** (the original server/containers tile was
> removed). Only the "today import" and "car" cells wire up automatically; the
> month/YTD, export and solar cells need sensors that don't exist yet — see
> **§ Wiring the Running Budget** below.

---

## 1. Deploy (on macserver)

The convention (from the brief): edit in the Cowork project, `scp` to the
server, `docker compose up -d`.

### a. Set the token (never committed)

Create a long-lived token in HA → **profile → Security → Long-lived access
tokens**, then on the server:

```bash
cd ~/stack
cp .env.example .env          # if you don't already have one
echo 'HA_TOKEN=<paste-token>' >> .env   # or edit .env
```

`stack/.env` is gitignored. Do not commit it.

### b. Wire Caddy + compose

Merge the two snippets in this repo into your **real** stack files:

- **`stack/caddy/Caddyfile`** — add the `http://wallboard.home { … }` block.
  It serves `/srv/wallboard` and proxies `/api/*` to `http://homeassistant:8123`
  with `header_up Authorization "Bearer {env.HA_TOKEN}"`.
- **`stack/docker-compose.yml`** — on the `caddy` service add:
  - `environment: - HA_TOKEN=${HA_TOKEN}`
  - a read-only bind mount: `- ${HOME}/dev/wallboard:/srv/wallboard:ro`

  (The caddy container must be on the `web` network so it can reach
  `homeassistant:8123`.)

### c. DNS

Add `wallboard.home` to Pi-hole pointing at `192.168.1.190` (it already
resolves `*.home` there, so a normal A record / wildcard covers it).

### d. Push the site and restart Caddy

```bash
# from the Cowork project on your dev machine:
scp -r dev/wallboard macserver:~/dev/        # -> ~/dev/wallboard on the server
ssh macserver
cd ~/stack && docker compose up -d caddy      # reload Caddy with the new config + mount
```

### e. Verify

```bash
curl -I http://wallboard.home                 # 200, serves index.html
curl -s http://wallboard.home/api/states | head   # proxied HA states (token injected)
./~/dev/wallboard/discover-entities.sh        # confirm entity ids
```

Open `http://wallboard.home` in a browser. Then set up the Pi: see
**`pi-kiosk.md`**.

---

## 2. Confirm / fix entity IDs

```bash
cd ~/dev/wallboard
./discover-entities.sh        # grouped: weather, ohme, octopus, sigen, climate, temps, server…
./discover-entities.sh all    # every entity_id, sorted
```

Edit `config.js` so each logical name points at the real `entity_id`. Nothing
else needs to change. Reload the browser (or wait for the 04:00 watchdog).

`config.js` highlights:

- `CONFIG.pollIntervalMs` (default 4s), `staleAfterMs`, `backoff`
- `CONFIG.nightDim` (23:00–06:00, brightness 0.55) and `CONFIG.dailyReload` (04:00)
- `CONFIG.autoDiscoverRooms` — when `true`, any °C temperature sensor not used
  elsewhere is shown in the Rooms tile automatically, so it's never empty before
  you curate `ENTITIES.rooms`.

---

## 3. Adding Sigen (solar / battery / grid) later

When the installer re-enables Modbus TCP on the inverter
(gateway ~`192.168.1.186:502`), the Sigen integration will expose `sensor.*`
for PV power (W), battery SOC (%), battery power (±W), grid power (±W) and house
load (W). Then:

1. `./discover-entities.sh` and look at the **Sigen** group (or
   `./discover-entities.sh all | grep -i sigen`).
2. Paste the real IDs into `ENTITIES.sigen` in `config.js`.
3. Check the sign conventions in `ENTITIES.sigenSigns`:
   - `batteryPositiveMeansCharging` — flip if your integration reports
     discharge as positive.
   - `gridPositiveMeansImport` — flip if export is positive.
4. Reload. The "awaiting Sigen" badge becomes "live", nodes un-dim, and the
   solar→home→battery/grid flow animates:
   - solar producing → **yellow** line down to home,
   - importing from grid → **amber**, exporting → **teal**,
   - battery charging → **green** (home→battery), discharging → **cyan**
     (battery→home), with the SOC ring around the battery node.

No other code changes are needed — the energy section already reads everything
from `config.js` and degrades gracefully when entities are missing.

---

## 4. The off-peak EV cost calculation

The Octopus dispatch feed doesn't capture this Ohme's daytime cheap slots, so
the built-in cost tracker over-prices daytime charging at the peak rate. The
wallboard computes the accurate cost itself (in `ui.js → renderEV`):

```
off_peak_rate = sensor.octopus…current_rate  → attribute current_day_min_rate   (~£0.069)
kWh           = sensor.octopus_energy_cost_tracker_ev_charger[_week|_month]
                → attribute total_consumption
cost          = kWh × off_peak_rate
```

On Intelligent Octopus Go essentially all scheduled charging is billed
off-peak, so this is correct. Today / week / month all use the same formula.

---

## 5. Wiring the Running Budget

The budget tile (column 3) is a **period × metric matrix** defined in
`ENTITIES.budget` in `config.js`. Each cell is a source:

```js
{ entity: 'sensor.x' }            // read the entity STATE as a number
{ entity: 'sensor.x', attr: 'y' } // read attribute y (e.g. total_consumption)
{ entity: null }                  // shows "—" until wired
```

The tile has three sections plus the net totals:

- **Cost (£):** Import, Export (income, `+`), Car
- **Generation (kWh):** Solar generated
- **Used by house (kWh):** From grid / From battery / From solar / Total —
  i.e. **what powered the house, split by source**
- **Net:**
  ```
  Net (incl. car) = import cost − export income
  Net (excl. car) = import cost − car cost − export income
  ```

> **"Used by house" is house LOAD only — it excludes energy used to charge the
> battery (and the EV).** So **From grid** is the *grid→house* portion, **not**
> the meter import (which also includes battery/EV charging). That source split
> can only come from Sigen, so these rows are PENDING until Modbus opens.
> **Total** is a direct Sigen house-load sensor if you set one, otherwise the
> sum of the three — but only shown when all three are present (else "—", to
> avoid a misleading total).

Costs auto-convert pence→£ when the entity unit is `p`/`pence`. Car cost is
`car kWh × off-peak rate` (same logic as the EV panel) unless you set an
explicit `budget.car.cost.*` sensor. Net credit (income > spend) shows green
with a `+`; net spend shows amber.

### What works out of the box
- **Import — Today**: best-guess Octopus *current accumulative cost/consumption*
  sensors (same serial/MPAN as the rate sensor). **Confirm with
  `discover-entities.sh`** — units especially (£ vs pence).
- **Car — Today & Month**: the Octopus EV cost trackers (`…_ev_charger`,
  `…_ev_charger_month`, `total_consumption` attribute).

### What you need to create / confirm (cells show "—" until then)
| Cell | How to get it |
|---|---|
| **Export** (all periods) | Your export meter has its own serial/MPAN. Run `./discover-entities.sh \| grep _export_` and paste `…_export_current_accumulative_cost` / `…_consumption` into `budget.export.*.today`. |
| **Import / Export — Month & YTD** | Octopus doesn't expose these directly. Create **utility_meter** helpers (Settings → Devices & Services → Helpers → Utility Meter) with a *monthly* and a *yearly* cycle, sourced from the import/export cost & consumption sensors. Or add Octopus **cost trackers** with `_month` companions. Put the resulting entity IDs into `budget.import.*` / `budget.export.*`. |
| **Solar — generation** | From the Sigen integration once Modbus opens (e.g. a daily PV-energy sensor for Today, plus utility_meter helpers for Month/YTD). Paste into `budget.solar.energy.*`. |
| **Used by house — from grid / battery / solar** | All from Sigen (PENDING). These are *to-load* energies, **excluding battery charging** — e.g. grid→load, battery discharge→load, solar self-consumption→load. Paste into `budget.consumption.{grid,battery,solar}.*`. Optionally set `budget.consumption.total.*` to a Sigen house-load energy sensor; otherwise Total is the sum of the three. Month/YTD need utility_meter helpers. |
| **Car — YTD** | No yearly tracker by default — add an Octopus cost tracker `_year` (or a yearly utility_meter on the EV consumption) and set `budget.car.energy.ytd`. |

Every cell is independent: wire what you have, the rest stays "—" and lights up
automatically when its sensor appears. Reload (or wait for the 04:00 watchdog).

---

## 6. Local testing (optional, off the Pi)

ES modules need to be served over HTTP (not `file://`). To preview the layout
without HA, serve the folder and you'll see placeholders + the "connecting…"
footer:

```bash
cd dev/wallboard && python3 -m http.server 8080   # http://localhost:8080
```

For live data while testing, run it behind the same Caddy proxy (so `/api/*`
resolves), or temporarily point a dev proxy at HA with the token.

---

## Design notes

- **Resilient:** every section renders inside a try/catch; one bad value can't
  blank the board. Failed polls keep the last cache and back off (2→30s). Window
  `error`/`unhandledrejection` are swallowed to logs — never a dialog on the wall.
- **No leaks:** the DOM skeleton is built once in `index.html`; `render()` only
  updates text/attributes/classes, so CSS animations never restart. The small
  rooms/budget grids are the only innerHTML rebuilds (text only, no animation).
  Plus the daily 04:00 reload.
- **Calm motion:** only the slow dashed energy-flow lines move; nothing flickers.
- **Glanceable:** large `tabular-nums`, one accent colour, state colour-coding
  (charging = green, grid import = amber, export/income = teal/green, net
  spend = amber, net credit = green).
