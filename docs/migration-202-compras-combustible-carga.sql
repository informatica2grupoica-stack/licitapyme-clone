-- migration-202: datos de una carga de combustible (gasto extra «Combustible», 20-nov-2026).
-- Cada carga es un servicio de Compras (compras_producto.es_servicio, servicio_tipo = 'COMBUSTIBLE', VARCHAR(20) ya alcanza: sin cambio de columna).
-- Aquí van los datos que no caben en el producto: litros, tipo, neto afecto, impuesto específico (exento de IVA) y patente.
-- La OC en Obuma sale con dos líneas (combustible afecto + «impuesto especifico» exento), como la OC 4058. Sin FK dura (criterio del módulo).
-- Aplicar con: node scripts/aplicar-migration-202.mjs   (espejo local por defecto; --produccion solo con OK del dueño).
CREATE TABLE IF NOT EXISTS compras_combustible_carga (
  producto_id          INT           NOT NULL PRIMARY KEY,
  negocio_id           INT           NOT NULL,
  tipo_combustible     VARCHAR(20)   NOT NULL,
  litros               DECIMAL(10,2) NOT NULL,
  neto_afecto          DECIMAL(14,0) NOT NULL,
  impuesto_especifico  DECIMAL(14,0) NOT NULL DEFAULT 0,
  patente              VARCHAR(10)   NULL,
  created_at           DATETIME      NOT NULL,
  KEY idx_ccc_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
