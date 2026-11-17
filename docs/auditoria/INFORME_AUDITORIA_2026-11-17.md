# Informe de auditoría LICITANK — 2026-11-17 (PARCIAL: F0 + F1 + sondeos)

> Alcance real: solo lectura del código y comandos locales. No se tocó producción, ni BD, ni Obuma, ni IA.
> La BD local Docker (:3308) estaba apagada, así que **no se pudo** correr `chequear-aislamiento.mts`, EXPLAIN, banco de anexos, ni recorridos F6 en navegador.
> Las fases F2–F10 NO están auditadas en profundidad (ver sección 6). Esto no es una luz verde: es lo que se alcanzó a verificar.

## 1. Resumen ejecutivo

| Área | Semáforo | Por qué |
|---|---|---|
| Seguridad (auth/aislamiento) | 🟡 | Diseño sólido (sesión en proxy + lista blanca de módulos + guardia por negocio). Un hueco real: SSRF en 2 rutas. |
| Datos / BD | 🟡 | Sin huérfanos en lo probado; collations mezcladas, 6 FK, sin purga (ver 3b). Falta restore y carga. |
| QA funcional | ⚪ sin evaluar | No se hicieron recorridos. |
| IA / Documentos | ⚪ sin evaluar | Sin banco de anexos corrido. |
| Rendimiento | ⚪ sin evaluar | Sin medición. |
| Operación | 🟡 | Tests verdes; lint con 4.561 errores sin triage; sin CSP completa. |
| Legal | 🔴 | No hay política de privacidad, términos ni canal de derechos; la Ley 21.719 rige el 1-dic-2026 (LEG-001). |
| UX | ⚪ sin evaluar | Sin revisar. |

**¿Se puede vender hoy a un segundo cliente? Condicionado**: el aislamiento está bien pensado (los clientes ≠ Grupo ICA solo llegan a Radar, Negocios, Viabilidad y Costeo; Auditor/Compras/Anexos están bloqueados por lista blanca), pero hay que cerrar SEC-001 y confirmar el aislamiento con la BD local arriba antes de firmar.

Top riesgos verificados: SEC-001 (SSRF), SEC-002 (dependencia next con aviso), DB-001 (migraciones duplicadas), OP-001 (lint sin triage), SEC-003 (jobId sin dueño).

## 2. Línea base (F0)

| Chequeo | Resultado |
|---|---|
| Inventario | 48 páginas `page.tsx`, 271 rutas `route.ts`, ~190 migraciones `.sql` en `docs/` |
| `tsc --noEmit` | ✅ 0 errores |
| Tests (`npm run test:viabilidad`) | ✅ 1848 pasan, 0 fallan, 0 omitidos (36 s) |
| `eslint app proxy.ts` | ❌ 4.561 errores (9 autocorregibles). No se hizo triage por regla |
| `npm audit --omit=dev` | 9 vulnerabilidades (2 bajas, 7 moderadas): `next` 16.3–16.4.4 (GHSA-mfr8-8qww-v76h, fuga entre root params con `unstable_cache`; fix en 16.4.6), `uuid`<11.1.1 vía `exceljs` |
| Revisor de migraciones | Corre; avisa índices/tablas de 189 y 191 |
| Build / tamaño / cobertura | No medidos |

## 3. Hallazgos

| ID | Título | Sev. | Módulo | Estado |
|---|---|---|---|---|
| SEC-001 | SSRF por validación de host floja + redirecciones | Alto (Medio si se exige sesión) | analizar-documento, pdf-pagina | nuevo |
| SEC-002 | `next@16.4.4` con aviso de fuga de datos | Medio | infra | nuevo |
| SEC-003 | `GET /api/documentos/estado?jobId=` sin dueño | Bajo | documentos | nuevo |
| SEC-004 | CSP parcial (sin default-src/img-src/connect-src) | Bajo | headers | pendiente conocido (comentario en next.config.ts) |
| DB-001 | Numeración de migraciones duplicada: 117 y 148 | Medio | BD | nuevo |
| OP-001 | 4.561 errores de lint sin triage | Bajo | código | nuevo |
| QA-000 | `/api/cv/viabilidad-ia/[codigo]/nivel` y `/debug/*` | Informativo | — | verificado: el primero es un stub de 6 líneas; los `debug` exigen `x-user-rol=admin` |

