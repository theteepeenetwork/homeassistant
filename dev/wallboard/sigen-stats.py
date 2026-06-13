#!/usr/bin/env python3
# =============================================================================
#  sigen-stats.py — month-to-date & year-to-date energy for the Sigenergy ESS
# -----------------------------------------------------------------------------
#  The Sigenergy integration exposes DAILY (reset at midnight) and LIFETIME
#  (always-climbing `total_*`) energy sensors, but no "this month" / "this year"
#  sensors. This script derives MTD and YTD from Home Assistant's long-term
#  statistics: it sums each cumulative sensor's per-month `change` from the
#  start of the year to now (YTD = all months, MTD = the current month bucket).
#
#  Runs ON the LAN (e.g. macserver) where home.home + the token live. Talks to
#  HA's WebSocket statistics API (recorder/statistics_during_period) directly —
#  pure Python stdlib, NO pip installs, no websocket library required.
#
#  Usage:
#     export HA_TOKEN=$(grep -E '^HA_TOKEN=' ~/stack/.env | cut -d= -f2-)
#     HA_URL=http://home.home python3 sigen-stats.py
#
#  Env:
#     HA_URL    base URL of Home Assistant (default http://home.home)
#     HA_TOKEN  long-lived access token (required)
#
#  NB statistics only exist for the window HA has been RECORDING this sensor.
#  If the Sigen integration was added partway through the year, "YTD" only
#  covers from that point — the script flags the earliest data it finds.
# =============================================================================
import os
import sys
import ssl
import json
import socket
import struct
import base64
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse

# ---- The cumulative (lifetime) sensors to derive MTD/YTD from, plus the
#      matching daily sensor for a sanity cross-check. ---------------------------
METRICS = [
    ("PV generation",      "sensor.sigen_plant_total_pv_generation",                "sensor.sigen_plant_daily_pv_energy"),
    ("Grid import",        "sensor.sigen_plant_total_imported_energy",              "sensor.sigen_plant_daily_grid_import_energy"),
    ("Grid export",        "sensor.sigen_plant_total_exported_energy",              "sensor.sigen_plant_daily_grid_export_energy"),
    ("Battery charged",    "sensor.sigen_plant_total_charged_energy_of_the_ess",    "sensor.sigen_plant_daily_battery_charge_energy"),
    ("Battery discharged", "sensor.sigen_plant_total_discharged_energy_of_the_ess", "sensor.sigen_plant_daily_battery_discharge_energy"),
    ("House load",         "sensor.sigen_plant_total_load_consumption",             "sensor.sigen_plant_daily_load_consumption"),
]

HA_URL = os.environ.get("HA_URL", "http://home.home").rstrip("/")
HA_TOKEN = os.environ.get("HA_TOKEN", "")


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


# ---- REST helper: pull current states (for units + today's daily values) ------
def get_states():
    req = urllib.request.Request(
        f"{HA_URL}/api/states",
        headers={"Authorization": f"Bearer {HA_TOKEN}", "Accept": "application/json"},
    )
    ctx = ssl._create_unverified_context() if HA_URL.startswith("https") else None
    with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
        return {e["entity_id"]: e for e in json.load(r)}


# ---- Minimal RFC6455 WebSocket client (stdlib only) ---------------------------
class WS:
    def __init__(self, sock):
        self.s = sock
        self.buf = b""

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("connection closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def handshake(self, host, port, path):
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.s.sendall(req.encode())
        while b"\r\n\r\n" not in self.buf:
            chunk = self.s.recv(65536)
            if not chunk:
                raise ConnectionError("closed during handshake")
            self.buf += chunk
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b"101" not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError(f"bad handshake: {head[:80]!r}")

    def send(self, obj):
        payload = json.dumps(obj).encode()
        n, mask = len(payload), os.urandom(4)
        frame = bytearray([0x81])              # FIN + text opcode
        if n < 126:
            frame.append(0x80 | n)
        elif n < 65536:
            frame.append(0x80 | 126); frame += struct.pack(">H", n)
        else:
            frame.append(0x80 | 127); frame += struct.pack(">Q", n)
        frame += mask
        frame += bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        self.s.sendall(bytes(frame))

    def recv(self):
        b0 = self._read(1)[0]
        opcode = b0 & 0x0F
        b1 = self._read(1)[0]
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._read(8))[0]
        mask = self._read(4) if (b1 & 0x80) else None
        data = self._read(n)
        if mask:
            data = bytes(b ^ mask[i & 3] for i, b in enumerate(data))
        if opcode == 0x8:
            raise ConnectionError("server sent close frame")
        if opcode in (0x9, 0xA):   # ping/pong — skip
            return self.recv()
        return json.loads(data.decode("utf-8", "replace"))


