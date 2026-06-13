#!/usr/bin/env python3
# =============================================================================
#  sigen-portal.py — parse Sigenergy portal "stationData" exports
# -----------------------------------------------------------------------------
#  The Sigenergy cloud portal exports three flavours of "stationData-*.xlsx":
#    * 5-minute POWER (kW)   : Date, Solar, Load, From/To Battery, From/To Grid
#    * daily ENERGY (kWh)    : Date, Solar, Load, Batt Charge/Discharge,
#                              Grid Import/Export, Revenue(£)
#    * yearly SUMMARY        : one row per year + a total (energy + Revenue)
#
#  HA only has live/recent data; these exports are the real long history. This
#  script reads any mix of them (auto-detected by header), uses the DAILY energy
#  rows as the source of truth (validated to within ~2% of integrating the
#  5-minute power and of HA's own daily sensors), and prints month-to-date,
#  year-to-date and per-month energy + the portal's Revenue. It also estimates
#  the grid cash net at your Octopus unit rates, and can emit a compact JSON for
#  the wallboard (CONFIG.solarHistoryUrl).
#
#  Pure Python stdlib — no pip, no openpyxl.
#
#  Usage:
#     python3 sigen-portal.py stationData-*.xlsx
#     python3 sigen-portal.py --json dev/wallboard/data/solar-history.json *.xlsx
#     SIGEN_IMPORT_RATE=0.07 SIGEN_EXPORT_RATE=0.15 python3 sigen-portal.py *.xlsx
#
#  NB the portal's "Revenue (£)" is its OWN benefit estimate from the tariff set
#  in the Sigenergy app — not your Octopus bill. The script also prints a
#  separate grid cash net (import £ - export £) at the rates below so you can
#  compare. The 5-minute export is capped ~10k rows (~35 days); daily/yearly go
#  back to install (2025-03-10).
# =============================================================================
import os
import re
import sys
import json
import glob
import zipfile
import argparse
from datetime import datetime, date, timezone

# Default Octopus unit rates (£/kWh) for the grid cash-net estimate. Override
# with --import-rate/--export-rate or SIGEN_IMPORT_RATE/SIGEN_EXPORT_RATE. On
# Intelligent Octopus Go nearly all import is the off-peak rate; export is the
# flat Outgoing rate. These are estimates — adjust to your actual tariff.
DEF_IMPORT_RATE = float(os.environ.get("SIGEN_IMPORT_RATE", "0.07"))
DEF_EXPORT_RATE = float(os.environ.get("SIGEN_EXPORT_RATE", "0.15"))

# daily/yearly column order after the Date column
COLS = ["pv", "load", "charge", "discharge", "import", "export", "revenue"]


def cells(block):
    """Return the inline-string / numeric text of each <c> in a row block."""
    return [
        (a or b)
        for (a, b) in re.findall(
            r"<c[^>]*?>(?:<is><t[^>]*>(.*?)</t></is>|<v>(.*?)</v>)?</c>", block, re.S
        )
    ]


def read_rows(xlsx):
    txt = zipfile.ZipFile(xlsx).read("xl/worksheets/sheet1.xml").decode("utf-8")
    return [cells(b) for b in re.findall(r"<row[^>]*>(.*?)</row>", txt, re.S)]


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def load_daily(rows):
    """Daily-energy export -> {date: {col: kWh/£}}. '--' / blank -> skipped."""
    out = {}
    for r in rows:
        if not r or r[0] in ("Date", ""):
            continue
        try:
            d = date.fromisoformat(r[0])
        except ValueError:
            continue
        vals = [num(v) for v in r[1:8]]
        if all(v is None for v in vals):
            continue
        out[d] = {c: (vals[i] or 0.0) for i, c in enumerate(COLS)}
    return out


def detect(rows):
    """Classify an export by its header row."""
    hdr = " ".join(rows[0]).lower() if rows else ""
    if "kw)" in hdr and "energy" not in hdr:
        return "power5min"
    if "energy" in hdr:
        # daily vs yearly: yearly's first data cell is a bare year like "2025"
        for r in rows[1:]:
            if r and r[0] not in ("Date", ""):
                return "yearly" if re.fullmatch(r"\d{4}", r[0]) else "daily"
    return "unknown"


def money(v):
    return "—" if v is None else f"£{v:,.0f}"


def kwh(v):
    return "—" if v is None else f"{v:,.0f}"