### SEC-001 — SSRF en lectura de URLs (verificado leyendo el código)
**ESTADO 2026-11-17: CORREGIDO en código, sin desplegar.** `url-propia.ts` ahora tiene `hostR2Propio` estricto (el id de cuenta ya no basta) y `fetchHostSeguro` (redirecciones a mano, host revalidado por salto), usado en `analizar-documento`, `pdf-pagina`, `document-extraction` y `clasificacion`. `tsc` limpio; `scripts/scratch/probar-url-propia.mts` 6/6. Queda permitido cualquier `*.r2.dev` (como antes): puede leerse un archivo ajeno, pero ya no redirigir adentro.
- **Evidencia**:
  - `app/lib/url-propia.ts`: `host.split('.').includes(cuenta)` acepta `<ACCOUNT_ID>.sitio-ajeno.com`; además cualquier `*.r2.dev` (lo puede abrir cualquiera).
  - `app/lib/document-extraction.ts` (~línea 735–745): si `esUrlR2Propia(url)` hace `fetch(url)` directo, con redirecciones automáticas.
  - `app/api/pdf-pagina/route.ts:48-56`: `h.includes(r2AccountId)` (aún más flojo) y `fetch(url)` sin `redirect:'manual'` (línea ~150).
  - Contraste: `app/api/proxy/route.ts` sí sigue redirecciones a mano y revalida host: ahí está bien.
- **Reproducir (teórico, no ejecutado)**: con sesión, `POST /api/analizar-documento` con `documentos:[{url:"https://<ACCOUNT_ID>.dominio-atacante.com/x.pdf", nombre:"x.pdf"}]`; ese host redirige a `http://evolution-api:8080` o `http://conversor-doc:8091`. El ID de cuenta R2 no es secreto (aparece en las URLs).
- **Impacto**: un usuario logueado (incluido un cliente externo con Negocios/Viabilidad) puede hacer que el servidor consulte la red interna (Evolution, conversor, metadatos del VPS). Riesgo de fuga/uso indebido, no de acceso a datos de otros clientes por sí solo.
- **Corrección mínima (S)**: una sola función `hostPermitido` estricta (igualdad exacta con el host de R2/MP, `endsWith('.mercadopublico.cl')`), usada en las 3 rutas; `redirect:'manual'` con revalidación por salto (copiar de `/api/proxy`); rechazar IPs privadas.

### SEC-002 — Next 16.4.4
Aviso moderado; fix en 16.4.6 (fuera del rango declarado). Impacto real depende de si se usa `unstable_cache` con `use cache`. **Esfuerzo S**, probar build antes de subir.

### SEC-003 — jobId
`obtenerJob(jobId)` devuelve estado/URL sin comprobar dueño. Si el id es aleatorio (no verificado) el riesgo es bajo. **S**: guardar `cliente_id` en el job y compararlo.

### DB-001 — Migraciones duplicadas
`migration-117-compras-agente-plazo-detectado.sql` y `migration-117-compras-reparto-oc-monto.sql`; `migration-148-compras-aprobacion-linea-correccion.sql` y `migration-148-reportes-error-solucion-imagen.sql`. Ambas parejas ya están aplicadas en prod (suposición: no verificado). Riesgo: al montar un cliente/BD nueva, el orden no es determinista. **S**: renombrar a sufijos `117a/117b` y documentar.

**ESTADO OLA 1 (2026-11-17, en código, sin desplegar ni commitear):**
- SEC-002: `next` fijado en 16.4.6 (`package.json` + lock). `npm audit` baja de 9 a 8 (queda `uuid` vía `exceljs`, requiere cambio mayor). Build: ver nota abajo.
- SEC-003: el job guarda `clienteId` y `/api/documentos/estado` responde 404 a otra empresa; el id usa UUID (antes timestamp + 5 caracteres de `Math.random`).
- DB-001: renombradas a `migration-117b-…` y `migration-148b-…` (y el script de 148 actualizado). Son archivos ya aplicados en prod: solo cambia el nombre.
- `/api/debug/*` borradas (3 rutas). Los tipos generados viejos de `.next/` dan error en `tsc` hasta el próximo build; el código fuente no.

