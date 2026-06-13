# Deploy the wallboard at http://dashboard.home

All the file prep is done in this Cowork project (source of truth). What's left
runs on the server — the sandbox can't reach the LAN/Tailscale, so run these
from your MacBook Air. The `macserver` SSH alias / `markp@192.168.1.190` both work.

Already done for you in the project:
- `dev/wallboard/` — the static site (copied from the repo).
- `stack/caddy/Caddyfile` — added the `http://dashboard.home { … }` block
  (serves `/srv/wallboard`, proxies `/api/*` to `homeassistant:8123` with the token).
- `stack/docker-compose.yml` — caddy service now has `HA_TOKEN` env + the
  `/home/markp/dev/wallboard:/srv/wallboard:ro` bind mount.
- `stack/.env` — `HA_TOKEN=` placeholder (you paste the real token, step 1).
- DNS: nothing to do — Pi-hole already wildcards `*.home` → 192.168.1.190.

## 1. Create the HA long-lived token
In a browser on your LAN: http://home.home → click your user (bottom-left) →
**Security** tab → **Long-lived access tokens** → **Create token** → name it
`wallboard`. Copy it now (shown once).

## 2. Put the token in stack/.env (locally, then it ships with the stack)
Edit `stack/.env` in this project and replace the placeholder:
```
HA_TOKEN=<paste-the-token>
```

## 3. Push everything to the server
From the project root (`Documents/Claude/Projects/macserver`):
```bash
scp -r dev/wallboard markp@192.168.1.190:~/dev/        # static site -> ~/dev/wallboard
scp -r stack/caddy stack/docker-compose.yml stack/.env markp@192.168.1.190:~/stack/
```

## 4. Reload Caddy on the server
```bash
ssh markp@192.168.1.190
cd ~/stack
docker compose up -d caddy        # picks up new Caddyfile, HA_TOKEN env, and the mount
docker compose logs --tail=20 caddy
```

## 5. Verify
```bash
curl -I http://dashboard.home                    # 200, serves index.html
curl -s http://dashboard.home/api/states | head  # proxied HA states (token injected)
```
Then open **http://dashboard.home** in a browser.

## 6. Fix any entity IDs (optional, recommended)
Several IDs in `config.js` are best-guesses (weather, Daikin climate, rooms,
last-backup) and **all of `ENTITIES.stats`** (the multi-period budget + heat-pump
cost sources). On the server:
```bash
~/dev/wallboard/discover-entities.sh        # grouped list of real entity_ids
```
Edit `dev/wallboard/config.js` here to match, re-`scp` the file, refresh the
browser. Sigen (solar/battery) stays on "awaiting Sigen" until Modbus is back.

## 7. Multi-period budget + heat-pump cost (long-term statistics)
The budget table (yesterday · month-to-date · year-to-date) and the
heat-pump month cost read HA **long-term statistics** over the WebSocket API
(`recorder/statistics_during_period`). Two things to wire:

1. **WebSocket proxy** — the `http://dashboard.home` Caddy block already proxies
   `/api/*`, which covers `/api/websocket` (Caddy upgrades WS automatically). No
   change needed if your block proxies all of `/api/*`.
2. **Token for the WS auth step** — unlike REST, Caddy can't inject the token
   into the WS `auth` *message*. Serve it same-origin so the page can read it.
   Add to the `dashboard.home` Caddy block:
   ```
   handle /ha-token.js {
     header Content-Type application/javascript
     respond `window.__HA_TOKEN={env.HA_TOKEN};` 200
   }
   ```
   (wrap the value in quotes: `window.__HA_TOKEN="{env.HA_TOKEN}";`), then
   uncomment `<script src="/ha-token.js"></script>` in `index.html`.

**Without this the board still works** — it falls back to the live previous-day
sensors, so the budget shows the **"yesterday"** column only and the badge reads
"yesterday only". Verify it's working: the badge flips to **"live"** and the
month-to-date / year-to-date columns populate.

**Security note:** this is the one place the token reaches the browser. It's
acceptable on a locked-down trusted-LAN kiosk; scope the `wallboard` token and
don't expose `dashboard.home` beyond the LAN. The REST path is unchanged (token
stays server-side).

Tune `CONFIG.heatPump.blendedRatePerKwh` in `config.js` to your tariff — it's the
blended £/kWh used to cost heating vs hot water (an upper-bound grid price; the
HP also runs partly on solar).

## Notes
- For REST (`/api/*`) the browser never sees the token — Caddy adds
  `Authorization: Bearer …` server-side; the site calls same-origin `/api`. The
  WebSocket statistics path (step 7) is the one exception, by necessity.
- For the Raspberry Pi kiosk, see `pi-kiosk.md` (point it at http://dashboard.home).
- `stack/.env` is secret — it is gitignored in the repo; don't commit it.
