# Integración con Obuma — inventario completo (22-sep-2026)

Documento de referencia: qué endpoints reales de Obuma están consumidos, en qué archivo del código
vive cada uno, dónde se ve en la pantalla de Compras, cómo se llegó a cada dato (documentado vs.
verificado en vivo) y qué es posible hacer hoy. Sirve como mapa único — antes esta información
estaba repartida entre `docs/BITACORA-MODULO-COMPRAS.md` (17 sesiones) y comentarios en el código.

Fuente de autenticación: header `access-token` (v1.0, `https://api.obuma.cl/v1.0`) — confirmado en
vivo el 4-ago-2026, no está en la documentación pública. v2.0 (Proyectos) pide además un header
`access-url` que la cuenta no tiene contratado — ver §5.

---

## 1. Mapa: endpoint de Obuma → función propia → dónde se usa → qué hace

| Endpoint Obuma (v1.0) | Método | Función en `app/lib/obuma.ts` | Se llama desde | Se ve en |
|---|---|---|---|---|
| `/proveedores.list.json` | GET | `listarProveedores`, `proveedoresObumaCompleto` | `compras-proveedores.ts` | `/compras/proveedores` (catálogo transversal) |
| `/proveedores.findById.json/{id}` | GET | `proveedorPorId` | `obuma-compras.ts`, `compras-proveedores.ts` | resolución interna (no pantalla propia) |
| `/proveedores.findByRut.json/{rut}` | GET | `proveedorPorRut` | `compras-oc-obuma.ts`, `compras-auditor.ts`, `compras-logistica.ts`, `compras-aprendizaje.ts` | modal "Crear proveedor en Obuma", Auditor de Compras |
| `/proveedores.create.json` | POST (escritura) | `crearProveedorObuma` | `compras-oc-obuma.ts` → `POST /api/compras/[negocioId]/orden-compra-obuma/proveedor` | pestaña **Compra, Importación y Logística** → `RepartoAdminCard.tsx`, modal "Crear proveedor en Obuma" |
| `/proveedores.update.json` | POST (escritura) | — (usado solo en el test de reconocimiento de hoy, no hay flujo de producto que actualice un proveedor todavía) | `scripts/scratch/obuma-test-update-proveedor-bancario.mjs` | — |
| `/productosCategorias.list.json`, `/productosSubcategorias.list.json` | GET | `listarCategoriasProductos`, `listarSubcategoriasProductos` | `app/api/compras/obuma-subcategorias` | pestaña **Aprobación y SKU** → formulario de SKU |
| `/productos.list.json` | GET | `listarProductosObuma`, `catalogoObumaCompleto` (interno) | `compras-aprobaciones.ts`, `app/api/compras/obuma-productos-buscar` | formulario de SKU (búsqueda de duplicados en vivo) |
| `/productos.create.json` | POST (escritura) | `crearProductoObuma` | `compras-aprobaciones.ts` → `crearSku()` | pestaña **Aprobación y SKU** → `AprobacionesCompraCard.tsx` |
| `/comprasOc.list.json` | GET | `listarComprasOc`, `comprasOcCompleto` | `obuma-compras.ts`, `compras-auditor.ts`, `compras-aprendizaje.ts`, `compras-proveedores.ts`, `obuma.ts` (gastos por proyecto) | bloque **Compras (Obuma)** de la licitación, Auditor de Compras (proveedor nuevo/antiguo, sugerencia histórica) |
| `/comprasOc.listItems.json` | GET | `listarComprasOcItems` | `obuma-compras.ts`, `compras-proveedores.ts`, `compras-aprendizaje.ts` | sugerencia de proveedor histórico ("ya le compramos esto 20 veces") |
| `/comprasOc.create.json` | POST (escritura) | `crearOrdenCompraObuma` | `compras-oc-obuma.ts` → `crearOrdenCompraParaProveedor()` | pestaña **Compra, Importación y Logística** → "Órdenes de compra (Obuma)" |
| `/comprasDte.list.json` (facturas recibidas) | GET | `listarComprasDte` | `obuma-compras.ts`, `compras-auditor.ts` | bloque **Compras (Obuma)** de la licitación — factura real con XML |
| `/empresaFormasDePago.list.json` | GET | `listarFormasPago`, `mapaFormasPagoCompleto` | `compras-oc-obuma.ts` → `GET /api/compras/obuma-formas-pago` | selector de forma de pago (OC y, desde hoy, proveedor) |
| `/contabilidadCentrosDeCostos.list.json` | GET | `buscarCentroCostoPorLicitacion`, `centrosDeCostoCompleto` (nuevo hoy), `gastosDelProyectoPorLicitacion` (nuevo hoy) | `compras-oc-obuma.ts`, `obuma.ts` | "Órdenes de compra (Obuma)" (centro de costo de la OC) y botón nuevo **"Ver gastos del proyecto en Obuma"** |
| `/empresaSucursales.list.json` | GET | constante `SUCURSAL_TALAGANTE` (verificada en vivo) | `compras-auditor.ts` (bodega de origen para el cálculo logístico) | Auditor de Compras, los 4 escenarios (§8.10) |
| `/proyectos.list.json`, `/proyectos.findById.json` | GET | `listarProyectos`, `proyectoPorId` | solo `scripts/obuma-test.mjs` (prueba) | **bloqueado** — ver §5 |

