# Plan: LICITANK 100 % en nuestra base de datos

Objetivo del dueño (2026-11-25): todo lo que llega de Obuma, de Mercado Público (MP) y todo lo que produce la IA debe quedar
en la BD propia, para que el chatbot responda siempre con datos completos y nunca se equivoque.

Base: auditoría del 2026-11-25 (solo lecturas sobre la BD del VPS y conteos de Obuma). Cifras al momento de medir.

## Reglas para todas las fases
- **Multiempresa** (skill `multiempresa-escalable`): tabla nueva = `cliente_id`; credenciales de Obuma y MP por empresa; nada de datos de ICA en el código.
- **Idempotente**: cada migración con `IF NOT EXISTS`, script `aplicar-migration-N.mjs` y prueba en BD local antes de producción.
- **Presupuesto de llamadas**: Obuma 1.500/día por método; usar `fecha_desde` y paginar de a 1.000. MP: respetar su límite y la cola existente.
- **Primera carga (backfill) separada del cron diario**, con tope por corrida y reanudable.
- Cada fase termina con una consulta de verificación (conteo propio vs conteo de la fuente) y se anota en `docs/memoria/`.

## Fase 0 — DECISIONES DEL DUEÑO (2026-11-25) — RESUELTAS
1. **Histórico de MP:** solo 2026 en adelante (el caché tiene 33.234 de 2026 y casi nada anterior).
2. **Respuesta completa de la API de MP:** SÍ, guardar `raw_json` (≈ +100 MB sobre 1,3 GB de BD; `licitaciones_cache` pesa 115 MB).
3. **Obuma:** SÍ compras, pagos y gastos; ventas y cobros; clientes, productos y proveedores; guías de despacho (falta hallar el endpoint, `guias.list` da «Error 101»). **Fuera:** contabilidad, stock y empleados.
4. **Universo de MP:** no medirlo ahora; solo si la Fase 1 lo necesita (gasta llamadas del ticket de MP).
5. **Restricción permanente:** nada de este trabajo debe gastar IA ni correr viabilidad. Las cargas son solo API de MP/Obuma → BD.

(Texto original de la fase, para referencia)
## Fase 0 — Decisiones previas (bloquean el resto)
1. ¿Cuánto histórico de MP guardamos? (hoy 33.488 licitaciones; el universo real no está medido).
2. ¿Guardamos la respuesta completa de la API (`raw_json`) en licitaciones? Aumenta el tamaño de la BD; recomendado.
3. ¿Qué tablas de Obuma entran? Propuesta: compras, ventas, pagos, cobros, gastos, clientes, productos, proveedores, guías. Contabilidad, stock y empleados quedan fuera salvo que lo pidas.
4. Medir el universo de MP (conteo por estado y año) para saber qué tan lejos estamos.

## Fase 1 — Mercado Público completo
| Paso | Qué | Verificación |
|---|---|---|
| 1.1 | Rellenar `comuna` (migration-206 ya creó la columna; hoy 100 % vacía) y `monto` (falta 49 %) desde la API o el detalle | % vacío de `comuna` y `monto` en Publicadas < 5 % |
| 1.2 | Agregar `raw_json` a `licitaciones_cache` y guardar la respuesta completa en cada actualización; backfill gradual | % con `raw_json` |
| 1.3 | Detalle de adjudicación de las 5.620 adjudicadas sin `adjudicacion_cache`, con tope diario y reanudable | adjudicadas sin detalle = 0 |
| 1.4 | Ofertas de competencia (`oferta_competencia`, hoy 211 licitaciones) para todas las adjudicadas, desde el acta | cobertura vs adjudicadas |
| 1.5 | Documentos de las bases: descargar, extraer texto y categorizar los pendientes (11.952 sin texto, 13.294 sin categoría); decidir si se descargan para las 29.000 licitaciones sin documentos o solo las que pasan el prefiltro | docs sin texto / sin categoría |
| 1.6 | OC públicas (`mp_oc_publica`, `mp_oc_proveedor_dia`, hoy vacías) y los 191 PDF de OC que faltan | OC sin PDF = 0 |
| 1.7 | Negocios huérfanos (521): traer su licitación a `licitaciones_cache` | huérfanos = 0 |

