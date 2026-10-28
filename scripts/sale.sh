#!/usr/bin/env bash
# Turn the Diwali sale on or off:  ./scripts/sale.sh on|off
set -euo pipefail
LAB_URL="${LAB_URL:-http://localhost:8081}"
case "${1:-}" in
  on)  active=true ;;
  off) active=false ;;
  *) echo "usage: $0 on|off"; exit 1 ;;
esac
curl -fsS -X POST "$LAB_URL/lab/api/sale" -H 'content-type: application/json' -d "{\"active\":$active}"
echo
