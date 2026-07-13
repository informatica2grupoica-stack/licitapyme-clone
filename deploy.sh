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

echo "==> 2/3 Reconstruyendo y levantando (puede tardar unos minutos)..."
docker compose up -d --build

echo "==> 3/3 Estado de los contenedores:"
docker compose ps

echo ""
echo "==> Ultimas lineas del log de la app:"
docker compose logs app --tail=15

echo ""
echo "==> Despliegue terminado."
