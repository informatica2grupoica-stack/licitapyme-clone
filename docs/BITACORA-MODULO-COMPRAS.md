# Módulo de Compras — Fase 1 (04-sep-2026)

> **Sesión 10 (09-sep-2026): auditoría de lo construido el 8/9-sep + reordenamiento de pantalla.**
> Ver §10 al final. Entre la Sesión 4 (04-sep) y esta sesión se construyó CASI TODA la spec
> (§7-§19) SIN una sola línea de bitácora — 13 tablas nuevas (migration-90 a 102), 13 librerías,
> 34 rutas API y 13 tarjetas de UI. Está aplicado en la base real y funcionalmente completo, pero
> nadie lo documentó ni lo probó en navegador. Si retomas esto, lee §10 primero.

> **Sesión 2 (04-sep-2026, más tarde): la Fase 1 quedó CERRADA.** Ver §7 al final — correo de
> proyecto ganado, orden de compra del cliente y registro de ejecución de las tareas. Lo que sigue
> es §8 (Auditor de Compras) o §9-§10 (incidencias y compuertas), sin empezar.

Bitácora de lo construido en esta sesión. Si retomas esto: lee primero este archivo completo,
después `git log`/`git status` para saber qué está commiteado (el usuario sube los commits él
mismo — no ofrecer commitear).

Spec fuente: `ESPECIFICACION_Modulo_Compras_v2_2.docx` (el usuario la compartió por chat, no está en
el repo). Es un documento de **22 secciones**, mucho más grande que lo construido acá — ver
"Qué NO se construyó todavía" al final.

---

## 0. Contexto: qué había ANTES de esta sesión

`/compras` ya existía pero **no era el Módulo de Compras real**: era un visor de solo lectura del
"paquete de traspaso" que se congela al **postular** (`checklist_comercial_congelamiento`, migración
55) — es decir, mostraba negocios que ni siquiera se sabía si se iban a ganar. Según la spec, Compras
solo debe existir para negocios **GANADOS** (§1.4 Frontera del módulo). Ese era "el módulo que ya
tenemos pero no está funcional" que el usuario pidió arreglar.

También existía un circuito PARECIDO pero con otro propósito: **Entrega de Proyectos** (Frente F.1,
`app/lib/entrega-proyecto.ts`, tablas `entrega_proyecto`/`entrega_acuse`) — resuelve "quién debe
acusar recibo de que ganamos", no "quién ejecuta la compra". Se REUSA su
`construirResumenEjecutivo()` como base del resumen de Compras (ver §3 abajo) en vez de duplicar esa
lógica.

## 1. Alcance de esta Fase 1 (acordado con el usuario antes de programar)

De las 22 secciones de la spec, se construyó SOLO el esqueleto de entrada:
- **§3** Gatillo de entrada, notificación, asignación con SLA de 3h hábiles + fallback automático,
  Cadena de Urgencia.
- **§4** Resumen Ejecutivo (congelado, no se regenera — mismo criterio que el paquete de traspaso y
  que Entrega de Proyectos, por consistencia y auditabilidad).
- **§5** Modelo de tareas: catálogo enunciativo (Validación + Administrativo), tareas manuales, sin
  estado "incumplida".

Decisiones que el usuario confirmó explícitamente (ver conversación):
1. Empezar por el esqueleto de entrada (no el Auditor de Compras ni las compuertas de aprobación).
2. La interfaz visual tiene que ser igual a como está el resto del programa (mismos componentes:
   `Banner`, `Select`, `MultiSelect`, paleta zinc/teal/indigo, mismo patrón de tarjetas y filtros que
   ya usaba `/compras` viejo).
3. Resumen Ejecutivo: **congelado**, no vivo — se decidió así porque es el patrón que YA usa todo el
   resto del sistema (`congelamiento.ts`, `entrega-proyecto.ts`) y el usuario pidió "lo mejor
   posible", que en este código significa consistencia con lo ya probado, no una excepción nueva.

## 2. Qué se construyó

### Datos (`docs/migration-86-modulo-compras.sql` + `scripts/aplicar-migration-86.mjs`)
Tres tablas nuevas:
- **`compras_asignacion`** — una fila por negocio ganado: encargado, `vencimiento_asignacion_at`
  (ganado + 3h hábiles), `urgente`, y `resumen_json` (el Resumen Ejecutivo, congelado al abrirse).
- **`compras_tarea_catalogo`** — catálogo ENUNCIATIVO (spec §1.3.5: "todo catálogo es enunciativo,
  nunca taxativo"), vive en tabla no en código. Sembrado con 8 tareas iniciales (contacto inicial,
  validación técnica real, validación de cotización, validación de costeo, aceptar OC, boleta,
  contrato, reloj de entrega).
- **`compras_tarea`** — instancia por negocio. `catalogo_clave = NULL` = tarea manual. Estados:
  `PENDIENTE | EN_CURSO | HECHA` — **sin** "incumplida" (spec §5.1 lo prohíbe explícitamente).

**✅ Migración aplicada** (04-sep-2026, misma sesión): `node scripts/aplicar-migration-86.mjs` corrió
contra la base real. Las 3 tablas existen y el catálogo tiene sus 8 tareas. Bug encontrado y
corregido en el camino: dos descripciones del catálogo traían un `;` DENTRO del texto (ej. "correcto;
habilita a mejorarlo...") y el runner (mismo patrón simple que `aplicar-migration-85.mjs`) parte el
SQL por `;` a secas — cortaba el INSERT a la mitad. Se reemplazaron esos `;` por `—` en el propio
`.sql`. **Ojo con esto en futuras migraciones**: cualquier texto en un INSERT no puede llevar `;`
mientras el runner siga usando ese split ingenuo.

### Lógica (`app/lib/compras.ts`, nuevo)
- Aritmética de fechas "de pared" (sin tocar zona horaria real): `sumarHorasHabiles`,
  `sumarDiasHabiles`, `sumarDiasCorridos`. Lunes-Viernes 09:00-18:00, **sin calendario de feriados**
  (simplificación explícita — peor caso: una tarea con un día de margen de más). 7 tests en
  `app/lib/__tests__/compras.test.mts`.
- `construirResumenEjecutivoCompras()` — envuelve `construirResumenEjecutivo` de
  `entrega-proyecto.ts` y le suma: presupuesto del proyecto, fecha de cierre, plazo de entrega
  ofertado (texto + días crudos), hito desde el que corre el plazo, boleta/contrato exigidos, plazo
  de aceptación de OC, monto costeado y margen previsto. **Todo sale de datos que YA existen**
  (`licitaciones_cache`, `viabilidad_licitacion.informe_ejecutivo` — el prompt v2.1/v3 ya extrae
  `requisitos_admisibilidad.{boleta,contrato,fiel_cumplimiento}` y
  `linea_tiempo.frontera_inicio_computo`): **no se agregó ninguna llamada nueva a IA**.
- `abrirComprasSiCorresponde()` — idempotente (INSERT IGNORE), llamada desde
  `procesar-postuladas.ts` (los MISMOS dos puntos donde ya se llama `abrirEntregaSiCorresponde`).
  Marca urgente si el plazo ofertado es < 3 días (§3.7/§15.2), notifica por `historial_eventos`
  (campana + SSE) al asistente comercial + jefe de ventas (permiso `aprobar_comercial`) + admins.
- `asignarEncargado()` — asignación manual (jefe de ventas) o automática (fallback). Siembra las
  tareas del catálogo con `plazo_at` calculado desde `ganado_at` (no desde la asignación — el reloj
  no espera a que alguien tome el caso, spec §9.7 "el reloj corre siempre").
- `asignacionAutomaticaFallback()` — barre asignaciones vencidas sin encargado, asigna al candidato
  (permiso `compras`) con menor carga (`compras_tarea` abiertas). Cron cada 20 min:
  `app/api/cron/compras-asignacion/route.ts`, agendado en `scheduler/scheduler.mjs`
  (`jobComprasAsignacion`, `*/20 * * * *`).
- Lectura para pantalla: `obtenerAsignacion`, `listarAsignacionesCompras`, `listarTareas`.
- Tareas: `crearTareaManual`, `cambiarEstadoTarea` (limpia `cerrado_at`/etc. si se vuelve atrás).

### Permisos (`app/lib/api-auth.ts`, `app/admin/usuarios/page.tsx`, `session-context.tsx`)
- Permiso nuevo: **`compras`** ("Encargado de Compras" — candidato a asignación automática, puede
  operar tareas). Otorgable desde `/admin/usuarios`.
- "Jefe de ventas" NO es un permiso nuevo — reusa `aprobar_comercial` (ya es quien aprueba el
  negocio comercial). Coherente con cómo ya funciona `esAsesor()` en
  `app/api/negocios/[id]/comercial/route.ts`.
- Acceso: admin, o quien tenga `compras`/`aprobar_comercial`, o el propio encargado asignado (aunque
  no tenga el permiso general — es su trabajo, mismo criterio que `entrega_proyectos`).

### API (`app/api/compras/**`)
- `GET /api/compras` — listado transversal (reemplaza la vista vieja de "paquete congelado" por la
  vista real de asignación/urgencia/avance de tareas). Devuelve `negocios` + `candidatos`.
- `GET /api/compras/[negocioId]` — resumen + asignación + tareas + candidatos, para la pestaña del
  negocio. Exporta `puedeOperarCompras()`, reusado por las otras rutas.
- `POST /api/compras/[negocioId]/asignar` — solo jefe de ventas/admin.
- `POST /api/compras/[negocioId]/tarea` — tarea manual.
- `PATCH /api/compras/tarea/[tareaId]` — cambiar estado.
- `GET/POST /api/cron/compras-asignacion` — fallback automático (mismo patrón de auth que los demás
  cron: `x-vercel-cron:1` · Bearer `CRON_SECRET` · `?secret=` · `x-cron-secret`).

### UI
- **`app/compras/page.tsx`** — reescrito. Antes: tarjetas de "paquete congelado" (postulados, no
  necesariamente ganados). Ahora: un negocio GANADO por fila, con urgencia, encargado (o dropdown
  para asignar si sos jefe de ventas y está sin asignar), avance de tareas (`X/Y hechas`, vencidas),
  filtros (encargado, urgentes, sin asignar, rango de fecha), búsqueda, orden — mismo patrón visual
  que la versión vieja (`MultiSelect`, `Select`, `Banner`, mismos tamaños de fuente/paleta).
- **`app/negocios/[id]/ComprasSection.tsx`** (nuevo) + wiring en `app/negocios/[id]/page.tsx`:
  pestaña "Compras" nueva en el detalle del negocio, visible solo cuando `esGanado(estado_pipeline)`
  (helper nuevo en `app/lib/pipeline.ts`, puro, seguro para cliente) y el usuario puede operar Compras.
  Muestra: banner de "resumen incompleto" si hay `faltantes[]`, control de asignación, resumen
  ejecutivo colapsable, tareas agrupadas por categoría con botón de ciclo de estado
  (Pendiente → En curso → Hecha), formulario para tarea manual.
- **`app/components/AppLayout.tsx`** — el ítem "Compras" del sidebar dejó de ser `adminOnly`: ahora
  también lo ve quien tenga `compras` o `aprobar_comercial` (mismo patrón que "Entregas"/"Puente").

## 3. Verificación hecha en esta sesión

- `npx tsc --noEmit` → **limpio**, sin errores.
- `npm run test:viabilidad` (`tsx --test app/lib/__tests__/*.test.mts`) → **922/922 tests OK**
  (incluye los 7 tests nuevos de `compras.test.mts`: aritmética de horas/días hábiles, cruce de fin
  de semana, inicio fuera de jornada).
- Smoke test en navegador: `next dev` ya corría en el puerto 3000 del usuario (no se tocó, se
  reusó); `/compras` respondió sin error de compilación/runtime y redirigió a `/login` como
  cualquier ruta protegida sin sesión (comportamiento esperado, no se probó autenticado).

## 4. Lo que falta para que esto funcione de punta a punta (próxima sesión)

1. ~~Aplicar `migration-86`~~ — **hecho** (ver §2, aplicada 04-sep-2026).
2. ~~Backfill histórico~~ — **hecho, con un cambio de rumbo en la misma sesión** (ver §4.1 abajo):
   quedó cargado **un solo negocio de prueba**, el **717**. **DECIDIDO (sesión 2): los 45 negocios
   ADJUDICADA viejos quedan FUERA.** Compras arranca limpio: solo entran los que se ganen de acá en
   adelante (`abrirComprasSiCorresponde` dispara por TRANSICIÓN, así que esto no requiere código —
   es no hacer nada). Lo viejo se sigue gestionando como se gestiona hoy, fuera del módulo.
3. **Permiso `compras`**: el usuario dijo explícitamente "solo los admin de momento, aun no tenemos
   creado el perfil de compras" — NO otorgar a nadie todavía. Los 3 admin (Alexis Tobar, Asesor,
   Carolina Gonzalez) ya pueden asignar y operar Compras sin este permiso (el admin es "super").
   Retomar cuando exista la cuenta real del Encargado de Compras.
4. **Probar en vivo — EN CURSO**: entrar a `/compras` con un admin y verificar que aparece el
   negocio **717** (`1114-12-LE26`), asignarlo a mano a un admin, confirmar que se siembran las
   tareas del catálogo con plazo correcto, y que la pestaña "Compras" del negocio 717
   (`/negocios/717`) muestra lo mismo. Es el punto exacto por donde sigue la próxima sesión.
5. **Desplegar el scheduler actualizado** (`scheduler/scheduler.mjs` tiene el job nuevo
   `jobComprasAsignacion` cada 20 min) — vive en el VPS/notebook (docker-compose), no en Vercel. Sin
   esto el fallback automático de 3h no corre en producción (sí sirve para probar el flujo manual).

### 4.1 Backfill: dos intentos, el segundo es el que quedó (04-sep-2026, misma sesión)

`/compras` apareció vacío pese a la migración aplicada: 46 negocios estaban en `ADJUDICADA` pero
`compras_asignacion` tenía 0 filas, porque `abrirComprasSiCorresponde` solo dispara por TRANSICIÓN
(igual que `abrirEntregaSiCorresponde`) y esas 46 promociones ya habían ocurrido antes de que este
código existiera — no hay avalancha de avisos, pero tampoco hay nada que mostrar.

**Herramienta construida:** `scripts/scratch/compras-backfill-ultimo-ganado.mts` (toma automático
"el último ganado" por `fecha_adjudicacion`) y su variante `compras-backfill-negocio.mts <id>` (toma
un negocio puntual a mano). Ambos reportan por defecto y solo escriben con `--aplicar`; identifican
`ganado_at` por la fecha REAL del acta de MP (`adjudicacion_cache`, nunca `ahoraChileSQL()` — ver
[[feedback_datos_reales_nunca_inventados]]) y notifican a los destinatarios reales (asistente + jefe
de ventas + admins) exactamente como si el negocio hubiera ganado en ese instante.

**Intento 1 — negocio 245** (`1004823-9-LP26`, "EQUIPOS HERRAMIENTAS Y SISTEMAS DE SIMULACIÓN Y
REALIDAD VIRTUAL..."), el más reciente por fecha. Se cargó, se probó (el usuario mismo lo asignó a
Alexis Tobar desde la UI, sembrando 6 tareas), pero el usuario decidió que **no sirve como caso de
prueba**: no tiene ningún documento propio subido por el asistente, solo el costeo generado por el
sistema — muy poco representativo. **Se revirtió por completo**: se borraron las 6 tareas
(`compras_tarea`), la fila de `compras_asignacion`, y los 5 eventos de campana
(`COMPRAS_PROYECTO_GANADO` × 4 + `COMPRAS_ASIGNADO` × 1) — negocio 245 quedó exactamente como antes
de esta sesión, sin rastro.

**Intento 2 — negocio 717** (`1114-12-LE26`, "ADQUISICIÓN DE PLATAFORMAS SATELITALES Y SENSORES"),
ganado 24-ago-2026 15:49:41. Elegido porque tiene **9 documentos propios reales** subidos por el
asistente a la licitación (`documentos_cache`, `categoria='DOCUMENTOS_PROPIOS'`, sin contar el
costeo): 8 anexos (`ANEXO N°1 DECLARACIÓN JURADA SIMPLE`, `N°4 PROGRAMA DE INTEGRIDAD`, `N°5
FACTURACIÓN ELECTRÓNICA`, `N°7 DECLARACIÓN JURADA`, `N°8 PROPUESTA TÉCNICA`, `N°2-B IDENTIFICACIÓN
DEL OFERENTE`, `N°6 AUTORIZACIÓN PAGOS`, `OFERTA ECONÓMICA PLAZO ENTREGA Y GARANTÍA`) — el candidato
más completo de los 46 (`compras-backfill-negocio.mts 717 --aplicar`). Quedó **sin asignar**, con 2
faltantes reales en el resumen (sin contactos del cliente, sin costeo registrado → sin margen
previsto) — dato real de ese negocio, no un bug.

**Nota para quien retome:** `documentos_cache` (por `licitacion_codigo`, categoría
`DOCUMENTOS_PROPIOS`) es la tabla de "documentos que el asistente subió a la licitación" — DISTINTA
de `checklist_comercial_documentos` (por `negocio_id`, la que lee `entrega-proyecto.ts` para
"documentos propios" del resumen ejecutivo). Ninguna de las dos está mal, son dos conceptos
distintos que hoy conviven; si en una fase futura el resumen de Compras necesita mostrar los anexos
reales presentados (no solo los que entrega-proyecto.ts ya trae), la fuente es `documentos_cache`.

**Verificación final de esta sesión:** `compras_asignacion` tiene exactamente **1 fila** (negocio
717, `asignado_a = NULL`). Negocio 245 no tiene ningún rastro de Compras.

## 5. Qué NO se construyó todavía (el resto de la spec, 22 secciones)

Todo lo posterior a "encargado asignado + tareas de validación creadas":
- **§6** Costeo digital — YA estaba resuelto antes de esta sesión (`costeo-editor.ts`, migración 85).
- **§7** Creación de SKU.
- **§8** Auditor de Compras (bandeja de cotizaciones multi-formato, homologación de productos por
  IA, cuadro comparativo, veredicto técnico sin exclusión, 4 escenarios logísticos desde Epeira 575
  Talagante). Es la pieza más grande y más valiosa de negocio de todo el documento.
- **§9** Zona de incidencias (defensivas/ofensivas, Oportunidad de Mejora).
- **§10-12** Compuertas de aprobación (compra + margen 20%), proceso administrativo post-aprobación,
  ruta de importación con costo aterrizado.
- **§13** Logística (base de fleteros, modalidad de retiro, sugerencia automática).
- **§14-15** Estados/subestados consolidados, reloj de entrega, multas, prórrogas.
- **§16-17** Entrega del proyecto (acta), postventa, captura de contacto de pagos.
- **§18** Trazabilidad/estadística de gestión (dashboard, solo jefatura).
- **§19** Agentes de aprendizaje (sugerencia de proveedor histórico vía OBUMA).
- **§20** Separación del modelo genérico (con stock) vs. Tecnomaq (reventa, sin stock) — hoy todo
  el módulo asume el camino difícil (sin stock), como pide la spec para esta etapa.

El documento (§21) deja 9 decisiones explícitamente sin resolver — la más relevante para diseño de
datos futuro: si el Resumen Ejecutivo se regenera cuando cambian datos del proyecto tras asignar
(OC por menos líneas, prórroga, Oportunidad de Mejora aprobada). Se decidió que NO para esta Fase 1
(congelado) — si una fase futura necesita reabrir esa pregunta, este documento es el lugar para
anotar por qué se cambia.

## 6. Archivos tocados (para orientarse rápido)

**Nuevos:**
`app/lib/compras.ts` · `app/lib/__tests__/compras.test.mts` · `app/negocios/[id]/ComprasSection.tsx`
`app/api/compras/[negocioId]/route.ts` · `.../asignar/route.ts` · `.../tarea/route.ts`
`app/api/compras/tarea/[tareaId]/route.ts` · `app/api/cron/compras-asignacion/route.ts`
`docs/migration-86-modulo-compras.sql` · `scripts/aplicar-migration-86.mjs`
`scripts/scratch/compras-backfill-ultimo-ganado.mts` · `scripts/scratch/compras-backfill-negocio.mts`
(las dos de backfill — scratch a propósito, no son parte del producto, ver §4.1)

