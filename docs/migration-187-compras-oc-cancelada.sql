-- migration-187-compras-oc-cancelada.sql
-- COMPRAS — la OC del cliente se canceló en Mercado Público (pedido del dueño, 10-nov-2026).
--
-- Cuando el organismo cancela la orden de compra y no queda otra vigente, el negocio sale de Compras
-- a «Compras cerradas» (compras_asignacion.cierre_legado = 'OC_CANCELADA', columna VARCHAR(16) de la
-- migration-107: no se toca). Cada cancelación queda aquí, y los encargados de esa licitación tienen
-- que escribir POR QUÉ se canceló: mientras `fundamento` esté vacío les sale un modal que no se cierra.
--
-- Una fila por (negocio, OC): si el organismo emite otra OC y también la cancela, es otra fila.
-- `cerro_compras` = 0 cuando NO se sacó de Compras porque ya había compras a proveedores emitidas.
-- Multiempresa: cliente_id sale de negocios.cliente_id (COALESCE 1).
--
-- Aplicar con `node scripts/aplicar-migration-187.mjs` (espejo local) o `--produccion`. Idempotente.

CREATE TABLE IF NOT EXISTS compras_oc_cancelacion (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id               INT          NOT NULL DEFAULT 1,
  negocio_id               INT          NOT NULL,
  licitacion_codigo        VARCHAR(40)  NOT NULL,
  oc_codigo                VARCHAR(40)  NOT NULL,
  cancelada_at             DATE         NULL,            -- fecha de cancelación que informa Mercado Público
  cerro_compras            TINYINT(1)   NOT NULL DEFAULT 1,
  fundamento               TEXT         NULL,
  fundamentado_por         INT          NULL,
  fundamentado_por_nombre  VARCHAR(160) NULL,
  fundamentado_at          DATETIME     NULL,
  created_at               DATETIME     NOT NULL,
  UNIQUE KEY uq_oc_cancelacion (negocio_id, oc_codigo),
  KEY idx_oc_cancelacion_cliente_pend (cliente_id, fundamentado_at)
);
