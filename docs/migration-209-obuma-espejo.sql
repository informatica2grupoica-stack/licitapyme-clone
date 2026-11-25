-- migration-209: espejo completo de Obuma en nuestra BD (plan «LICITANK 100 % en la BD», Fase 2).
-- Una sola tabla para todas las entidades de Obuma (compras, OC, facturas recibidas, gastos, pagos, ventas/guías, cobros,
-- clientes, productos, proveedores), con las columnas comunes sacadas a la vista (para que el chatbot consulte fácil)
-- y la fila COMPLETA de Obuma en raw_json (para no perder ningún campo).
-- Multiempresa: cada fila lleva cliente_id (hoy 1 = Grupo ICA; la cuenta de Obuma sale del .env y se hará por cliente después).
-- Idempotente.

CREATE TABLE IF NOT EXISTS obuma_registro (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  cliente_id       INT          NOT NULL DEFAULT 1,
  entidad          VARCHAR(30)  NOT NULL,   -- compra | compra_oc | compra_dte | gasto | pago_compra | venta | cobro_venta | cliente | producto | proveedor
  obuma_id         VARCHAR(40)  NOT NULL,   -- id propio de Obuma
  tipo_dcto        VARCHAR(10)  DEFAULT NULL, -- venta: 33 factura, 52 guía de despacho, 61 nota de crédito. compra: tipo de documento
  folio            VARCHAR(40)  DEFAULT NULL,
  fecha            DATETIME     DEFAULT NULL,
  contraparte_id   VARCHAR(40)  DEFAULT NULL, -- proveedor o cliente de Obuma
  contraparte_rut  VARCHAR(20)  DEFAULT NULL,
  contraparte_nombre VARCHAR(300) DEFAULT NULL,
  neto             DECIMAL(18,2) DEFAULT NULL,
  iva              DECIMAL(18,2) DEFAULT NULL,
  total            DECIMAL(18,2) DEFAULT NULL,
  pagado           DECIMAL(18,2) DEFAULT NULL,
  estado           VARCHAR(60)  DEFAULT NULL,
  centro_costo     VARCHAR(40)  DEFAULT NULL,
  referencia       VARCHAR(400) DEFAULT NULL, -- texto libre (en OC: donde se escribe la licitación)
  rel_documento_id VARCHAR(40)  DEFAULT NULL, -- pago/cobro → compra o venta a la que pertenece
  raw_json         LONGTEXT     NOT NULL,
  sincronizado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_obuma_registro (cliente_id, entidad, obuma_id),
  KEY idx_obuma_reg_fecha (cliente_id, entidad, fecha),
  KEY idx_obuma_reg_contraparte (cliente_id, entidad, contraparte_id),
  KEY idx_obuma_reg_folio (cliente_id, entidad, folio),
  KEY idx_obuma_reg_rel (cliente_id, entidad, rel_documento_id),
  KEY idx_obuma_reg_cc (cliente_id, centro_costo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS obuma_sync_estado (
  cliente_id     INT          NOT NULL DEFAULT 1,
  entidad        VARCHAR(30)  NOT NULL,
  total_obuma    INT          DEFAULT NULL,   -- «data-total-items» que declara Obuma en la última pasada
  filas_local    INT          DEFAULT NULL,   -- filas que tenemos de esa entidad después de la pasada
  llamadas       INT          DEFAULT NULL,   -- llamadas a la API que gastó la última pasada
  ultima_sync    DATETIME     DEFAULT NULL,
  ultimo_error   VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (cliente_id, entidad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