## Fase 2 — Obuma completo en BD (cron con `fecha_desde`)
- Tablas nuevas (todas con `cliente_id`, `obuma_id` único y `raw_json`): `obuma_compra`, `obuma_compra_item`, `obuma_venta`, `obuma_venta_item`, `obuma_pago_compra`, `obuma_cobro_venta`, `obuma_gasto`, `obuma_cliente`, `obuma_producto`, `obuma_guia`. `compras_proveedor` y `compras_historial_oc` se completan en vez de duplicarlas.
- Backfill por tabla, de la más chica a la más grande (clientes 1.105 → cobros 1.433 → productos 1.599 → proveedores 2.854 → gastos 3.694 → ventas 5.086 → compras 17.330 → pagos 18.950). Los totales son los de Obuma al 2026-11-25.
- Sincronización diaria incremental con `fecha_desde` y una reconciliación semanal (conteo propio vs `data-total-items`).
- Averiguar el endpoint correcto de guías (`guias.list` devolvió «Error 101»).
- El código que hoy consulta Obuma en vivo pasa a leer de la BD (las cachés de 60 s en [obuma.ts](../app/lib/obuma.ts) se retiran por módulo, sin tocar lo que escribe en Obuma).
- Completar `obuma_proyectos_snapshot` (vacía).

## Fase 3 — Salidas de IA
1. Guardar las conversaciones del chatbot general y del chat por menú (hoy solo existe `chat_licitacion`): tabla `chat_mensaje` con `cliente_id`, usuario, sección, pregunta, SQL generado y respuesta.
2. Revisar las 11 rutas que llaman a IA: confirmar que cada una guarda su resultado (viabilidad, análisis, prefiltro, checklist y auditor ya lo hacen) y que cada llamada queda en `ia_uso`.
3. Los checkpoints de viabilidad que hoy van a una carpeta temporal ([viabilidad-ia.ts:515](../app/lib/viabilidad-ia.ts)) pasan a una tabla o se documentan como caché desechable.
4. Cobertura de análisis: decidir cuáles licitaciones deben tener prefiltro / viabilidad (hoy 16.046 sin prefiltro).

## Fase 4 — Abrir la BD al chatbot
1. Agregar a `TABLAS_PERMITIDAS` y a `chat-secciones.ts` las tablas nuevas y las 50 que hoy ningún chat lee, **excepto** `login_intentos`, `push_tokens`, `sesiones_revocadas`, `empresa_firmas`, `password_resets` y tablas de cola.
2. Cada tabla nueva con su filtro por empresa en `filtrosDeAcceso`; una tabla que no se pueda separar por empresa no se entrega.
3. Notas por tabla para que la IA elija bien (como las de `negocio_costeo_editor`).
4. Pruebas: banco de ~30 preguntas con respuesta conocida (ganadas del año, OC sin pagar por negocio, proveedor que más vende, competidores, margen por negocio) contra el chatbot, antes y después.

## Fase 5 — Limpieza y definición del esquema
- Migración con `CREATE TABLE IF NOT EXISTS` para las 7 tablas sin definición en el repo (`doc_chunks`, `doc_files`, `doc_pipeline`, `documentos_licitacion`, `documentos_scraping_log`, `migracion_174_hora_chile`, `oferta_competencia_garantia`); borrar las vacías y sin uso previa confirmación.
- Revisar las tablas vacías (`analisis_cache`, `experiencia_*`, `compras_equivalencia`, `compras_embarque`, `negocio_auditor_compra_*`): funciones sin datos, activarlas o quitarlas.
- Rehacer el informe de huecos con el script de la auditoría y dejarlo como control periódico.

## Orden y tamaño estimado
1. Fase 0 (decisiones) → 2. Fase 4 con las tablas que ya existen (mejora rápida del chatbot) → 3. Fase 1 → 4. Fase 2 → 5. Fase 3 → 6. Fase 5.
Las fases 1 y 2 son las más largas por el backfill; el límite de llamadas manda el calendario, no el código.

## Riesgos
- El backfill de MP y Obuma consume cuota: puede competir con el uso diario normal. Mitigación: topes por corrida y ventanas nocturnas.
- Tamaño de la BD en el VPS con `raw_json` y textos de documentos: medir espacio libre antes de la Fase 1.
- El PC escribe directo en producción (túnel 3307): toda migración se prueba primero en una BD local.
- Abrir más tablas al chatbot sin filtro por empresa filtraría datos entre clientes: la Fase 4 no se despliega sin la prueba de aislamiento.

## Lo que este plan no cubre
- Calidad campo por campo de lo ya guardado (se mide en la reconciliación de cada fase).
- Contabilidad, stock y empleados de Obuma, salvo decisión en la Fase 0.

