# Raspberry Pi kiosk setup

Turns a Raspberry Pi (Pi OS Bookworm) into an always-on, full-screen Chromium
display showing `http://dashboard.home`. Works on both the default Wayland
(labwc/wayfire) and X11 sessions.

## Quick start (scripted)

Copy the dashboard's `pi-kiosk-setup.sh` to the Pi and run it as the **desktop
user** (not root):

```bash
scp dev/wallboard/pi-kiosk-setup.sh pi@<pi-ip>:~/
ssh pi@<pi-ip>
bash ~/pi-kiosk-setup.sh
sudo reboot
```

The script:

- installs Chromium + `unclutter` (+ `wlr-randr` on Wayland),
- writes `~/.local/bin/wallboard-kiosk.sh` — a wrapper that **relaunches
  Chromium if it crashes** and disables screen blanking,
- registers autostart for whichever session is present (wayfire.ini, labwc
  autostart, or LXDE/X11 autostart),
- hides the mouse cursor.

Override the URL with `WALLBOARD_URL=http://dashboard.home bash pi-kiosk-setup.sh`.

## Prerequisites

- **DNS**: the Pi must use the LAN DNS (Pi-hole at `192.168.1.190`) so
  `dashboard.home` resolves. A normal DHCP client on your network gets this
  automatically. Verify: `getent hosts dashboard.home`.
- The wallboard must be deployed and reachable (see top-level `README.md`):
  `curl -I http://dashboard.home` should return `200`.

## What the script configures

### Chromium kiosk flags
```
chromium-browser --kiosk --noerrordialogs --disable-infobars --incognito \
  --check-for-update-interval=31536000 --disable-session-crashed-bubble \
  --disable-features=Translate http://dashboard.home
```

### Disable screen blanking / DPMS
- **Easiest:** `sudo raspi-config` → *Display Options* → *Screen Blanking* → **Off**.
- **X11:** `xset s off; xset -dpms; xset s noblank` (the wrapper does this).
- **Wayland (labwc/wayfire):** the wrapper keeps the output on; you can also use
  `wlr-randr` to manage outputs.

### Hide the cursor
- **X11:** `unclutter -idle 0` (the wrapper starts it).
- **Wayland:** the cursor auto-hides when idle in kiosk; install `interception-tools`
  only if you need it gone immediately.

### Auto-restart on crash
`wallboard-kiosk.sh` runs Chromium in a `while true` loop and relaunches it 3s
after any exit, so a rare renderer crash self-heals without a reboot. The
dashboard itself also does a silent full reload at ~04:00 daily (configurable in
`config.js`) as memory-leak insurance.

## Optional: turn the HDMI display off overnight

The dashboard already dims itself 23:00–06:00 (CSS brightness, see
`CONFIG.nightDim`). If you'd rather power the panel down entirely, add a cron
job on the Pi:

```bash
# crontab -e
0 23 * * *  /usr/bin/vcgencmd display_power 0   # or: wlr-randr --output HDMI-A-1 --off
0 6  * * *  /usr/bin/vcgencmd display_power 1   # or: wlr-randr --output HDMI-A-1 --on
```

Use `wlr-randr` (Wayland) or `vcgencmd display_power 0|1` depending on your
setup; run `wlr-randr` once to find your output name.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `dashboard.home` won't resolve | Confirm Pi DNS = Pi-hole; `getent hosts dashboard.home` |
| Black screen / no autostart | Check session: `echo $XDG_SESSION_TYPE`; re-run the script |
| Screen sleeps after a while | `raspi-config` → Screen Blanking → Off; reboot |
| "Restore pages" bubble | Already suppressed via `--disable-session-crashed-bubble` + clean profile |
| Need to exit kiosk | `Alt+F4`, or SSH in and `pkill chromium` (wrapper relaunches — disable autostart first) |