**Modificados:**
`app/lib/api-auth.ts` (permiso `compras`) · `app/lib/pipeline.ts` (`esGanado`)
`app/lib/procesar-postuladas.ts` (hook `abrirComprasSiCorresponde`, contador `comprasAbiertas`)
`app/api/cron/alertas/route.ts` (log del contador) · `app/api/compras/route.ts` (reescrito)
`app/compras/page.tsx` (reescrito) · `app/negocios/[id]/page.tsx` (pestaña nueva)
`app/components/AppLayout.tsx` (visibilidad del ítem de sidebar)
`app/admin/usuarios/page.tsx` · `app/lib/session-context.tsx` (tipo de permisos)
`scheduler/scheduler.mjs` (job + cron nuevo)

Nota: `app/lib/anexos-datos.ts`, `app/lib/costeo-editor.ts`,
`app/licitacion/[codigo]/sections/DocumentosSection.tsx`, `app/negocios/[id]/CosteoEditorCard.tsx`
aparecen modificados en `git status` pero son de la sesión ANTERIOR (anexo económico en Excel —
ver `docs/BITACORA-COSTEO-ANEXO-ECONOMICO.md`), no de esta.

---

## 7. Sesión 2 (04-sep-2026): cierre de la Fase 1

Se taparon los tres huecos que quedaban de §3-§5 — lo que la spec pide en esas mismas secciones y
la Fase 1 no había construido. **Migración 87** (`docs/migration-87-compras-oc-y-registro-tareas.sql`,
runner `scripts/aplicar-migration-87.mjs`), **aplicada y verificada** contra la base real.

### 7.1 §3.2 — El correo que faltaba

La spec pide DOS canales al declararse ganado: "en el sistema **y también por correo**". La Fase 1
solo empujaba la campana (`historial_eventos`). Ahora `notificarProyectoGanadoCompras` manda además
un correo (`enviarAvisoComprasGanado`, nuevo en `app/lib/email.ts`) a los mismos destinatarios
—asistente que lo trabajó + jefes de ventas (`aprobar_comercial`) + admins— con el precio de venta,
el plazo de entrega ofertado, el vencimiento del SLA de asignación y, si aplica, la marca de Cadena
de Urgencia en rojo.

Los correos se resuelven en **una sola consulta** para los N destinatarios (no una por persona), y
el envío **nunca bloquea la apertura**: si el SMTP está caído, la campana ya avisó y el módulo queda
abierto igual.

> ⚠️ **El SMTP del proyecto está caído** (error 535 desde hace más de una semana — ver la memoria
> `project_smtp_roto_confirmado_sep2026`). El código quedó listo y probado en su lógica, pero
> **ningún correo va a salir hasta que se arregle la credencial**. `enviarAvisoComprasGanado`
> devuelve `false` y loguea, sin romper nada.

### 7.2 §3.6 — Orden de compra del cliente

No había dónde registrarla. Ahora `compras_asignacion` guarda número, fecha de emisión, **fecha de
aceptación en el portal**, monto, la marca **"difiere de lo ofertado"** y una observación libre,
con quién la registró y cuándo.

Dos decisiones que vale la pena recordar:

- **Todo opcional.** La OC llega por partes (primero el número y la emisión, la aceptación días
  después). Exigirla completa habría hecho que no se registre nada hasta el final.
- **Anotar la fecha de aceptación da por HECHA la tarea `aceptar_oc`** del catálogo
  (`registrarOrdenCompraCliente` devuelve `tareaAceptacionCerrada`). Pedirle al encargado que además
  marque la tarea a mano es pedirle que escriba dos veces el mismo hecho.
- **`difiere` es una casilla propia, no una nota perdida en un texto**, porque §3.6 es tajante: "si
  el monto o alcance adjudicado difiere de lo ofertado, manda siempre la orden de compra". Al
  marcarla se avisa al encargado por campana (`COMPRAS_OC_DIFIERE`) y sale un banner en la pestaña.
  Registrar una OC que calza no notifica a nadie — no es noticia.

### 7.3 §5.3 / §5.4 — Registro de lo que se hizo en cada tarea

Hasta acá una tarea solo podía pasar a HECHA: no había dónde dejar **con quién se habló** ni **qué
contestó el proveedor**. La spec lo pide explícitamente — el contacto inicial "queda registrado en
el sistema" (§5.3), y la validación de la cotización tiene salida binaria: "cotización validada, o
hallazgo levantado" (§5.4).

**El formulario de cada tarea vive en el CATÁLOGO** (`compras_tarea_catalogo.campos_json`), no en el
código — §1.3.5: "ningún catálogo se implementa como lista cerrada en código". Agregarle una
pregunta al cuestionario del vendedor es un `UPDATE`, no un deploy. Se sembraron los formularios de
6 de las 8 tareas del catálogo (boleta y contrato no lo necesitan: son un sí/no con plazo):

| Tarea | Qué se registra |
|---|---|
| `contacto_inicial` | canal, con quién se habló, sus datos, si se acusó recibo de la OC, dudas del cliente, qué se le anticipó que puede no cumplirse |
| `validacion_tecnica_real` | producto, fabricante, **¿la ficha es de un producto que existe?**, ¿es el producto correcto?, dónde se verificó |
| `validacion_cotizacion` | proveedor, vendedor, y **las 7 preguntas de §5.4 una por una** (existe · stock · specs · ficha · entrega inmediata · plazo · precio vigente) |
| `validacion_costeo` | si el costo del asistente es correcto, desviación, dónde se ve espacio para mejorar |
| `aceptar_oc` | quién la aceptó en el portal |
| `reloj_entrega` | hito de inicio, su fecha, plazo ofertado, fecha tope resultante |

Cada formulario lleva **salida por texto libre** ("observaciones"), como exige §1.3.5. Los tipos de
campo son tres: `texto`, `parrafo`, `si_no`. Una tarea **manual** no declara campos y cae a un
"¿Qué se hizo?" libre.

**`hallazgo`** es una marca aparte del estado, a propósito: "hecha" y "salió mal" son dos cosas
distintas, y §5.1 prohíbe el estado "incumplida". §5.4 dice que un hallazgo "abre automáticamente
una incidencia" — la Zona de Incidencias (§9) todavía no existe, pero **la marca sí**, para que
cuando se construya tenga de dónde leer los hallazgos ya levantados en vez de empezar de cero.

En la UI: el registro se guarda con la tarea abierta ("Guardar") o de una con **"Guardar y dar por
hecha"** — el gesto natural es terminar el cuestionario y cerrar, no dos pasos. Lo ya anotado se ve
sin abrir el formulario.

### 7.4 Verificación de esta sesión

- `node scripts/aplicar-migration-87.mjs` → **aplicada** contra la base real (9 sentencias), y
  corrida **dos veces** para confirmar que es idempotente (la 2ª: "6 aplicadas, 3 que ya estaban" —
  los 3 ALTER dan 1060 y se saltan). 6 tareas del catálogo con formulario.
- `npx tsc --noEmit` → **limpio**. De paso se arregló el único error que arrastraba el proyecto:
  `compras.test.mts` importaba `'../compras.ts'` con extensión (TS5097).
- `npm run test:viabilidad` → **944/944 OK**, incluidos 5 tests nuevos de `parsearCamposCatalogo`
  (el parser del formulario del catálogo: JSON roto, campos sin clave, tipo desconocido → nunca
  voltea la pantalla, deja la tarea sin formulario).
- **NO se probó en el navegador**: la app pide login y el asistente no ingresa contraseñas. Sigue
  pendiente el punto 4 de §4 — entrar como admin al negocio **717** y recorrer el flujo completo.

### 7.5 Archivos de esta sesión

**Nuevos:** `docs/migration-87-compras-oc-y-registro-tareas.sql` · `scripts/aplicar-migration-87.mjs`
`app/api/compras/[negocioId]/orden-compra/route.ts`

**Modificados:** `app/lib/compras.ts` (correo en la apertura · `OrdenCompraCliente` +
`registrarOrdenCompraCliente` · `guardarRegistroTarea` · `parsearCamposCatalogo` · `listarTareas` y
`obtenerAsignacion` extendidos) · `app/lib/email.ts` (`enviarAvisoComprasGanado`) ·
`app/api/compras/tarea/[tareaId]/route.ts` (acepta registro y hallazgo, y `estado` pasa a ser
opcional) · `app/negocios/[id]/ComprasSection.tsx` (bloque de OC + formulario de registro por tarea)
· `app/lib/__tests__/compras.test.mts`

### 7.6 Por dónde sigue

Lo pendiente de §4 que NO es código: **desplegar el scheduler** con `jobComprasAsignacion` (vive en
el VPS, no en Vercel — sin eso el fallback de 3h no corre en producción), **probar en vivo** el
negocio 717, y el permiso `compras` cuando exista la cuenta real del Encargado.

De la spec, lo grande sin construir sigue siendo §7 (SKU), **§8 (Auditor de Compras — la pieza más
valiosa)**, §9 (incidencias), §10 (compuertas de aprobación) y de ahí en adelante. Ver §5 arriba.

---

## 8. Sesión 3 (04-sep-2026): el Resumen Ejecutivo estaba mintiendo

El usuario abrió la pestaña Compras del negocio **717** y la pantalla mostraba un banner amarillo:
*"El resumen ejecutivo quedó incompleto: el paquete congelado quedó sin contactos del cliente · el
negocio no tiene costeo registrado"*, con **Margen previsto —**, **Plazo de entrega —** y **Desde
cuándo corre —**.

Ninguno de esos datos faltaba de verdad. Estaban todos en la base. Eran **cinco bugs distintos**,
encadenados sobre los mismos tres campos de §4.2.

### 8.1 Los cinco

**1. El costeo se buscaba en la foto equivocada.** El resumen lee el costeo del *paquete de
traspaso*, que se congela **al postular**. El del 717 se congeló el 06-ago con `costeo: null`. El
costeo apareció después y está vigente en `checklist_comercial_costeo` desde entonces
($19.546.749 de costo, $40.378.376 de venta). Nadie lo miraba. → Si el paquete no lo trae, ahora se
busca en la fuente viva. **Margen previsto real: 51,6%** — y ese es justo el número del que va a
depender la Compuerta 2 (§10.3, piso del 20%), así que nacía ciega.