---

## 2. Rutas API internas (14) que exponen todo lo anterior

| Ruta | Método | Qué hace |
|---|---|---|
| `GET /api/obuma-compras?codigo=` | lectura de BD | Compras de Obuma ya cruzadas para una licitación (las carga el cron, no llama a Obuma en vivo) |
| `GET /api/obuma-compras/factura?codigo=&compraOcId=&dteId=` | lectura de BD + parseo | Factura real parseada (DTE del SII), nunca acepta una URL del cliente |
| `GET /api/obuma-compras/gastos-proyecto?codigo=` | **Obuma en vivo** (nuevo hoy) | Gastos agregados del Proyecto completo (todos los centros de costo hermanos) |
| `GET/POST /api/cron/obuma-compras` | cron diario | `sincronizarComprasObuma()` — barre `comprasOc.list.json`, cruza con licitaciones nuestras |
| `GET /api/compras/obuma-formas-pago` | Obuma en vivo | Formas de pago habilitadas para compras |
| `GET /api/compras/obuma-subcategorias` | Obuma en vivo | Subcategorías de productos (para el SKU) |
| `GET /api/compras/obuma-siguiente-sku` | Obuma en vivo | Siguiente código correlativo por subcategoría |
| `GET /api/compras/obuma-productos-buscar` | Obuma en vivo | Búsqueda de productos existentes (evitar duplicados al crear SKU) |
| `GET/POST /api/compras/[negocioId]/orden-compra-obuma` | Obuma en vivo (POST = escritura) | Listar proveedores del escenario elegido / crear la OC real |
| `GET /api/compras/[negocioId]/orden-compra-obuma/detalle` | Obuma en vivo | Detalle de una OC ya creada |
| `GET/POST /api/compras/[negocioId]/orden-compra-obuma/proveedor` | Obuma en vivo (POST = escritura) | Verificar proveedor por RUT / crear proveedor (con datos bancarios desde hoy) |
| `GET /api/compras/[negocioId]/sku/[skuId]/verificar-obuma` | Obuma en vivo | Confirma que el SKU sigue existiendo en Obuma tal como se guardó |
| `GET /api/compras/proveedores/importar-obuma` | Obuma en vivo | Sincroniza el catálogo completo de proveedores de Obuma a `compras_proveedor` |
| `GET /api/compras/proveedores/[id]/compras-obuma` | Obuma en vivo | Historial de compras de Obuma para un proveedor puntual |

---

## 3. Dónde se ve en pantalla (mapa de navegación)

```
/compras                         → listado de negocios GANADOS con Compras abierto
/compras/proveedores             → catálogo de proveedores sincronizado desde Obuma (botón "Sincronizar con Obuma")
/compras/[negocioId]             → detalle de UN negocio, con pestañas:
  ├─ Tareas                      → sin Obuma
  ├─ Costeo y Auditoría          → AuditorComprasCard: proveedor nuevo/antiguo (consulta Obuma por RUT),
  │                                 sugerencia de proveedor histórico ("le compramos esto 20 veces")
  ├─ Aprobación y SKU            → AprobacionesCompraCard: crear SKU en Obuma (busca duplicados en vivo,
  │                                 usa el código de Obuma como identificador único)
  ├─ Compra, Importación         → RepartoAdminCard: "Órdenes de compra (Obuma)" — verificar/crear proveedor
  │  y Logística                   (con datos bancarios desde hoy), elegir forma de pago y centro de costo,
  │                                 crear la OC real en Obuma
  ├─ Entrega y Cierre            → sin Obuma
  ├─ Documentos                  → sin Obuma
  └─ Actividad                   → sin Obuma

En la ficha de CADA licitación (/licitacion/[codigo]):
  └─ Bloque "Compras (Obuma)"    → lo que compramos de verdad para esa licitación: proveedor, ítems,
                                    factura real con XML (modal), y desde hoy el botón
                                    "Ver gastos del proyecto en Obuma"
```

