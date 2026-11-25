# API de Obuma

**Antes de tocar cualquier llamada a Obuma, lee `docs/obuma/GUIA-API.md`** (spec oficial completa en `docs/obuma/openapi-v1.0.yaml`, índice en `docs/obuma/indice-endpoints.txt`). Todo se entrega por `app/lib/obuma.ts` (capa HTTP) y `app/lib/obuma-compras.ts` (cron).

## 2026-11-25 — Hallazgos nuevos (probados en vivo)
- **`pg-bancos.list.json` SÍ existe** (id → nombre, código SBIF, RUT): `proveedor_banco_cuenta` es el ID del banco. Antes se creía que no había catálogo.
- **No hay endpoints para crear/renombrar centros de costo ni proyectos** (`contabilidadCentrosDeCostos` y `ext-proyectos` solo `list`/`findById`). El número PR en el nombre del centro lo escribe quien lo crea en Obuma.
- **`proveedores.update.json` no borra lo que no se manda** (ficha 158108 igual antes y después, con banco/cuenta fuera del payload). Banco, N° y tipo de cuenta siguen sin guardarse al escribir. Correo para Obuma: `docs/obuma/CORREO-soporte-proveedores-banco.md`. Detalle en `compras.md` (2026-11-25).

## 2026-11-24 (noche) — Checkpoint en el cron de Obuma (sin desplegar)
**Qué cambia (`app/lib/obuma-compras.ts`):** el cron ya no pide ítems ni facturas de cada OC en cada corrida. Compara la fila del listado con lo guardado (estado, neto/total/IVA, enlace de factura, referencia, observación, centro de costo, proveedor); si no cambió y ya tiene ítems, RUT y facturas, la salta (0 llamadas). La revisión de notas de crédito (baja `compras.list` entero, ~17 llamadas) corre como máximo cada 6 h en el cron (temporizador en memoria: un reinicio la vuelve a permitir). El botón «Sincronizar con Obuma ahora» (`soloCodigo`) NO usa checkpoint y refresca todo. El resumen trae `sinMovimiento`.
**Pendiente:** desplegar y mirar `sinMovimiento` y el contador por método tras un día; si hace falta ahorrar más, usar `id_dcto_desde` para el barrido del listado.

## 2026-11-24 — Documentación revisada completa y guardada (solo lectura; nada cambiado en código)
**Qué se hizo:** se bajó la especificación OpenAPI (207 operaciones, 57 grupos), se revisó entera, se probó en vivo con la cuenta real y se escribió la guía.
**Hallazgos que importan:**
- **Límite = 1.500 llamadas/día POR MÉTODO**, reinicio a las 00:00; el contador (`endpoint-rate-limit-used/remaining`) viene en el cuerpo de cada respuesta. Hoy a media mañana: `compras.list` 561, `comprasOc.listItems` 407, `comprasDte.list` 374, `comprasOc.list` 260. Obuma puede subir el límite por empresa y método: es lo que hay que pedirles por correo.
- **`fecha_desde` filtra pero OMITE registros** (probado después, 24-nov tarde): `comprasOc.list` con `fecha_desde=2026-05-08` dio 396 de 407 OC (faltaron 11); con 5 semanas de margen aún faltaron 2. **Usar `id_dcto_desde`**: probado exacto en `comprasOc.list` (201 = 201, sin faltantes ni sobrantes); `id_desde` no filtra. Sin probar `id_dcto_desde` en `listItems` y `compras.list`. `limit` máximo 1000 (el cron usa 100). La propuesta de «1 llamada de listItems para todas las OC nuevas» sigue valiendo, pero con `id_dcto_desde`.
- **`ventasCobros.list` trae los cobros con fecha real** (`vp_fecha`, `rel_venta_id`; 1.433 en total = pantalla «Cobros Realizados») y `comprasPagos.list` los pagos a proveedores. `ventas.list` con `tipo_dcto=33/34` trae `venta_total_pagado` (coincide con los cobros).
- Hay un servidor **TEST** (`api-test1.obuma.cl`) — sin probar con nuestro token.
- Hay operaciones GET que BORRAN o MODIFICAN (`compras.delete`, `comprasOc.delete`, `ventas.update`, `ventas.delete`, `contabilidad.createDiario`…): jamás llamarlas por probar.
- HTTP 200 no significa éxito (errores como JSON, texto «Error 005…» o HTML).
**Pendiente (propuesto, no hecho):** cron con `id_dcto_desde`; guardar y vigilar el contador por método; marcar «pagada» con `ventasCobros.list` (fecha real); probar el servidor TEST; correo a Obuma pidiendo subir el límite con estas cifras.