**2. Los plazos se leían de una clave que ya no se usa.** El código buscaba `linea_tiempo` en el
informe de viabilidad. Los informes del prompt v3 —o sea, todos— guardan eso en `plazos`. Resultado:
sin plazo de entrega, sin hito de inicio, y con el plazo de aceptación de OC genérico ("tope legal 5
días") cuando el informe decía textualmente **2 días hábiles desde la emisión de la OC**. →
`leerPlazosDelInforme()`, que entiende los dos esquemas, con 5 tests.

**3. §4.2 campo 5 pide el plazo OFERTADO, no el de las bases.** Se estaba mezclando. Ahora manda el
comprometido en el bloque comercial del Auditor Técnico, y el de las bases entra solo como respaldo
**rotulado** (*"50 días corridos (tope de las bases — no se registró el plazo ofertado)"*), para que
nadie confunda el máximo permitido con lo que efectivamente prometimos.

**4. `repararContactosFaltantes` no podía funcionar.** Su query pasaba dos parámetros para un solo
`?`: el array de estados caía en el `LIMIT` y MySQL rechazaba la consulta por error de sintaxis. El
`catch` se lo tragaba y la función devolvía "0 revisados" para siempre. El cron llevaba semanas
corriendo sin reparar nada, en silencio.

**5. Y aunque hubiera funcionado, leía el campo equivocado.** `obtenerContactosCliente` buscaba
`lic.Comprador`. `obtenerPorCodigoRapido` devuelve la ficha **ya aplanada**: `Organismo`,
`NombreUnidad`, `DireccionUnidad`, `ComunaUnidad`, `Region`, `NombreUsuario`, `CargoUsuario` van en
la raíz. `Comprador` daba `undefined` y la función salía por el camino de "MP respondió pero no trae
comprador", que ni siquiera reintenta. **Por eso NINGÚN paquete de traspaso de toda la base tenía
contactos del cliente** — y el contacto inicial con el cliente (§5.3) es literalmente la primera
tarea del encargado.

De paso, esa ficha traía datos que la spec pide y nadie estaba leyendo:
`NombreResponsableContrato`, `EmailResponsableContrato`, `FonoResponsableContrato`,
**`NombreResponsablePago`** y `EmailResponsablePago`. Ese último es §17.3 — el contacto de pagos,
"que nunca es la misma persona que la contraparte técnica". En el 717 efectivamente son tres
personas distintas: Pablo Vergara (contraparte), Cristian Maturana (contrato), Ximena Guzmán (pagos).

### 8.2 Pendiente #1 de §21, respondido

*"¿El resumen se regenera cuando cambian datos del proyecto tras la asignación, o queda congelado?"*

La respuesta que tomó el módulo: **congelado sigue siendo el default —no hay cron ni regeneración
automática— pero se puede volver a armar a mano.** `regenerarResumen()` +
`POST /api/compras/[negocioId]/resumen`, con botón en el banner de faltantes y en la cabecera del
resumen. Es una acción explícita de una persona.

El razonamiento: nadie quiere que la foto se mueva sola por la espalda, pero cuando la foto salió
**mal** —el paquete se congeló antes de que existiera el costeo, MP estaba caído— la única
alternativa era editar la base a mano. No toca la asignación, el encargado, las tareas ni lo que se
haya registrado en ellas: solo el resumen. Al regenerar también se recalcula la Cadena de Urgencia,
por si el plazo de entrega recién ahora se supo.

### 8.3 Verificación

Resumen del 717, recién armado contra la base real:

```
  Existe costeo          : true · monto costeado: 19546749.58
  Margen previsto        : 51.6 %
  Plazo entrega ofertado : 50 días corridos (tope de las bases — no se registró el plazo ofertado)
  Desde cuando corre     : Desde la notificación de la orden de compra (24h después de la adjudicación) — emision_oc
  Plazo aceptacion OC    : 2 días hábiles — según las bases de esta licitación.
  Contactos del cliente  : Pablo Vergara Brito · contrato: Cristian Maturana Bravo · pagos: Ximena Guzmán Bravo
  FALTANTES              : []
```

- **59 paquetes congelados reparados** — toda la base de paquetes sin contactos del cliente, con la
  misma función del cron (`scripts/scratch/reparar-contactos-ahora.mts`, 59 revisados / 59 reparados).
- `npm run test:viabilidad` → **949/949**, con 5 tests nuevos de `leerPlazosDelInforme` (esquema v3,
  esquema viejo, informe sin plazos, plazo inferido, duración suelta).
- `npx tsc --noEmit` → limpio.
- **Sigue sin probarse en el navegador por el asistente** (la app pide login). El usuario tiene el
  server local corriendo: basta recargar la pestaña Compras del 717.

### 8.4 Archivos

**Nuevos:** `app/api/compras/[negocioId]/resumen/route.ts`
**Modificados:** `app/lib/compras.ts` (`leerPlazosDelInforme` · respaldos de costeo y contactos ·
`regenerarResumen`) · `app/lib/congelamiento.ts` (los bugs 4 y 5 + los contactos de contrato y pago)
· `app/negocios/[id]/ComprasSection.tsx` (botón de rearmado, contactos por rol) ·
`app/lib/__tests__/compras.test.mts`

### 8.5 La lección, para la próxima fase

Los cinco bugs comparten forma: **un dato que sí existía, leído desde la clave, la tabla o la foto
equivocada, con el error tapado por un `catch` mudo o por un `null` que parecía un dato faltante
legítimo.** El módulo entero se apoya en datos que vienen de otras partes del sistema (el paquete
congelado, el informe de viabilidad, la ficha de MP, el costeo) — cada una con su propio esquema y
su propio momento de captura. Antes de construir §8 (Auditor de Compras), que se apoya en MÁS
fuentes todavía, conviene asumir que el dato está y que lo que falla es la lectura.

---

## 9. Sesión 4 (04-sep-2026): la orden de compra llega sola

Pedido del usuario, con la OC de 1114-12-LE26 ya emitida: *"si llega la orden de compra debe avisar
y cargarla a esta licitación de ganada"*.

### 9.1 Los dos módulos se ignoraban

El sistema **ya traía las órdenes de compra desde la API de MP** — `ordenes_compra` (migración 64)
lleva 352 guardadas, con su PDF descargado a R2 y todo. Y al mismo tiempo, la pestaña Compras que
se construyó en la sesión 2 pedía que **alguien fuera al portal a copiar a mano** el número, la
fecha y el monto de esa misma orden.

Nadie los había conectado. Es el mismo patrón de la sesión 3: el dato estaba, faltaba la lectura.

### 9.2 La orden del 717 apareció

Barriendo 14 días (`scripts/scratch/buscar-oc-1114.mts`):

```
1114-21-SE26 · "ORDEN DE COMPRA DESDE 1114-12-LE26" · COMERCIAL MP SPA
  creada 24-ago · enviada 25-ago · ACEPTADA 26-ago (hora Chile)
  neto $40.378.376 · total c/IVA $48.050.267    ← calza exacto con lo adjudicado
  PDF ya descargado a R2 · contacto comprador: Ximena Guzmán
```

El barrido diario por defecto mira 3 días hacia atrás y esta orden es del 24-ago, así que nunca la
había visto: el cron de órdenes vive en el scheduler del VPS, que no se ha desplegado.

### 9.3 Lo que se construyó (migración 88)

**`vincularOrdenCompraDeMP()`** en `compras.ts`, llamada desde el loop de guardado de
`sincronizarOrdenesCompra`. Cuando una orden es NUESTRA y su licitación ya está abierta en Compras:

- escribe en la ficha el código, estado, fechas y montos que reporta MP;
- **cierra sola la tarea `aceptar_oc`** si la orden viene aceptada (la cierra "Mercado Público",
  con la fecha real en la nota) — el hecho ya ocurrió, pedirle a alguien que lo marque a mano es
  pedirle que escriba dos veces lo mismo;
- **avisa** al encargado (o a jefes de ventas + admins si todavía no hay encargado — la OC llega
  cuando llega, no espera a que alguien tome el caso);
- **enciende la marca "difiere"** si el monto no calza (§3.6: "manda siempre la orden de compra").

Reglas de convivencia con lo escrito a mano, que importan:

| Situación | Qué hace |
|---|---|
| Misma orden, mismo estado | No hace nada y **no vuelve a avisar** — el listado de MP es de MOVIMIENTOS, una orden reaparece cada vez que cambia de estado |
| Había una observación escrita por una persona | **No se pisa**, se conserva |
| `difiere` ya estaba marcada a mano | **Solo se enciende, nunca se apaga sola** — alguien pudo marcarla porque cambió el ALCANCE, no el monto |
| Había otro número anotado a mano | No se borra: queda dicho en la observación ("antes estaba anotada como X; MP informa Y") |

**`ocDifiereDeLoAdjudicado()`**, con tests. Compara **neto contra neto**: `total` viene con IVA y el
monto adjudicado del resumen es neto — compararlos directo marcaba un 19% de diferencia falsa en
TODAS las órdenes, o sea la alerta se volvía ruido el primer día. Tolerancia del 1% para los
redondeos por línea del portal.

**`engancharOrdenesCompraPendientes()`** — backfill idempotente para las órdenes ya guardadas que
nunca se vincularon (las que llegaron antes de que este enganche existiera).

### 9.4 "Debe ser inmediato"

El cron de órdenes es **diario** porque barre el listado completo de un día (~16.000 órdenes de
todo Chile): la API no deja preguntar por una licitación concreta. Eso no se puede correr cada 20
minutos.

Pero la **vía directa por proveedor** sí: son 2 llamadas, una por empresa (las dos ya tienen su
`mp_codigo_proveedor` descubierto). Se agregó el modo `soloProveedor` a
`sincronizarOrdenesCompra`, y el cron **`compras-asignacion` (cada 20 min)** ahora hace tres cosas:
fallback de asignación (§3.3) + búsqueda de la OC por proveedor + enganche de pendientes.

No hizo falta tocar el scheduler: `jobComprasAsignacion` ya está agendado `*/20 * * * *`.

### 9.5 En pantalla

El bloque de la OC muestra ahora: chip **"Llegó sola desde Mercado Público"**, estado en MP, link a
la ficha del portal y link al **PDF de la orden** (ya estaba descargado en R2, nadie lo mostraba).
Sin OC: *"Todavía no llega. El sistema la busca solo y la carga acá apenas aparece"* — en vez del
formulario vacío que pedía tipearla. El botón pasa a "Corregir a mano" cuando el dato lo puso el
sistema.

### 9.6 Verificación

- OC **1114-21-SE26 enganchada al negocio 717** de punta a punta: ficha completa (`origen: mp`,
  estado Aceptada, neto y total), **tarea `aceptar_oc` cerrada por "Mercado Público"**, campana
  enviada (`COMPRAS_OC_RECIBIDA`).
- **El cron corrido contra el servidor local del usuario** (`localhost:3000`): HTTP 200 en 14,7s,
  `{"oc":{"buscadas":0,"enganchadas":0}}` — o sea idempotente, no repite el aviso de una orden ya
  enganchada.
- `npm run test:viabilidad` → **952/952** (3 tests nuevos de `ocDifiereDeLoAdjudicado`).
- `npx tsc --noEmit` → limpio.

### 9.7 Archivos

**Nuevos:** `docs/migration-88-compras-oc-automatica.sql` · `scripts/aplicar-migration-88.mjs`
**Modificados:** `app/lib/compras.ts` (`vincularOrdenCompraDeMP` · `ocDifiereDeLoAdjudicado` ·
`engancharOrdenesCompraPendientes` · `OrdenCompraCliente` con origen/estado MP) ·
`app/lib/ordenes-compra.ts` (enganche + modo `soloProveedor`) ·
`app/api/cron/compras-asignacion/route.ts` · `app/api/compras/[negocioId]/route.ts` (link y PDF) ·
`app/negocios/[id]/ComprasSection.tsx` · `app/lib/__tests__/compras.test.mts`

---

## 10. Sesión 10 (09-sep-2026): auditoría de las Sesiones 5-9 (nunca documentadas) + reordenamiento

El usuario compartió `ESPECIFICACION_Modulo_Compras_v2_2.docx` (ahora sí, versión completa de 22
secciones) y pidió: (1) revisar qué falta contra el documento, (2) confirmar si Obuma está
integrado, (3) que la pantalla deje de mostrarlo todo apilado — "no se va a entender para qué
sirve cada módulo" — y (4) que Compras pueda ver el costeo con las mismas funciones de la burbuja
flotante.

### 10.1 Lo que apareció: Sesiones 5-9 existieron pero nunca se escribieron acá

Entre el 08-sep y el 09-sep (antes de esta sesión) se construyó, sin ninguna línea de bitácora:

- **13 migraciones** (`migration-90` a `migration-102`) — **verificado con `SHOW TABLES` contra la
  BD real: las 26 tablas nuevas EXISTEN**, no quedaron a mitad de aplicar.
- **13 librerías** (`app/lib/compras-*.ts` + `tipo-cambio.ts`): auditor de compras (§8, cotización
  OCR multi-formato, homologación por IA, cuadro comparativo, 4 escenarios desde Epeira 575
  Talagante), incidencias (§9, con Oportunidad de Mejora y triple aprobación), aprobaciones+SKU
  (§7, §10, compuertas de compra y margen 20%), reparto administrativo (§11, registro pasivo de lo
  que hace Obuma), importación/costo aterrizado (§12), logística/fleteros (§13), reloj/multas/
  prórrogas (§15), entrega/acta/postventa (§16, §17), fracaso con doble dictamen (§14.6),
  aprendizaje/sugerencia de proveedor histórico (§19.3) y gastos reales (pedido aparte del usuario,
  no numerado en la spec).
- **34 rutas API** y **13 tarjetas de UI**, todas montadas (ninguna huérfana).
- **Sin una sola prueba en navegador ni entrada de bitácora.** Se auditó con un agente de
  exploración (lectura completa de cada archivo nuevo, cruzado contra las 22 secciones de la spec)
  — ver conversación de esta fecha para el detalle sección por sección.

### 10.2 El problema real que reportó el usuario: confirmado, y es de pantalla, no de código

`ComprasSection.tsx` mostraba, apenas había encargado asignado, **12 tarjetas seguidas al mismo
nivel** (Productos → Modalidad de retiro → Reloj → Fracaso → Incidencias → Auditor de Compras →
Gastos → Importación → Aprobaciones/SKU → Reparto Administrativo → Entrega → Postventa), sin tabs
ni agrupación. Un proyecto recién asignado veía exactamente la misma pila que uno ya entregado.

**Fix:** las 12 tarjetas se agruparon en **5 pestañas por etapa real del ciclo de compra**, cada
una con una línea que explica para qué sirve (constante `FASES` en `ComprasSection.tsx`):

| Pestaña | Contiene | Spec |
|---|---|---|
| Tareas | El checklist de validación y plazos administrativos | §5 |
| Costeo y Auditoría | Cobertura por producto + Auditor de Compras | §8, §14 |
| Aprobación y SKU | Creación de SKU + las dos compuertas | §7, §10 |
| Compra, Importación y Logística | Reparto administrativo + importación + modalidad de retiro + gastos | §11, §12, §13 |
| Entrega y Cierre | Reloj/multas + incidencias + acta de entrega + postventa + fracaso | §9, §15, §16, §17, §14.6 |

Lo de arriba de las pestañas (header, documentos, banner de faltantes, encargado, OC del cliente,
resumen ejecutivo) queda igual — es información de "Entrada" que aplica siempre, no una etapa.
`app/compras/[negocioId]/page.tsx` pasó de `max-w-4xl` a `max-w-6xl`: con pestañas y tablas
comparativas el contenedor angosto quedaba apretado.

### 10.3 Costeo con las mismas funciones de la burbuja — enganchado

Ningún archivo de Compras importaba `CosteoFlotanteContext`. Solo había reuso de **datos** (copia
puntual de precios del editor a `compras_producto` al asignar, ver `poblarProductosCompra` en
`compras.ts`), nunca de la vista en vivo. Se agregó un botón **"Ver costeo"** en el header de
`ComprasSection.tsx` que llama `useCosteoFlotante().abrir(negocioId, licitacionCodigo)` — la MISMA
función que usa el resto de la app (ver [[project_costeo_burbuja_flotante_sep2026]]), no una copia:
abre la burbuja/pantalla completa real, con el mismo estado y las mismas fórmulas.

### 10.4 Obuma — decisión del usuario, no una integración nueva

Hoy `app/lib/obuma.ts` es de **solo lectura** (v1.0: proveedores, OC de compra, facturas) y se usa
en vivo en 2 puntos: `proveedorNuevoOAntiguo` (§8.5, en `compras-auditor.ts`) y
`sugerenciaProveedorHistorico` (§19.3, en `compras-aprendizaje.ts`). El resto de las secciones que
mencionan Obuma (§11, §16, §17) son **registro pasivo por diseño**: la spec dice literalmente "eso
lo ejecuta Obuma, el módulo solo controla y registra el estado" — no está roto, es la spec.

**Decisión explícita del usuario (09-sep-2026):** dejar pendiente cualquier integración de
escritura con Obuma por ahora, EXCEPTO la creación de SKU (§7) — "apenas lleguemos a ese módulo, ya
que sé cómo se realiza, lo apliqué en otro programa". O sea: cuando se trabaje la pestaña
"Aprobación y SKU", el usuario va a guiar cómo crear/homologar el SKU contra Obuma en vivo (hoy
`crearSku` en `compras-aprobaciones.ts` solo guarda `obumaProductoId` a mano, sin llamada real). No
tocar esto todavía sin que el usuario lo pida.

### 10.5 Verificación de esta sesión

- `npx tsc --noEmit` → limpio en `ComprasSection.tsx` y `app/compras/[negocioId]/page.tsx` (los 3
  errores que arroja el comando son de `app/lib/detectar-aperturas.ts`, preexistentes de otra
  sesión, no tocados acá).
- Tablas de las migraciones 86-102 confirmadas contra la BD real con un script de solo lectura
  (`scripts/scratch/check-tablas-compras.mjs`, queda como herramienta de diagnóstico reutilizable).
- **No se probó en navegador**: la ruta `/compras/717` redirige a login (comportamiento esperado,
  sin sesión) — se intentó conectar al servidor del propio usuario (`localhost:3000`, HMR ya había
  recargado los cambios), pero el asistente no ingresa credenciales. Pendiente que el usuario
  recorra las 5 pestañas del negocio 717 y confirme que se ve bien.

### 10.6.1 Primera prueba en vivo (09-sep-2026, mismo día): 2 bugs reales, ambos arreglados

El usuario entró al negocio 717 con sesión iniciada y reportó dos huecos:

1. **El Resumen Ejecutivo no mostraba quién ganó/trabajó el negocio de nuestro lado.** El dato
   YA estaba calculado y guardado — `ResumenEjecutivo.responsableNombre` (JOIN
   `negocios.asignado_a` → `usuarios.nombre` en `entrega-proyecto.ts::construirResumenEjecutivo`,
   heredado por `ResumenEjecutivoCompras`) viaja completo en `resumen_json` (confirmado con lectura
   directa a la BD: `responsableNombre: "Consuelo Ramirez"` para el 717) — nadie lo pintaba en
   pantalla. Fix: nuevo campo en la interfaz `ResumenCompras` de `ComprasSection.tsx` + una tarjeta
   "Asistente comercial (lo trabajó)" al inicio del grid del resumen, separada de "Contactos del
   cliente" (que es del organismo, no nuestro).
2. **El acta de evaluación no aparecía en "Documentación del proyecto".** Existe y ya estaba
   descargada (`Acta_1114_12_LE26.pdf`, visible en la pestaña "Resultado" de la licitación vía
   `DocumentosActa.tsx` → `GET /api/licitacion/acta`), pero vive en su PROPIA tabla
   (`acta_documento`, `app/lib/acta-adjudicacion.ts`) — completamente separada de `documentos_cache`,
   que es la única fuente que lee `DocumentosLicitacionCard.tsx` (vía `GET /api/documentos/[codigo]`).
   Fix: el card ahora pide las dos fuentes en paralelo y funde en una sola lista los documentos del
   acta que ya tienen copia en R2 (`d.url`), bajo la categoría nueva "ACTA" → "Acta de adjudicación".
   Los detectados-pero-no-descargados se siguen gestionando solo desde "Resultado" (no se duplicó
   ese flujo acá).

**Nota para quien retome:** el acta NO se trae sola — hoy requiere que un admin abra la pestaña
"Resultado" de la licitación y apriete "Buscar documentos" (`POST /api/licitacion/acta`, pega
contra Mercado Público con IP chilena). Si en el futuro se quiere que llegue sola al ganar (como ya
pasa con la OC del cliente, ver §9), es un enganche nuevo en `abrirComprasSiCorresponde` o en el
cron `compras-asignacion` — no se construyó en esta sesión, no se pidió.

Verificado en vivo (sesión del propio usuario, `localhost:3000`, negocio 717): ambos campos se ven
correctos en pantalla, el link del acta abre el PDF real en R2. `npx tsc --noEmit` limpio.

### 10.6.2 Recorrido completo de las 4 pestañas restantes (09-sep-2026, mismo día): 1 bug grave más

El usuario pidió "revisa todo, realiza el flujo completo a ver si todo cuadra". Se recorrieron en
vivo (negocio 717, sesión del propio usuario) las 4 pestañas que nadie había abierto en navegador:
Costeo y Auditoría, Aprobación y SKU, Compra/Importación/Logística, Entrega y Cierre.

**Bug grave encontrado — cotización en dólares leída como si fuera pesos.** El usuario había
registrado una cotización real de Unisource Ingeniería (`Cotizacion24377.pdf`, USD, "5.- TIPO
MONEDA: DOLAR" explícito en el documento) esa misma mañana. La extracción por IA
(`extraerDatosCotizacionDeDocumento`, `app/lib/compras-cotizacion-ocr.ts`) devolvió
`precioUnitario: 2.05` y `moneda: "CLP"` — leyó "2.052,00" (formato chileno: punto de miles, coma
decimal) como 2,05, y no detectó "DOLAR" en el pie de página aunque el texto OCR lo traía literal.
Con eso, el cuadro comparativo y los 4 escenarios del Auditor de Compras mostraban **$2 CLP** por un
sensor industrial que en verdad cuesta **USD 2.052 (~$1.902.081 CLP)** — un error de ~950.000×, no
cosmético: si alguien hubiera aprobado la compra con esos escenarios, la Compuerta 2 (margen) habría
mostrado un negocio espectacular sobre un precio que no existe.

Interesante: el pipeline de conversión de moneda (`tipo-cambio.ts`, migration-100, `precio_unitario_clp`)
**ya existía y funcionaba bien** — fue construido ESE MISMO DÍA, más temprano, a raíz de esta misma
cotización (ver el comentario en `compras-auditor.ts::registrarCotizacion`, "hallazgo real
09-sep-2026, cotización de Unisource en USD"). El bug no estaba en la conversión: estaba un paso
antes, en la EXTRACCIÓN — la IA nunca le pasó "USD" al conversor porque devolvió "CLP".

**Arreglado en tres capas:**
1. **Prompt de extracción mejorado** (`SYS_EXTRACCION`): instrucción explícita del formato chileno
   de números (punto = miles, coma = decimal) y de revisar TODO el documento — no solo el
   encabezado — buscando "TIPO MONEDA"/"DOLAR"/"USD" antes de asumir CLP.
2. **Red de seguridad nueva**: la IA ahora también extrae `cantidadPrincipal` (la cantidad de la
   línea del precio unitario). `precioUnitarioConfiable()` compara `precioUnitario × cantidad`
   contra `precioTotal` (que SÍ se leyó bien, 8.243 — el propio documento permite detectar el error
   sin volver a llamar a la IA); si el desfase es de orden de magnitud (>3×), anula el
   `precioUnitario` en vez de dejarlo pasar mal — mismo criterio de
   [[feedback_no_inventar_datos_parser]]: mejor pedirle al encargado que lo tipee que un precio
   equivocado silencioso.
3. **Dato ya corrupto en la BD, corregido con los valores reales del PDF** (se descargó y leyó el
   PDF real para confirmar los números): `scripts/scratch/fix-cotizacion-11-unisource.mjs` —
   cotización #11 pasó a `precio_unitario=2052, precio_total=8243, moneda='USD'`, con el tipo de
   cambio del día ya cacheado (`compras_tipo_cambio`, $926,94), recalculando
   `precio_unitario_clp=$1.902.081` y `precio_total_clp=$7.640.766`, y el ítem homologado
   (`compras_cotizacion_item`) actualizado igual. Verificado en vivo: el cuadro comparativo y los 4
   escenarios ahora muestran $1.902.081/unidad y $7.648.324 de costo total (= 4×1.902.081 + $40.000
   de flete interno, matemática consistente).

**Bug menor encontrado — "Productos y cobertura" mostraba el precio de VENTA sin etiqueta, no el
costo.** `compras_producto.monto_unitario` se puebla desde `precioUnitarioSinDecimales` del costeo
(motor-comercial.ts) — el precio que LE COBRAMOS al Estado, no `costoUnitarioNeto` (lo que a
NOSOTROS nos cuesta). `ProductosCompraCard.tsx` lo pintaba como número pelado ("4 Unidad ·
$6.745.621"), en una pestaña cuyo propósito es justo comparar costos de cotización — fácil de leer
como techo de compra cuando en realidad ES el precio de venta (pagar cerca de eso se come toda la
utilidad). Fix: se etiquetó explícito ("venta unitaria: $6.745.621"). No se agregó una columna de
costo nueva (requeriría migración de esquema) — el costo real ya está a un clic en "Ver costeo" y en
las cotizaciones del mismo Auditor.

**Verificado y confirmado CORRECTO, no bug (para no repetir la duda si alguien retoma esto):**
- Los 4 escenarios salían idénticos — correcto, hay una sola cotización real cargada, así que las 4
  estrategias de selección convergen al mismo candidato. `calcularEscenarios()` sí diferencia
  cuando hay más de un candidato por producto (revisado el código, no solo la pantalla).
- `RepartoAdminCard` y `PostventaCard` no se veían en sus pestañas — ambos por diseño: Reparto solo
  aparece con la Compuerta 1 ya aprobada (§11.2, "tareas paralelas AL APROBARSE la compra") y
  Postventa solo si el resumen ejecutivo trae compromisos/garantías (el 717 no tiene ninguno
  registrado — dato real, no hueco).
- Un `POST /api/actividad → 400` intermitente en consola: preexistente, de otra sesión (registro de
  "vio esta sección" al navegar por la licitación), no toca nada de Compras — no se investigó más
  a fondo por estar fuera de alcance.

**Verificación de esta sesión:** `npx tsc --noEmit` limpio · `npm run test:viabilidad` → **984/984**
(sin tests nuevos — el fix de extracción es de prompt + una función pura ya cubierta
indirectamente). Las 5 pestañas recorridas en vivo con la sesión real del usuario, sin errores de
consola nuevos ni requests fallidos propios de Compras.

### 10.6 Qué sigue (según lo que decida el usuario)

- Probar en vivo el negocio 717 con las pestañas nuevas.
- Si el usuario quiere, agregar contadores/badges por pestaña (cuántas tareas pendientes, cuántas
  incidencias abiertas) — no se hizo en esta sesión para no mezclar cambio de UI con cambio de
  datos.
- Cuando se trabaje "Aprobación y SKU": integración de escritura con Obuma para crear el SKU, con
  el usuario guiando (ver §10.4).
- §18 (Trazabilidad) sigue sin vista propia — hoy es indirecta vía `historial_eventos` y el
  histórico de `compras_tarea`; no hay un dashboard dedicado.

---

## 11. Sesión 11 (09-sep-2026): "agreguemos lo que falta" — dashboard, contadores, permisos finos

El usuario pidió completar lo que faltaba. Auditoría rápida: **§7-§17 ya estaban construidos**
(sesiones 5-10), y el propio documento marca §18 (Dashboard) y §19.4 como **fuera de alcance**
explícito para esta etapa — así que "lo que falta" se acotó, con el usuario, a tres cosas
concretas que sí valía la pena construir ahora que el módulo tiene uso real.

### 11.1 Contadores por pestaña

La reorganización en 5 fases (Sesión 10) escondió información: antes de entrar a una pestaña no
había forma de saber si había algo esperando. `obtenerResumenFases()` (nuevo, `app/lib/compras.ts`)
calcula, con consultas livianas envueltas en try/catch (nunca rompen la pantalla si una tabla
falla): tareas vencidas, productos sin ninguna cotización, compuertas pendientes, hitos
administrativos pendientes (`null` si la Compuerta 1 no está aprobada — no aplica todavía) e
incidencias abiertas + reloj vencido. Viaja en `GET /api/compras/[negocioId]` como
`resumenFases`, y `ComprasSection.tsx` pinta un badge por pestaña (rojo si es urgente: incidencia
abierta o reloj vencido).

### 11.2 Dashboard de Compras (§18) — construido pese a que la spec lo marca "fuera de alcance"

La spec es explícita: "Dashboard de Compras (**fuera de alcance**, condiciona el modelo de datos)".
Solo pedía que el modelo de datos lo soportara después — y ya lo soportaba (cada tarea trae
`creado_at`/`cerrado_at`/`responsable` desde el día uno, migration-86). El usuario pidió completar
igual, así que esto es la vista que faltaba sobre datos que ya existían, no una funcionalidad nueva
de fondo.

`app/lib/compras-dashboard.ts` (`obtenerDashboardCompras()`): negocios activos/urgentes, relojes
vencidos, incidencias abiertas, SLA de asignación real (§3.3, promedio de horas + cuántas fueron
fallback automático), **cuellos de botella por tipo de tarea** (tiempo promedio de creación a
cierre, solo entre las cerradas, ordenado de más lenta a más rápida) y **ranking por encargado**
(tareas cerradas, vencidas hoy, tiempo promedio — atribución "a quien tenía la tarea en el momento
del evento", spec §18.4). Todo el cálculo de horas es en JS sobre fechas ya guardadas como hora de
pared de Chile — nunca `TIMESTAMPDIFF`/`NOW()` de MySQL (mismo criterio que el resto del proyecto).

`GET /api/compras/dashboard` — gate MÁS ANGOSTO que el resto del módulo: admin o
`aprobar_comercial` únicamente (§2.4/§18.6: "la estadística de gestión por usuario es visible solo
para la jefatura, no para el propio encargado" — el permiso `compras` NO alcanza acá, a propósito).
`app/compras/dashboard/page.tsx`, enlazado desde `/compras` con un botón "Dashboard" visible solo a
jefatura.

**Hallazgo real construyendo esto, no un bug de UI:** el dashboard mostraba "Fijación y validación
del reloj de entrega" como vencida en el negocio 717 aunque el reloj YA estaba fijado (Sesión 10,
sección "sigamos"). La tarea del catálogo y la tabla `compras_reloj` son cosas distintas y nadie las
enganchaba — a diferencia de `registrarOrdenCompraCliente`, que sí cierra sola la tarea
`aceptar_oc`. Fix: `fijarReloj()` (`app/lib/compras-reloj.ts`) ahora cierra sola la tarea
`reloj_entrega` con el mismo patrón. Corregido también el dato ya viejo del 717
(`scripts/scratch/cerrar-tarea-reloj-717.mjs`). El dashboard sirvió literalmente para lo que dice la
spec que debía servir: encontrar un cuello de botella falso.

### 11.3 Permisos finos: administración y bodega (§2.2)

La spec decía "se define cuando el sistema esté andando, no antes" — y hoy nadie salvo los 3 admin
tiene el permiso `compras` (ver Sesión 1, §4 punto 3), así que este era el momento sin riesgo de
romper acceso real de nadie. Dos permisos nuevos, **aditivos** sobre `compras` (que sigue siendo el
perfil "compras y entrega", el dueño operativo de todo el negocio):

- **`compras_administracion`** — opera SOLO el Proceso Administrativo §11 (`RepartoAdminCard`),
  aunque no sea el encargado del negocio.
- **`compras_bodega`** — opera SOLO la verificación de la entrega §16.4 (Conforme/No conforme
  dentro de `EntregaCard`), aunque no sea el encargado del negocio.

**La parte que costó pensar, no la de agregar dos checkboxes:** casi todas las rutas de Compras
(`aprobaciones`, `sku`, `incidencias`, `importacion`, `logistica`, `gastos`, `productos`,
`cotizaciones`/`escenarios`, y casi toda `entrega`) reusan el MISMO gate (`puedeOperarCompras`) para
absolutamente todo. Si se lo hubiera ensanchado sin más, administración y bodega habrían quedado con
permiso de escritura sobre TODO el módulo, no solo su sección — justo lo que el "aditivo pero
angosto" del diseño quería evitar. Se resolvió con dos gates separados en
`app/api/compras/[negocioId]/route.ts`:
- `puedeOperarCompras` — el de siempre, intacto, sigue siendo el único que usan las rutas de
  escritura genéricas.
- `puedeVerCompras` (nuevo) — suma administración/bodega, pero SOLO se usa para lectura general (el
  `GET` principal, y el `GET` de `aprobaciones`/`entrega` que esas dos secciones necesitan leer) o
  para la acción puntual que de verdad es de ellas: `reparto` (GET+PATCH completos, vía
  `puedeOperarReparto` en su propia ruta) y `entrega`'s acción `verificacion` (chequeo dentro del
  propio `switch`, no en el gate general del PATCH).

`EntregaCard.tsx` recibió un prop nuevo `puedeVerificar` (además de `puedeOperar`), usado SOLO en el
botón Conforme/No conforme — el resto de la tarjeta (modalidad, acta, firmas) sigue exclusivo del
encargado. `ComprasSection.tsx` calcula `esAdministracion`/`esBodega` de los permisos del usuario y
se los pasa a `RepartoAdminCard`/`EntregaCard`.

Catálogo de permisos actualizado en `app/admin/usuarios/page.tsx` (dos checkboxes nuevos, categoría
"comercial"), y los 4 gates de navegación/vista que antes solo miraban `compras`/`aprobar_comercial`
(`app/compras/page.tsx`, `app/compras/[negocioId]/page.tsx`, `app/components/AppLayout.tsx`, más el
listado `GET /api/compras`) se ensancharon para dejar entrar a los dos perfiles nuevos.

### 11.4 Verificación

`npx tsc --noEmit` limpio · `npm run test:viabilidad` → **984/984** (sin tests nuevos: son vistas
sobre datos existentes y ajustes de permisos, no lógica de negocio nueva que valiera un test
unitario aparte). Verificado en vivo con la sesión real del usuario: contadores correctos en las 5
pestañas del 717, dashboard con datos reales (SLA 10.9 días, 1 tarea cerrada en 1.5h, 5 tareas
vencidas → 4 tras el fix del reloj), checkbox nuevo visible en `/admin/usuarios`. **No probado**:
ningún usuario real tiene todavía `compras_administracion` ni `compras_bodega` otorgado — la
autorización se revisó leyendo el código de cada ruta, no recorriendo la pantalla como esos
perfiles (no hay ninguna cuenta de prueba con esos permisos).

### 11.5 Qué sigue

- Otorgar `compras_administracion`/`compras_bodega` a cuentas reales cuando existan esos perfiles,
  y recorrer la pantalla como ellos al menos una vez.
- El Dashboard es v1: sin filtro por rango de fecha ni por encargado, sin exportar. Ampliar si la
  jefatura lo usa y pide algo puntual — no antes.

---

## 12. Sesión 12 (09-sep-2026): el contacto de la licitación vivía en el acta, no en la ficha de MP

El usuario pidió el teléfono y correo de la persona a cargo de MP en 1114-12-LE26. Se revisaron las
tres fuentes que la app ya lee (ficha de la API, bases en PDF, acta de evaluación en PDF): ninguna
trae esos dos datos — `EmailResponsableContrato`/`FonoResponsableContrato` de la API vienen siempre
`""`, y las bases dicen explícitamente "No se atenderán consultas por teléfono ni otros canales".
Se le dijo así al usuario.

El usuario mandó capturas de pantalla del **propio portal de Mercado Público**: la página del acta
tiene una sección "Datos del Contacto para esta Licitación" (Nombre Completo / Cargo / Teléfono /
Fax / E-Mail) que la API nunca expone y que ningún documento trae — **pero que la app YA descarga**
como HTML crudo dentro de `leerActa()` (`app/lib/acta-adjudicacion.ts`) para sacar la grilla de
anexos. Nadie leía el resto de esa página.

**Fix, sin llamada nueva a MP** (reusa el HTML que `leerActa()` ya trae):
- `parseContactoLicitacion(html)` — mismo patrón genérico de extracción por `<tr>`/`<t[dh]>` que ya
  usa el resto del archivo para los anexos. Busca la sección por su título, lee las filas
  etiqueta→valor. **No verificado contra HTML real** (el sandbox de esta sesión no tiene IP
  chilena, no puede abrir mercadopublico.cl) — queda para confirmar con "Releer" desde una sesión
  real la próxima vez que se use en una licitación nueva.
- Migración 103: 4 columnas nuevas en `adjudicacion_cache` (`contacto_nombre/cargo/telefono/email`),
  aplicada contra la BD real. `leerYGuardarActa()` las persiste cuando el parseo encuentra el
  bloque; `obtenerActaVista()` las expone a la UI.
- `DocumentosActa.tsx` (pestaña "Resultado" de la licitación) pinta el contacto arriba de la lista
  de documentos del acta, con el e-mail como `mailto:`.
- `congelamiento.ts::obtenerContactosCliente()` — el que alimenta `usuarioNombre`/`usuarioCargo` en
  todos lados (paquete de traspaso, Resumen Ejecutivo de Compras) — ahora suma
  `usuarioTelefono`/`usuarioEmail` leyendo esas mismas columnas, best-effort (nunca rompe si la
  migración no corrió o el acta no se ha leído todavía). Es el mismo Pablo Vergara Brito que ya
  aparecía como "Contraparte" en el Resumen Ejecutivo — se le suman los 2 campos, no se duplica.

**El dato del 717 se cargó a mano** con los valores EXACTOS que el usuario mostró en las capturas
(Pablo Vergara Brito · Asistente Administrativo · 56-22-4496661 · pablo.vergara@mop.gov.cl) —
`scripts/scratch/set-contacto-1114.mjs` — porque el sandbox no puede volver a leer el acta en vivo
para confirmarlo por su cuenta. Es dato real que el usuario ya tenía en pantalla, no una invención.

**Verificación:** `npx tsc --noEmit` limpio, `npm run test:viabilidad` → **984/984**. Migración 103
aplicada y confirmada contra la BD real. **No se pudo probar en navegador** (la sesión de este
turno no tenía login activo) — pendiente que el usuario confirme visualmente en "Resultado" del
717, y que pruebe "Releer" en una licitación adjudicada NUEVA para validar el parser contra HTML
real por primera vez.

---

## 13. Sesión 13 (10-sep-2026): "termina el módulo" — el acta llega sola

Sin sesión de navegador disponible (otra vez), esta sesión fue código + auditoría estática. El
pendiente más concreto que quedaba de la Sesión 12 era manual: un admin tenía que abrir
"Resultado" y apretar "Buscar documentos" para que el acta (y el contacto que trae, §12 arriba)
llegara. Se automatizó.

### 13.1 El acta se lee sola

`licitacionesEnComprasSinActa()` + `traerActaAutomatico()` (nuevo en `acta-adjudicacion.ts`),
enganchados al cron `compras-asignacion` que ya corre cada 15-30 min (mismo que trae la OC del
cliente por proveedor) — de a 5 negocios por corrida, cada uno en su propio try/catch para que uno
que falle no tumbe a los demás.

**Migración 104** (`adjudicacion_cache.acta_leida_at`): sin esto, un organismo que simplemente no
publica ningún anexo en el acta habría hecho que el cron reintentara ESE negocio cada 15-30 min
para siempre (2 llamadas a MP cada vez, sin que nada fuera a cambiar) — `acta_leida_at` se sella al
intentar, tenga o no anexos, separado de si guardó algo. `licitacionesEnComprasSinActa()` también
exige `url_acta IS NOT NULL` (no intenta si MP todavía ni siquiera publicó el link del acta).
Backfill aplicado: 10 licitaciones que ya se habían leído a mano antes de que existiera esta
columna quedaron selladas, para no reprocesarlas de gratis.

### 13.2 Auditoría estática del resto del módulo (sin navegador)

Se lanzó una revisión de código dedicada sobre lo que todavía no se había recorrido en vivo ni leído
línea por línea: `compras-entrega.ts` (§16/§17), `compras-logistica.ts` (§13), `compras-gastos.ts`,
`compras-fracaso.ts`, `compras-proveedores.ts`, `compras-reparto.ts` — buscando el mismo tipo de
bugs ya encontrados en el resto del módulo (dinero mal calculado, campo leído de la columna
equivocada, un hecho real que no cierra su tarea del catálogo, guards que fallan abierto). Revisado
también a mano `calcularMargenPrevisto` (compras-aprobaciones.ts) y `calcularCostoAterrizado`
(compras-importacion.ts, prorrateo del flete internacional §12.4) — ambos correctos: el margen
prioriza costo aterrizado → escenario elegido → costeo estimado, y el prorrateo es por unidad,
efectivo, no la fórmula gruesa de Fase 3 que la spec prohíbe explícitamente para esta decisión.

**6 hallazgos reales, arreglados:**

1. **IDOR en `quitarPuntoEntrega`** (`compras-entrega.ts`) — confianza ALTA, el único de
   seguridad. Borraba un punto de entrega por `id` solo, sin comprobar que fuera del negocio de la
   URL: cualquiera con acceso de Compras a SU negocio podía borrar un punto de entrega de OTRO
   negocio mandando su `id`. Fix: `quitarPuntoEntrega(negocioId, id)` con `WHERE id=? AND
   negocio_id=?`, mismo patrón que ya usaba `eliminarGasto` en `compras-gastos.ts` — el guardarraíl
   correcto existía en el mismo módulo, acá faltaba.
2. **`generarActa` no invalidaba la firma/cierre de una versión anterior** (`compras-entrega.ts`,
   §16.5/§16.7) — regenerar el acta limpiaba la aprobación pero dejaba `acta_firma_*`,
   `acta_conformidad` y `cerrada_at` de la versión VIEJA, mostrando un acta "cerrada" con contenido
   que en los hechos nunca fue firmado. Fix: toda regeneración limpia también firma y cierre, mismo
   criterio que `invalidarAprobacionesCompras`.
3. **`declararFracaso` no invalidaba el dictamen del jefe de ventas al re-declarar con otro
   motivo** (`compras-fracaso.ts`, §14.6) — si el encargado corregía el motivo declarado, el
   dictamen anterior (que analizó el motivo VIEJO) seguía mostrado como vigente. Fix: si el motivo
   cambia de verdad, limpia el dictamen; si es el mismo texto, no toca nada.
4. **`obtenerOCrearProveedor` comparaba RUT como string exacto** (`compras-proveedores.ts`, §8.3) —
   "76.123.456-7" y "76123456-7" no calzaban entre sí, creando proveedores duplicados en vez de
   engancharlos (justo lo que la función decía evitar). Fix: comparación normalizada con `normRut`
   (misma utilidad que ya usa `adjudicacion.ts`), sin tocar el RUT guardado.
5. **Política "proveedor nuevo exige factura antes de provisión de fondos" nunca se aplicaba**
   (`compras-reparto.ts`, §11.2) — la regla estaba descrita en el comentario de la migración pero
   `marcarHitoReparto` no la comprobaba. Fix: nueva función `proveedorNuevoSinFactura()` (mira los
   proveedores del escenario elegido vs. `compras_cotizacion.proveedor_nuevo`, calculado por
   Obuma) que bloquea provisionar fondos si hay un proveedor nuevo sin factura registrada.
6. **Desmarcar un hito de reparto no limpiaba el dato adjunto** (`compras-reparto.ts`) — el número
   de OC, monto o cuenta quedaban pegados y reaparecían como vigentes al reactivar el hito sin que
   nadie los hubiera vuelto a verificar. Fix: desmarcar limpia también el campo adjunto de ese
   hito.

**Descartado tras revisar, no era bug:** `compras-logistica.ts` (sugerencia de fleteros, pana,
modalidad de retiro) y `compras-gastos.ts` (total en CLP) sin hallazgos — el filtro de
`compras_gasto` por moneda es intencional, no un bug de casing. Dos hallazgos de confianza BAJA
(duplicado de evento al re-firmar la guía/acta ya cerrada; `plazo_despacho_dias` no se limpia al
cambiar de carga consolidada a única) quedaron sin tocar — el propio informe los marca como ruido
cosmético, no corrupción de datos, y no valía el riesgo de tocar más código por eso.

Se verificó explícitamente el mismo patrón del bug del reloj (un hecho real que no cierra su tarea
del catálogo) en `generar acta`, `firmar guía` y los hitos de reparto/logística/gastos — ninguno
tiene una tarea del catálogo asociada que debiera cerrarse y no cierre (la única relacionada,
`contacto_pagos` §17.3, es independiente). No es el mismo bug repetido en otro lado.

### 13.3 Verificación

`npx tsc --noEmit` limpio · `npm run test:viabilidad` → **984/984**. Migraciones 103 y 104
aplicadas contra la BD real. Sin sesión de navegador disponible — nada de esto se probó en vivo
esta sesión.

---

## 14. Sesión 14 (10-sep-2026): verificación en vivo + SKU-Obuma en escritura real

### 14.1 Verificación en vivo — todo lo de la Sesión 13, confirmado

Con sesión real del usuario abierta, se recorrieron las 5 pestañas del negocio 717 y se probaron en
vivo (no solo por script) dos de los guards agregados en la Sesión 13:
- **IDOR de `quitarPuntoEntrega`**: ya verificado por script en la Sesión 13; hoy se confirmó en
  pantalla que la Documentación/Entrega se ve correcta.
- **Guard "proveedor nuevo exige factura antes de provisionar fondos"**: clic real en "Provisión de
  fondos" → toast **"El escenario elegido incluye un proveedor nuevo — se exige la factura de
  compra registrada..."** — bloqueó exacto como se diseñó. Unisource quedó marcada `proveedor_nuevo=1`
  de verdad (consulta real a OBUMA de una sesión anterior), no fue necesario fabricar el caso.
- **Guard de cobertura en `generarActa`** (§14.2): clic en "Generar acta" con 0/2 productos listos →
  toast **"El proyecto no tiene cobertura total todavía (0/2 listos)..."** — bloqueó correcto.

Antes de esto se creó una **cotización SIMULADA** para "Plataformas satelital - GOES CS2" (pedido
explícito del usuario, con el valor del costeo original — `scripts/scratch/crear-cotizacion-simulada-plataforma-717.mjs`),
marcada sin ambigüedad ("SIMULACIÓN — pendiente cotización real") para que nadie la confunda con una
cotización de proveedor real. Eso permitió recalcular el escenario con AMBOS productos cubiertos
(antes solo tenía al sensor real de Unisource): costo total pasó de $7.648.324 a **$20.537.128**,
margen real de 81,1% a **49,1%** — las Compuertas 1 y 2, que ya estaban aprobadas con el dato
incompleto, se invalidaron solas (§10.5) y se volvieron a aprobar con el dato completo. Se creó
también el segundo SKU. Técnica usada para todo esto: **importar los módulos TypeScript reales vía
`tsx` con las env vars cargadas ANTES del import** (`scripts/scratch/elegir-escenario-717.mts` y
similares) — permite ejecutar la lógica de negocio real sin necesitar sesión de navegador ni
duplicar la lógica en SQL a mano. Reutilizable para la próxima vez que no haya sesión disponible.

### 14.2 SKU–OBUMA: de standby a escritura real (spec §7, §7.5)

El usuario compartió su otro proyecto (`D:\grupoica-intranet`, mismo grupo empresarial — **mismo
token de Obuma**, confirmado byte a byte) donde ya había resuelto esto antes. Se leyó
`app/api/obuma/productos/route.ts` de ese proyecto para sacar el payload real de
`POST productos.create.json`, y se confirmó EN VIVO (solo lectura) contra la cuenta real:

- Categoría **"Mercado Publico" = id 13255**, con **1383 productos reales** ya cargados ahí — es la
  categoría que la propia empresa ya usa para todo lo comprado para licitaciones.
- **25 subcategorías reales** debajo (INSTRUMENTOS, MAQUINARIA, FERRETERIA, TECNOLOGIA, EPP, etc.).
- El SKU sigue el patrón `"60" + subcategoría + correlativo` (ej. `6026434221`), correlativo
  arrancando en 203 — replicado tal cual, no inventado.

**Decisiones del usuario (10-sep-2026) antes de escribir el código de escritura:**
- Los productos creados desde Compras quedan **solo internos**: `producto_para_venta=0`,
  `producto_vender_en_web=0`, `producto_mostrar=0` — no son catálogo público, son lo que se compró
  para cumplir UNA licitación puntual.
- La subcategoría **se elige a mano cada vez** (selector con las 25 reales) — sin default fijo.

**Construido:**
- `app/lib/obuma.ts`: `listarCategoriasProductos`, `listarSubcategoriasProductos`,
  `listarProductosObuma`, `siguienteSkuMercadoPublico` (correlativo real, filtra por
  categoría+subcategoría en la propia consulta a Obuma — no trae los 1383 productos), y
  `crearProductoObuma` (la escritura real, `POST productos.create.json`).
- **Migración 105**: `compras_sku.obuma_codigo_comercial` — el código comercial que genera Obuma
  ("6026427204") es DISTINTO del `sku_propio` legible interno; no se pisan.
- `crearSku()` (compras-aprobaciones.ts) acepta `crearEnObuma`/`obumaSubcategoriaId`: si viene,
  usa el costo del **escenario YA elegido** para ESE producto puntual (nunca un costo aparte — mismo
  criterio que `calcularMargenPrevisto`), genera el SKU correlativo, crea el producto en Obuma de
  verdad, y guarda `obuma_producto_id`/`obuma_codigo_comercial` — el usuario deja de tipear el ID a
  mano para este camino.
- `GET /api/compras/obuma-subcategorias` (nuevo, transversal) + formulario de SKU en
  `AprobacionesCompraCard.tsx`: checkbox "Crear también en Obuma" + selector de subcategoría: si se
  marca, el campo manual de "ID producto en OBUMA" se oculta (lo llena Obuma solo).

**Verificación:** `npx tsc --noEmit` limpio · `npm run test:viabilidad` → **984/984**. Migración 105
aplicada contra la BD real. `GET /api/compras/obuma-subcategorias` probado en vivo (con sesión real):
devuelve las 25 subcategorías reales. **La escritura real (`crearProductoObuma`, crear un producto
de verdad en Obuma) NO se probó** — se le preguntó al usuario si quería que se disparara una prueba
ahora mismo (borrar y re-crear el SKU del sensor con la opción Obuma) y prefirió probarlo él mismo
desde su sesión cuando quiera. No hay endpoint de borrado visto en `grupoica-intranet`, así que un
producto creado por error no es trivial de deshacer — correcto no arriesgarlo sin que lo dispare él.

### 14.3 Cómo probarlo (para el usuario)

1. Entrar a "Aprobación y SKU" de cualquier negocio con la Compuerta 1 ya aprobada.
2. En la fila de un producto SIN SKU todavía, "Crear SKU".
3. Llenar SKU propio/marca/modelo como siempre, marcar **"Crear también en Obuma"**, elegir la
   subcategoría real que corresponda, Guardar.
4. Si todo sale bien: toast "SKU creado — también se creó el producto real en Obuma", y el bloque
   del SKU muestra "Creado en Obuma — código NNNNNNNNNN". Se puede confirmar entrando a Obuma
   directamente y buscando ese código.
5. Si algo sale mal (error de Obuma, subcategoría inválida, etc.), el SKU local NO se crea tampoco
   (todo o nada) — el error queda en el toast.

## 15. Sesión 15 (10-sep-2026): bugs reales de la Sesión 14 + Orden de Compra real + permisos finos

### 15.1 Bugs reales encontrados probando en vivo contra la cuenta de Obuma

- **Colisión de SKU**: los filtros de categoría/subcategoría de `productos.list.json` NO filtran
  nada del lado de Obuma (se confirmó pidiendo el mismo filtro dos veces con resultados distintos).
  Fix: `catalogoObumaCompleto()` trae el catálogo completo paginado (1383 productos, caché 60s) y
  filtra del lado del cliente — usado tanto por `siguienteSkuMercadoPublico` como por la búsqueda de
  duplicados nueva (abajo).
- **"Obuma no devolvió el ID del producto creado"**: la respuesta real embebe el ID como texto en
  `result.result_detail` ("producto creado. producto_id:1118883"), no en un campo JSON predecible —
  mismo patrón después confirmado para `comprasOc.create.json` y `proveedores.create.json`. Fix con
  regex de respaldo + lectura de verificación post-creación (falla si el código confirmado no
  coincide con lo pedido).
- **Moneda mal detectada en un PDF real** (USD leído como CLP): el motor OCR simplemente no
  transcribió bien esa sección de ESE PDF puntual — se agregó un fallback determinista por regex
  (`monedaDelTexto`) y se corrigió el registro a mano con el PDF real + tipo de cambio del día.
- **Obuma no "sabía" que yo había borrado un producto ahí directo**: se agregó botón "Verificar en
  Obuma" (`verificarVinculoObuma`) — autoservicio, no intervención puntual del asistente cada vez.
- **`producto_id` en `comprasOc.listItems.json` no filtra nada** ("Ver proveedor histórico" traía
  proveedores sin relación) — el parámetro real que sí filtra es `producto`.
- **`plazo_entrega_dias` nunca se poblaba**, dejando el escenario "Más rápido" indistinguible de los
  demás — se agregó `parsearDiasDeTexto` (extrae días de texto libre tipo "30 días hábiles").
- **"Unknown column 'NaN' in field list"** — el bug grande de la sesión. `Number("6.745.621")` (formato
  chileno, puntos de miles) da `NaN`, y mysql2 escribe `NaN` como literal SIN COMILLAS en el SQL, que
  MySQL interpreta como nombre de columna. Fix: `app/lib/numeros.ts` (`parsearMontoCL`, nunca
  devuelve NaN) aplicado en el punto de origen (`cotizaciones/route.ts`) + guardas
  `Number.isFinite()` en cada escritura a BD que toca plata, más dos instancias ya existentes en el
  checklist de hitos de `RepartoAdminCard.tsx` que tenían el mismo bug.

### 15.2 Rediseño del formulario de SKU + búsqueda de duplicados en vivo

Pedido del usuario: "si lo estamos creando ahora [en Obuma] ¿para qué me pide el sku propio? Licitank
y Obuma son la misma empresa, solo necesitamos el código de Obuma." Y: "si pongo martillo, dime si ya
tenemos martillos en Obuma para no duplicar."

- `buscarProductosObumaPorNombre()` — búsqueda en vivo (client-side sobre el catálogo cacheado,
  normalizada por acento/mayúsculas) mientras se escribe el nombre del producto, con botón "Usar
  este" para reutilizar un producto ya existente en vez de crear uno nuevo.
- `crearSku()`: `skuPropioFinal = crearEnObuma && obumaCodigoComercial ? obumaCodigoComercial :
  datos.skuPropio` — el SKU propio deja de ser obligatorio cuando se crea en Obuma; el código real de
  Obuma pasa a ser el único identificador.

### 15.3 Orden de Compra real contra Obuma (spec §11.1, escritura real)

Pedido explícito: "las órdenes de compra son por proveedor" (una OC por proveedor del escenario
elegido, nunca mezcladas) y "puede incluir el flete o no" (línea opcional, no un campo especial).

- `app/lib/obuma.ts`: sección OC nueva — `listarFormasPago()` (filtra `usar_en_compras=1`),
  `crearOrdenCompraObuma()` (arma `docs:[{...}]`, calcula 19% IVA sobre el neto, verifica la OC
  creada leyéndola de vuelta). Matemática confirmada contra un PDF real de OC de Obuma que compartió
  el usuario (Neto → ×19% IVA → Total; flete como línea, no como campo aparte).
  `buscarCentroCostoPorLicitacion()` — el código de licitación viene embebido literalmente en el
  nombre del centro de costo Obuma cuando ya existe un Proyecto para esa licitación (ej. "PROY-58 -
  MUNICIPALIDAD DE CALAMA 2385-19-LE25"); si no hay match, **no se inventa uno** — queda como aviso.
- **Proveedor verificado en Obuma, NUNCA automático**: el usuario corrigió un diseño anterior de
  auto-creación silenciosa ("no tiene que crear al proveedor automático") — quedó como verificar por
  RUT → si no existe, botón explícito → modal con TODOS los campos documentados de la API real de
  Obuma (RUT, razón social, nombre fantasía, contacto, giro, dirección/comuna/región/país,
  teléfono/celular/email, sitio web, cuenta contable, observación, es supermercado, es factoring) →
  clic explícito del usuario crea. Deliberadamente sin Tipo proveedor/Centro de costo/Forma de
  pago/Banco/Tags — no hay nombre de campo de API confirmado para esos, y no se inventan.
  `crearOrdenCompraParaProveedor()` **lanza error** (no auto-crea) si el proveedor no está verificado.
- Migración 106: tabla `compras_orden_compra_obuma` (una fila por negocio+proveedor,
  `UNIQUE(negocio_id, proveedor_id)`), aplicada contra la BD real.
- Nuevas rutas: `GET/POST /api/compras/[negocioId]/orden-compra-obuma` (listar proveedores del
  escenario + crear la OC), `GET/POST .../orden-compra-obuma/proveedor` (verificar/crear proveedor),
  `GET /api/compras/obuma-formas-pago` (transversal).
- `RepartoAdminCard.tsx`: sección "Órdenes de compra (Obuma)" — una tarjeta por proveedor con sus
  ítems, estado en Obuma, selector de forma de pago, checkbox de flete, tipo fijo "Nacional ·
  Inventario" (confirmado contra pantallazos reales del flujo de Obuma — `oc_concepto_gasto` son 3
  categorías fijas en botones, no un catálogo), centro de costo (o aviso si no hay match), checkbox
  de confirmación y botón "Crear en Obuma".

Revisión completa de la API de Obuma pedida por el usuario: confirmado que `/proyectos.list.json`
solo existe en v2.0 (no disponible, requiere header `access-url`); `/comprasPagos.list.json` y
`/comprasDte.list.json` son de solo lectura (sin endpoint de creación) — confirma que los hitos "Pago
registrado" y "Factura de compra registrada" del checklist correctamente siguen siendo manuales.

### 15.4 Permisos finos: "solo Asesor y super usuario ven TODO el módulo" (10-sep-2026)

Pedido: "el módulo de compra solo lo puede visualizar asesor y super usuario" → aclarado: "antes se
podía ver por todos los admin, ahora solo el perfil de Asesor... y yo el super user" → confirmado
después que Asesor debe ver TODO lo cargado (no una vista acotada).

- `app/lib/api-auth.ts`: nuevo permiso `compras_todo` — el ÚNICO de todo el catálogo que NO se
  auto-otorga por `rol==='admin'` (`permisosDeUsuario` lo sobreescribe con el dato real incluso para
  admin). Se otorgó a mano (`scripts/scratch/otorgar-compras-todo.mts`, preservando el resto de cada
  ficha) a Alexis Tobar (id=1, dueño del proyecto) y Asesor (id=7) — ninguno de los dos tenía antes
  ningún permiso de compras guardado.
- **Bug encontrado durante la propia implementación**: fijar solo `compras_todo` no bastaba — las
  puertas del módulo (`puedeOperarCompras`, `puedeVerCompras`, `esJefatura`, y ~10 rutas más con
  variantes locales `esJefeDeVentas`/`puedeVerProveedores`) seguían leyendo `compras`,
  `aprobar_comercial`, `compras_administracion` y `compras_bodega` vía `permisosDeUsuario`, que SIGUE
  auto-otorgando esos cuatro flags a cualquier admin — cualquier admin (Carolina incluida) habría
  seguido entrando igual por esa puerta trasera. Fix real: nueva `permisosCrudosDeUsuario` (exportada
  desde api-auth.ts) que lee los permisos guardados de verdad, ignorando el rol — usada en TODAS las
  puertas del módulo (backend: ~13 archivos de rutas bajo `app/api/compras/**`; frontend: los 4
  `esAdmin`/`isAdmin` de `app/compras/**/page.tsx` y `ComprasSection.tsx`, más el link del sidebar en
  `AppLayout.tsx`).

**Verificación**: `npx tsc --noEmit` limpio. `scripts/scratch/verificar-compras-todo.mts` simula
`permisosDeUsuario`/`puedeOperarCompras`/`puedeVerCompras` contra los 3 usuarios reales: Alexis
(id=1) y Asesor (id=7) → `true`/`true`; Carolina González (id=12, admin sin `compras_todo`) →
`false`/`false`. Un encargado no-admin no cambia de comportamiento: `permisosCrudosDeUsuario` y
`permisosDeUsuario` ya eran idénticos para `rol!=='admin'` antes de este cambio (se verificó
leyendo el código, no hacía falta un usuario de prueba nuevo).

---

## 16. Sesión 16 (11-sep-2026): el correo del acta, el Resumen Ejecutivo sin teléfono/correo, y control de gasto

Tres pedidos del usuario en la misma sesión, cada uno auditado contra la spec real (documento
completo de 22 secciones, releído desde `.docx` con `mammoth` en esta sesión — confirmado que el
resumen que el usuario tenía de otra IA era fiel en contenido pero obsoleto en enfoque: recomendaba
"empezar por el modelo de datos" como si el módulo no existiera, cuando ya estaba construido en un
~90-95% a lo largo de las Sesiones 1-15).

### 16.1 El correo de "Datos del Contacto" viene como IMAGEN, no como texto

La Sesión 12 dejó `parseContactoLicitacion` sin verificar contra HTML real. Esta sesión sí tuvo
acceso a un acta real (`1355402-5-LE26`, vía el Browser pane) y confirmó por qué el teléfono
llegaba y el correo no: MP sirve el campo E-Mail como `<img src="Tools/ImgOfuscar.aspx?qs=...">` —
anti-scraping, no un bug de parseo de tabla. El teléfono sí es texto plano.

**Fix**: `leerEmailOfuscado()` (`app/lib/acta-adjudicacion.ts`) descarga esa imagen (mismas cookies
de sesión que ya abren el acta) y la lee con Tesseract LOCAL forzando el modelo **'eng'** —
verificado contra el archivo JPEG real: el modelo 'spa' confunde la "@" con una "G"
(`moyanoGloprado.cl`), el modelo 'eng' la lee bien. Se agregó parámetro de idioma opcional a
`ocrImagenLocalTesseract()` (`tesseract-ocr.ts`, default 'spa' sin tocar el resto de los llamadores).
MP a veces concatena un formulario de postback justo después de los bytes del JPEG en la misma
respuesta HTTP — se corta en el marcador de fin de JPEG (FF D9) antes de pasarlo a Tesseract.

Para licitaciones ya leídas antes de este fix (como la de prueba), hace falta apretar **"Releer"**
en "Resultado" para que el OCR corra de nuevo.

### 16.2 El teléfono/correo no llegaban al Resumen Ejecutivo aunque estuvieran en la base

Dos bugs reales, distintos entre sí:

1. **UI**: la tarjeta "Contraparte" del Resumen Ejecutivo (`ComprasChrome.tsx`) solo pintaba el
   cargo — nunca `usuarioTelefono`/`usuarioEmail`, aunque esos 2 campos existen desde la Sesión 12.
   El tipo del frontend (`ComprasContext.tsx::ResumenCompras`) tampoco los declaraba. Fix: se
   agregaron a ambos, y la tarjeta ahora muestra cargo + teléfono + correo.
2. **Lectura congelada, nunca se completaba**: `construirResumenEjecutivoCompras` solo iba a buscar
   `obtenerContactosCliente` (que sí lee el acta) cuando el `contactosCliente` congelado venía
   **completamente null**. Como el paquete YA traía organismo/nombre desde la API de MP al
   congelarse, nunca se consideraba "vacío" — así que el teléfono/correo del acta (que se leen
   DESPUÉS, casi siempre después de congelar) jamás se completaban, ni con "Volver a armar". Mismo
   patrón de bug que los 5 de la Sesión 3 ("un dato que sí existía, leído desde la foto
   equivocada"). Fix: nuevo chequeo en `compras.ts` que completa specificamente esos 2 campos desde
   `adjudicacion_cache` cuando el contacto ya existe pero le faltan.

### 16.3 Control de gasto (pedido nuevo del usuario, no numerado en la spec)

Pedido: "si tenemos un presupuesto para compras y un margen de ganancia no los podemos pasar en las
compras, y esas órdenes de compra deben ser autorizadas". Auditoría de lo que ya existía:

- El margen mínimo (20%, §10.3) YA bloqueaba (soft) sin motivo — confirmado en código.
- La OC real a Obuma YA exigía la Compuerta 1 (compra) aprobada — confirmado en código.
- **Hueco real de UX encontrado en el camino**: cuando el margen queda bajo 20%, el backend exige
  un motivo, pero la pantalla (`AprobacionesCompraCard.tsx`) NO TENÍA dónde escribirlo — el botón
  "Proponer para aprobación" no pedía nada y el servidor devolvía un error de texto sin que hubiera
  ningún campo para resolverlo. El usuario quedaba atascado. Coincide con lo que reportó ("veo cosas
  del resumen que le faltan funcionalidad").
- **Hueco real de control encontrado**: la OC de Obuma (dinero real saliendo) solo exigía la
  Compuerta 1, nunca la Compuerta 2 (margen) — dos aprobaciones independientes por diseño de la
  spec, pero nada impedía emitir plata real con el margen todavía sin aprobar.

**Construido:**
- **Presupuesto de compra**, nuevo (`calcularPresupuestoCompra` en `compras-aprobaciones.ts`):
  compara el costo real del escenario elegido contra lo costeado originalmente al ofertar (§1.3.2,
  "el costeo es presupuesto, no meta"). Mismo criterio no-bloqueante que el margen (§10.3): si se
  excede, exige motivo antes de proponerse — no impide comprar, pero no deja pasarlo en silencio.
  Se guarda en el `detalle_json` de la Compuerta 1 (`presupuestoOriginal`, `excedePresupuestoPct`,
  `motivoExcesoPresupuesto`), viaja en el evento de auditoría, y se expone en
  `GET /api/compras/[negocioId]/aprobaciones` como `presupuestoActual`.
- **Campo de motivo, ahora visible**: `BloqueCompuerta` (componente compartido de ambas compuertas)
  gana `requiereMotivo`/`motivoLabel` — cuando corresponde (margen bajo 20%, o compra sobre
  presupuesto), aparece un cuadro ámbar CON el campo de texto ANTES de que el botón de proponer se
  habilite, en vez de un error después de apretar. Mismo patrón para las dos compuertas.
- **Ambas compuertas exigidas para la OC real**: `crearOrdenCompraParaProveedor`
  (`compras-oc-obuma.ts`) ahora rechaza si la Compuerta 2 (margen) no está aprobada, no solo la 1.
  `RepartoAdminCard.tsx` avisa esto ANTES de que la persona llene el formulario completo (banner
  ámbar + botones "Crear orden de compra"/"Crear en Obuma" deshabilitados hasta que el margen esté
  aprobado), no como un error sorpresa al final.

**Deliberadamente NO tocado**: `crearSku` (creación de catálogo interno en Obuma, no es plata
saliendo) sigue exigiendo solo la Compuerta 1, tal como dice la spec §7.1 — no se le sumó el
guardarraíl de margen porque ahí no aplica el mismo riesgo.

### 16.4 Verificación

`npx tsc --noEmit` → limpio (solo el error preexistente de `.next/types/validator.ts`, artefacto de
build stale, no de este código). `npm run test:viabilidad` → **984/984**, sin regresiones (no se
agregaron tests nuevos: son cálculos derivados del mismo patrón que `calcularMargenPrevisto`, que
tampoco tiene test unitario aparte, y wiring de UI). **No probado en navegador**: sin sesión
disponible en este entorno — pendiente que el usuario confirme en pantalla el banner de presupuesto
en Compuerta 1, el campo de motivo en ambas compuertas, y el bloqueo de "Crear en Obuma" sin margen
aprobado.

### 16.5 Auditoría completa contra la spec real (22 secciones) — resultado

Se releyó el `.docx` completo (antes solo se conocía por el resumen parafraseado de otra IA) y se
cruzó contra esta bitácora. Resultado: **§1-§17 construidas** (con los bugs de arriba corregidos),
**§18 (dashboard) construida como v1 pese a que la spec la marca fuera de alcance para esta etapa**,
**§19.3 (aprendizaje) construida, §19.4 fuera de alcance confirmado**, **§20 (separación
genérico/Tecnomaq) sin construir — correcto, la spec la pide para después**. De los 9 pendientes de
§21: la mayoría resueltos o decididos explícitamente en sesiones anteriores; siguen sin calibrar los
**plazos concretos por tarea** (hoy heredan el plazo global) y la **definición fina de perfiles**
cuando existan cuentas reales de Administración/Bodega para probarlas en pantalla.

### 16.6 Archivos de esta sesión

**Modificados:** `app/lib/acta-adjudicacion.ts` (`leerEmailOfuscado`, `filaCelda`,
`parseContactoLicitacion` ahora async) · `app/lib/tesseract-ocr.ts` (parámetro `lang`) ·
`app/lib/compras.ts` (top-up de teléfono/correo del acta en `construirResumenEjecutivoCompras`) ·
`app/compras/[negocioId]/ComprasChrome.tsx` (Contraparte muestra teléfono/correo) ·
`app/compras/[negocioId]/ComprasContext.tsx` (tipo `ResumenCompras` con los 2 campos) ·
`app/lib/compras-aprobaciones.ts` (`calcularPresupuestoCompra`, `proponerAprobacionCompra` con
motivo) · `app/lib/compras-oc-obuma.ts` (exige Compuerta 2 también) ·
`app/api/compras/[negocioId]/aprobaciones/route.ts` (`presupuestoActual`, motivo para COMPRA) ·
`app/negocios/[id]/AprobacionesCompraCard.tsx` (campo de motivo visible, banner de presupuesto) ·
`app/negocios/[id]/RepartoAdminCard.tsx` (aviso y bloqueo proactivo sin margen aprobado)

### 16.6.1 Continuación: prompts nativos reemplazados + aclaración Proveedores/Fleteros

**Más `window.prompt`/`window.confirm` encontrados y arreglados** (mismo criterio que el motivo de
margen/presupuesto de §16.3), en decisiones serias que antes dependían de un diálogo nativo del
navegador sin validación de formato:
- `RelojEntregaCard.tsx`: **prórroga** (fecha + motivo, antes fecha como texto libre "YYYY-MM-DD" a
  mano) y **entrega con multa** (motivo) pasan a formularios en línea con `<input type="date">` real.
- `IncidenciasCard.tsx`: la respuesta del cliente a una Oportunidad de Mejora usaba
  `window.confirm` con semántica invertida ("Aceptar = Sí, Cancelar = No") — un clic equivocado
  registraba lo contrario de lo que el cliente dijo, sobre algo que se modifica de lo ofertado al
  Estado. Ahora son dos botones explícitos ("Cliente aprobó" / "Cliente rechazó"), con la
  constancia mínima (§9.4) en un campo real en vez de un prompt.
- `EntregaCard.tsx`: motivo de entrega parcial (§16.2), mismo cambio de prompt a campo en línea.

**Pregunta del usuario, aclarada, no un bug**: "¿por qué registrar una cotización me crea un
proveedor, y eso aparece en otro módulo (Proveedores, bajo Fleteros)?" — es comportamiento
intencional (`obtenerOCrearProveedor`, `compras-proveedores.ts`, spec §8.4 "trazabilidad del
proveedor local"): sin esto, el proveedor quedaba pegado a UNA cotización, había que retipear
correo/teléfono/cuenta bancaria cada vez, y la emisión real de OC a Obuma (Sesión 15,
§11.1) no tendría de dónde sacar el RUT/dirección/contacto del proveedor. Lo que SÍ estaba mal es
la ubicación en el menú: "Proveedores" vivía pegado a "Fleteros" en el sidebar (mismo grupo, sin
separación), dos catálogos sin relación (a quién le compramos el producto vs. a quién le pagamos el
flete) que se leían como el mismo módulo. Fix en `AppLayout.tsx`: "Proveedores" se movió junto a
"Órdenes de compra" (mismo circuito de dinero saliendo), "Fleteros" quedó separado.

**Verificación**: `npx tsc --noEmit` limpio · `npm run test:viabilidad` → 984/984.

### 16.6.2 Fleteros: no se poblaba desde OBUMA como pide §13.3

El usuario pidió releer el documento en lo que dice de flete/proveedor antes de aceptar la
explicación de arriba. Tenía razón en que faltaba algo: §13.3 es explícito —
**"Se puebla desde OBUMA, que conecta con facturas y proveedores"** — la IDENTIDAD del fletero
(razón social) debe salir de ahí, solo lo operativo (capacidad, tipo de camión, costo/km, pionetas,
zonas, nota, pana) es tabla propia de Licitank. `crearFletero` (`compras-logistica.ts`) guardaba el
RUT como un dato suelto "para cuando se resuelva la integración" y nunca lo consultaba de verdad —
el catálogo de Fleteros era 100% tipeado a mano, sin ningún enganche real con Obuma.

**Fix**: `buscarFleteroEnObuma(rut)` (nuevo, `compras-logistica.ts`) reusa `proveedorPorRut` de
`obuma.ts` (la misma función que ya usa `verificarProveedorEnObuma` para proveedores de producto,
compras-oc-obuma.ts) — mismo patrón, aplicado donde faltaba. `GET /api/logistica/fleteros?rutObuma=`
expone la búsqueda; el formulario de alta (`app/logistica/fleteros/page.tsx`) tiene ahora un botón
"Buscar en Obuma" que pre-llena la razón social y muestra contacto/dirección de referencia ANTES de
escribir nada a mano. Si el RUT no tiene facturas en Obuma (fletero contratado por primera vez, caso
real — no se bloquea), se avisa y se completa el nombre a mano como antes.

**Confirmado, no era un bug**: que registrar una cotización en el Auditor de Compras cree/enganche
un "Proveedor" (`compras_proveedor`, distinto de `compras_fletero`) SÍ es lo que pide §8.4
("trazabilidad del proveedor local") — sin eso, el proveedor quedaba pegado a una sola cotización.
Proveedores (a quién le compramos el producto) y Fleteros (a quién le pagamos el flete) siguen
siendo dos catálogos con propósito distinto, pero ambos deben engancharse a OBUMA por RUT — antes
solo Proveedores lo hacía.

**Verificación**: `npx tsc --noEmit` limpio · `npm run test:viabilidad` → 984/984. **No probado en
vivo contra la cuenta real de Obuma** (sin sesión disponible esta sesión) — pendiente que el usuario
pruebe "Buscar en Obuma" con un RUT de fletero que sepa que ya tiene facturas ahí.

### 16.6.3 "El proveedor no va en Compras" — rediseño del picker de la cotización + bug de duplicados

El usuario mandó una captura: el selector "Elegir del catálogo…" del formulario de cotización
(`AuditorComprasCard.tsx`) mostraba "TechSat Solutions S.A" tres veces. Pedido explícito: esa
pantalla es para REGISTRAR cotizaciones, no para administrar el catálogo de proveedores — eso vive
aparte, en `/compras/proveedores`, que además debería nutrirse de la API de Obuma (todos los datos
del proveedor + si ya le hemos comprado antes).

**Bug real confirmado en la base**: `compras_proveedor` tenía 3 filas para la misma empresa (ids 7,
8, 9), con RUTs DISTINTOS entre sí (sin RUT / `11.111.111-1` / `76.543.210-8`). Causa:
`obtenerOCrearProveedor` (compras-proveedores.ts), sin RUT, comparaba `nombre_empresa` EXACTO —
"TechSat Solutions S.A" con y sin punto final nunca calzaban entre sí. Fix: normalización
(espacios colapsados, sin punto final, sin distinguir mayúsculas) antes de comparar, mismo criterio
que ya usaba la comparación de RUT. **No se fusionaron las 3 filas existentes** — como tienen RUTs
distintos de verdad, fusionarlas a ciegas podría mezclar dos empresas reales; queda para que el
usuario confirme cuál RUT es el correcto.

**Rediseño del formulario de cotización**: se sacó el selector "Elegir del catálogo…" — ahora solo
hay dos campos (nombre + RUT), y el backend reconoce/reusa el proveedor que ya exista por RUT sin
necesidad de un picker. El link "Agregarlo al catálogo" también se sacó (ya no tiene sentido sin el
picker) — el texto de ayuda apunta a `/compras/proveedores` para completar correo/teléfono/cuenta
bancaria después.

**Aviso de histórico, agregado** (parte de lo pedido: "el sistema nos tiene que avisar, ojo, ya le
compramos esto a tal proveedor"): al salir del campo RUT, `historicoProveedorPorRut()`
(`compras-aprendizaje.ts`, nuevo) consulta Obuma por ese RUT y, si tiene compras registradas,
muestra un aviso ámbar con la razón social real y el folio/fecha de la última OC. **Limitación
técnica explicada, no ocultada**: el aviso es a nivel de PROVEEDOR (¿ya le compramos algo, alguna
vez?), no de PRODUCTO exacto — el aviso "ya compramos ESTE producto" (§19.3,
`sugerenciaProveedorHistorico`) necesita un SKU de Obuma homologado, que a esta altura del flujo
(recién cotizando, antes de aprobar la compra §7.1) todavía no existe. No se inventa esa respuesta.

**Verificación**: `npx tsc --noEmit` limpio · `npm run test:viabilidad` → 984/984. Confirmado contra
la base real (`node --env-file=.env.local`) que las 3 filas de TechSat existen tal como se reportó.
**No probado en vivo el formulario nuevo ni el aviso de histórico** — falta que el usuario registre
una cotización con un RUT que sepa que tiene compras en Obuma, y confirme qué RUT de TechSat es el
correcto para poder limpiar las 2 filas sobrantes.

### 16.6.4 Bug real en los 4 escenarios: el cumplimiento técnico no pesaba en el ranking

El usuario mandó una captura de los 4 escenarios del negocio 717: una cotización de TechSat
Solutions ($6.745.621/un, CUMPLE) para "Plataformas satelital - GOES CS2" no aparecía en NINGÚN
escenario, pese a ser más barata que AeroSpace y cumplir íntegro.

Causa confirmada contra la base real: para ese producto había 3 cotizaciones — Satellite Systems
($5.950.000/un, **INFERIOR_NEGOCIABLE** — le falta algo) · TechSat ($6.745.621/un, **CUMPLE**) ·
AeroSpace ($7.890.000/un, CUMPLE, 29 días). `armar()` (compras-auditor.ts, dentro de
`calcularEscenarios`) ordenaba candidatos SOLO por precio o plazo, sin mirar `cumple` — la oferta de
Satellite, más barata pero con una brecha técnica sin cerrar, le ganaba a TechSat en "Mínimo precio"
por precio puro. TechSat nunca ganaba ningún escenario: ni el más rápido (AeroSpace, 1 día menos),
ni el más barato (Satellite gana por precio aunque no cumpla íntegro), ni mínimos viajes/equilibrado
(mismo motivo).

Spec §8.8.1 ("ningún proveedor se excluye del ranking por incumplimiento técnico") dice que no se
EXCLUYE — no dice que un candidato con brecha deba preferirse sobre uno que cumple íntegro cuando
ambos están disponibles. **Fix**: nueva `tierCumple()` — CUMPLE/MEJORA (tier 0) antes que
INFERIOR_NEGOCIABLE (tier 1) antes que INFERIOR_INSALVABLE (tier 2); los 4 `elegir()` (más rápido,
mínimo precio, mínimos viajes, equilibrado) ordenan PRIMERO por tier y recién dentro del mismo tier
aplican su criterio propio. Un candidato con brecha sigue ganando si es el ÚNICO que cubre ese
producto — ahí no se excluye nada, sigue firme la regla de la spec.

**Verificado contra la base real** (`calcularEscenarios(717)`, importado en vivo): TechSat ahora
gana Mínimo precio, Mínimos viajes y Equilibrado (total pasó de $31.480.360 a $34.662.844 en esos
tres — más caro en plata, pero técnicamente correcto: ya no compara un CUMPLE contra un
INFERIOR_NEGOCIABLE como si fueran lo mismo). Sigue sin ganar "Más rápido", correctamente: ahí
compite contra AeroSpace, que también CUMPLE y es 1 día más rápido — comparación justa entre pares
del mismo nivel.

**Pendiente, sin resolver todavía**: el usuario también pidió poder "armar un escenario a mano y
que el sistema calcule los otros automáticos" — un modo de selección manual por producto, además de
los 4 automáticos. No se construyó esta sesión (alcance propio, no una corrección de bug) — se le
preguntó si sigue queriéndolo ahora que el bug de arriba está corregido (puede que resolviera lo que
esperaba ver).

**Verificación**: `npx tsc --noEmit` limpio · `npm run test:viabilidad` → 984/984.

### 16.6.5 El documento se lee ANTES de guardar, no en silencio al guardar

Pedido explícito del usuario, con una captura del formulario vacío: "esos datos los puede armar
con la cotización que se sube". La extracción (§8.2) ya existía
(`extraerDatosCotizacionDeDocumento`, compras-cotizacion-ocr.ts) pero corría dentro de
`POST /cotizaciones`, en silencio, recién al apretar "Guardar" — el encargado nunca veía qué se
había leído hasta que la cotización ya estaba creada, así que en la práctica igual tipeaba todo a
mano por las dudas.

**Fix**: nuevo `POST /api/compras/[negocioId]/cotizaciones/extraer` (sube el archivo a R2 + corre
la misma extracción, sin crear ninguna cotización) — se dispara apenas se elige el archivo en
`AuditorComprasCard.tsx` (`leerArchivo`), autocompleta proveedor/RUT/precio/moneda/plazo (nunca pisa
lo ya tipeado, mismo criterio de siempre) y muestra un aviso de qué se leyó, para revisar/corregir
ANTES de guardar. Al confirmar, si el archivo ya se leyó, se manda por JSON reusando esa URL —no se
vuelve a subir el documento ni se paga el OCR dos veces; si la lectura falló, cae al camino viejo
(multipart, el backend reintenta solo).

**Verificación**: `npx tsc --noEmit` limpio · `npm run test:viabilidad` → 984/984. **No probado en
vivo** (sin sesión de navegador esta sesión, y la extracción real necesita GLM-OCR contra un
documento real) — falta que el usuario suba una cotización real y confirme que el formulario se
autocompleta como se espera.

### 16.6.6 Dos bugs reales de dinero, encontrados con datos del negocio 717

El usuario reportó dos cosas juntas, con números reales en la mano: "en la aprobación no se
actualiza cuando hago cambios" y "el presupuesto está con IVA pero nosotros trabajamos todo en
neto". Las dos eran ciertas.

**1. Una compuerta aprobada podía quedar con el escenario VIEJO.** `resolverAprobacion`
(compras-aprobaciones.ts) solo comprobaba que el estado fuera `PENDIENTE` — nunca comparaba el
`detalle_json` (snapshot congelado al proponer) contra el estado actual. Y `invalidarAprobacionesCompras`
(compras.ts, §10.5) cambia el estado a PENDIENTE cuando algo cambia, pero NUNCA toca ese
`detalle_json` congelado. Caso real, confirmado contra la base: la Compuerta 1 del negocio 717
quedó "Aprobada" mostrando `MAS_RAPIDO $39.240.360` (snapshot del 10-sep) cuando el escenario
elegido YA era `MINIMO_PRECIO $34.662.844` (elegido el 11-sep a las 18:50) — se aprobó 4 minutos
después, sin volver a proponer. El banner de presupuesto (que sí calcula en vivo) mostraba el
número correcto al lado de una compuerta "Aprobada" con el número viejo — inconsistente en la
misma pantalla.

Fix: `resolverAprobacion`, al aprobar (no al rechazar), compara el `detalle_json` guardado contra
el estado ACTUAL — el escenario elegido en vivo (tipo + costo) para COMPRA, el margen recalculado
para MARGEN — y si no coinciden, rechaza con un mensaje claro pidiendo volver a "Proponer para
aprobación". El dato ya corrupto del 717 se corrigió a mano (vuelve a PENDIENTE, con nota
explicando por qué).

**2. El presupuesto de la licitación se mostraba CON IVA, todo lo demás en NETO.** El resto del
sistema (viabilidad-ia.ts, motor-comercial.ts) ya sabe una regla: Mercado Público publica el
presupuesto CON IVA por defecto (salvo régimen Ley FORA/exento), y siempre se normaliza a neto
(÷1,19) antes de compararlo con nada. `construirResumenEjecutivoCompras` (compras.ts) no aplicaba
esa regla: tomaba `licitaciones_cache.monto` crudo (BRUTO, tal como lo publica MP) como
"Presupuesto del proyecto", y si le faltaba, el respaldo prefería `.bruto` sobre `.neto` del informe
de viabilidad — al revés del criterio correcto. Confirmado contra la base real (1114-12-LE26):
`licitaciones_cache.monto = $49.000.000` (bruto) mientras el informe de viabilidad —que sí leyó las
bases— ya tenía `neto: $41.176.470,58` calculado correctamente. Con el bug, el Resumen Ejecutivo de
Compras iba a mostrar $49.000.000 al lado de `montoCosteado` ($19.546.750, neto) y `montoNuestro`
($40.378.376, neto) — una comparación de peras con manzanas.

Fix: el informe de viabilidad pasa a ser la fuente PRIMARIA del presupuesto (ya sabe distinguir
bruto/neto/régimen porque leyó las bases reales), con el mismo criterio que `motor-comercial.ts`
(`neto` si está, si no `bruto ÷ 1,19` salvo `regimen_fora`/`con_iva:false`). `licitaciones_cache.monto`
queda como respaldo SOLO si no hay informe, convertido con el mismo supuesto por defecto del resto
del sistema. Verificado contra el 717: ahora `presupuestoProyecto = $41.176.470,58` — coincide
con lo que el usuario ya sabía que era el número correcto (bases, numeral XVI, pág. 17).

**Verificación**: `npx tsc --noEmit` limpio · `npm run test:viabilidad` → 984/984 · ambos fixes
confirmados contra la base real del negocio 717 (no solo en teoría).

### 16.6.7 El fix anterior dejó una compuerta sin forma de refrescarse

El usuario eligió un nuevo escenario ("Mínimo precio", con una cotización nueva de Tecnomaq SpA que
hizo bajar el total a $20.529.164) y mandó captura: la Compuerta 1 seguía en "Pendiente" mostrando
el snapshot viejo (`MAS_RAPIDO $39.240.360`, de la Sesión 16.6.6) — y no había ningún botón para
volver a proponerla con el dato nuevo. El fix de la 16.6.6 (bloquear aprobar sobre datos viejos)
dejó al encargado atascado: no podía aprobar (correcto, bloqueado a propósito) pero tampoco podía
corregirlo, porque "Proponer para aprobación" solo aparecía sin propuesta o con una rechazada —
nunca estando PENDIENTE, que es justo el estado al que cae una compuerta invalidada (§10.5).

**Fix, dos partes:**
1. `GET /api/compras/[negocioId]/aprobaciones` ahora manda también `escenarioElegidoActual` (tipo +
   costo EN VIVO, no el snapshot congelado) — antes la pantalla solo tenía el snapshot de la
   propuesta, sin nada con qué compararlo.
2. `AprobacionesCompraCard.tsx`: si el snapshot de la Compuerta 1 no coincide con el escenario
   elegido en vivo, se tacha el número viejo, se muestra "Vigente ahora: MINIMO_PRECIO — $X" al lado,
   y aparece un aviso rojo explícito ("esto quedó desactualizado"). El botón "Proponer para
   aprobación" (rebautizado "Actualizar propuesta" en este caso) ahora también aparece estando
   PENDIENTE, no solo sin propuesta o rechazada — sin esto, una compuerta invalidada no tenía salida.

Verificado contra la base real: `compra.detalle` (MAS_RAPIDO, $39.240.360) vs escenario elegido en
vivo (MINIMO_PRECIO, $34.662.844 en ese momento) → `desactualizada: true`, tal como debía detectarse.

**Verificación**: `npx tsc --noEmit` limpio · `npm run test:viabilidad` → 984/984.

### 16.6.8 El badge "Elegido" mentía cuando una cotización nueva cambiaba el total

El usuario preguntó por qué se le reportó "$34 millones" cuando su pantalla mostraba "Mínimo
precio $20.529.164 · Elegido". Aclaración honesta primero: este asistente no ve la pantalla del
usuario en vivo — el número de $34M venía de una consulta a la base hecha ANTES de que el usuario
agregara una cotización de Tecnomaq SpA y recalculara los escenarios en su sesión. Al volver a
consultar la base en el momento, confirmó que el "$34.662.844" seguía siendo el que estaba
GUARDADO en `compras_escenario` — el usuario nunca había vuelto a apretar "Elegir este escenario"
después de que Tecnomaq abarató el total a $20.529.164.

Ahí apareció el bug real: `escenarioElegidoTipo()` (compras-auditor.ts) solo comparaba por `tipo`
("MINIMO_PRECIO") para decidir qué tarjeta pintar como "Elegido" — nunca por costo. Como el tipo
seguía siendo el mismo, la tarjeta con el número YA RECALCULADO ($20.529.164) se pintaba como
"Elegido" aunque lo único guardado en la base fuera el monto viejo ($34.662.844). El usuario no
tenía forma de notar, mirando la pantalla, que su elección real seguía apuntando a un número que ya
no existía.

**Fix**: `escenarioElegidoTipo()` ahora devuelve también el costo GUARDADO (no solo el tipo).
`GET /api/compras/[negocioId]/escenarios` expone `elegidoCostoGuardado`. La pantalla compara ese
costo contra el recién recalculado para el mismo tipo: si coinciden, badge verde "Elegido" normal;
si no, badge ámbar "Cambió — vuelve a elegir" + una nota con el monto viejo, y el botón "Elegir este
escenario" reaparece (antes desaparecía apenas el tipo coincidía, aunque el monto hubiera cambiado)
como "Confirmar el nuevo monto".

De paso, se sacó el último `window.prompt` de este flujo: elegir un escenario que no es "Más
rápido" pedía la justificación (§8.10.4) por un diálogo nativo — ahora es un campo en la misma
tarjeta.

**Verificación**: `npx tsc --noEmit` limpio · `npm run test:viabilidad` → 984/984.

### 16.7 Qué sigue

Pedido explícito del usuario, todavía abierto: que el resto de la pantalla (no solo Aprobaciones)
sea intuitiva a prueba de errores de usuario, sin perder profesionalismo. Esta sesión cubrió el hueco más
grave (motivo sin dónde escribirse) y el control de gasto pedido; falta un recorrido del mismo tipo
sobre el resto de las pestañas (Costeo y Auditoría, Compra/Importación/Logística, Entrega y Cierre)
para el mismo estándar. Sugerido para la próxima vuelta, en el mismo orden que las pestañas del
stepper de `ComprasChrome.tsx`.

---

## 17. Sesión 17 (22-sep-2026): campos bancarios del proveedor confirmados en vivo + gastos del
proyecto sin esperar v2.0

Pedido del usuario: "dale full a Obuma" — revisar qué falta contra la spec v2.2 completa (compartió
también `GUIA_IMPLEMENTACION_MODULO_COMPRAS.md`, un prompt técnico derivado de la misma spec) y
cerrar los huecos reales de integración. La auditoría (con un agente de exploración + relectura de
esta bitácora) confirmó que **§1-§19 ya estaban construidas** — el "todo lo que falta" del pedido
inicial se redujo, tras el análisis, a dos huecos puntuales que esta bitácora ya tenía anotados sin
resolver: (1) proveedor sin datos bancarios, (2) gastos del proyecto bloqueados por no tener acceso
a v2.0.

### 17.1 Los campos bancarios del proveedor — ya no es una sospecha, está confirmado

`docs.obuma.cl/ayuda/api-integracion` (el usuario pasó el link) documenta `/proveedores.create.json`
con solo los campos básicos, igual que ya sabíamos. Pero **leyendo 100 proveedores reales**
(`proveedores.list.json`, solo lectura) aparecen en la respuesta: `proveedor_forma_pago`,
`proveedor_banco_cuenta`, `proveedor_nro_cuenta`, `proveedor_tipo_cuenta`, `proveedor_centro_costo`,
`proveedor_tags`, `rel_tipoproveedor_id` — nombres de campo reales, no documentados para `create`.

**Se probó, en vez de adivinar**: un UPDATE IDEMPOTENTE contra un proveedor real (158108, "13A SPA")
mandando esos 5 primeros campos con EXACTAMENTE los mismos valores que ya tenía. Obuma respondió
`"proveedor actualizado"` (HTTP 200) y una relectura posterior confirmó que los 5 valores quedaron
idénticos — no fue un no-op silencioso, la API los procesó de verdad. Cero riesgo (nada cambió en
producción), confirmación real.

`bancos.list.json`, `empresaBancos.list.json`, `proveedoresTipos.list.json` y
`empresaTiposProveedor.list.json` se probaron como candidatos a catálogo para `banco_cuenta`/
`rel_tipoproveedor_id` — los 4 dan 404 "Metodo no encontrado". Esos dos quedan como campo de texto
libre en el formulario (el usuario tiene que saber el ID, igual que lo ve en el desplegable del
formulario web de Obuma) — no se inventa un catálogo que no existe.

**Construido:**
- `app/lib/obuma.ts`: `DatosCrearProveedorObuma` gana `formaPago`, `centroCosto`, `bancoCuenta`,
  `nroCuenta`, `tipoCuenta`, `tipoProveedorId`, `tags` (todos opcionales). `crearProveedorObuma()`
  los manda si vienen, y la verificación post-creación ahora también compara estos 5 valores contra
  lo que Obuma guardó de verdad (antes solo confirmaba que el proveedor existía) — si alguno no
  quedó como se mandó, queda un `console.warn` explícito en vez de fallar en silencio.
- `app/api/compras/[negocioId]/orden-compra-obuma/proveedor/route.ts`: el POST pasa los 7 campos
  nuevos del body.
- `app/negocios/[id]/RepartoAdminCard.tsx`: el modal "Crear proveedor en Obuma" gana Forma de pago
  (desplegable, reusa el mismo catálogo que ya se cargaba para la OC), Centro de costo, Banco, Tipo
  de cuenta y N° de cuenta (texto libre) — `abrirModalProveedor` ahora también dispara
  `cargarFormasPago()`, que antes solo se llamaba al abrir la OC.

### 17.2 Gastos del proyecto — cruce v1-only, sin esperar el header `access-url`

Hallazgo real, no documentado por Obuma en ningún lado: `contabilidadCentrosDeCostos.list.json`
(el mismo endpoint que ya usaba `buscarCentroCostoPorLicitacion` desde el 10-sep) trae un campo que
nadie había mirado, **`rel_proyecto_id`** — el ID del Proyecto de Obuma (v2.0) al que pertenece ese
centro de costo. No hace falta leer `/proyectos.*` (sigue bloqueado sin `OBUMA_ACCESS_URL`) para
saber que dos centros de costo son del mismo Proyecto: alcanza con que compartan `rel_proyecto_id`.

**Construido**, `app/lib/obuma.ts`:
- `centrosDeCostoCompleto()` — catálogo completo cacheado (5 min; el endpoint no filtra del lado del
  servidor, verificado en vivo otra vez con `comprasOc.list.json?centro_costo=X` — mismo total con y
  sin filtro).
- `buscarCentroCostoPorLicitacion()` ahora también devuelve `relProyectoId`.
- `gastosDelProyectoPorLicitacion(codigo)` (nuevo): ubica el centro de costo de la licitación, junta
  TODOS los centros de costo que comparten su `rel_proyecto_id` (si tiene), y suma el total de todas
  las OC de `comprasOcCompleto()` cuyo `compra_oc_centro_costo` esté en ese conjunto. Sin Proyecto
  asociado, devuelve el total de un único centro de costo (mejor esfuerzo, no inventa agrupación).
- `GET /api/obuma-compras/gastos-proyecto?codigo=` (nuevo) — llama a Obuma EN VIVO, a propósito
  (distinto del resto del bloque, que solo lee lo que el cron ya cruzó): es una consulta explícita,
  no un autoload de pantalla.
- `ComprasObumaBloque.tsx`: botón "Ver gastos del proyecto en Obuma" al pie del bloque — muestra el
  total, cantidad de OC, y si hay más de un centro de costo agrupado, los nombra.

### 17.3 Verificación

Todo lo anterior se probó **contra la API real de Obuma con el token del `.env.local`**, no contra
una respuesta simulada — scripts de reconocimiento en `scripts/scratch/obuma-recon-sep22.mjs`,
`obuma-buscar-proveedor-test.mjs`, `obuma-test-update-proveedor-bancario.mjs` (solo lectura + el
único update, idempotente, documentado arriba). `npx tsc --noEmit` → limpio. `npm run
test:viabilidad` → **1025/1025**, sin regresiones (no se agregaron tests nuevos: es wiring de
formulario + una función de agregación sin lógica de negocio compleja para testear en aislado).

**No probado en el navegador** (sin sesión disponible en este entorno): falta que el usuario abra el
modal "Crear proveedor en Obuma" desde Compra/Importación/Logística → Órdenes de compra (Obuma) y
confirme que los 5 campos nuevos se ven bien, y que abra el bloque "Compras (Obuma)" de una
licitación con centro de costo armado y confirme que "Ver gastos del proyecto en Obuma" trae un
número razonable.

### 17.3.1 El resumen de gasto se movió DENTRO del módulo (mismo día, a pedido del usuario)

El usuario vio el informe de la sesión y corrigió el enfoque: "la idea es que eso esté en el módulo
de compra... no tenemos un resumen de cuánto gastamos, las OC creadas y las facturas realizadas".
El botón "Ver gastos del proyecto en Obuma" de §17.2 vivía en la ficha de la licitación
(`ComprasObumaBloque.tsx`, pestaña Resultado) — útil, pero no es "el módulo de Compras".

**Construido:** `resumenGastosCompra()` (nuevo en `compras-oc-obuma.ts`) combina DOS fuentes que ya
existían pero nunca se habían juntado en una pantalla: `compras_orden_compra_obuma` (las OC que
EMITIMOS desde Licitank, migración 106) y `obuma_compras` (todo lo que el cron cruzó, incluida
factura real con XML, migración 66/67). Las dos son lectura de base — no llaman a Obuma en cada
carga, mismo criterio que el resto de la pantalla. `GET /api/compras/[negocioId]/resumen-gastos`
(nuevo) expone esto + el `montoCosteado` que ya calculaba `obtenerAsignacion()`, para mostrar la
variación real vs. lo presupuestado.

`ResumenGastosCard.tsx` (nuevo componente) se muestra AL PRINCIPIO de la pestaña "Compra,
Importación y Logística" (antes de "Órdenes de compra (Obuma)") — 3 cifras (OC creadas, compras
cruzadas, facturas realizadas) + variación vs. costeado, y el botón de §17.2 ("Ver gastos del
Proyecto completo en Obuma", consulta EN VIVO, movido/duplicado acá) al pie.

**Verificado en vivo** contra el negocio real 655 (3143-27-LE26, Municipalidad de Lago Ranco):
"Resumen de gasto (Obuma) · $16.377.608" con OC creadas $0 (0 emitidas desde Licitank — correcto,
esta compra se cruzó por referencia, no se creó desde el sistema), Compras cruzadas $16.377.608 (2),
Facturas realizadas $16.758.410 (7 con XML), y el botón de Proyecto completo respondiendo en vivo
"$16.377.608 en 2 órdenes de compra del Proyecto completo". `npx tsc --noEmit` limpio, `npm run
test:viabilidad` 1025/1025.

**Nuevos:** `app/negocios/[id]/ResumenGastosCard.tsx`,
`app/api/compras/[negocioId]/resumen-gastos/route.ts`.
**Modificados:** `app/lib/compras-oc-obuma.ts` (`resumenGastosCompra`),
`app/compras/[negocioId]/ComprasChrome.tsx` (wiring).

### 17.3.2 Módulo "Proyectos (Obuma)" — para comparar contra nuestros negocios

Pedido explícito del usuario, mismo día: "necesito ver el tema de los proyectos... me podés crear
un módulo bajo de compras y mostrarme los proyectos para hacer una comparación". Aclarado antes de
programar: Obuma sigue sin darnos acceso a v2.0 (re-verificado con `scripts/obuma-test.mjs`, sigue
"OBUMA_ACCESS_URL no configurado"), así que no se puede mostrar el Proyecto real (nombre, ficha) —
el usuario confirmó explícitamente construir la reconstrucción v1-only en vez de esperar.

**Construido:** `listarProyectosObuma()` (nuevo, `app/lib/compras-proyectos-obuma.ts`) agrupa los
202 centros de costo reales de la cuenta por su `rel_proyecto_id` (182 de los 202 tienen uno — casi
siempre 1 centro = 1 Proyecto, salvo sub-proyectos), suma sus OC reales (`comprasOcCompleto()`,
filtrado del lado del cliente porque el filtro de servidor no funciona) y cruza el NOMBRE de cada
centro contra el código de licitación de cada negocio nuestro activo, con `mencionaCodigo()` (el
mismo matcher del cruce OC-MP ↔ Obuma — una sola definición de "esto es nuestro" en todo el
sistema). `centrosDeCostoCompleto()` pasó de función privada a export en `obuma.ts` para esto.

- `GET /api/compras/proyectos-obuma` (nuevo, permiso `compras_todo`/`compras`/`aprobar_comercial`,
  mismo criterio que `/compras/proveedores`).
- `app/compras/proyectos/page.tsx` (nueva página) — banner explicando la limitación de v1 de
  entrada (para que nadie confunda esto con el Proyecto real), 4 estadísticas (total, con negocio
  nuestro, sin negocio nuestro, gasto total), búsqueda, y un filtro clicable "solo coincidentes".
  Cada tarjeta muestra sus centros de costo, gasto total, cantidad de OC, y si calza con algo
  nuestro, un chip verde clickeable a `/compras/[negocioId]`.
- Enganchado en el sidebar (`AppLayout.tsx`) como "Proyectos (Obuma)", junto a "Proveedores".

**Verificado en vivo** contra la cuenta real: 202 "proyectos", 1 calza con un negocio nuestro
(3143-27-LE26 → `/compras/655`, el mismo caso de la sección 17.3), 201 sin match (proyectos de
Tecnomaq que no son licitaciones públicas o que no tienen negocio activo en Licitank), gasto total
agregado ~$5,19M. Un caso interesante y correcto (no un bug): un centro de costo llamado "TECNOMAQ"
solo, sin Proyecto, concentra ~2.918 OC — es el centro de costo genérico de la empresa, no uno de
proyecto. `npx tsc --noEmit` limpio, `npm run test:viabilidad` 1025/1025.

**Nuevos:** `app/lib/compras-proyectos-obuma.ts`, `app/api/compras/proyectos-obuma/route.ts`,
`app/compras/proyectos/page.tsx`.
**Modificados:** `app/lib/obuma.ts` (`centrosDeCostoCompleto` exportada), `app/components/AppLayout.tsx`.

### 17.3.3 Dos ajustes más, mismo día: el ítem estaba lejos de "Compras" y faltaba el detalle

**Ubicación en el menú.** El usuario mandó captura: "aquí quiero ver los proyectos, no sé dónde lo
metiste" — señalando el grupo PRINCIPAL (Aprobaciones/Postuladas/Compras/Ganadas-Perdidas/Entregas).
El ítem vivía en el grupo GESTIÓN, bastante más abajo, junto a "Proveedores". Se movió a PRINCIPAL,
justo debajo de "Compras" — mismo círculo de acceso (`puedeVerCompras`), solo cambió de grupo.

**Detalle de las OC.** Cada tarjeta solo mostraba el total agregado — el usuario pidió ver el
contenido real: "sí me aparecen pero no puedo ver el contenido de los proyectos". Se agregó a
`listarProyectosObuma()` la lista de OC de cada proyecto (proveedor resuelto vía
`proveedoresObumaCompleto()`, un solo mapa construido una vez — no una llamada a Obuma por OC),
ordenadas por fecha descendente, con un tope de 100 por proyecto (hay centros de costo genéricos
con miles: el de "TECNOMAQ" solo tiene 2.918 OC) para no mandar un payload gigante — el contador
real (`cantidadOc`) sigue contando TODAS, el tope es solo del detalle. Cada tarjeta ahora es
expandible (clic en "N OC · N centro(s) de costo") y muestra proveedor, RUT, folio, estado, monto
y fecha por cada orden de compra.

**Verificado en vivo** contra la cuenta real: el proyecto #30532 (el que calza con
3143-27-LE26) se expande y muestra sus 2 OC reales con proveedor y monto exactos; el centro
"TECNOMAQ" se expande y muestra "Mostrando las 100 más recientes de 2918 en total." `npx tsc
--noEmit` limpio, `npm run test:viabilidad` 1025/1025.

### 17.3.4 El despliegue en producción no tenía OBUMA_API_TOKEN — nunca se había copiado

Al probarlo en el sitio real (`licitank.cl`, VPS con docker-compose), el usuario vio "OBUMA_API_TOKEN
no configurado". Causa: el token vive en `.env.local` (desarrollo, en la notebook Windows) y nunca
se copió al `.env` del VPS — no es que se perdiera, nunca estuvo ahí. **Se agregó `OBUMA_API_TOKEN`
y `OBUMA_API_URL` a `.env.example`** (no estaban documentados) para que el próximo despliegue no
repita el olvido.

Guiado por chat mientras el usuario editaba el `.env` del VPS con `nano` a mano: un accidente de
copia/pega insertó el texto de la barra de estado de `nano` (`[ "OBUMA_API_TOKEN" not found ]` + la
fila de atajos `^G Help ^O Write Out...`) como contenido real del archivo, **13 veces repetido**,
cortando en dos un comentario. Se limpió con `sed -i '5,64d'` (borrado por rango de línea, verificado
antes de aplicar) + un `sed` puntual para la línea que quedó con basura pegada sin salto de línea al
comentario real. El token en sí ya estaba bien escrito al final del archivo desde el principio.

**Lección aparte, aprendida en el camino:** `docker compose restart` NO vuelve a leer `.env`/
`env_file` — solo reinicia el proceso con la configuración que el contenedor ya tenía cargada desde
que se creó. Hace falta `docker compose up -d <servicio>` (sin `--build`, no cambió código) para que
tome variables de entorno nuevas. Confirmado en vivo: con `restart`, `printenv OBUMA_API_TOKEN`
seguía vacío; con `up -d`, devolvió el valor real.

**Nota de seguridad:** en el chat de esta sesión quedaron varias credenciales reales de producción
en texto plano (`DB_PASSWORD`, `SMTP_PASS`, `JWT_SECRET`, varias API key) porque el usuario pegó el
`.env` completo para depurar la corrupción. Se le avisó explícitamente; rotar esas credenciales
cuando tenga tiempo queda a su criterio, no es urgente pero tampoco hay que olvidarlo.

### 17.3.5 Orden de la lista: fecha primero, número de referencia como respaldo

Pedido explícito del usuario: "acomódamelos por fecha, la última creada de los primeros, o por
PROY-número (a veces tiene otro) pero como referencia el más alto primero si no tiene fecha".

`listarProyectosObuma()` ahora calcula por proyecto: `ultimaFecha` (la fecha de su OC más reciente,
ya se calculaba para el detalle, solo se expuso) y `proyNumeroReferencia` (el número que sigue a
"PROY" en el nombre del centro de costo, con una regex tolerante — varios centros usan "PR-" en vez
de "PROY-", ej. "PR-179 Equipamiento agropecuario"; cuando no hay ningún patrón reconocible, cae al
`rel_proyecto_id` de Obuma, que también es más alto = más reciente por ser correlativo). Orden:
fecha descendente primero; los que no tienen ninguna OC (sin fecha) van al final, ordenados por ese
número de referencia, el más alto primero. Cada tarjeta muestra ahora una línea con el criterio
usado ("Última OC: 2026-09-22" o "Sin OC — orden por referencia PROY-31015").

**Verificado en vivo**: el orden real arrancó en "Última OC: 2026-09-22" y bajó correctamente
(17-sep, 16-sep, 16-sep...); los proyectos sin ninguna OC (probado con `fetch` directo a la API)
quedaron al final ordenados 31015 → 30913 → 30799 → ... descendente, incluidos los que usan "PR-"
en vez de "PROY-" en el nombre (cayeron bien al respaldo del `rel_proyecto_id`). `npx tsc --noEmit`
limpio, `npm run test:viabilidad` 1025/1025.

### 17.3.6 Ítems de cada OC — qué se compró

Pedido explícito, mismo día: "necesito poder ver las OC de estas compras" → aclarado con el
usuario: quería el DETALLE de cada orden de compra (qué productos, cantidad, precio), no más datos
de cabecera (eso ya se mostraba: proveedor, RUT, folio, estado, monto, fecha).

Se reusó `itemsCompraOcObuma(folio)` (`compras-proveedores.ts`) tal cual — es la misma función que
ya usa `/compras/proveedores` para esto mismo, primero mira la tabla local sincronizada
(`compras_historial_oc_item`) y si no está ahí recién pide a Obuma en vivo
(`comprasOc.listItems.json`). Nuevo `GET /api/compras/proyectos-obuma/items?folio=`. Cada fila de OC
en `/compras/proyectos` es ahora clickeable (deshabilitada si no tiene folio) y despliega sus ítems
inline — mismo patrón `toggleOc`/`itemsPorFolio` que ya usaba `/compras/proveedores`, sin pedir
nada hasta que la persona hace clic en ESA fila puntual.

**Verificado en vivo**: folio 3942 (QATAR SHOP) mostró "BATERIA CICLO PROFUNDO 12V 100AH PANEL
SOLAR · 28 × $74.988 = $2.099.671" — el ítem real. `npx tsc --noEmit` limpio, `npm run
test:viabilidad` 1025/1025.

### 17.3.7 Datos REALES de Obuma — leídos a mano de la web, no de la API

Cambio de fondo en la sesión: el usuario pegó el contenido completo de una ficha real de Obuma
("Ficha Proyecto #188") — la vio porque tiene sesión WEB logueada en Obuma (distinto de la API,
que sigue bloqueada en v2.0). Esa ficha reveló el campo real que Obuma usa para vincular un
Proyecto con la licitación: **"Referencia proyecto"** — en el caso real, literalmente
`1355402-5-LE26`. Mucho más confiable que el método de hoy (buscar el código adentro del nombre de
un centro de costo, texto libre).

Se le preguntó al usuario si contratar v2.0 (no está habilitado, "hay que ver otra opción") o
explorar leer la web con su sesión — confirmó explícitamente la segunda vía, con una condición dura
respetada: **nunca se le pidió ni se escribió su contraseña de Obuma** — se le pidió que iniciara
sesión él mismo en el panel de navegador (mismo patrón que se usó para Licitank en esta misma
sesión), exactamente como dice la regla de credenciales.

**Ubicación real de la web de Obuma** (nueva, no documentada antes): `https://app.obuma.cl/obuma2.0/`
— el login es `OBUMA Solutions - Login` con RUT + Clave. `https://app.obuma.cl/` solo es una
redirección genérica a obuma.cl, no sirve. Listado de Proyectos: `home.php?page=mod-proyectos/listar`.

**Extracción (una sola vez, no automatizada todavía):** con la sesión del usuario ya logueada, se
subió el selector de "por página" a 200 (vía JS, cambiando el `<select id="_pagi_cuantos">` y
disparando `change`) para traer los 189 proyectos en una sola página, y se extrajo la tabla completa
directo del DOM (`document.querySelectorAll('table')[0].rows`, celda por celda — no parseo de texto
plano, que se demostró poco confiable porque algunas filas no tienen "Referencia" y corren los
campos). Columnas reales: FOLIO, FECHA INGRESO, FECHA INICIO, PROYECTO, REFERENCIA, CLIENTE,
PRESUPUESTO, COSTO, PRECIO (Neto), FACTURADO (Neto), ESTADO.

**Guardado**: `docs/migration-122-obuma-proyectos-reales.sql` → tabla `obuma_proyectos_reales`
(folio como PK, todo el resto de columnas + `capturado_at`). Aplicada con
`scripts/aplicar-migration-122.mjs`. Cargada con `scripts/scratch/importar-obuma-proyectos-reales.mjs`
desde `scripts/scratch/obuma-proyectos-reales-22sep2026.json` (el snapshot). **189/189 cargados,
152 con campo `referencia` no vacío.**

**Cruce real**: `listarProyectosRealesObuma()` (nuevo en `compras-proyectos-obuma.ts`) lee esa tabla
y cruza `referencia` contra `negocios.licitacion_codigo` con `mencionaCodigo()` (mismo matcher de
siempre). Resultado real contra la cuenta: **11 de 189 proyectos calzan con un negocio activo
nuestro** — la mayoría de los 189 son de años/proyectos anteriores o sin negocio vigente en Licitank
hoy, dato correcto, no un bug del cruce.

**UI**: nuevo bloque verde "Proyectos reales de Obuma" arriba de todo en `/compras/proyectos`
(antes de la reconstrucción v1, que ahora queda claramente rotulada como el método aproximado,
secundario). Muestra folio, nombre, cliente, referencia, precio/costo/estado reales, y un chip
verde clickeable a `/compras/[negocioId]` cuando hay match. Botón "Ver los 189 completos" / "Ver
solo confirmados (11)" para no abrumar con los sin match. Búsqueda propia.

**Importante — esto NO es en vivo.** Es una foto tomada a mano el 22-sep-2026. Si se necesita
actualizar, hay que repetir el proceso manual (no hay automatización ni cron construido hoy —
guardar credenciales de Obuma y automatizar el login/scraping es una decisión aparte, más grande,
que no se tomó en esta sesión).

**Verificado en vivo**: `npx tsc --noEmit` limpio, `npm run test:viabilidad` 1025/1025, probado en
el navegador (11/189 confirmados, chip a `/compras/655` funcionando, toggle "ver todos" funcionando).

**Nuevos:** `docs/migration-122-obuma-proyectos-reales.sql`, `scripts/aplicar-migration-122.mjs`,
`scripts/scratch/importar-obuma-proyectos-reales.mjs`, `scripts/scratch/obuma-proyectos-reales-22sep2026.json`.
**Modificados:** `app/lib/compras-proyectos-obuma.ts` (`listarProyectosRealesObuma`),
`app/api/compras/proyectos-obuma/route.ts`, `app/compras/proyectos/page.tsx`.

### 17.3.8 El snapshot manual se volvió automático (mismo día)

El usuario preguntó por qué tenía que iniciar sesión cada vez que quería los datos al día, y
decidió automatizarlo: "ok, guardá la clave" — con la advertencia hecha explícita de que es su
login personal de Obuma (RUT + Clave de la web), mucho más sensible que el `OBUMA_API_TOKEN` (ese
es de solo lectura por API; esto es acceso completo al ERP). **Nunca se recibió la clave por
chat para escribirla** — el usuario intentó pegarla dos veces y en ambas se le pidió que la
escribiera directo en el `.env` del servidor (mismo patrón que `OBUMA_API_TOKEN`); en la segunda
la pegó igual, así que quedó registrada en el historial de esta conversación — se le avisó y se
recomendó rotarla en Obuma cuando pueda, sin urgencia.

**Construido** (reusa la infraestructura de Puppeteer que YA existe para descargar documentos de
Mercado Público — `app/lib/mp-descarga-browser.ts::resolverChromium()`, mismo criterio de detectar
Chrome/Chromium local o el binario `@sparticuz/chromium` serverless, no hay nada nuevo que instalar):

- `app/lib/obuma-proyectos-scraper.ts` (nuevo) — `scrapearProyectosObuma()`: abre un Chrome headless
  real, hace login en `https://app.obuma.cl/obuma2.0/` con `OBUMA_WEB_RUT`/`OBUMA_WEB_CLAVE`
  (selectores confirmados en vivo: `#idLogin`, `#idPassword`, `button[type=submit]`, formulario
  postea a `usuario-login.php`), confirma que quedó logueado (busca el link a `mod-proyectos` en el
  menú — si no aparece, tira error en vez de seguir a ciegas), va a
  `home.php?page=mod-proyectos/listar`, sube el `<select id="_pagi_cuantos">` a 500 y lee la tabla
  completa celda por celda del DOM (mismo método que la extracción manual de §17.3.7, ahora
  automatizado). `guardarProyectosObuma()` hace el mismo upsert de antes.
  `actualizarProyectosObuma()` encadena las dos.
- `GET/POST /api/cron/obuma-proyectos` (nuevo) — mismo esqueleto de auth que los demás cron
  (`x-vercel-cron`/`CRON_SECRET`). `scheduler/scheduler.mjs`: `jobObumaProyectos`, agendado
  **`50 7 * * *`** (una vez al día, justo después de compras Obuma) — pedido explícito del usuario,
  con el razonamiento de que abrir una sesión real contra Obuma no debería hacerse más seguido.
- `POST /api/compras/proyectos-obuma` (nuevo, mismo archivo del GET) — botón manual, restringido a
  `compras_todo` (más estricto que el resto del módulo, por tratarse de un login real). Botón verde
  "Actualizar desde Obuma" en la pantalla, junto al bloque de datos reales.

**Verificado en vivo, dos veces**: una vez por script directo (`scripts/scratch/probar-scraper-proyectos.mjs`,
48,6s, `{ guardados: 189 }`) y otra vez apretando el botón real en `/compras/proyectos` — la
`capturado_at` de la base avanzó las dos veces (`20:25:14` → `20:26:39`), confirmando que cada
corrida es una sesión real nueva contra Obuma, no un caché. `npx tsc --noEmit` limpio, `npm run
test:viabilidad` 1025/1025.

**`.env.example` actualizado** con `OBUMA_WEB_RUT`/`OBUMA_WEB_CLAVE` documentadas (mismo criterio
que se hizo con `OBUMA_API_TOKEN` en §17.3.4, para que el próximo despliegue no se olvide).

**Nuevos:** `app/lib/obuma-proyectos-scraper.ts`, `app/api/cron/obuma-proyectos/route.ts`,
`scripts/scratch/probar-scraper-proyectos.mjs`.
**Modificados:** `scheduler/scheduler.mjs` (`jobObumaProyectos`, cron `50 7 * * *`),
`app/api/compras/proyectos-obuma/route.ts` (POST), `app/compras/proyectos/page.tsx` (botón),
`.env.example`.

**Pendiente real:** confirmar que `OBUMA_WEB_RUT`/`OBUMA_WEB_CLAVE` también quedaron en el `.env`
del VPS (el usuario dijo que sí, "los puse en el env.local" fue lo confirmado explícitamente por
chat — el `.env` del servidor de producción es el que hace falta para que el cron diario funcione
ahí, no alcanza con tenerlo solo en la notebook de desarrollo).

### 17.3.9 Facturas reales (compras.list.json), sumadas al bloque por centro de costo

El usuario recibió un correo de soporte de Obuma: *"Los proyectos tienen un centro costo, ese es el
campo que te permite hacer match con las facturas del proyecto"*, señalando `centro_costo` en
`/compras.list.json` (el endpoint de **Compras/facturas reales** — distinto de `comprasOc.list.json`,
que es solo las Órdenes de Compra).

**Probado en vivo antes de creerlo**: igual que con `comprasOc.list.json` en sesiones anteriores, el
filtro `?centro_costo=` del SERVIDOR **no filtra nada** — se probó con un centro de costo real
(22602) y `compras.list.json` devolvió el mismo total (16.870) con y sin el filtro, con filas de
centros de costo distintos al pedido. El campo `compra_centro_costo` SÍ viene en cada fila (soporte
tenía razón en eso), así que se filtra del lado del cliente — mismo patrón que el resto del módulo.

**Construido**: `comprasCompleto()` (nuevo en `obuma.ts`, mismo patrón que `comprasOcCompleto`,
paginado hasta 25 páginas de 1000, caché 5 min por el volumen: ~17.000 filas). En
`listarProyectosObuma()`, cada grupo de centros de costo suma además `totalFacturado`/
`cantidadFacturas` desde esta fuente — el dato contable definitivo (con IVA, folio SII), distinto
de las OC (que pueden quedar pendientes o no facturarse nunca). UI: cada tarjeta del bloque amarillo
ahora muestra "facturado $X" en verde junto al total de OC, y el contador de arriba de la pantalla
gana la tarjeta "Facturado real".

**Verificado en vivo** contra la cuenta real (`scripts/scratch/verificar-facturas-proyecto.mjs`): el
proyecto 30532 (licitación `3143-27-LE26`) tiene $16.377.608 en 2 OC pero **$17.139.210 facturado de
verdad en 8 facturas** — más preciso que solo mirar las OC. `npx tsc --noEmit` limpio, `npm run
test:viabilidad` 1025/1025.

**Nuevos:** `scripts/scratch/verificar-facturas-proyecto.mjs`.
**Modificados:** `app/lib/obuma.ts` (`listarCompras`, `comprasCompleto`),
`app/lib/compras-proyectos-obuma.ts` (`totalFacturado`/`cantidadFacturas`),
`app/compras/proyectos/page.tsx`.

### 17.3.10 El endpoint que faltaba — todo por API real, sin login, mismo día

El usuario recibió otro correo de soporte de Obuma: *"llegó a los proyectos será así:
`{{BASE-URL}}/v1.0/ext-proyectos.list.json`"*. Probado en vivo antes de construir nada (mismo
criterio de toda la sesión): **HTTP 200**, 190 proyectos reales, con TODOS los campos que hacían
falta — `proyecto_referencia`, `proyecto_presupuesto`, `proyecto_costo`, `proyecto_facturado_monto`,
fechas, `proyecto_estado` (código numérico), `rel_cliente_id`. Es v1.0, no pide `access-url`.

**Hallazgo extra, cruzando el `proyecto_id` de la API contra un caso ya conocido** (folio 155, la
licitación `3143-27-LE26`): `proyecto_id: "30532"` — el MISMO `rel_proyecto_id` que ya traía
`contabilidadCentrosDeCostos.list.json` desde el hallazgo original del 22-sep (§17.2). O sea: el
"Proyecto Obuma #30532" que la reconstrucción v1 mostraba a ciegas por texto libre era, en
realidad, el ID REAL del Proyecto — se puede cruzar por ID exacto, no por aproximación de nombre.

**Se resolvió también**: `rel_cliente_id` → nombre real vía `clientes.list.json`/`clientes.findById.json`
(1092 clientes, catálogo completo cacheado igual que proveedores). `proyecto_estado` es un código
numérico sin traducir en la doc — se armó el mapeo cruzando en vivo contra el snapshot ya leído por
la web el mismo día (antes de tener la API), folio a folio: **0=Abierto · 1=Cerrado · 2=Cancelado ·
3=Rechazado · 20=En proceso**.

**Esto vuelve obsoleto TODO lo de §17.3.7/§17.3.8 en horas** — la reconstrucción aproximada por
centro de costo y el robot con login personal del usuario. `app/lib/compras-proyectos-obuma.ts` se
reescribió entero: `listarProyectosObuma()` ahora arma una sola lista (ya no dos bloques separados
en la pantalla) juntando, por `proyecto_id` = `rel_proyecto_id`: la ficha real (API), sus centros
de costo, sus OC (`comprasOc`) y sus facturas reales (`compras.list.json`, §17.3.9). Los centros de
costo sin Proyecto asociado (gasto general de la empresa, ej. "TECNOMAQ") se siguen mostrando, sin
ficha, para no perder esa visibilidad (razón que dio el usuario en §17.3 para no sacar el bloque
viejo — ahora es una sola lista con esa distinción marcada por fila, no dos listas).

**Se dio de baja el cron/robot de login** (`jobObumaProyectos` en `scheduler.mjs`, comentado no
borrado) — ya no hace falta abrir un Chrome ni guardar la clave personal de Obuma del usuario para
nada de esto. El archivo `obuma-proyectos-scraper.ts` queda en el repo sin usarse, por si alguna vez
hace falta un respaldo, pero **el usuario debería poder borrar `OBUMA_WEB_RUT`/`OBUMA_WEB_CLAVE`**
de los `.env` (notebook y VPS) — ya no se leen desde ningún lado del código en uso.

**Verificado en vivo, con el token real**: `contabilidadCentrosDeCostos`, `comprasOc`, `compras`,
`ext-proyectos`, `clientes` y `proveedores` juntos en una sola corrida — **211 entradas totales,
190 con ficha real de Proyecto, 13 calzan con un negocio nuestro activo** (subió de 11 a 13 respecto
a la reconstrucción aproximada de antes, con datos ahora exactos: cliente, presupuesto, costo,
precio neto, facturado, estado). 19s en frío, cacheado 5 min. `npx tsc --noEmit` limpio, `npm run
test:viabilidad` 1025/1025.

**Nuevos:** `scripts/scratch/verificar-proyectos-unificado.mjs`.
**Reescrito:** `app/lib/compras-proyectos-obuma.ts` (modelo unificado), `app/compras/proyectos/page.tsx`
(una sola lista), `app/api/compras/proyectos-obuma/route.ts` (ya sin POST/scraper).
**Modificados:** `app/lib/obuma.ts` (`ext-proyectos`, `clientes`, `ESTADOS_PROYECTO_OBUMA`),
`scheduler/scheduler.mjs` (cron del robot comentado, no borrado).

### 17.3.11 Más robusto, orden por fecha de creación, filtros, y "¿tengo todos?"

Pedido explícito, mismo día: "hazlo más robusto... ponelo por fecha de lo más nuevo creados
primero... poneme filtros... quiero saber si tengo todos los proyectos que están en Obuma".

- **Robustez**: `listarProyectosObuma()` ahora envuelve cada una de las 6 fuentes (centros de costo,
  OC, facturas, `ext-proyectos`, clientes, proveedores, negocios de la BD) en `conTolerancia()` — si
  UNA falla (rate limit, timeout, Obuma caído un rato), las demás siguen funcionando con lo que sí
  se pudo traer, en vez de tumbar toda la pantalla. El fallo queda anotado en `meta.fuentesConError`,
  nunca silencioso.
- **Orden por fecha de creación**: se corrigió el criterio — antes ordenaba por "última actividad"
  (la OC más reciente); ahora ordena por `proyecto_ingreso_fecha` real (cuándo se CREÓ el Proyecto
  en Obuma), descendente. Los centros de costo sin ficha (sin fecha de creación propia) siguen
  cayendo a su última OC como respaldo.
- **Filtros**: se agregó un selector de Estado (Abierto/En proceso/Cerrado/Cancelado/Rechazado,
  client-side sobre el campo real ya mapeado), sumado a los que ya había (solo con ficha, solo con
  negocio nuestro, búsqueda de texto).
- **"¿Tengo todos?"**: `proyectosExtCompleto()` ahora devuelve también `totalReportado` (el
  `data-total-items` que Obuma dice tener), y `listarProyectosObuma()` arma `meta.completo`
  comparando eso contra lo que efectivamente se armó. La pantalla muestra un banner verde
  ("Están los N de N... ninguno se cortó") o uno ámbar si algo no cuadra o alguna fuente falló.

**Verificado en vivo** (`scripts/scratch/verificar-robustez-proyectos.mjs`): `meta` = `{
totalReportadoPorObuma: 190, totalConFicha: 190, completo: true, fuentesConError: [] }` — confirmado
que no falta ningún Proyecto. Orden real correcto: folio 190 (creado hoy 14:41) primero, seguido de
"ADMINISTRACION" (última OC 10:48), "TECNOMAQ" (16-sep), folio 189 (11-sep 16:51), folio 188 (11-sep
16:28) — descendente, tal como se pidió. `npx tsc --noEmit` limpio, `npm run test:viabilidad`
1025/1025.

**Nuevos:** `scripts/scratch/verificar-robustez-proyectos.mjs`.
**Modificados:** `app/lib/obuma.ts` (`proyectosExtCompleto` devuelve `totalReportado`),
`app/lib/compras-proyectos-obuma.ts` (`conTolerancia`, `meta`, `ordenFecha`),
`app/api/compras/proyectos-obuma/route.ts`, `app/compras/proyectos/page.tsx` (filtro de estado,
banner de completitud).

### 17.3.12 Ver la orden de compra en Obuma — link directo al documento real

Pedido de nuevo, mismo día: "podemos ver la orden de compra" (ya se había resuelto ver los ÍTEMS de
cada OC en §17.3.6, pero el usuario quería abrir el documento tal cual se ve en Obuma).

- Se probó primero adivinar la URL del iframe de Obuma — **se descartó** sin confirmación real del
  usuario, siguiendo la regla de no inventar URLs.
- El usuario pasó un link real copiado desde `mod-compras/oc/listar`
  (`.../iframe-main.php?id=276880`) para la OC folio 3928. Antes de usarlo se cruzó contra la API
  (`comprasOc.list.json?folio_dcto=3928`), que devolvió `compra_oc_id: "276868"` — **no coincidía**
  con el `id=276880` del link pegado. Se le mostró la discrepancia al usuario y se le pidió abrir
  `.../iframe-main.php?id=276868` para confirmar que era el mismo documento antes de tocar código.
  Confirmó: "si es asi".
- Patrón final, confirmado en vivo: `https://app.obuma.cl/obuma2.0/mod-compras/oc/iframe-main.php?id={compra_oc_id}`
  (requiere sesión activa de Obuma en el navegador que lo abre).
- Se agregó el link "Ver en Obuma" / "Ver esta orden de compra en Obuma" en dos lugares:
  - `app/compras/proyectos/page.tsx` — dentro del detalle expandido de cada OC, junto a los ítems.
  - `app/licitacion/[codigo]/sections/ComprasObumaBloque.tsx` — en la fila de cada compra
    (`FilaCompra`). Esto requirió pasar esa fila de acciones de condicional (solo se mostraba si
    había ítems o facturas) a siempre visible, para que el link aparezca aunque la OC no tenga ítems
    cargados.

**Verificado:** `npx tsc --noEmit` limpio, `npm run test:viabilidad` 1025/1025.

**Modificados:** `app/compras/proyectos/page.tsx` (helper `urlOcEnObuma`, link en el detalle de OC),
`app/licitacion/[codigo]/sections/ComprasObumaBloque.tsx` (mismo helper, link en `FilaCompra`,
bloque de acciones ya no es condicional).

### 17.4 Pendiente real, sin resolver hoy

**Superado por §17.3.10, mismo día.** El acceso a v2.0 (`OBUMA_ACCESS_URL`) sigue sin configurarse
y no está habilitado en la cuenta — pero ya no importa: `ext-proyectos.list.json` (v1.0) resuelve
lo mismo por API real. No queda pendiente nada de v2.0 ni de credenciales guardadas para esto.

Lo único que sigue pendiente de verdad: **confirmar que el usuario borró `OBUMA_WEB_RUT`/
`OBUMA_WEB_CLAVE`** de los `.env` (notebook y VPS) — ya no se usan, y esa clave personal de Obuma
quedó expuesta en el historial de este chat en algún momento del día (ver aviso de seguridad en
§17.3.8).