---

## 4. Cómo se llegó a cada dato — metodología

Tres niveles de confianza, todos anotados en el código con la fecha:

1. **Documentado por Obuma** (`obuma.cl/ayuda/api-integracion`): la mayoría de los campos básicos
   (`proveedor_rut`, `comprasOc.list.json`, `comprasDte.list.json`, etc.) — pero la doc pública es
   incompleta a propósito o por desactualización (varios campos reales no figuran ahí).
2. **Verificado en vivo, solo lectura**: cuando la doc no alcanza, se lee la respuesta REAL de un
   endpoint (ej. `proveedores.list.json` sobre 100 proveedores reales) para ver qué claves trae de
   verdad, sin arriesgar nada — así se confirmaron `proveedor_forma_pago`, `proveedor_banco_cuenta`,
   `proveedor_centro_costo`, `proveedor_nro_cuenta`, `proveedor_tipo_cuenta` y el campo
   `rel_proyecto_id` de `contabilidadCentrosDeCostos.list.json` (ninguno de los dos está en la doc
   pública).
3. **Verificado con una escritura de prueba idempotente**: cuando hacía falta confirmar que un campo
   de un `create`/`update` se acepta de verdad (no solo que aparece en un `list`), se mandó el MISMO
   valor que el registro ya tenía (proveedor real 158108, 22-sep-2026) y se releyó después para
   confirmar que no cambió nada — cero riesgo, confirmación real. Este es el nivel que se usó hoy
   para habilitar los campos bancarios del proveedor.

Regla dura de todo el módulo (ver `feedback_no_inventar_datos_parser` en memoria): nunca se manda un
nombre de campo sin confirmar de alguna de las tres formas de arriba. Por eso `banco_cuenta` y
`rel_tipoproveedor_id` (sin catálogo público — se probaron 4 endpoints candidatos, los 4 dan 404)
quedan como campo de texto libre: el ID hay que saberlo desde el propio formulario web de Obuma.

---

## 5. Qué se puede hacer HOY, y qué sigue bloqueado

**Se puede (v1.0, en producción):**
- Crear el SKU propio en Obuma con verificación de duplicados en vivo.
- Crear proveedores en Obuma con RUT, contacto, dirección **y ahora también** forma de pago, centro
  de costo, banco, tipo y N° de cuenta.
- Emitir la Orden de Compra real a un proveedor (una por proveedor, con IVA calculado, verificada
  post-creación).
- Saber si un proveedor es nuevo o antiguo (consulta a Obuma por RUT).
- Sugerir proveedor histórico por producto/SKU.
- Ver la factura real (XML del SII) de una compra cruzada.
- Agregar los gastos de un Proyecto completo de Obuma (todos sus centros de costo), SIN necesitar
  v2.0 — usando el cruce nuevo por `rel_proyecto_id`.

**Sigue bloqueado — requiere gestión con Obuma, no es un problema de código:**
- Leer el Proyecto en sí (nombre, ficha, estado) — vive en v2.0, pide el header `access-url`, que es
  un módulo pago que hay que contratar con el área comercial de Obuma.
- Registrar pago o factura de compra por API — `comprasPagos.list.json` y `comprasDte.list.json` son
  de solo lectura, Obuma no ofrece un endpoint de creación para ninguno de los dos (se confirmó
  releyendo la doc completa) — esos hitos siguen siendo registro manual, correcto según la spec
  (§11.1: "el módulo controla y registra el estado, no los ejecuta").
- Catálogo de bancos y de tipos de proveedor — no existe endpoint público (4 candidatos probados, 4
  con 404). Esos dos campos quedan como ID de texto libre hasta que Obuma confirme un endpoint.

---

## 6. Capturas de pantalla

Pendiente — se agregan cuando el usuario inicia sesión y se recorren las 3 pantallas señaladas en
§3 (Auditor de Compras, Aprobación y SKU, Órdenes de compra Obuma + bloque de la licitación).