### SEC-005 — IDOR entre clientes en `/api/empresas/[id]/documentos` y `/firmas` (verificado leyendo el código)
**Severidad: Crítico (fuga y modificación entre clientes). Estado: CORREGIDO en código, sin desplegar.**
- **Evidencia**: `app/api/empresas/[id]/documentos/route.ts` (GET/POST/DELETE) y `app/api/empresas/[id]/firmas/route.ts` (GET/POST/PATCH/DELETE) solo comprobaban `rol === 'admin'` y hacían `SELECT id FROM empresas WHERE id = ?` sin `cliente_id`. `/api/empresas` está en la lista blanca del módulo Negocios, o sea abierta a clientes. El resto de `/api/empresas/[id]` (GET/PATCH) sí usa `registroEsDeMiEmpresa`.
- **Reproducir (teórico, no ejecutado: BD local apagada)**: admin de la empresa-cliente B llama `GET /api/empresas/<id de Grupo ICA>/firmas` o `DELETE …/documentos?documentoId=N`.
- **Impacto**: otro cliente podría ver, reemplazar o borrar la firma, el timbre, el logo y los certificados de Grupo ICA (las firmas se estampan en anexos de licitación).
- **Corrección (S, aplicada)**: `registroEsDeMiEmpresa(request,'empresas',id)` al inicio de los 7 handlers (404 si no es de la empresa del usuario). tsc limpio y 1848 tests verdes; **falta probarlo con 2 empresas en BD local**.
- Barrido siguiente: todas las rutas de los módulos abiertos a clientes (negocios, licitación, documentos, empresas, postuladas, radar, viabilidad…) se revisaron por marca de tenant; las únicas sin marca eran estas dos y `negocios/[id]/comentarios` (falso positivo: usa `negocioEsDeMiEmpresa`).

**PRUEBA DE AISLAMIENTO (BD local :3308, sin tocar el VPS; Docker Desktop levantado para esto):**
- `scripts/scratch/probar-aislamiento-empresas.mts` llama a los handlers como admin del cliente 2 sobre la empresa 1 (Grupo ICA). **Código anterior (`git show HEAD`): 5 de 5 acciones ajenas respondieron 200** (leer/borrar documentos, leer/editar/borrar firmas) → vulnerabilidad reproducida. **Código corregido: 8/8 como se esperaba** (5 ajenas → 404, 3 controles propios → 200, incluido ICA sobre su propia empresa).
- `scripts/chequear-aislamiento.mts` (revisor estático ya existente): 156 tablas, 87 rutas abiertas. Falló por una tabla nueva sin clasificar (`compras_doc_plantilla`, migration-194): clasificada como `PRIVADA_ICA` en `app/lib/tablas-dueno.ts`; ahora pasa. **Límite del revisor (CORREGIDO en la nota del 17-nov, más tarde)**: el aviso 3 («ningún filtro de empresa en el archivo») SÍ habría marcado las versiones viejas de `/empresas/[id]/documentos` y `/firmas` (verificado después con `git show`), pero solo como **aviso** que no bloquea, y a nivel de archivo (un helper en un solo handler bastaba). *Una versión anterior de este informe decía que no lo detectaba por una palabra en un comentario: era incorrecto.* **Endurecido**: nueva sección 4 en `scripts/chequear-aislamiento.mts` (lógica en `scripts/lib/aislamiento-handlers.ts`): cada handler de una ruta con `[id]` en módulos abiertos debe nombrar un guardia de dueño o falla; las excepciones llevan razón escrita. Probado: marca 7 de 7 handlers de las versiones previas a SEC-005 y deja pasar las actuales (`scripts/scratch/probar-revisor-handlers.mts`); sobre el código actual revisa 35 rutas con id y solo exige una excepción (stub 501 de `cv/viabilidad-ia/[codigo]/nivel`). Límite que queda: comprueba que el guardia se nombre, no que esté bien usado.
- No se probó con navegador/login real ni con los usuarios SIM (clientes 5–9); la prueba es a nivel de handler con los headers que inyecta `proxy.ts`.

