# Infraestructura, stack, seguridad y multi-cliente

## 2026-11-09 — Prueba de carga de 100 usuarios (local, sin arreglar nada aún)
Montaje: copia de producción (sin `documentos_cache` ni capturas) en la BD dev (3308) + imagen Docker `licitank-carga` (4 CPU / 4 GB, puerto 3010, env en el scratchpad); script `scripts/scratch/carga-100.mjs` (`sembrar` / `correr` / `limpiar`; solo corre contra el puerto 3308). Siembra: 5 empresas «SIM Empresa n» + 100 usuarios `uNNN@sim.licitank.test` (clave en el script) — borrar con `limpiar`.
- **100 logins en 5 s: 87 fallan con 500 «Queue limit reached»** (pool 8 + cola 24 = 32). Con los logins repartidos en 60 s: 100/100 ok, p95 343 ms; el resto de las pantallas p95 < 200 ms, p99 < 400 ms, 0 errores 5xx, MySQL 17 conexiones máx. y 52 consultas/s. CPU del proceso Node llega a ~97 % de UN núcleo (event loop saturado en la llegada; bcryptjs es JS puro).
- **Arreglo aplicado (local, sin desplegar):** pool 8→20 y cola 24→200 en `db.ts` (`DB_POOL_LIMIT` / `DB_QUEUE_LIMIT`). VPS real (leído 09-nov): 4 vCPU, 12 GB, carga 0, app 600 MB, MySQL max_connections=100, disco 80 %. Repetida la tormenta de 100 logins en 5 s: 100/100 ok, 0 errores 5xx, MySQL 41 conexiones máx. PERO el login tarda ~10 s (p50) y las demás pantallas se frenan hasta 7 s: `bcryptjs` ocupa el hilo (CPU 155 %). Con logins repartidos en 60 s: login p50 169 ms, resto p95 < 270 ms.
- **Probado en el VPS real (09-nov, ~15 min, contenedores aparte `carga-app` 2 CPU/3 GB + `carga-db` 1 CPU/2 GB en red propia, vigilante de latencia de producción; ya borrados):** 100 logins en 5 s → 100/100 ok, 0 errores, login p50 4,3 s / p95 7,6 s (bcrypt), resto de pantallas p95 < 250 ms fuera del pico; MySQL 41 conexiones. Producción siempre 0,10 s (máx. 0,105 s en 46 lecturas). Nota: `docker builder prune -f` liberó 50 GB de caché de build (disco 77 → 26 GB usados); el próximo `deploy.sh` reconstruye todo sin caché y tarda más. La app en producción NO tiene aún el cambio del pool (falta desplegar). El puerto 3003 de la app está publicado en 0.0.0.0 (visto en `docker ps`; revisar si debe quedar solo detrás de Caddy).
- Pendiente: bcrypt fuera del hilo principal (el JWT dura 7 días, así que la tormenta solo pasaría tras caducar sesiones; prioridad baja), estampida de SSE, 200 usuarios, y probar en el VPS en un contenedor aparte con límites (propuesto, sin hacer; requiere OK del dueño).

