-- migration-180: ORDEN DE COMPRA PROPIA (05-nov-2026, pedido del dueño).
-- Comercial MP no está en Obuma (Obuma es solo de Inversiones Claro). Cuando un negocio es de Comercial MP y la mercadería la
-- tiene Inversiones Claro, Comercial MP le emite una OC desde Licitank (folio propio MP-año-correlativo, PDF con su logo) y
-- después se sube a mano la factura de Inversiones Claro para emparejarla con esa OC.
-- Aplicar con `node scripts/aplicar-migration-180.mjs` (espejo local) o `--produccion` (solo con OK del dueño). Idempotente.

CREATE TABLE IF NOT EXISTS compras_oc_propia (
  id                         INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id                 INT           NOT NULL,
  empresa_rut                VARCHAR(20)   NOT NULL,   -- quien emite (Comercial MP)
  folio                      VARCHAR(40)   NOT NULL,   -- MP-2026-0001
  anio                       SMALLINT      NOT NULL,
  correlativo                INT           NOT NULL,
  proveedor_nombre           VARCHAR(300)  NOT NULL,
  proveedor_rut              VARCHAR(20)   NOT NULL,
  proveedor_giro             VARCHAR(300)      NULL,
  proveedor_direccion        VARCHAR(300)      NULL,
  proveedor_email            VARCHAR(160)      NULL,
  proveedor_telefono         VARCHAR(40)       NULL,
  items_json                 TEXT          NOT NULL,   -- [{productoId, codigo, descripcion, cantidad, precio}]
  neto                       DECIMAL(14,2) NOT NULL,
  iva                        DECIMAL(14,2) NOT NULL,
  total                      DECIMAL(14,2) NOT NULL,
  fecha_oc                   DATE          NOT NULL,
  fecha_entrega              DATE              NULL,
  forma_pago                 VARCHAR(150)      NULL,
  direccion_despacho         VARCHAR(300)      NULL,
  condiciones                TEXT              NULL,
  estado                     VARCHAR(20)   NOT NULL DEFAULT 'EMITIDA',  -- EMITIDA | FACTURADA | ANULADA
  factura_folio              VARCHAR(40)       NULL,
  factura_fecha              DATE              NULL,
  factura_neto               DECIMAL(14,2)     NULL,
  factura_total              DECIMAL(14,2)     NULL,
  factura_url                VARCHAR(700)      NULL,
  factura_nombre             VARCHAR(255)      NULL,
  factura_emparejo           VARCHAR(20)       NULL,   -- REFERENCIA (la factura cita el folio) | MONTO (mismo neto, confirmado) | MANUAL (PDF)
  factura_subida_por         INT               NULL,
  factura_subida_por_nombre  VARCHAR(160)      NULL,
  factura_subida_at          DATETIME          NULL,
  anulada_motivo             VARCHAR(500)      NULL,
  creado_por                 INT               NULL,
  creado_por_nombre          VARCHAR(160)      NULL,
  created_at                 DATETIME      NOT NULL,
  UNIQUE KEY uq_compras_oc_propia_folio (empresa_rut, anio, correlativo),
  INDEX idx_compras_oc_propia_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
