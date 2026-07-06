# Actualizar el notebook (IP chilena) con los últimos cambios

Guía para dejar el despliegue del notebook al día con lo que hay en GitHub
(`origin/master`). El notebook corre la app en **Docker + Cloudflare quick tunnel**
y es el único que tiene **IP chilena** (obligatoria para descargar documentos de
Mercado Público).

---

## ¿Se genera un link nuevo?

Actualizar el **código NO cambia el link** por sí solo — el link es la URL del túnel de
Cloudflare, independiente del código.

- ✅ Si reconstruyes **solo la app** (`docker compose up -d --build app`) → **el link se
  mantiene** (el contenedor `cloudflared` no se toca).
- ❌ Si haces `docker compose down`, reinicias todo, o se apaga el notebook → sale un
  **link nuevo** de `trycloudflare.com` (limitación del *quick tunnel*). Para un link fijo
  habría que comprar dominio y migrar a un túnel con nombre + token.

Si el link cambió, la URL nueva sale en: `docker compose logs cloudflared`.

---

## Requisitos previos (una sola vez)

- El código nuevo ya está en GitHub (`origin/master`). ✅ (commit ya pusheado.)
- Las migraciones de base **YA están aplicadas** a Bluehost (base compartida): `migration-29`
  (campana de notificaciones), `migration-36` (login) y `migration-37` (recuperación de
  contraseña, tabla `password_resets`). **NO hay que re-correrlas.**

---

## Instrucciones para el Claude del notebook (copiar/pegar tal cual)

```
Actualiza el despliegue de licitapyme-clone en este notebook (IP chilena, Docker + Cloudflare quick tunnel).
El código nuevo ya está en GitHub (origin/master). NO reinicies cloudflared (para no cambiar la URL del túnel).

1. Traer el código:
   git pull

2. Actualizar el archivo de entorno del notebook (el .env que usa docker-compose) con el SMTP correcto:
   SMTP_HOST=mail.sociedadcomercialmp.cl
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=licitaciones@sociedadcomercialmp.cl
   SMTP_PASS=Licitaciones2026!
   SMTP_FROM="ICA Licitaciones <licitaciones@sociedadcomercialmp.cl>"
   (deja CRON_SECRET, DB_*, MERCADO_PUBLICO_TICKET, R2/S3, etc. como están)

3. Reconstruir y reiniciar SOLO el servicio app (así el túnel/URL NO cambia):
   docker compose up -d --build app
   # verificar que arrancó bien:
   docker compose logs -f app     (Ctrl+C cuando veas "Ready")

4. NO correr migraciones: la base es Bluehost (compartida) y las migraciones 29 y 36 ya están aplicadas.

5. Descarga de documentos: NUEVA ESTRATEGIA -> se descargan AL ASIGNAR la licitacion (automatico
   dentro de la app, corre en el notebook). Ya NO hace falta el scheduler que bajaba todas las PASA.
   No hay que encender nada para esto: al asignar un negocio, la app baja los documentos y corre el
   pipeline IA en segundo plano.
   (Kill-switch opcional: DESCARGA_AL_ASIGNAR=false en el .env para desactivarlo.)
   (Backlog: para bajar docs de negocios YA asignados sin documentos, usar el boton
    "Descargar documentos" de Negocios, o POST /api/documentos/descargar-pendientes?origen=negocios.)

6. En cron-job.org, agregar un segundo job para el prefiltro automatico (ademas del intake de /api/cron/alertas):
   POST https://<URL-del-tunnel>/api/cron/prefiltro
   Header: x-cron-secret: <CRON_SECRET>
   Cada 4 horas, ~30 min despues del job de alertas.

7. Verificar que la automatizacion quedo andando:
   docker compose exec app node scripts/_verif-automatizacion.mjs
   -> "SIN prefiltro (nuevas 24h)" debe ir a ~0 y "PASA/REVISION SIN documentos" debe ir bajando con cada ciclo.
```

---

## Qué incluye esta actualización

- **Radar** mucho más rápido (~9s → ~1s).
- **Login** blindado contra fuerza bruta (tabla `login_intentos`).
- **Recuperación de contraseña por correo** desde el login (enlace de reseteo, tabla
  `password_resets`, migración 37). El admin también puede editar perfiles y resetear claves
  desde Administración de Usuarios. **Se quitó el auto-registro:** solo el admin crea perfiles
  (es una app interna). Requiere el SMTP del paso 2 para que lleguen los correos de reseteo.
- **Prefiltro automático** (`/api/cron/prefiltro`, por cron-job.org) + **descarga de documentos
  AL ASIGNAR** la licitación (en `/api/negocios` POST; solo se bajan las que se van a trabajar).
- **Alertas por correo** (digest de radar por perfil) + correos de asignación/cambios con
  plantilla nueva. **Requiere el SMTP del paso 2.**
- **Campana de notificaciones por perfil** en tiempo real (asignación, reasignación, cambio de
  estado, descarte, etiquetas, comentarios). El push en vivo (SSE) funciona en el notebook.
- **Análisis de licitación** rediseñado (tablero Kanban + dashboard por perfil).
- **Fix de modalidad** suma alzada vs por línea (el parser ya no lee el propio COSTEO generado).

---

## Notas

- El notebook tiene su **propio** archivo de entorno; el SMTP hay que actualizarlo ahí a mano
  (los `.env` no viajan por git).
- Si el link del túnel cambió, actualízalo en cron-job.org (pasos 6) y donde tengas guardado el enlace.
- Comandos base del notebook (recordatorio): `git pull` → `docker compose up -d --build app`.
