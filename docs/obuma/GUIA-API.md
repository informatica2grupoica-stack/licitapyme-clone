# API de Obuma v1.0 — guía para trabajar con ella en LICITANK

Revisada completa el **2026-11-24** (https://api.obuma.cl/v1.0/docs/). Archivos de esta carpeta:
- `openapi-v1.0.yaml` — la especificación oficial tal cual (OpenAPI 3.0.3, 207 operaciones, 57 grupos). Bajada de https://api.obuma.cl/v1.0/openapi.yaml.
- `indice-endpoints.txt` — índice legible: método, ruta, parámetros (`*` = obligatorio) y campos del body.
- Esta guía — lo que importa para nosotros, las pruebas en vivo y las trampas.

> Aviso de Obuma en la propia spec: se escribió «por inspección estática del código» (no verificada en vivo). Lo que dice esta guía como **PROBADO** sí se comprobó contra la cuenta real el 24-nov-2026.

## 1. Lo básico

| | |
|---|---|
| Autenticación | cabecera `access-token: <token>` (sin «Bearer»). El token puede limitarse por endpoint. En el código: `OBUMA_API_TOKEN` (`app/lib/obuma.ts`). |
| Servidores | `https://api.obuma.cl/v1.0` (principal) · `https://api-g1.obuma.cl/v1.0` (G1) · **`https://api-test1.obuma.cl/v1.0` (TEST)**. |
| Paginación | `page` (desde 1) y `limit`: **máximo 1000, por defecto 1000**. El cron hoy pide 100 por página (5 llamadas para 500 OC); con `limit=500` sería 1. |
| Orden | Casi todos los `list` traen lo más nuevo primero; algunos aceptan `order_by` / `order_dir`. |
| Respuesta | `{ data: [...], data-total-items, data-total-pages, endpoint-rate-limit, endpoint-rate-limit-used, endpoint-rate-limit-remaining, endpoint-rate-limit-reset-at, ... }` |
| Errores | **HTTP 200 aunque falle.** Puede venir JSON `{errors:[{code,message}]}`, un string plano «Error 005…» o HTML. Nunca dar por bueno un 200 sin mirar el cuerpo (`llamar()` en `obuma.ts` ya lo hace). |

## 2. El límite de uso (lo que nos bloqueó el 23-nov)

- **1.500 llamadas por día POR MÉTODO** (`endpoint-rate-limit`), no global. Se reinicia a las **00:00** (`endpoint-rate-limit-reset-at`). La spec dice que el límite efectivo puede configurarlo Obuma por empresa y operación: **eso es lo que hay que pedirles** (subir `comprasOc.listItems`, `compras.list`, `comprasDte.list`, `comprasOc.list`, `proveedores.findById`).
- **El contador viene en el cuerpo de cada respuesta**: se puede leer `endpoint-rate-limit-used` y `…-remaining` sin gastar nada extra. Hoy `obuma.ts` no lo guarda: conviene registrarlo por método y cortar antes de topar (Error 005).
- Medición del 24-nov-2026 a media mañana (incluye mis pruebas): `compras.list` 561 · `comprasOc.listItems` 407 · `comprasDte.list` 374 · `comprasOc.list` 260 · `ext-proyectos.list` 92 · `proveedores.list` 64 · `contabilidadCentrosDeCostos.list` 55 · `ventas.list` 34 · `ventas.listReferencias` 25.

## 3. Cómo gastar mucho menos (PROBADO 24-nov-2026)

> **CORRECCIÓN (24-nov, tarde): `fecha_desde` NO es confiable para sincronizar.** Comparado con la lista completa de `comprasOc.list` (4.106 OC): `fecha_desde=2026-05-08` entregó 396 de las 407 OC que la lista completa trae desde esa fecha (faltaron 11, ej. OC 3904, 3705, 3942); aun con 5 semanas de margen faltaron 2. Filtra por otra fecha (probablemente la del documento, no la de ingreso). **Para sincronizar usar `id_dcto_desde`** (el id de la última OC ya vista): probado en `comprasOc.list` con id 275801 → 201 filas = las 201 de la lista completa, 0 faltantes, 0 sobrantes. `id_desde` NO filtra (devuelve todo). `id_dcto_desde` también existe en `comprasOc.listItems` y `compras.list` (sin probar ahí). Los números de la tabla de abajo valen como orden de magnitud, no como regla.

Los filtros **`fecha_desde` / `fecha_hasta` filtran** en `comprasOc.list`, `comprasOc.listItems` y `compras.list` (pero pueden omitir registros, ver arriba):

| Antes (lo que hace el código) | Con `fecha_desde` | Prueba |
|---|---|---|
| `comprasOc.listItems` **1 llamada por OC** (39 OC = 39 llamadas) | **1 llamada** trae las líneas de TODAS las OC desde esa fecha | desde 2026-11-15: 45 líneas de 39 OC en 1 llamada |
| `compras.list` completo (17 páginas de 1000) solo para ver notas de crédito | 1 llamada con las compras recientes | desde 2026-11-15: 57 filas (de 17.326) |
| `comprasOc.list` 5 páginas de 100 | 1 llamada con `limit=1000` y `fecha_desde` | desde 2026-11-15: 39 OC (de 4.106) |

Otros filtros útiles que **sí existen en la spec**: `id_dcto_desde` / `id_desde` (traer solo lo posterior a un id ya visto → sincronización incremental), `folio_dcto`, `proveedor`, `proveedor_rut` (compras), `total_pagado` / `total_por_pagar` (compras y ventas), `order_by` / `order_dir`.
**No existe `centro_costo` como filtro** en `comprasOc.list` ni `compras.list` (confirma lo que ya habíamos visto: el filtro no hacía nada; el campo viene en cada fila y se filtra en el cliente).

## 4. Pagos y cobros (NUEVO — antes lo sacábamos de la pantalla)

- **`GET /ventasCobros.list.json`** → cobros de facturas de venta. Filtros: `ano`, `mes`, `fecha_ingreso_desde`, `fecha_ingreso_hasta`, `venta_id`, `origen`. **PROBADO:** 1.433 cobros en total (igual que la pantalla «Cobros Realizados»); cada fila trae `vp_fecha` (**fecha real del cobro**), `vp_pagado`, `vp_total`, `vp_por_pagar`, `vp_forma_pago`, `rel_venta_id` (id interno de la venta; se une con `ventas.list` por `venta_id`). Con esto Licitank puede marcar «pagada» **con la fecha verdadera** (hoy `marcarFacturasPagadasDesdeObuma` usa el día en que lo detecta).
- `GET /comprasPagos.list.json` → pagos a proveedores (filtros `compra_id`, `fecha_ingreso_desde/hasta`, `ano`, `mes`, `origen`). 18.948 en total. Sirve para saber si pagamos una compra.
- `ventas.list` (tipo 33/34) trae `venta_total_pagado` y `venta_total_por_pagar` por factura: **coincide con los cobros** (comparado el 24-nov con 11 facturas). Ojo: pedir SIEMPRE con `tipo_dcto=33` (o 34); sin filtrar mezcla boletas, notas y otros y parece que casi nada está pagado.
- `POST /ventasCobros.create.json` registra un cobro (**escribe en Obuma**; no usar sin orden expresa).

## 5. Lo que Licitank usa hoy (y cuánto cuesta)

Lectura: `proveedores.list/findById/findByRut`, `comprasOc.list/findById/listItems`, `compras.list`, `comprasDte.list`, `ext-proyectos.list`, `contabilidadCentrosDeCostos.list`, `clientes.list`, `productos.list`, `productosCategorias.list`, `productosSubCategorias.list`, `empresaFormasDePago.list`, `empresaBodegas/Sucursales.list`, `ventas.list`, `ventas.listReferencias`.
Escritura: `comprasOc.create/update`, `productos.create`, `proveedores.create`, `ventasIntegracionExternas.create` (guías), `ventasConsultaDte.listPdfXml` / `estadoDTEenSII` (consulta).
Los puntos caros están en `app/lib/obuma-compras.ts` (cron 07:45) y en las descargas «completas» de `obuma.ts` (`comprasCompleto`, `comprasOcCompleto`, `proveedoresObumaCompleto`, `proyectosExtCompleto`).

## 6. Lo que sirve (para nosotros)

| Necesidad | Método |
|---|---|
| Compras (OC) y sus líneas | `comprasOc.list`, `comprasOc.listItems`, `comprasOc.listLast` (últimos registros), `comprasOc.findById` |
| Facturas de compra / DTE | `compras.list`, `compras.listItems`, `compras.listReferencias`, `comprasDte.list` |
| Gastos | `comprasGastos.list`, `comprasGastos.listItems` |
| Proyectos y centros de costo | `ext-proyectos.list/findById`, `contabilidadCentrosDeCostos.list` |
| Facturas de venta, referencias (OC de MP tipo 801) | `ventas.list`, `ventas.listReferencias`, `ventas.listLast`, `ventas.listItems`, `ventas.listOne/{id}` |
| PDF/XML y estado SII de un DTE | `ventasConsultaDte.listPdfXml` (POST `folio`, `tipoDte`, `mostrar_pdf_url`), `listPdfXml2` (GET), `estadoDTEenSII` |
| Cobros y pagos | `ventasCobros.list`, `comprasPagos.list` |
| Proveedores y clientes | `proveedores.*`, `clientes.*` (+ `findByRut`) |
| Productos / SKU | `productos.list/create/update`, `productosCategorias`, `productosSubCategorias` |
| Cotizaciones de venta | `ventasCotizaciones.*` (list, create, update, `listPdfLink`, `sendEmail`) — posible a futuro |
| Correo desde Obuma | `emailSender.send` / `sendUploadFile` — no lo usamos (el correo va por la cuenta propia de cada cliente) |
| Probar conexión | `tester.ping`, `tester.hello` (no gastan datos) |

## 7. Lo que NO sirve para LICITANK (ignorar)

Remuneraciones y empleados (`remuneraciones.*`, `empleados*`, `empleadosPerfil*`), inventario y stock (`productosStock.*` incl. kits y libro), POS (`ventasPOSLocal*`, `ventasConsultaBoleta`), contabilidad general (`contabilidad.*`: diario, cheques, cartolas; `contabilidadPlanDeCuentas`), CRM (`crm.*`, incluye `crm.sendwhatsapp`), tareas (`tareas.*`), producción y SAT (`ext-producciones`, `ext-sat`), listas de precio, folios y certificados DTE (`empresaDte*`), tablas de apoyo (`pg-*`), brochures/imágenes/fabricantes, direcciones y contactos de clientes, `productosConsultaPrecios`, `productosLdM`.

## 8. Trampas — NO llamar sin orden expresa

- **Hay operaciones que modifican o borran y son GET** (se disparan con solo abrir la URL): `compras.delete`, `comprasOc.delete`, `ventas.update`, `ventas.delete`, `ventas.deleteNotaVenta`, `ventasCotizaciones.delete`, `contabilidad.createDiario`.
- `gestor-sql.runQueryById` ejecuta consultas SQL guardadas en la empresa (ver qué hace antes de usarlo).
- Nombres sucios en la spec: `productosStock.listolddddd`, `tareas.listttt` (restos de desarrollo).
- Las escrituras (`*.create`, `*.update`, `ventas.create` con XML, `emailSender.send`, `crm.sendwhatsapp`, `ventasCobros.create`) **actúan de verdad**. Probar primero contra el servidor **TEST** (`api-test1`) si el token lo permite (no probado).
- `compras.create/update` y `comprasOc.create/update` reciben `{docs: [...]}` (lista de documentos).

## 9. Pendientes que salen de esta revisión

1. Cambiar el cron a **`id_dcto_desde`** (NO `fecha_desde`, que omite OC): guardar el id de la última OC vista y pedir solo las posteriores; probar antes `id_dcto_desde` en `comprasOc.listItems` (una llamada para las líneas de todas las OC nuevas en vez de una por OC) y en `compras.list` — baja el consumo diario a una fracción.
2. Leer y guardar `endpoint-rate-limit-used/remaining` por método y avisar/cortar antes de llegar a 1.500.
3. Marcar «pagada» con `ventasCobros.list` (fecha real) en vez de la fecha de detección.
4. Probar si el token funciona contra `api-test1.obuma.cl`.
5. Mandar el correo a Obuma pidiendo subir el límite por método (el correo se redactó el 24-nov; ahora con cifras reales).