def ws_statistics(stat_ids, start_iso, end_iso, period="month"):
    u = urlparse(HA_URL)
    secure = u.scheme == "https"
    host = u.hostname
    port = u.port or (443 if secure else 80)
    raw = socket.create_connection((host, port), timeout=15)
    if secure:
        raw = ssl._create_unverified_context().wrap_socket(raw, server_hostname=host)
    ws = WS(raw)
    ws.handshake(host, port, "/api/websocket")

    # auth handshake
    msg = ws.recv()
    if msg.get("type") != "auth_required":
        raise ConnectionError(f"unexpected first message: {msg}")
    ws.send({"type": "auth", "access_token": HA_TOKEN})
    msg = ws.recv()
    if msg.get("type") != "auth_ok":
        raise ConnectionError(f"auth failed: {msg}")

    ws.send({
        "id": 1,
        "type": "recorder/statistics_during_period",
        "start_time": start_iso,
        "end_time": end_iso,
        "statistic_ids": stat_ids,
        "period": period,
        "types": ["change", "sum", "state"],
    })
    while True:
        msg = ws.recv()
        if msg.get("type") == "result" and msg.get("id") == 1:
            if not msg.get("success"):
                raise ConnectionError(f"stats query failed: {msg.get('error')}")
            return msg.get("result", {})


# ---- unit normalisation to kWh ------------------------------------------------
def to_kwh(value, unit):
    if value is None:
        return None
    u = (unit or "kWh").lower()
    if u == "mwh":
        return value * 1000.0
    if u == "wh":
        return value / 1000.0
    return value  # already kWh (or assume so)


def bucket_dt(b):
    s = b.get("start")
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / 1000 if s > 1e12 else s, tz=timezone.utc).astimezone()
    return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone()


def fmt(v):
    return "    —    " if v is None else f"{v:9.1f}"


def main():
    if not HA_TOKEN:
        die("HA_TOKEN is not set. Run: export HA_TOKEN=$(grep -E '^HA_TOKEN=' ~/stack/.env | cut -d= -f2-)")

    try:
        states = get_states()
    except Exception as e:
        die(f"could not GET {HA_URL}/api/states — {e}")

    now = datetime.now().astimezone()
    year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    stat_ids = [m[1] for m in METRICS]
    try:
        result = ws_statistics(stat_ids, year_start.isoformat(), now.isoformat(), period="month")
    except Exception as e:
        die(f"statistics query failed — {e}")

    earliest = None
    rows = []
    for label, total_id, daily_id in METRICS:
        unit = (states.get(total_id, {}).get("attributes", {}) or {}).get("unit_of_measurement")
        buckets = result.get(total_id, []) or []
        ytd = None
        mtd = None
        for b in buckets:
            ch = b.get("change")
            if ch is None:
                continue
            ch = to_kwh(ch, unit)
            ytd = (ytd or 0.0) + ch
            d = bucket_dt(b)
            if earliest is None or d < earliest:
                earliest = d
            if d.year == now.year and d.month == now.month:
                mtd = ch
        daily_raw = states.get(daily_id, {}).get("state")
        try:
            today = float(daily_raw)
        except (TypeError, ValueError):
            today = None
        rows.append((label, today, mtd, ytd))

    # ---- print ---------------------------------------------------------------
    print()
    print(f"Sigenergy ESS energy — {now:%Y-%m-%d %H:%M %Z}   (source: {HA_URL})")
    print("-" * 60)
    print(f"{'Metric':<20}{'Today':>9}{'Month→date':>12}{'Year→date':>12}   kWh")
    print("-" * 60)
    for label, today, mtd, ytd in rows:
        print(f"{label:<20}{fmt(today)}{fmt(mtd):>12}{fmt(ytd):>12}")
    print("-" * 60)
    if earliest:
        print(f"NB statistics begin {earliest:%Y-%m-%d}; "
              f"YTD only covers data recorded since then.")
    print()


if __name__ == "__main__":
    main()