## Estado de la Fase 1 (2026-11-25)
**Hecho en código (tsc ok; NADA aplicado en producción, sin desplegar, sin gasto de IA):**
- `docs/migration-207-licitaciones-raw-json.sql` + `scripts/aplicar-migration-207.mjs`: columna `licitaciones_cache.raw_json` (respuesta completa de la API).
- `app/lib/mercado-publico.ts`: cada licitación normalizada guarda su respuesta cruda en un WeakMap (`respuestaCrudaDe`); no viaja en el JSON de las rutas.
- `app/lib/licitaciones-cache.ts`: `guardarCache` escribe `raw_json` (best-effort; nunca borra lo ya guardado).
- `scripts/rellenar-licitaciones-mp.mts`: una llamada de detalle por código llena comuna, items, `raw_json` y `adjudicacion_cache` (adjudicadas primero); por defecto solo cuenta; `--aplicar --limite N`; retoma donde quedó; se frena ante 429.
**Falta:** aplicar migration-207 en producción, probar el script con pocos códigos, correrlo por tandas (5.620 adjudicadas ≈ 2,5 h de llamadas a 1,5 s), y después los pasos 1.4 (ofertas de competencia), 1.5 (documentos), 1.6 (OC públicas) y 1.7 (negocios huérfanos).
**Aviso:** el `monto` vacío (49 %) es en buena parte monto oculto por el organismo (`VisibilidadMonto`): la API no lo entrega y el relleno no lo va a arreglar; hay que decidir si se completa con el presupuesto que sale de las bases o con la suma de las líneas adjudicadas.

**2026-11-25 (más tarde): migration-207 APLICADA en producción y script probado con 5 adjudicadas** (`--aplicar --limite 5 --solo-adjudicadas`, 0,2 min, sin IA): las 5 quedaron con comuna, `raw_json` (3–5 KB) y `adjudicacion_cache` (oferentes, monto adjudicado, líneas). 4 de 5 siguen sin `monto` aunque están adjudicadas (monto oculto por el organismo). Pendiente: correr por tandas el resto (5.615 adjudicadas + 33.485 sin `raw_json`), pasos 1.4–1.7 y decidir el relleno del `monto`.

## Estado de la Fase 2 — Obuma en la BD (2026-11-25)
**Hecho y aplicado en producción (sin IA, sin desplegar la app):**
- migration-209 aplicada: `obuma_registro` (una fila por registro de Obuma, `cliente_id`, columnas comunes + `raw_json` con la fila completa) y `obuma_sync_estado` (conteo propio vs `data-total-items` de Obuma).
- Primera carga completa, cuadrada al registro con Obuma: clientes 1.105 · cobros 1.433 · productos 1.599 · proveedores 2.854 · gastos 3.694 · OC 4.110 · ventas (incluye guías de despacho, `tipo_dcto` 52: 1.822) 5.090 · facturas recibidas (DTE) 14.088 · compras 17.330 · pagos 18.950. Total ≈ 70.000 filas, 147 MB, ≈ 100 llamadas.
- Las guías de despacho están en `ventas.list` con `tipo_dcto=52` (no hay endpoint propio: el «Error 101» era por eso).
- Código: `app/lib/obuma-espejo.ts` (sincronizador), `scripts/sincronizar-obuma-espejo.mts`, `app/api/cron/obuma-espejo/route.ts`, trabajo diario 07:55 en `scheduler/scheduler.mjs` (aún sin desplegar). El chatbot (sección Proyectos/Obuma) ya conoce `obuma_registro` con nota de uso.
**Decisión de diseño (corregida por el dueño el mismo día):** el espejo es para el chat; los cron de Obuma que ya existen siguen igual (el de `obuma-compras` ya salta las OC sin movimiento y las licitaciones con compra Cerrada/Pagada/Cancelada). El cron del espejo NO relee todo Obuma: en modo RÁPIDO lee solo las páginas más nuevas hasta la primera sin novedades (Obuma entrega las compras, OC, facturas, gastos, pagos, ventas y cobros de la más nueva a la más vieja), guarda siempre todo lo nuevo, y cuando cae un pago/cobro vuelve a pedir solo ESE documento si no estaba pagado del todo. Lo viejo, pagado o anulado no se vuelve a leer. Un día tranquilo = 15 llamadas (clientes, proveedores y productos se releen completos: son 7). El modo completo (~100 llamadas) queda solo manual (`--completo`). No se usa `fecha_desde` porque omite registros. `comprasPagos` entrega 500 por página. Probado: se borró a propósito el último pago de la copia y el modo rápido lo recuperó y refrescó su compra con 3 llamadas.
**Falta:** (1) desplegar para que corra el cron; (2) ítems de OC y de ventas (líneas de detalle: `comprasOc.listItems`, `ventas.findById`) — hoy solo hay cabeceras; (3) cambiar el código que consulta Obuma en vivo para que lea de `obuma_registro` («solo consultamos lo que nos falta»), módulo por módulo, sin tocar lo que escribe en Obuma; (4) Obuma por empresa cliente (hoy una sola cuenta del `.env`, `cliente_id` = 1).
