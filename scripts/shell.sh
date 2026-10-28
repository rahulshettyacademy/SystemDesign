#!/usr/bin/env bash
# Open a shell on a data store (read-only accounts where possible).
#   ./scripts/shell.sh psql order_db      (auth_db | cart_db | order_db | payment_db | inventory_db)
#   ./scripts/shell.sh mongo catalog_db   (catalog_db | notification_db)
#   ./scripts/shell.sh redis
#   ./scripts/shell.sh logs <request-id>  (every log line, from every service, for one request)
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  psql)  docker compose exec -e PGPASSWORD=lab_readonly_pw postgres psql -h localhost -U lab_readonly -d "${2:-order_db}" "${@:3}" ;;
  mongo) docker compose exec mongodb mongosh --quiet -u lab_readonly -p lab_readonly_pw --authenticationDatabase admin "${2:-catalog_db}" "${@:3}" ;;
  redis) docker compose exec redis redis-cli ;;
  logs)  docker compose logs --no-log-prefix 2>/dev/null | grep "${2:?request id required}" ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
