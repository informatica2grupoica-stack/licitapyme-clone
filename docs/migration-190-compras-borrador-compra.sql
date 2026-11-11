-- migration-190-compras-borrador-compra.sql
-- COMPRAS — borrador compartido de «Elegir a quién comprar» (pedido del dueño, 11-nov-2026).
--
-- Las marcas de proveedor por producto eran un borrador en localStorage: cada persona veía solo las suyas.
-- Ahora el borrador vive aquí, una fila por negocio, y todos los del negocio ven lo mismo.
-- NO es la compra oficial: esa sigue en compras_escenario (al pulsar «Elegir esta compra»). Este borrador no toca
-- aprobaciones, SKU ni OC.
-- Multiempresa: cliente_id sale de negocios.cliente_id (COALESCE 1).
--
-- Aplicar con `node scripts/aplicar-migration-190.mjs` (espejo local) o `--produccion`. Idempotente.

CREATE TABLE IF NOT EXISTS compras_borrador_compra (
  negocio_id              INT          NOT NULL PRIMARY KEY,
  cliente_id              INT          NOT NULL DEFAULT 1,
  seleccion_json          LONGTEXT     NOT NULL,          -- {"productoId": cotizacionId, ...}
  actualizado_por         INT          NULL,
  actualizado_por_nombre  VARCHAR(160) NULL,
  updated_at              DATETIME(3)  NOT NULL,
  KEY idx_borrador_compra_cliente (cliente_id)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;