### Otros sondeos (sin hallazgo)
- **XSS**: los 3 `dangerouslySetInnerHTML` de contenido de terceros están escapados (`formatNegritas`) o saneados (`sanearHtmlExcel`).
- **Comandos**: único `execFile` es `soffice` con argumentos fijos y archivo temporal propio; sin `eval`.
- **Admin/interno**: `/api/admin|cron|memoria|obuma-compras` están clasificados «interno» (bloqueados a clientes).
- **Subidas**: 17 rutas con `formData`; hay tope de tamaño en varias (documentos 250 MB, firma 5 MB, reporte 8 MB) pero **no hay verificación de tipo real (magic bytes)** y el MIME se deriva de la extensión: riesgo bajo (R2 es otro origen) → recomendación Ola 2.
- **TZ**: `app` y `scheduler` en `America/Santiago`; el contenedor de BD en `America/Denver` pero con `SET PERSIST time_zone` (pendiente conocido).

## 3b. Sondeos F2–F10 (hechos con la BD local y lectura de código; NO son auditorías completas)

| ID | Hallazgo | Sev. | Evidencia | Corrección mínima | Estado |
|---|---|---|---|---|---|
| LEG-001 **(PARCIAL 2026-11-17: páginas públicas `/privacidad` y `/terminos` creadas, con enlaces en login y landing; faltan datos legales por env, revisión de abogado, canal de derechos y procedimiento de brechas)** | No hay política de privacidad, términos ni mecanismo de derechos del titular (acceso, rectificación, supresión, portabilidad) en la app. Solo existe la baja de empresa en `/admin/clientes` (exportar JSON + borrar). La Ley 21.719 rige desde el **1-dic-2026** (14 días). | Alto | `app/` no tiene páginas de privacidad/términos; búsqueda de texto sin resultados reales | Redactar aviso y términos, página pública, correo/formulario de solicitudes y procedimiento escrito de brechas (L) | nuevo |
| OP-002 **(CORREGIDO en código 17-nov, sin desplegar)** | El scheduler llama a la app con `fetch` **sin timeout** (`scheduler.mjs:llamar`). Si la app se cuelga, el job queda pegado y los jobs con `sinSolapar` se saltan para siempre. | Medio | `scheduler/scheduler.mjs:42-60`, `82-96` | `AbortSignal.timeout(…)` por llamada (S) | nuevo (pariente del crash-loop de jobPostuladas) |
| OP-003 **(CORREGIDO en código 17-nov, sin desplegar; límite: si la app está caída el aviso tampoco llega, queda el log)** | Un job que falla solo escribe `console.error`; nadie recibe aviso (fallo silencioso). | Medio | `scheduler.mjs:55-58`, `loop()` corta sin avisar | Aviso por campana/correo al admin tras N fallas seguidas (M) | nuevo |
| OP-004 **(CORREGIDO en código 17-nov, sin desplegar; probado con docker simulado, no en el VPS)** | `deploy.sh` no aplica migraciones, no tiene rollback ni healthcheck; las migraciones se aplican a mano con `aplicar-migration-N.mjs`, así que se puede desplegar código sin su migración. `docker-compose.yml` sin `healthcheck` ni límites de memoria. | Medio | `deploy.sh`, `docker-compose.yml` | Paso de verificación de migraciones pendientes + healthcheck de `app` (M) | nuevo |
| DB-002 | La clave única de `negocios` es `(asignado_a, licitacion_codigo)`, no incluye cliente; hay 1 caso con 2 negocios activos para `2408-179-LE26` en el mismo cliente (ids 1243 y 1723, distinto asignado). | Bajo | `SHOW INDEX FROM negocios`; consulta de duplicados | Confirmar con el dueño si es intencional (dos personas, una licitación) | por confirmar |
| DB-003 | Solo 6 claves foráneas en 156 tablas: la integridad (huérfanos, borrados en cascada) depende 100 % del código. Huérfanos probados: 0 en `comentarios_negocio` y `checklist_comercial`; 0 negocios/usuarios sin `cliente_id`; 0 correos duplicados. | Informativo | information_schema | Mantener el revisor de huérfanos como script periódico | nuevo |
| DB-004 | Collations mezcladas en la copia local: `utf8mb4_0900_ai_ci` (134 tablas), `general_ci` (12), `unicode_ci` (8) y 2 tablas utf8mb3. Mezclarlas en un JOIN de textos da «Illegal mix of collations» (ya pasó: migration-24). No verificado en producción. | Medio | `information_schema.TABLES` (local) | Comparar con producción; unificar en una sola collation (L) | por verificar |
| DB-005 **(CORREGIDO en código 17-nov, sin desplegar; la purga queda en SIMULACIÓN hasta poner `PURGA_ACTIVA=1`)** | Sin purga: `actividad_usuario` (53 mil filas desde junio), `historial_eventos`, `password_resets`, `licitaciones_cache` (96 MB). Con otros clientes crecerán más rápido. | Bajo | `grep DELETE FROM` en app/scheduler | Retención por tabla (S–M) | nuevo |
| COD-001 **(timeouts: 16 llamadas externas del servidor cubiertas con `fetchConTimeout`/`fetchRapido` el 17-nov, sin desplegar; quedan ~22 sin timeout visible: código de navegador, archivos de Gemini y lecturas internas)** | Deuda de código: 3.702 usos de `any`, 338 TODO/FIXME, 2 `catch {}` vacíos, 0 `@ts-ignore`; 87 archivos con datos de empresa/correo/RUT escritos en el código (ya registrado en `multiempresa.md`, 82 antes); solo ~10 de 64 `fetch` llevan timeout. | Medio | greps en `app/` | Timeout por defecto en un `fetchSeguro` común; seguir el plan multiempresa | pendiente conocido (multiempresa) / timeouts nuevo |
| UX-001 | Accesibilidad por teclado: 58 `<div onClick>` (no son enfocables); 394 usos de `aria-`; 1 `<img>` sin `alt` de 20. No se revisó contraste ni lector de pantalla. | Bajo | greps en `app/**/*.tsx` | Cambiar a `button` o agregar `role`/`tabIndex`/teclado (M) | nuevo |

