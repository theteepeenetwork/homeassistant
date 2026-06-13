# Wallboard — 1080p Home Assistant wall dashboard

A self-contained, display-only dashboard for a fixed **1920×1080** screen,
running full-screen in Chromium kiosk on a Raspberry Pi. Vanilla HTML/CSS/JS,
**no build step**, no runtime internet dependency. It polls Home Assistant's
REST API through Caddy (which injects the token server-side, so the browser
never sees it), shows last-known values with a "stale" indicator if HA blips,
and silently reloads once a day as memory-leak insurance.

### Look: "Ambient Reticle" HUD

The board uses a JARVIS-class holographic theme: a central energy **reactor**
(SOLAR ▸ HOME ◂ GRID ▸ EV CAR, with the home battery on the right and animated
power-flow lines), the full budget matrix, and a bottom band of heat-pump /
rooms / solar-to-date. The whole board **breathes with live solar generation** —
as PV power climbs toward ~8 kW the reactor floods from calm night-blue to vivid
green-cyan, the aura swells and the flow lines speed up; the heat-pump module
separately flushes amber→red as the day's heating cost rises. Those two
thresholds live at the top of `ui.js` (`SOLAR_PEAK_KW`, `HEAT_COSTLY_GBP`).
The EV charger band fills the vehicle battery and animates a charge-sweep + a
grid→EV flow only while the car is actually drawing power.

```
dev/wallboard/
├── index.html            # static HUD layout: header / reactor+budget / heat·rooms·solar / footer
├── style.css             # holographic HUD theme, reticle + flow animations, reactive mood vars, night dim
├── config.js             # ★ ENTITIES map + CONFIG — the only file you edit to re-wire
├── ha.js                 # data layer: poll /api/states, cache, backoff, staleness, forecast
├── ui.js                 # render(): pure function of the cache -> DOM
├── icons.js              # inline SVG weather icons (no network)
├── app.js                # clock, night-dim, daily-reload watchdog, forecast timer
├── vendor/               # (empty) local third-party libs would go here, never a CDN
├── data/                 # generated static JSON (solar-history.json), served by Caddy
├── discover-entities.sh  # list/verify real HA entity ids on macserver
├── sigen-stats.py        # live HA WebSocket pull: MTD/YTD ESS energy (stats API)
├── sigen-portal.py       # parse Sigenergy portal exports -> report + solar-history.json
├── pi-kiosk-setup.sh     # one-shot Raspberry Pi kiosk installer
└── pi-kiosk.md           # Pi kiosk docs (Wayland + X11)
```

## Solar history (true MTD / YTD generation + revenue)

HA only holds recent data, so true month/year-to-date solar comes from the
**Sigenergy cloud portal**. Export the daily *Energy (kWh)* report (and/or the
yearly summary) from the portal, then:

```bash
python3 dev/wallboard/sigen-portal.py --json dev/wallboard/data/solar-history.json stationData-*.xlsx
```

This prints a per-month / MTD / YTD table (generation, import/export, battery,
the portal's Revenue £, and a grid cash-net at your Octopus rates) and writes
`data/solar-history.json`. The wallboard's **Solar — to date** card reads that
JSON (slow timer, cache-busted); `rsync` it to the server alongside the site to
refresh (`rsync -av dev/wallboard/data/ markp@192.168.1.190:~/dev/wallboard/data/`). Rates default to the confirmed Octopus tariff — import £0.069 (IOG
off-peak; ~99% of import is off-peak) / export £0.12 (flat Outgoing) — override
with `--import-rate` / `--export-rate` or `SIGEN_IMPORT_RATE` / `SIGEN_EXPORT_RATE`.
The portal's 5-minute power export is capped ~10k rows (~35 days); the daily and
yearly exports go back to install, so use those for history. `sigen-stats.py` is
the live alternative — it pulls MTD/YTD straight from HA's statistics WebSocket,
but only covers the window HA has been recording.

> **Heads-up on entity IDs.** This was built from the entity IDs in the brief.
> The Ohme, Octopus, server-health and container IDs are confirmed; **Sigen
> (solar/battery/grid) is not live yet** and shows "awaiting Sigen" placeholders;
> weather, heat-pump and room-sensor IDs are best-guesses marked `VERIFY` in
> `config.js`. Run `discover-entities.sh` on macserver and fix any mismatches —
> it's all in one config object, so re-wiring is a one-line change per entity.

---

## 1. Deploy (on macserver)

The convention (from the brief): edit in the Cowork project, `rsync` to the
server (user `markp` at `192.168.1.190`), `docker compose up -d`.

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

- **`stack/caddy/Caddyfile`** — add the `http://dashboard.home { … }` block.
  It serves `/srv/wallboard` and proxies `/api/*` to `http://homeassistant:8123`
  with `header_up Authorization "Bearer {env.HA_TOKEN}"`.
- **`stack/docker-compose.yml`** — on the `caddy` service add:
  - `environment: - HA_TOKEN=${HA_TOKEN}`
  - a read-only bind mount: `- ${HOME}/dev/wallboard:/srv/wallboard:ro`

  (The caddy container must be on the `web` network so it can reach
  `homeassistant:8123`.)

### c. DNS

Add `dashboard.home` to Pi-hole pointing at `192.168.1.190` (it already
resolves `*.home` there, so a normal A record / wildcard covers it).

### d. Push the site and restart Caddy

```bash
# from the Cowork project on your dev machine (user markp; the `macserver` SSH
# alias logs in as the wrong account, so use the explicit host):
rsync -av dev/wallboard/ markp@192.168.1.190:~/dev/wallboard/   # -> ~/dev/wallboard (+ data/)
ssh markp@192.168.1.190
cd ~/stack && docker compose up -d caddy      # reload Caddy with the new config + mount
```

### e. Verify

```bash
curl -I http://dashboard.home                 # 200, serves index.html
curl -s http://dashboard.home/api/states | head   # proxied HA states (token injected)
./~/dev/wallboard/discover-entities.sh        # confirm entity ids
```

Open `http://dashboard.home` in a browser. Then set up the Pi: see
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

## 5. Local testing (optional, off the Pi)

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
  updates text/attributes/classes, so CSS animations never restart and there are
  no growing node sets. Plus the daily 04:00 reload.
- **Calm motion:** only the slow dashed energy-flow lines move; nothing flickers.
- **Glanceable:** large `tabular-nums`, one accent colour, state colour-coding
  (charging/up = green, import = amber, export = teal, down/fault = red).
