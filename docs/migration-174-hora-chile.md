# Migration-174 — la BD pasa a hora de Chile

**Problema (2026-10-27):** el MySQL del VPS corre en `America/Denver` (heredado de Bluehost). Lo que
pone la BD sola (`DEFAULT CURRENT_TIMESTAMP`, `ON UPDATE`, `NOW()`) queda 3 h atrás de Chile, y 4 h desde
el 2026-11-01, cuando Denver sale del horario de verano. La app escribe hora chilena a mano en otras
columnas, así que hoy conviven las dos horas.

**Qué deja:** `NOW()` = hora de Chile, y las fechas ya guardadas en hora chilena. El script
`scripts/aplicar-migration-174.mjs` explica qué hace con cada columna y por qué.

**Duración:** unos 10 min con la app detenida. Hacerlo en un horario sin uso (temprano o de noche).

## Pasos (en el VPS, salvo el 4)

1. **Elegir el momento.** Sin análisis de viabilidad corriendo:
   ```bash
   docker exec licitapyme-db sh -c 'mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT licitacion_codigo FROM viabilidad_jobs WHERE estado=\"procesando\""'
   ```
2. **Detener la app y el scheduler** (nadie escribe fechas mientras se convierten):
   ```bash
   cd ~/licitapyme-clone && docker compose stop app scheduler
   ```
3. **Respaldo completo:**
   ```bash
   docker exec licitapyme-db sh -c 'mysqldump --single-transaction --routines -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' | gzip > ~/respaldo-antes-174-$(date +%F-%H%M).sql.gz && ls -lh ~/respaldo-antes-174-*
   ```
4. **Convertir los datos** (desde el PC, con el túnel abierto). Primero revisar, después aplicar:
   ```bash
   node scripts/aplicar-migration-174.mjs --produccion
   node scripts/aplicar-migration-174.mjs --produccion --aplicar
   ```
   Si se corre dos veces no hace nada: deja la tabla `migracion_174_hora_chile` como marca.
5. **Cambiar la zona de la BD.** En `docker-compose.yml`, servicio `db`: `TZ: America/Denver` →
   `TZ: America/Santiago` (ese cambio se sube al repo el mismo día del corte, no antes: un `deploy.sh`
   con el cambio puesto reinicia la BD sin haber convertido los datos). Luego:
   ```bash
   git pull && docker compose up -d db
   docker exec licitapyme-db sh -c 'mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "SELECT @@system_time_zone, NOW()"'
   ```
   Tiene que mostrar la hora de Chile.
6. **Levantar la app:** `docker compose up -d app scheduler`.
7. **Comprobar:** escribir un comentario en un negocio y ver que la hora sea la actual. Abrir el
   Historial y ver que las horas de hoy calcen.

## Si algo sale mal

```bash
docker compose stop app scheduler
gunzip -c ~/respaldo-antes-174-<fecha>.sql.gz | docker exec -i licitapyme-db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
```
Volver `TZ: America/Denver` en `docker-compose.yml`, `docker compose up -d db`, y levantar la app.

## Lo que queda con error conocido

- Filas viejas de columnas que en algún momento escribió la BD y después la app (o al revés): la
  conversión es por columna, no por fila. Se eligió lo que hace la mayoría de cada columna.
- Los comentarios del código que hablan de «MySQL en UTC-6» quedan desactualizados, pero no cambian
  nada: `ahoraChileSQL()` y la hora chilena escrita a mano siguen siendo correctas con la BD en Chile.
- Bluehost (respaldo nocturno) recibe el volcado del VPS: queda igual que el VPS.
