# Informe de auditoría LICITANK — 2026-11-17 (PARCIAL: F0 + F1 + sondeos)

> Alcance real: solo lectura del código y comandos locales. No se tocó producción, ni BD, ni Obuma, ni IA.
> La BD local Docker (:3308) estaba apagada, así que **no se pudo** correr `chequear-aislamiento.mts`, EXPLAIN, banco de anexos, ni recorridos F6 en navegador.
> Las fases F2–F10 NO están auditadas en profundidad (ver sección 6). Esto no es una luz verde: es lo que se alcanzó a verificar.

## 1. Resumen ejecutivo

| Área | Semáforo | Por qué |
|---|---|---|
| Seguridad (auth/aislamiento) | 🟡 | Diseño sólido (sesión en proxy + lista blanca de módulos + guardia por negocio). Un hueco real: SSRF en 2 rutas. |
| Datos / BD | ⚪ sin evaluar | BD local apagada; solo se vio numeración de migraciones. |
| QA funcional | ⚪ sin evaluar | No se hicieron recorridos. |
| IA / Documentos | ⚪ sin evaluar | Sin banco de anexos corrido. |
| Rendimiento | ⚪ sin evaluar | Sin medición. |
| Operación | 🟡 | Tests verdes; lint con 4.561 errores sin triage; sin CSP completa. |
| Legal | ⚪ sin evaluar | Pendiente (Ley 21.719 desde 1-dic-2026). |
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

F2 (legal), F3 (EXPLAIN, integridad, restore), F4 (validación de entrada por ruta, idempotencia, concurrencia), F5 (banco de anexos, fuzz), F6 (todos los recorridos), F7 (UX/accesibilidad/web vitals), F8 (carga), F9 (logs/alertas/deploy.sh), F10 (código muerto, `any`, catch vacíos). Tampoco: subidas de archivos (magic bytes), XSS en HTML de IA, inyección de prompt, Caddy/HSTS/SSH/respaldos del VPS (no hay Caddyfile en el repo), webhooks de Evolution. Pendientes conocidos de la memoria (SMTP, licitaciones@ comprometida, CRON_SECRET a rotar) no se re-verificaron.

## 7. Anexo de pruebas

`scripts/scratch/auditoria-rutas.sh` (rutas sin marca de auth). Comandos: `npx tsc --noEmit`, `npm run test:viabilidad`, `npx eslint app proxy.ts --quiet`, `npm audit --omit=dev`, `node scripts/scratch/chequear-migraciones.mjs`.