## 2026-11-06 — Casilla licitaciones@ comprometida: Bluehost bota todo lo que sale a Gmail (fightspamHG)
Visto en cPanel → Track Delivery (Chrome, sesión del dueño; solo lectura).
- El 04-11-2026 de 22:01 a 22:24 la IP **85.239.245.1** (ajena: VPS = 216.185.51.104, oficina = 45.4.1.30) entró como licitaciones@sociedadcomercialmp.cl y mandó **102 correos de spam** (rechazados por Proofpoint «AUP#SNDR»).
- Desde entonces el antispam de Bluehost (`router fightspamHG`, entrega a `/dev/null`) marca «Filtrado» todo lo que sale de esa casilla hacia afuera: 104 correos a informatica2.grupoica@gmail.com (pruebas y avisos del VPS), nunca salieron. Por eso «a Gmail no llega» y al corporativo sí (es entrega local en el mismo servidor). Los correos de las personas desde Outlook (carolina.sepulveda@, asistentemp@…) a Gmail salen «Aceptado»: el problema es SOLO esta casilla. DNS (SPF/DKIM/DMARC) está bien.
- Causa de la filtración: la clave SMTP estaba escrita en `docs/DESPLIEGUE_NOTEBOOK.md` y `docs/actualizar-notebook.md` (desde 2026-07) y el repo **informatica2grupoica-stack/licitapyme-clone es PÚBLICO** en GitHub. Se sacó de los dos documentos el 06-nov; sigue en el historial de git.
- **Pendiente (lo hace el dueño):** (1) cambiar la clave de licitaciones@ en cPanel → Cuentas de correo; (2) poner la nueva en `.env.local` y en el `.env` del VPS y reiniciar la app; (3) pedir a soporte de Bluehost que quite el bloqueo de fightspamHG a esa casilla (ej. msgid 1xPIc2-00000003eM4-1jR7); (4) evaluar dejar el repo privado; (5) después, mandar pruebas a Gmail y al corporativo.
- **Corrección (mismo 06-nov, más tarde):** el dueño creó notificaciones@sociedadcomercialmp.cl (en `.env.local` y, desde el 06-nov 10:00, en el `.env` del VPS: login ok, prueba 4 desde producción «Aceptado» al corporativo y «Filtrado» al Gmail; el scheduler aún tiene la clave vieja cargada hasta recrearlo) y las pruebas desde ella TAMBIÉN salieron «Filtrado» (fightspamHG) hacia informatica2.grupoica@gmail.com, y «Aceptado» al corporativo. Ese Gmail sale filtrado desde por lo menos el 30-oct (antes del spam), desde cualquier casilla; el resto del correo externo de la cuenta sale «Aceptado» (71 desde el 04-11). Entonces el bloqueo es del DESTINATARIO (probable lista de supresión por una queja de spam marcada desde ese Gmail), no de la casilla. Falta: probar a OTRO Gmail y pedir a Bluehost que saque informatica2.grupoica@gmail.com de la supresión. La clave de licitaciones@ igual hay que cambiarla (la IP 85.239.245.1 sí la usó).
- **CAUSA REAL (06-nov 10:13):** a drokuas@gmail.com también salió «Filtrado», así que no era el destinatario. Era el saludo SMTP: nodemailer se presentaba como `EHLO [127.0.0.1]` y fightspamHG descartaba lo que iba a Gmail. Con `name` = dominio de la casilla (`email.ts`, transporter) sale «Aceptado»: prueba 6 (texto, desde el VPS) y prueba 7 (OC 4035 en PDF, 387 KB, con nombre de remitente y Responder a) llegaron a drokuas@gmail.com y a informatica2.grupoica@gmail.com (el dueño confirmó). No hace falta pedirle nada a Bluehost. Falta desplegar ese cambio.
- **Regla:** nunca escribir claves en archivos versionados (el repo es público): solo `<placeholder>`.


Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió. Sin
direcciones de servidores ni claves: esos datos viven en los `.env`, fuera del repo.

## 2026-11-06 — Gasto de IA del Auditor: ahora se sabe qué función lo hace
Caso real: `ia_uso` 30 días, 2.065 llamadas Kimi del Auditor (US$89,8) **sin licitación ni función**: no se podía saber dónde se repetía. Señal de repetición: ~630 llamadas con el mismo tamaño de pedido que otra (≈US$30; 280 a menos de 10 min, US$15,4); un proceso SIN usuario repitió el mismo pedido hasta 19 veces entre el 3 y el 4-nov. Tamaño igual no prueba pedido igual (parte es casualidad).
Cambio: `conModuloIA(modulo, fn, funcion)` guarda «modulo.funcion» en `ia_uso.modulo` (sin migración, VARCHAR(40)); los 12 archivos del Auditor llevan su etiqueta (lector, comparador, comparador-req, tecnico, tecnico-v2, ficha-propia, posicion, costo, segmentacion, prepostulacion, sugerir-linea, compras). /admin/gasto-ia agrupa por lo de antes del punto (se ve igual) y el detalle muestra la función.
**Verificado:** llamada real del Lector en la BD local → `auditor.lector`; tsc y suite 1766/1766. Desplegado 2026-11-06 (lo confirmó el dueño); panel no visto en el navegador.
**Pendiente:** tras desplegar, mirar una semana qué función repite (`SELECT modulo, tokens_in, COUNT(*) ... GROUP BY modulo, tokens_in HAVING COUNT(*)>1`) y cortar ahí. La licitación sigue sin registrarse en el Auditor (se conoce en ~22 rutas; habría que envolver cada una con `conUsuarioIA({licitacion})`).

## 2026-11-06 — Kimi: se probaron versiones más baratas y ninguna sirve; todo sigue en K3
Caso real: `ia_uso` del VPS, 30 días: kimi-k3 era el mayor gasto de IA (US$91; 88 del Auditor, 2,8 del prefiltro), más que glm-5 (US$71). K3 cuesta $3/$15 por M.
El dueño pidió «bájale las versiones, la más barata estable que sirva». Se probó todo contra datos reales ya procesados, sin escribir en la BD:
- **Comparador técnico con K3.1 Pro ($2/$10, `medium`)**, 5 líneas (634-96, 607-84 ×2, 2483-265, 2013-22): se pasó de 240 s en 2 líneas que K3 terminó, gastó más tokens de salida y en 2013-22-LE26 bajó un ❌ a ❓. K3 repetido coincidió 98% con lo guardado; K3.1 Pro 92%.
- **Lector con K2.6 ($0,95/$4) sin razonar**, 14 documentos: en 5 de 8 cotizaciones no vio «PRECIO NETO»/«TOTAL NETO» (IVA «no_declarado») y en una tomó el total con IVA como precio. **K2.6 razonando en `low`**: 7 de 8 se pasaron de 240 s.
- 634-96-LE26 L1 (36 requisitos × 4 opciones) se pasa de 240 s con cualquier modelo.
Queda en código (`app/lib/gemini.ts`): `kimi` = K3 (`KIMI_MODELO`, por defecto `high`; Lector y prefiltro piden `low`) y `kimi_rapido` = K2.6 sin razonar (`KIMI_MODELO_RAPIDO`), que hoy solo usa evaluar empresa por RUT y queda para elegir el campo de una casilla en anexos (ahí sí acertó en la prueba simple). La vieja `KIMI_TEXT_MODEL` ya no se lee. La etiqueta del motor guardada en el Auditor sale de `MODELO_KIMI`. Precio de K3.1 en la telemetría.
**Regla / decisión:** no bajar el Auditor ni el prefiltro de K3 sin repetir estas pruebas. Kimi SÍ permite apagar el razonamiento: `thinking:{type:'disabled'}` con `temperature` 0.6 obligatoria (razonando, solo 1); otro valor = 400. `response_format` se sigue quitando en Kimi (claves rotas en K3).
**Verificado:** las tres pruebas de arriba (gastaron ~US$1,50 en `ia_uso`, módulo auditor) y tsc OK. Desplegado 2026-11-06 (lo confirmó el dueño).
- **Comparador con K3 en `medium`** (mismas 4 líneas, sin 634-96): mismo estado por opción en las 4, 97% de celdas iguales a `high`, pero gastó MÁS salida en las 4 (6.502 vs 5.741, 6.226 vs 5.853, 9.004 vs 8.624, 3.964 vs 3.505 tokens; US$0,50 vs 0,47). En K3 bajar el esfuerzo no ahorra: se queda en `high`.
**Pendiente:** el ahorro tendría que salir de mandar menos texto o hacer menos llamadas (revisar en `ia_uso` cuántas veces se vuelve a comparar la misma línea); 634-96-LE26 L1 no cabe en 240 s.
**Multiempresa:** la cuenta Kimi sigue siendo una sola (`KIMI_API_KEY`); al vender, la key y el modelo tienen que ir por cliente.

## 2026-11-04 — Avisos por WhatsApp (ganada, perdida, apertura) desde un número emisor por QR
- Decisión del dueño: la vía OFICIAL de Meta se descartó por costo/trámite; se usa Evolution API (Baileys, NO oficial) con UN número emisor por empresa (Grupo ICA: +56 9 7549 1040, instancia `emisor-ica`), vinculado por QR. Solo avisa al equipo (contactos que ya lo tienen guardado): nada masivo, nada a externos. Riesgo asumido: Meta puede cortar el número; al vender el sistema el cliente debe saberlo y usar un número secundario. Se evaluó y se sacó un chat completo tipo WhatsApp Web (contactos @lid sin nombre/teléfono, sin buscador): NO se hace.
- Quién recibe (regla del dueño, cambiada el mismo 04-nov): por defecto TODOS los perfiles activos reciben ganada/perdida/apertura; el responsable, de sus licitaciones; el admin, de TODA la empresa. Aviso «Orden de compra» (solo OC NUEVAS, no cambios de estado; gancho en `sincronizarOrdenesCompra`): apagado para todos por defecto, el admin lo activa a mano a quien quiera y le llega de toda la empresa. En el VPS ya está levantado Evolution (`licitapyme-evolution`) y el emisor vinculado. Selector por perfil en Editar permisos (tabla `whatsapp_aviso_pref`, migration-178, NO son permisos). Requiere celular válido en el perfil y cuenta activa.
- **2026-11-05 — cambio de regla:** la ganada 3573-45-LE26 no le llegó a Carolina Sepúlveda, María Elena ni John (rol usuario, no responsables): el código solo dejaba pasar al responsable y al admin, aunque tuvieran el aviso activado. Dueño: «a todos». Ahora todo perfil activo (menos `externo`) recibe lo que tenga activado de TODA la empresa; el externo solo lo suyo. Texto del selector en Editar permisos actualizado. Falta deploy al VPS (los avisos ya enviados no se reenvían).
- Envío: cola `whatsapp_cola` (clave única = no repite), de a uno con pausa 8-20 s, tope `WHATSAPP_TOPE_DIARIO` (150/día), reintentos cada 5 min (`/api/cron/whatsapp-cola`). Mensaje con emoji de encabezado, negritas y enlace `/licitacion/<código>`. Botones: no existen en la vía no oficial.
- Código: `app/lib/whatsapp.ts` (cliente), `whatsapp-avisos-core.ts` (reglas y texto, probado), `whatsapp-avisos.ts` (BD y cola); gancho en `avisar-resultado-licitacion.ts`; pantalla `/admin/whatsapp` (QR, estado, prueba, cola). Servicio: `docker-compose.whatsapp.yml` (local) y perfil `whatsapp` en `docker-compose.yml` (VPS: COMPOSE_PROFILES=db,whatsapp + EVOLUTION_API_KEY + EVOLUTION_API_URL=http://evolution-api:8080).
- Pendiente: aviso de cierre próximo por WhatsApp (el cron de cierres no está enganchado); ver la pantalla en el navegador; migration-178 YA aplicada en la BD de producción (2026-11-04, dueño dio el OK); falta levantar Evolution en el VPS y volver a escanear el QR allá (la sesión local no se traslada); alertas de otras empresas-cliente usarán la ruta `/api/admin` (hoy solo ICA la ve en el menú de admin).
- Trampa: al probar por consola de Windows, curl rompe los emojis y tildes (llegó `??`); usar fetch/Node con UTF-8.

## 2026-11-02 — Auditoría de seguridad de toda la plataforma: lo corregido y lo pendiente
- **Next 16.2.6 → 16.4.4** (exacta, con eslint-config-next igual). La anterior tenía bypass del proxy con Turbopack (toda la autenticación vive en
  `proxy.ts`) y RCE en optimizador de imágenes/next/og (la app no usa next/image ni next/og). `npm audit`: de 35 (1 crítica, 16 altas) a 16
  (0 críticas, 1 alta). Build de producción OK y 1692 tests OK; **sin probar la app corriendo**: desplegar con `deploy.sh` y revisar login y Compras.
- **xlsx 0.18.5 → 0.20.3 desde el CDN de SheetJS** (`package.json` apunta a la URL; el de npm no tiene arreglo). Cualquier `npm install` limpio lo baja de ahí.
- **SSRF**: `app/lib/url-segura.ts` (`urlPublicaSegura`, `fetchSeguro` con redirecciones a mano). Lo usan costeo-ficha-producto, producto-referencia,
  la subida de costeo (`comercial/costeo`, URL que manda el navegador), las imágenes de las fichas y la captura del auditor. Riesgo restante: DNS rebinding.
- Mismo día, segunda tanda: **nodemailer 9 → 10.3.1** (compila igual; **probar un correo tras desplegar**: `/api/admin/test-email`). `npm audit`: 15
  (0 críticas, 0 altas). **Cron y `admin/prefiltro` ya NO aceptan `?secret=`**: solo `Authorization: Bearer` o `x-cron-secret` (el scheduler ya
  manda ambos), con comparación en tiempo constante (`app/lib/cron-secret.ts`). Borrada la ruta temporal `admin/clasificar-test`. `String(error)`
  al cliente reemplazado por `mensajeSeguro` en rutas de negocios. Subidas de `empresas/[id]/documentos` (20 MB) y `firmas` (5 MB); las demás ya tenían tope.
- Revisadas a mano las 38 rutas que mi búsqueda marcó «sin chequeo»: casi todas usan `getAuthedUser` (api-auth) o `auditor-acceso`; `usuarios`, `debug/*`,
  `analizadas`, `radar/*` exigen admin; `documentos/estado`, `analizar-documento` y `pdf-pagina` solo piden sesión y no entregan datos de negocios.
  Ningún IDOR confirmado. El `UPDATE` que parecía estar en un GET de `comercial/costeo` está en `ingresarVersionCosteo` (no es GET).
- 02-nov-2026 (tercera tanda, pedido del dueño tras desplegar): **CSP en BLOQUEO** en next.config.ts (script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:;
  worker-src; object-src 'none'; base-uri; form-action; frame-ancestors). Sin default-src/img-src/connect-src a propósito: se pulen con la consola del navegador
  («Refused to load the script… Content-Security-Policy» → agregar ese origen). **Filtro por empresa en Compras**: `proxy.ts` + `negocioEsDeCliente`
  (tenant.ts) niegan `/compras/<id>` y `/api/compras/<id>/…` si el negocio no es de la empresa; Grupo ICA (1) pasa igual que siempre.
- **Sigue pendiente**: pulir el CSP con la consola; DNS rebinding del guardián de URLs (riesgo bajo); la lista `MODULOS_ACTIVABLES` sigue sin Compras.

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

- 2026-11-06 — Pedido del dueño: todo lo nuevo tiene que servir para venderlo a otras empresas. Skill `multiempresa-escalable` (`.claude/skills/multiempresa-escalable/SKILL.md`), citada en `AGENTS.md`: cliente vs razón social, `cliente_id` desde la sesión, anti-IDOR, nada de RUT/razón social/logo en el código, cuentas externas (correo, Obuma, WhatsApp, IA) detrás de una función que recibe el cliente, crons y límites por cliente, línea «Multiempresa:» en cada entrada de memoria. Primera aplicación: «Enviar al proveedor» (Compras).

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
