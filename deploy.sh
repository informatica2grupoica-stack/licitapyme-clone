#!/usr/bin/env bash
# deploy.sh — Despliega los últimos cambios en el VPS.
#
# Uso EN EL VPS (después de hacer git push desde tu PC):
#   bash ~/licitapyme-clone/deploy.sh            → despliega
#   bash ~/licitapyme-clone/deploy.sh --volver   → vuelve a la versión anterior (la imagen y el commit del despliegue previo)
#
# Hace: git pull -> avisa si trae migraciones -> reconstruye la imagen Docker -> levanta -> espera a que la app responda -> muestra estado y logs.
# El .env NO se toca (no está en git): si cambiaste variables, edítalas antes en el VPS.
set -e

# Ir a la carpeta del proyecto (donde está este script), funcione desde donde funcione.
cd "$(dirname "$0")"

IMAGEN="licitapyme-local"
CONTENEDOR="licitapyme"
ARCHIVO_ANTERIOR=".deploy-anterior"   # commit del despliegue previo (no está en git: ver .gitignore)
ARCHIVO_MIGRACIONES=".deploy-migraciones-pendientes"   # migraciones que un despliegue cancelado dejó por confirmar

# Espera hasta N segundos a que el contenedor quede «healthy». Devuelve 0 si sí, 1 si no.
esperar_salud() {
  local limite="${1:-150}" estado=""
  for i in $(seq 1 $((limite / 5))); do
    estado="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-healthcheck{{end}}' "$CONTENEDOR" 2>/dev/null || echo desconocido)"
    case "$estado" in
      healthy) return 0 ;;
      sin-healthcheck) echo "    (la app no tiene healthcheck definido: no se puede verificar)"; return 0 ;;
    esac
    sleep 5
  done
  echo "    Estado final de la app: $estado"
  return 1
}

# ── Volver a la versión anterior ──────────────────────────────────────────────
if [ "${1:-}" = "--volver" ]; then
  if ! docker image inspect "$IMAGEN:anterior" >/dev/null 2>&1; then
    echo "No hay imagen anterior guardada ($IMAGEN:anterior): no se puede volver automáticamente."; exit 1
  fi
  echo "==> Volviendo a la imagen anterior..."
  docker tag "$IMAGEN:anterior" "$IMAGEN:latest"
  docker compose up -d --no-build
  if [ -f "$ARCHIVO_ANTERIOR" ]; then
    echo "    El código quedó en el commit nuevo; para alinear el repo: git checkout $(cat "$ARCHIVO_ANTERIOR")"
  fi
  echo "    OJO: si el despliegue aplicó migraciones, la versión anterior las verá (casi siempre son aditivas y no molestan)."
  esperar_salud 150 && echo "==> Versión anterior en pie." || { echo "==> La versión anterior tampoco responde: revisar  docker compose logs app --tail=100"; exit 1; }
  exit 0
fi

echo "==> 1/4 Bajando cambios de GitHub..."
ANTES="$(git rev-parse HEAD)"
git pull
DESPUES="$(git rev-parse HEAD)"

# Las migraciones se aplican a mano (scripts/aplicar-migration-N.mjs): si este despliegue trae alguna y no se aplicó, el código nuevo
# corre contra una base vieja. Se avisa y se pide confirmación (sin terminal: MIGRACIONES_OK=1 para seguir igual).
NUEVAS=""
[ -f "$ARCHIVO_MIGRACIONES" ] && NUEVAS="$(cat "$ARCHIVO_MIGRACIONES")"   # quedaron de un intento cancelado: el pull ya ocurrió y no se verían de nuevo
if [ "$ANTES" != "$DESPUES" ]; then
  NUEVAS="$(printf '%s
%s
' "$NUEVAS" "$(git diff --name-only "$ANTES" "$DESPUES" -- 'docs/migration-*' 'scripts/aplicar-migration-*')" | sed '/^$/d' | sort -u)"
fi
if [ -n "$NUEVAS" ]; then
  {
    echo ""
    echo "    ⚠ Este despliegue trae migraciones nuevas o cambiadas:"
    echo "$NUEVAS" | sed 's/^/        /'
    echo "    Deben estar aplicadas en la base ANTES de levantar el código nuevo."
    if [ "${MIGRACIONES_OK:-0}" != "1" ]; then
      echo "$NUEVAS" > "$ARCHIVO_MIGRACIONES"
      if [ -t 0 ]; then
        read -r -p "    ¿Ya las aplicaste? (s/N) " RESP
        [ "$RESP" = "s" ] || [ "$RESP" = "S" ] || { echo "    Despliegue cancelado: aplica las migraciones y vuelve a correr deploy.sh."; exit 1; }
      else
        echo "    Sin terminal para preguntar: cancelado. Aplica las migraciones y corre  MIGRACIONES_OK=1 bash deploy.sh"; exit 1
      fi
    fi
    rm -f "$ARCHIVO_MIGRACIONES"
  }
fi

echo "==> 2/4 Reconstruyendo la imagen (la app sigue atendiendo mientras tanto)..."
# Guarda la imagen que está corriendo como «anterior» para poder volver con --volver.
if docker image inspect "$IMAGEN:latest" >/dev/null 2>&1; then
  docker tag "$IMAGEN:latest" "$IMAGEN:anterior"
  echo "$ANTES" > "$ARCHIVO_ANTERIOR"
fi
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

echo "==> 3/4 Esperando a que la app responda (hasta 2,5 min)..."
if esperar_salud 150; then
  echo "    La app responde y llega a la base de datos."
  SALUD_OK=1
else
  SALUD_OK=0
  echo "    ❌ La app NO quedó sana. Últimas líneas del log:"
  docker compose logs app --tail=40
  echo ""
  echo "    Para volver a la versión anterior:  bash deploy.sh --volver"
fi

echo "==> 4/4 Estado de los contenedores:"
docker compose ps

echo ""
echo "==> Ultimas lineas del log de la app:"
docker compose logs app --tail=15

echo ""
if [ "$SALUD_OK" = "1" ]; then
  echo "==> Despliegue terminado."
else
  echo "==> Despliegue terminado CON PROBLEMAS (la app no pasó el chequeo de salud)."
  exit 1
fi
