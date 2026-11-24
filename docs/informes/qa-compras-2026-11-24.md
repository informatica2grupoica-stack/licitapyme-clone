# QA del módulo Compras — 2026-11-24

**Cómo se probó:** copia aislada del repo (`C:\licitank-qa`) con `next dev` en el puerto 3200, contra la BD del contenedor Docker `licitank-dev-db` (127.0.0.1:3308, espejo local). Sin Obuma, correo, R2, WhatsApp ni IA reales. No se tocó el VPS ni el servidor del puerto 3000. Usuarios de prueba (solo en la BD local): `qa.compras@licitank.test` (admin), `qa.usuario@…` (usuario), `qa.externo@…` (externo). Pruebas por API (curl/Node, ~200 llamadas) + recorrido en navegador de la lista y de la ficha del negocio 1356.
**Código escrito:** ninguno. Solo se aplicaron al Docker las migraciones 197–205 que le faltaban.

## Errores (de más a menos grave)
| # | Dónde | Qué pasa | Evidencia |
|---|---|---|---|
| 1 | `POST /cierre-legado` | Se salta la máquina de estados: un negocio En proceso se marca «Entregada» o «No realizada» sin motivo y sin pasos. Queda `estado_compra=EN_PROCESO` y `cierre_legado=ENTREGADA` a la vez (dos verdades). | 1568 |
| 2 | Escrituras en negocio Cancelado | El servidor acepta crear y borrar gastos en un negocio Cancelado (solo se bloquea Abierta). | gasto id 10 en 1008 → 200 |
| 3 | Aprobación de líneas | `PATCH /aprobaciones/linea` no valida que el producto sea del negocio: aprobó el producto 516 de otro negocio y un id inexistente (fila huérfana). | filas en compras_aprobacion_linea |
| 4 | Montos sin tope + BD no estricta | Gasto de $99.999.999.999.999 se guardó truncado en silencio a $999.999.999.999,99; la OC propia igual. Margen real quedó −12.096.072 %. | gasto 11, OC MP-2026-0004 |
| 5 | `POST /asignar` | Se puede asignar como encargado a un usuario con rol **externo** (cliente). | asignado_a=34 |
| 6 | Margen previsto 93,7 % (ficha 1356) | Mezcla venta de TODA la adjudicación ($188,6 M) con costo de solo 13 de 141 líneas ($11,8 M). El comparativo da 21,3 %. Dos márgenes distintos para el mismo negocio. | pantalla vs `/costo-real` |
| 7 | Proveedores | Sin validar RUT, sin detectar duplicados (3 con el mismo RUT), correo/teléfono libres, nombre vacío por PATCH. En datos reales ya hay 4 RUT duplicados y 52 sin RUT. | ids 585–588 |
| 8 | Dashboard | `negociosActivos` y «urgentes» no miran `estado_compra`: cuentan Cerradas y Canceladas (83 vs 40 vivas; 5 de 15 urgentes están cerradas/canceladas). «No realizadas 2» vs 9 Canceladas. | `compras-dashboard.ts` |
| 9 | OC del cliente | Acepta monto negativo, fechas invertidas (aceptada antes de emitida, y cierra la tarea), fecha «ayer» y número repetido. | QA-2, QA-3, QA-4 |
| 10 | OC propia | RUT «abc», cantidad 0,001 (total $0), entrega en 2001. | MP-2026-0003/5/6 |
| 11 | Cotización manual | Precio −500 o «abc» → éxito con precio vacío; plazo −5 días; RUT inválido; cotización sin precio. Ítems con precio negativo o 1e12. | ids 393–398 |
| 12 | Errores 500 en vez de 400 | Gasto con monto «1e999», moneda inexistente, categoría inexistente y JSON mal formado devuelven 500 (este último con el texto técnico). | gastos |
| 13 | Obuma caído = pantalla vacía | `.catch(() => [])` en orden-compra-obuma: si Obuma falla, devuelve éxito con listas vacías; el modal «Lo creado en Obuma» queda en blanco, sin aviso. Otras rutas devuelven 500 con «OBUMA_API_TOKEN no configurado» (filtra el nombre de la variable). | UI + curl |
| 14 | Cancelar | Irreversible desde la app («el dueño debe deshacerlo»), y la Actividad lo registra como «no realizada (backlog histórico)». Motivo con `<script>` se guarda tal cual (no se ejecutó en el PDF). | 1568 |
| 15 | Datos expuestos | `GET /proveedores` abierto a todo rol interno: 109 de 563 proveedores con cuenta bancaria visible (decisión del 10-oct, a revisar). | usuario básico → 200 |

## Front / usabilidad
- La lista muestra «Sin negocios ganados todavía» mientras carga (mensaje falso).
- Modal bloqueante «Hay 1 negocio esperando tu aprobación» tapa la ficha al entrar.
- Lista con 10 pestañas de estado + 3 vistas + 3 subvistas del Gantt: muy densa; 5 botones idénticos «Registrar lo que se hizo».
- Respuestas muy pesadas: `/api/compras` 407 KB, `/proveedores` 412 KB, `escenarios` hasta 2,3 MB, `documentos-generados` 1,7 MB, `auditor-costeo` 1,1 MB.
- Fechas de aprobación de líneas salen como `Tue Nov 24 2026 16:06:26 GMT-0300 (…)` (texto de JS, no ISO).
- Banner «Completa tu perfil» persistente.

## Lo que está bien
Saltos de estado ilegales, cancelar sin motivo (<15 caracteres), permisos por rol (usuario y externo: 403 en todo lo de negocio y en todas las escrituras), folios de OC propia sin duplicarse con 6 envíos simultáneos, PDF de OC (escapa HTML), tareas/incidencias de otro negocio rechazadas, gate «pasar a En proceso» del servidor.

## No se pudo probar (límite del entorno, no «pasó»)
Todo lo que depende de Obuma (crear OC/proveedor/SKU, sincronizar, guías), subida de archivos a R2, lectura de cotizaciones con IA, envío de OC por correo, WhatsApp, factura de venta. El SKU tampoco: exige Compuerta 1 aprobada, que exige elegir escenario con cobertura completa. Excel de la lista (se arma en el navegador) no se descargó. Sin pruebas de carga ni de móvil.

## Residuo en el Docker
Negocios 1568, 1356 y 1008 con datos de prueba (gastos, tareas, cotizaciones 393–398, OC propias 3–13, proveedores 585–588, 1568 con encargado externo y cierre legado). Se puede resetear con `docker compose -f docker-compose.dev-db.yml down -v`.