def main():
    ap = argparse.ArgumentParser(description="Parse Sigenergy portal exports.")
    ap.add_argument("files", nargs="+", help="stationData-*.xlsx export(s)")
    ap.add_argument("--json", metavar="PATH", help="also write a wallboard summary JSON")
    ap.add_argument("--import-rate", type=float, default=DEF_IMPORT_RATE)
    ap.add_argument("--export-rate", type=float, default=DEF_EXPORT_RATE)
    args = ap.parse_args()

    paths = []
    for f in args.files:
        paths.extend(sorted(glob.glob(f)) or [f])

    daily = {}
    for p in paths:
        try:
            rows = read_rows(p)
        except Exception as e:
            print(f"skip {p}: {e}", file=sys.stderr)
            continue
        kind = detect(rows)
        if kind == "daily":
            for k, v in load_daily(rows).items():
                # prefer the populated record if a date appears in two files
                if k not in daily or sum(daily[k].values()) == 0:
                    daily[k] = v
        # power5min / yearly are ignored for totals (daily is authoritative)
        print(f"read {os.path.basename(p)}: {kind}", file=sys.stderr)

    if not daily:
        sys.exit("no daily-energy export found (need the 'Energy (kWh)' report)")

    days = sorted(daily)
    as_of = max(d for d in days if sum(daily[d].values()) > 0)

    def agg(sel):
        out = {c: 0.0 for c in COLS}
        n = 0
        for d in sel:
            n += 1
            for c in COLS:
                out[c] += daily[d][c]
        out["days"] = n
        # grid cash net at the configured rates (negative => net earned)
        out["netGridCost"] = out["import"] * args.import_rate - out["export"] * args.export_rate
        return out

    ytd = agg([d for d in days if d.year == as_of.year])
    mtd = agg([d for d in days if d.year == as_of.year and d.month == as_of.month])
    by_month = {}
    for d in days:
        by_month.setdefault((d.year, d.month), []).append(d)

    # ---- console report ------------------------------------------------------
    ir, er = args.import_rate, args.export_rate
    print(f"\nSigenergy portal — data {days[0]} → {as_of}   "
          f"(rates: import £{ir:.3f} / export £{er:.3f} per kWh)")
    print("=" * 78)
    hdr = ["PV", "Load", "Import", "Export", "Charge", "Dischg", "Rev £", "GridNet"]
    print(f"{'Period':12}" + "".join(f"{h:>9}" for h in hdr))
    print("-" * 78)

    def line(label, a):
        net = a["netGridCost"]
        nets = ("+£%.0f" % -net) if net < 0 else ("£%.0f" % net)
        print(f"{label:12}" + "".join(f"{kwh(a[c]):>9}" for c in
              ["pv", "load", "import", "export", "charge", "discharge"])
              + f"{money(a['revenue']):>9}{nets:>9}")

    for (y, m) in sorted(by_month):
        if y != as_of.year:
            continue
        line(f"{y}-{m:02d}", agg(by_month[(y, m)]))
    print("-" * 78)
    line(f"MTD {as_of:%b}", mtd)
    line(f"YTD {as_of.year}", ytd)
    print("=" * 78)
    net = ytd["netGridCost"]
    print(f"Portal revenue YTD: £{ytd['revenue']:,.0f}   |   "
          f"grid cash net YTD @ your rates: "
          f"{'+£%.0f earned' % -net if net < 0 else '£%.0f paid' % net}")
    print("(grid cash net = import kWh × import rate − export kWh × export rate; "
          "excludes standing charge & car split)\n")

    # ---- wallboard JSON ------------------------------------------------------
    if args.json:
        def pack(label, a):
            return {"label": label, "days": a["days"],
                    **{c: round(a[c], 1) for c in COLS},
                    "netGridCost": round(a["netGridCost"], 2)}
        payload = {
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "Sigenergy portal daily export",
            "dataStart": days[0].isoformat(),
            "asOf": as_of.isoformat(),
            "rates": {"import": ir, "export": er, "currency": "GBP"},
            "periods": {"mtd": pack(f"{as_of:%b} MTD", mtd),
                        "ytd": pack(f"{as_of.year} YTD", ytd)},
        }
        os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
        with open(args.json, "w") as fh:
            json.dump(payload, fh, indent=2)
        print(f"wrote {args.json}", file=sys.stderr)


if __name__ == "__main__":
    main()
