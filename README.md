# homeassistant

Home Assistant–related projects for the macserver stack.

## Projects

### [`dev/wallboard/`](dev/wallboard/README.md) — 1080p Raspberry Pi wall dashboard

A self-contained, display-only dashboard for a fixed 1920×1080 Chromium kiosk on
a Raspberry Pi, showing live data from Home Assistant (energy/EV, climate &
rooms, a running energy budget, weather). Vanilla HTML/CSS/JS, no build step, token kept
server-side via Caddy. See [`dev/wallboard/README.md`](dev/wallboard/README.md)
for setup, deployment, the Pi kiosk guide, and how to wire in Sigen later.

### [`stack/`](stack/) — deployment snippets

Reference Caddy + docker-compose blocks to merge into the real macserver stack
so Caddy serves the wallboard and proxies `/api/*` to Home Assistant with the
token injected server-side. `stack/.env` (the `HA_TOKEN`) is **gitignored and
never committed** — copy `stack/.env.example`.
