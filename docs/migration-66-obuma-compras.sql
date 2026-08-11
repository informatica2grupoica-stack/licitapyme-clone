-- migration-66-obuma-compras.sql
-- COMPRAS de Obuma (ERP de compras/proveedores) cruzadas contra nuestras licitaciones.
--
-- POR QUÉ: la orden de compra de Mercado Público (tabla ordenes_compra, migration-64) es la VENTA
-- — lo que el organismo nos compra. Esta tabla es el otro lado: lo que NOSOTROS compramos para
-- cumplir esa licitación (proveedor, ítems, monto) según nuestro propio ERP.
--
-- CÓMO SE CRUZA (probado en vivo el 11-ago-2026, ver app/lib/obuma-compras.ts): la API v2.0 de
-- Obuma (módulo Proyectos, que habría permitido cruzar por centro_costo) NO está operativa incluso
-- con key — confirmado con /proyectos.list.json devolviendo 404 en v1.0 y v2.0 sin acceso. El
-- cruce real es MÁS SIMPLE: comprasOc.list.json (v1.0, ya accesible) trae un campo de texto libre
-- `compra_oc_referencia` donde el usuario escribe a mano el código de la licitación
-- ("PR-177 ID1471-8-LE26 DGAC") — se cruza con el mismo mecanismo de texto que ya usa
-- ordenes_compra (mencionaCodigo). La factura tributaria (DTE/XML) queda FUERA a propósito: el
-- campo que debería unir un DTE con su comprasOc (`dte.rel_compra_id`) viene en "0" en el 100% de
-- una muestra real — cruzarla por proveedor+monto+fecha sería adivinar, no matchear.
--
-- Solo se guardan compras que SÍ mencionan una licitación nuestra — no es un espejo del ERP
-- completo (~16.700 compras totales), es la vista cruzada que pidió el usuario.
--
-- Idempotente: se puede correr dos veces sin romper nada.

CREATE TABLE IF NOT EXISTS obuma_compras (
  id                    INT AUTO_INCREMENT PRIMARY KEY,

  -- Identificación en Obuma. `compra_oc_id` es la huella única (interno de Obuma, estable).
  compra_oc_id          VARCHAR(30)  NOT NULL,
  folio                 VARCHAR(30)  DEFAULT NULL,
  fecha_ingreso         DATETIME     DEFAULT NULL,

  -- Texto tal cual lo escribió el usuario en Obuma, y el código que se extrajo de ahí.
  referencia            VARCHAR(400) DEFAULT NULL,
  licitacion_codigo     VARCHAR(60)  DEFAULT NULL,
  -- Empresa nuestra dueña de esa licitación (viene del negocio, no de un RUT — a diferencia de
  -- ordenes_compra, acá no hay ambigüedad de "puede ser del competidor": es nuestro propio ERP,
  -- todo lo que hay adentro es nuestro.
  empresa_id            INT          DEFAULT NULL,

  estado                VARCHAR(60)  DEFAULT NULL,   -- compra_oc_estado tal cual la entrega Obuma (ej. "EMITIDA")
  centro_costo          VARCHAR(30)  DEFAULT NULL,

  subtotal              DECIMAL(18,2) DEFAULT NULL,
  neto                  DECIMAL(18,2) DEFAULT NULL,
  iva                   DECIMAL(18,2) DEFAULT NULL,
  total                 DECIMAL(18,2) DEFAULT NULL,

  -- Proveedor (a quién le compramos). Resuelto una vez vía proveedores.findById y cacheado acá —
  -- comprasOc.list.json solo trae el id (`rel_proveedor_id`), no el nombre.
  proveedor_id          VARCHAR(30)  DEFAULT NULL,
  proveedor_rut         VARCHAR(20)  DEFAULT NULL,
  proveedor_razon_social VARCHAR(300) DEFAULT NULL,

  items_json            LONGTEXT     DEFAULT NULL,   -- comprasOc.listItems.json tal cual
  raw_json               LONGTEXT    DEFAULT NULL,   -- fila completa de comprasOc.list.json, por si mañana hace falta un campo más

  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_obuma_compra_oc_id (compra_oc_id),
  KEY idx_obuma_licitacion (licitacion_codigo),
  KEY idx_obuma_empresa (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- OJO con la collation: utf8mb4_general_ci, la MISMA que ordenes_compra/negocios — ver la bitácora
-- de collations (project_collation_joins_rotos), 4 tablas quedaron en unicode_ci y sus cruces por
-- licitacion_codigo mueren en silencio.
