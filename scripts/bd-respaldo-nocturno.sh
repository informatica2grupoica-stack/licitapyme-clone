#!/usr/bin/env bash
# bd-respaldo-nocturno.sh — Respalda la base del VPS: guarda una copia comprimida aquí (últimos 7 días)
# y la carga en Bluehost, que queda como base de reserva con los datos de anoche.
#
# Se programa en el crontab del usuario ubuntu del VPS (ver docs/migracion-bd-vps.md):
#   0 3 * * * bash /home/ubuntu/licitapyme-clone/scripts/bd-respaldo-nocturno.sh >> /home/ubuntu/respaldos-bd/respaldo.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

leer() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']$//"; }
BH_HOST=$(leer BLUEHOST_DB_HOST); BH_USER=$(leer BLUEHOST_DB_USER); BH_PASS=$(leer BLUEHOST_DB_PASSWORD); BH_DB=$(leer BLUEHOST_DB_NAME)
ROOT_PASS=$(leer MYSQL_ROOT_PASSWORD); DB=$(leer DB_NAME)
for v in BH_HOST BH_USER BH_PASS BH_DB ROOT_PASS DB; do [ -n "${!v}" ] || { echo "Falta $v en .env"; exit 1; }; done

CARPETA="$HOME/respaldos-bd"
mkdir -p "$CARPETA"
ARCHIVO="$CARPETA/$DB-$(date +%F_%H%M).sql.gz"

echo "[$(date '+%F %T')] respaldo -> $ARCHIVO"
docker exec -e MYSQL_PWD="$ROOT_PASS" licitapyme-db \
  mysqldump -u root --single-transaction --quick --set-gtid-purged=OFF --routines --triggers \
  --default-character-set=utf8mb4 "$DB" | gzip > "$ARCHIVO"
# Un dump cortado no trae la línea final «Dump completed»: no se sube a Bluehost ni se cuenta como respaldo.
zcat "$ARCHIVO" | tail -1 | grep -q "Dump completed" || { echo "!! dump incompleto, se descarta"; rm -f "$ARCHIVO"; exit 1; }

# Deja solo los 7 más recientes.
ls -1t "$CARPETA"/*.sql.gz | tail -n +8 | xargs -r rm -f

echo "[$(date '+%F %T')] cargando en Bluehost ($BH_DB)..."
# MySQL 8 crea con utf8mb4_0900_ai_ci las tablas que dicen CHARSET=utf8mb4 sin COLLATE; Bluehost (5.7) no lo conoce
# («Unknown collation», 22-oct). Se traduce al equivalente de 5.7 solo en la copia que va a Bluehost.
zcat "$ARCHIVO" | sed 's/utf8mb4_0900_ai_ci/utf8mb4_general_ci/g' | docker exec -i -e MYSQL_PWD="$BH_PASS" licitapyme-db \
  mysql -h "$BH_HOST" -u "$BH_USER" --compress --default-character-set=utf8mb4 "$BH_DB"
echo "[$(date '+%F %T')] respaldo OK ($(du -h "$ARCHIVO" | cut -f1))"
