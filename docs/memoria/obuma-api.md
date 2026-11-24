# API de Obuma

**Antes de tocar cualquier llamada a Obuma, lee `docs/obuma/GUIA-API.md`** (spec oficial completa en `docs/obuma/openapi-v1.0.yaml`, índice en `docs/obuma/indice-endpoints.txt`). Todo se entrega por `app/lib/obuma.ts` (capa HTTP) y `app/lib/obuma-compras.ts` (cron).

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
