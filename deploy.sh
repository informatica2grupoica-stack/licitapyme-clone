#!/usr/bin/env bash
# deploy.sh — Despliega los últimos cambios en el VPS.
#
# Uso EN EL VPS (después de hacer git push desde tu PC):
#   bash ~/licitapyme-clone/deploy.sh
#
# Hace: git pull -> reconstruye la imagen Docker -> levanta -> muestra estado y logs.
# El .env NO se toca (no está en git): si cambiaste variables, edítalas antes en el VPS.
set -e

# Ir a la carpeta del proyecto (donde está este script), funcione desde donde funcione.
cd "$(dirname "$0")"

echo "==> 1/3 Bajando cambios de GitHub..."
git pull

echo "==> 2/3 Reconstruyendo la imagen (la app sigue atendiendo mientras tanto)..."
docker compose build

# Reiniciar la app mata los análisis de viabilidad que estén corriendo («El análisis se
# interrumpió»: 3712-74-LP26, dos veces el 2026-10-27). Se espera a que terminen, hasta 15 min.
# FORZAR=1 bash deploy.sh reinicia sin esperar.
analisis_en_curso() {
  docker exec licitapyme-db sh -c 'mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT GROUP_CONCAT(licitacion_codigo) FROM viabilidad_jobs WHERE estado = '"'"'procesando'"'"' AND TIMESTAMPDIFF(SECOND, actualizado_at, UTC_TIMESTAMP()) < 150"' 2>/dev/null | grep -v '^NULL$' || true
}
if [ "${FORZAR:-0}" != "1" ]; then
  for i in $(seq 1 90); do
    EN_CURSO="$(analisis_en_curso)"
    [ -z "$EN_CURSO" ] && break
    [ "$i" = 1 ] && echo "    Hay análisis de viabilidad corriendo ($EN_CURSO): espero a que terminen antes de reiniciar..."
    sleep 10
  done
  [ -n "$EN_CURSO" ] && echo "    Pasaron 15 min y siguen corriendo ($EN_CURSO): reinicio igual."
fi

echo "    Levantando la versión nueva..."
docker compose up -d

echo "==> 3/3 Estado de los contenedores:"
docker compose ps

echo ""
echo "==> Ultimas lineas del log de la app:"
docker compose logs app --tail=15

echo ""
echo "==> Despliegue terminado."