Medidas útiles: 143 archivos de test (todos de tipo unitario, 1.848 casos); el motor de anexos (`anexos-*.ts`) tiene 18.155 líneas, el mayor `anexos-detectar.ts` con 3.215. EXPLAIN de las 2 consultas probadas (negocios por cliente/estado; alertas por usuario no leídas) sin problemas: usan índice o la tabla es chica (1.615 negocios).

**No se pudo ejecutar**: el golden set de anexos (`scripts/anexos-golden.mts`) lee anexos llenados a mano desde `C:\Users\droku\Downloads\anexos-20260803…`, que no existe en este PC; los otros bancos de anexos necesitan `documentos_cache`, que la copia local no trae. Por eso F5 queda sin medir (casillas rotas/ciegas desconocidas).

## 3c. Verificación en producción (https://licitank.cl, Chrome, solo lecturas, tras el despliegue del 17-nov)

- ✅ `/privacidad` y `/terminos` abren sin sesión (muestran «[por completar]» en razón social, RUT, domicilio y correo, pendiente del dueño); enlaces presentes en la landing.
- ✅ `/api/health` → 200 `{"ok":true,"db":true}`. `/api/debug/*` ya no existe (404 con sesión, 401 sin ella).
- ✅ Sin sesión: `/api/negocios`, `/api/empresas/1/firmas`, `/api/documentos/estado`, `/api/proxy?url=…` → 401; `/api/cron/alertas`, `/api/cron/aviso-fallo` y `/api/admin/prefiltro` sin secreto → 401.
- ✅ Con sesión (admin ICA): `/dashboard` carga con datos, sin errores de consola.
- ✅ Cabeceras presentes: CSP parcial, `X-Frame-Options: SAMEORIGIN`, `nosniff`, `Referrer-Policy`.
- ⚠ **SEC-006 (Bajo-Medio, nuevo): no se ve cabecera `Strict-Transport-Security` (HSTS)** en licitank.cl. Puede faltar en Caddy/Cloudflare (no hay Caddyfile en el repo; no se revisó el VPS). Corrección: activarla en Caddy o Cloudflare (S), con `max-age` corto al inicio.
- **No verificado en producción** (a propósito, no se atacó producción): SSRF, aislamiento entre empresas, scheduler y su aviso de fallos, `healthy` de Docker, `deploy.sh --volver`. SEC-001/SEC-005 solo están probados en la BD local.

## 4. Matriz ruta × rol / aislamiento (parcial)

Cobertura real: de 271 rutas API, el script `scripts/scratch/auditoria-rutas.sh` marcó **19 sin ninguna marca de auth propia**; se leyeron las 14 relevantes:

| Ruta(s) | Auth real | Veredicto |
|---|---|---|
| `/api/auth/{login,logout,recuperar,restablecer}` | públicas a propósito; login con bloqueo por intentos (429) | ✅ |
| `/api/cron/*`, `/api/admin/prefiltro` | públicas en proxy, pero con `CRON_SECRET` comparado en tiempo constante (`igualSecreto`, falla cerrado), solo cabecera | ✅ |
| `/api/debug/*` (3) | proxy exige sesión + chequeo `x-user-rol=admin` (el header lo pisa el proxy) y `/api/admin` solo admin | ✅ (rutas de diagnóstico en prod: conviene borrarlas) |
| `/api/negocios/[id]/auditor/*`, `prepostulacion` | `contextoAuditor`; módulo `auditor` no activable a clientes | ✅ para clientes; **no verificado** que `contextoAuditor` filtre por cliente (irrelevante hoy, relevante el día que se active) |
| `/api/documentos/estado` | solo sesión | ⚠ SEC-003 |
| `/api/analizar-documento`, `/api/pdf-pagina` | solo sesión | ❌ SEC-001 |
| `/api/search`, `/api/usuarios` | sesión / admin + `clienteDeHeader` | ✅ |

Aislamiento por empresa: `proxy.ts` pisa `x-cliente-id` desde la sesión, borra los headers de identidad en rutas públicas, revalida rol/estado en BD y revoca sesiones; lista blanca de rutas por módulo (rutas sin clasificar = negadas); `negocioEsDeCliente` guarda `/compras/<id>` y `/negocios/<id>/(comercial|lineas-oferta)`. Otras 162 rutas no mencionan `cliente_id`, pero quedan detrás de módulos no activables; **no probado con 2 empresas reales** (BD local apagada).

Cookies: `httpOnly`, `secure` en prod, `sameSite: lax` ✅. Historial git: búsqueda de patrones `sk-…`, `AKIA…`, `BEGIN` en cambios sin md/lock: sin coincidencias (búsqueda acotada, no exhaustiva). `.env*` fuera de git ✅ (`.env.example` ignorado). DB y Evolution sin puerto público en compose (3306 solo 127.0.0.1) ✅.

## 5. Plan de corrección

- **Ola 0 (hoy)**: SEC-001.
- **Ola 1 (esta semana)**: SEC-002 (subir next 16.4.6 y probar), SEC-003, DB-001, borrar `/api/debug/*`.
- **Ola 2 (este mes)**: levantar BD local y correr `chequear-aislamiento.mts` con 2 empresas de prueba; triage de lint; CSP completa; rotación de `CRON_SECRET` (ya marcado en memoria).
- **Ola 3 (antes de vender)**: F2 legal (Ley 21.719), pruebas de restauración de respaldos, DKIM/DMARC (SMTP conocido roto), plan B oficial de WhatsApp.

## 6. Lo que NO se auditó (para no dar falsa tranquilidad)

(Actualizado tras los sondeos 3b.) Sin hacer: F2 a fondo (inventario de datos personales, retención, encargados, transferencias, WhatsApp no oficial, términos de MP), F3 (restauración de respaldos, EXPLAIN de las 20 consultas, bloqueos), F4 (validación de entrada ruta por ruta, idempotencia de OC/correos, concurrencia), F5 (banco de anexos y fuzz de lectores: faltan los archivos), F6 (todos los recorridos de navegador), F7 (contraste, web vitals, bundle, responsive), F8 (carga y capacidad: ya hay una prueba de 100 usuarios del 09-nov en `infra.md`), F9 (logs/rotación/auditoría de acciones), F10 (código muerto, duplicación). Tampoco: subidas de archivos (magic bytes), XSS en HTML de IA, inyección de prompt, Caddy/HSTS/SSH/respaldos del VPS (no hay Caddyfile en el repo), webhooks de Evolution. Pendientes conocidos de la memoria (SMTP, licitaciones@ comprometida, CRON_SECRET a rotar) no se re-verificaron.

## 7. Anexo de pruebas

`scripts/scratch/auditoria-rutas.sh` (rutas sin marca de auth). Comandos: `npx tsc --noEmit`, `npm run test:viabilidad`, `npx eslint app proxy.ts --quiet`, `npm audit --omit=dev`, `node scripts/scratch/chequear-migraciones.mjs`.
