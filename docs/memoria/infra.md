# Infraestructura, stack, seguridad y multi-cliente

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió. Sin
direcciones de servidores ni claves: esos datos viven en los `.env`, fuera del repo.

## Estado vigente

- **Producción en el VPS chileno** (reemplazó al notebook). El dominio `licitank.cl` apunta al VPS
  (2026-10-22). Deploy: el dueño corre `deploy.sh` en el VPS; hacer commit y push NO despliega.
- **BD movida de Bluehost al VPS** (2026-10-22, corte hecho): MySQL 8 en Docker (`DB_HOST=db`).
  Bluehost quedó como respaldo nocturno: se sobreescribe cada noche.
- **Todo dato se escribe en la BD del VPS.** Antes de correr un script que ESCRIBA desde el PC,
  comprobar a qué BD apunta (`SELECT @@hostname`: el VPS responde con el id del contenedor Docker).
  Desde el PC se llega por túnel SSH al puerto 3307. Desde el 2026-10-27 el PC del dueño tiene una
  llave SSH autorizada en el VPS: el túnel se abre sin contraseña con
  `ssh -N -o BatchMode=yes -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L 3307:127.0.0.1:3306 <usuario>@<vps>`
  (datos en el comentario de `DB_HOST` en `.env.local`). Consultas de solo lectura:
  `npx tsx scripts/scratch/bd.mts "SELECT …"`. Escribir en producción requiere el OK del dueño.
- Los scripts que leen `.env.local` deben ignorar el comentario `# …` al final de la línea.
- Al 2026-10-27 todas las migraciones del repo están aplicadas en el VPS
  (`node scripts/scratch/chequear-migraciones.mjs` no reporta faltantes).
- IA: Z.AI (GLM) es el proveedor principal de texto y OCR; Gemini retirado (código dormido tras
  `geminiHabilitado()`); Kimi en el Auditor. El OCR de PDF con GLM necesita URL pública (R2), nunca
  base64. Document AI se probó y se descartó: no reactivar sin pedido. `getGemini()` en realidad
  apunta a DeepSeek (`model: 'deepseek-chat'`). `soloGlm` en `crearChatIA` evita caer a DeepSeek.
- `gemini.ts` es server-only (`node:async_hooks`): un módulo «universal» que lo arrastre rompe el
  build si lo importa un Client Component.
- **Una sola conexión SSE en toda la app** (`app/lib/use-realtime.ts`, singleton): un
  EventSource por componente agotaba las 6 conexiones de Chrome y colgaba la app. Para que todos
  vean cambios en vivo hay que publicar con `publicarCambio`.
- La API de Mercado Público devuelve flags como texto («1»/«0»): comparar con `Number(x) === 1`.
- Solo el admin crea perfiles (sin auto-registro); recuperación de contraseña por correo.
- Login blindado contra fuerza bruta en MySQL (sin Redis).
- Interruptor de «modo manual» pausa toda la automatización del front.

## Reglas para trabajar aquí

- Scripts de diagnóstico van en `scripts/scratch/` (ignorada): uno suelto en `scripts/` rompe el
  `next build` del VPS. Correr `tsc` antes de dar algo por listo.
- Migraciones: las aplica el dueño o un script `scripts/aplicar-migration-N.mjs`; revisar el
  número libre antes de crear una. Comparar migraciones contra la BD real:
  `node scripts/scratch/chequear-migraciones.mjs`.
- `.env` del VPS no está en git.

## Multi-cliente (vender Radar + Negocios a otras empresas)

- Desarrollo SOLO en BD local Docker (puerto 3308); nada en producción.
- Decisión del dueño (2026-10-23): «lo nuestro no se toca ni modifica». Rama
  `multicliente-mismo-sistema`: mismo sistema, módulos por empresa, aislamiento probado 80/80 en
  el espejo.
- Antes de producción: aplicar migraciones 167→168→169 ANTES del código; marcar `es_superadmin=1`
  al dueño; clasificar rutas nuevas en `modulos.ts`; un módulo nuevo para clientes necesita
  `cliente_id` en sus tablas primero.
- Plan comercial v3 (`docs/plan-integral-lanzamiento-comercial-licitank.pdf`): planes Individual,
  Equipo y Premium; alta por RUT. Ley 21.719 de datos personales rige desde el 2026-12-01; límites
  de la API de MP (1 ticket por persona, 10.000 consultas/día). Todo lo legal lo valida un abogado.
- Evaluar empresa nueva por RUT (sugerencias en `/mi-empresa` al primer ingreso): subido, falta
  deploy y prueba en producción.

## 2026-10-27 — La BD pasó a hora de Chile (migración 174, aplicada)
Antes `NOW()` del MySQL del VPS daba hora de Denver (3 h atrás; 4 h desde el 2026-11-01) y la app
escribía hora chilena a mano en parte de las columnas. Aplicado a las 11:48–11:51: app y scheduler
detenidos, respaldo `~/respaldo-antes-174-2026-10-27-1448.sql.gz` en el VPS, `scripts/aplicar-migration-174.mjs
--produccion --aplicar` (8 TIMESTAMP con hora chilena y 36 DATETIME con hora de Denver convertidas) y
`SET PERSIST time_zone = 'America/Santiago'` como root (sin reiniciar la BD). Columnas decididas por quién
las escribe en el código y por la huella horaria de los datos. Guía: `docs/migration-174-hora-chile.md`.
**Verificado:** conexión nueva da `NOW()` = hora de Chile; actividad y comentarios se leen igual que
antes; `documentos_cache.updated_at` y `checklist_comercial` quedaron en hora chilena; lo nuevo que escribe
la BD (`mp_api_uso_diario`) sale con la hora actual; licitank.cl responde 200.
**Regla:** el `TZ: America/Denver` del servicio `db` en `docker-compose.yml` se dejó a propósito (cambiarlo
recrea la BD en el próximo deploy); manda el `SET PERSIST`. `ahoraChileSQL()` y la hora chilena escrita a
mano siguen siendo correctas. Las fechas leídas con mysql2 desde el PC salen corridas de hora:
formatearlas en SQL (`DATE_FORMAT`) para mirarlas.
**Pendiente:** filas viejas de columnas mixtas (escritas a veces por la BD y a veces por la app, p.ej.
`documentos_cache.created_at`, `negocios.updated_at`) pueden quedar con 3 h de diferencia.

## Pendientes conocidos

- Seguridad: rotar `CRON_SECRET` y otros secretos; bucket R2 privado + URLs firmadas;
  revocación de sesiones al cambiar clave; `?secret=` en query de cron; `timingSafeEqual`; 2FA.
- BD del VPS con binlog apagado (sin recuperación a un punto) y sin prueba de restauración;
  respaldo nocturno sin cifrar (por verificar).
- Node 20 → 22 antes de ene-2027; desconectar 2 proyectos Vercel que quedaron.
- Charset: al 2026-10-27 solo `actividad_usuario_bkp` (respaldo) y `documentos_origen_manual`
  siguen en utf8mb3; el resto ya es utf8mb4.
- Rol `externo` (la migración ya está aplicada): crear uno de prueba y verificar que no ve lo que
  no tiene asignado.
- Caché de lecturas del radar (Redis/Upstash disponible) para bajar latencia.
