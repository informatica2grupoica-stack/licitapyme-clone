#!/usr/bin/env bash
# bd-migrar-desde-bluehost.sh — Copia la base de Bluehost a la MySQL del VPS (contenedor licitapyme-db).
#
# Uso EN EL VPS, con el scheduler detenido (ver docs/migracion-bd-vps.md):
#   bash ~/licitapyme-clone/scripts/bd-migrar-desde-bluehost.sh
#
# Copia directo servidor a servidor (sin pasar por el navegador) y al final compara cuántas filas
# tiene cada tabla en los dos lados. Si alguna no cuadra, termina con error y NO hay que cambiar DB_HOST.
set -euo pipefail
cd "$(dirname "$0")/.."

leer() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E "s/^[\"']//; s/[\"']$//"; }
BH_HOST=$(leer BLUEHOST_DB_HOST); BH_USER=$(leer BLUEHOST_DB_USER); BH_PASS=$(leer BLUEHOST_DB_PASSWORD); BH_DB=$(leer BLUEHOST_DB_NAME)
ROOT_PASS=$(leer MYSQL_ROOT_PASSWORD); DB=$(leer DB_NAME)
for v in BH_HOST BH_USER BH_PASS BH_DB ROOT_PASS DB; do [ -n "${!v}" ] || { echo "Falta $v en .env"; exit 1; }; done

# Clientes mysql/mysqldump del propio contenedor; las claves van por variable de entorno, no en la línea de comandos.
bluehost() { local p=$1; shift; docker exec -i -e MYSQL_PWD="$BH_PASS" licitapyme-db "$p" -h "$BH_HOST" -u "$BH_USER" --compress "$@"; }
local_db() { local p=$1; shift; docker exec -i -e MYSQL_PWD="$ROOT_PASS" licitapyme-db "$p" -u root "$@"; }

echo "==> 1/3 Copiando $BH_DB (Bluehost) -> $DB (VPS)... (unos minutos)"
inicio=$(date +%s)
# Durante la copia no se espera al disco en cada fila (mucho más rápido); se restablece al terminar, pase lo que pase.
local_db mysql -e "SET GLOBAL innodb_flush_log_at_trx_commit = 2"
trap 'local_db mysql -e "SET GLOBAL innodb_flush_log_at_trx_commit = 1"' EXIT
# --column-statistics=0: el mysqldump 8.0 lo pide para leer un servidor 5.7.
# --no-tablespaces: si no, pide el privilegio PROCESS, que el usuario compartido de Bluehost no tiene.
bluehost mysqldump --single-transaction --quick --set-gtid-purged=OFF --column-statistics=0 \
  --no-tablespaces --default-character-set=utf8mb4 "$BH_DB" \
  | local_db mysql --default-character-set=utf8mb4 "$DB"
echo "    listo en $(( $(date +%s) - inicio )) s"

echo "==> 2/3 Comparando filas por tabla..."
CONTEO="SELECT CONCAT('SELECT ''', table_name, ''', COUNT(*) FROM \`', table_name, '\`;') FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name"
contar() { local lado=$1 base=$2; $lado mysql -N -D "$base" -e "$CONTEO" | $lado mysql -N -D "$base"; }
diff <(contar bluehost "$BH_DB") <(contar local_db "$DB") > /tmp/bd-diferencias.txt || {
  echo "!! Hay tablas que no cuadran (izquierda Bluehost, derecha VPS):"; cat /tmp/bd-diferencias.txt
  echo "   Si el scheduler estaba andando, deténlo y vuelve a correr el script. NO cambies DB_HOST todavía."
  exit 1
}
echo "    las $(contar local_db "$DB" | wc -l) tablas tienen las mismas filas"

echo "==> 3/3 Listo. Siguiente paso: DB_HOST=db en .env y docker compose up -d (ver la guía)."
