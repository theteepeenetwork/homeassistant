#!/usr/bin/env bash
# =============================================================================
#  discover-entities.sh — list/verify Home Assistant entity ids for the wallboard
# -----------------------------------------------------------------------------
#  Run this ON macserver (where the LAN + token live). It hits the SAME proxy
#  the browser uses, so no token is needed once Caddy is wired (see README).
#
#  Usage:
#     ./discover-entities.sh                 # via Caddy proxy (no token needed)
#     ./discover-entities.sh all             # dump every entity_id, sorted
#     HA_URL=http://home.home HA_TOKEN=xxx ./discover-entities.sh   # direct
#
#  Then copy the real ids into config.js. Requires: curl, jq.
# =============================================================================
set -euo pipefail

URL="${HA_URL:-http://wallboard.home}"
TOKEN="${HA_TOKEN:-}"

auth=()
[[ -n "$TOKEN" ]] && auth=(-H "Authorization: Bearer $TOKEN")

if ! command -v jq >/dev/null; then echo "Please install jq."; exit 1; fi

states="$(curl -fsS "${auth[@]}" "$URL/api/states")" || {
  echo "Could not reach $URL/api/states."
  echo "If using the Caddy proxy, ensure HA_TOKEN is set in stack/.env and caddy is up."
  echo "Or run directly:  HA_URL=http://home.home HA_TOKEN=<token> $0"
  exit 1
}

if [[ "${1:-}" == "all" ]]; then
  echo "$states" | jq -r '.[].entity_id' | sort
  exit 0
fi

show() {
  local title="$1" pattern="$2"
  echo
  echo "== $title =="
  echo "$states" | jq -r --arg p "$pattern" '
    .[] | select(.entity_id | test($p)) |
    "  \(.entity_id)\t= \(.state)\t[\(.attributes.unit_of_measurement // "")]"' \
    | sort || true
}

echo "Home Assistant entity discovery  ($URL)"
echo "Confirm these against config.js, then edit ids that don't match."

show "Weather"            'weather\.'
show "EV charger (Ohme)"  'ohme'
show "Octopus / Intelligent Go" 'octopus'
show "Solar/Battery/Grid (Sigen — may be empty until Modbus opens)" 'sigen'
show "Climate (heat pump)" '^climate\.'
show "Temperature sensors" 'temperature'
show "Humidity sensors"    'humidity'
show "Server health"       'server'
show "Containers"          'container'
show "Backups"             'backup'

echo
echo "Tip:  $0 all   # to dump every entity_id"
