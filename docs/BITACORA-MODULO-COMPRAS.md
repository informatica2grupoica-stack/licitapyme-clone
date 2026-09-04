# Módulo de Compras — Fase 1 (04-sep-2026)

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
