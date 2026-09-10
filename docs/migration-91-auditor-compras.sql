-- migration-91-auditor-compras.sql
-- MÓDULO DE COMPRAS — Auditor de Compras (spec §8). Es un SUGERIDOR, no un comparador: recibe
-- cotizaciones en cualquier formato (PDF, imagen, WhatsApp, texto, correo, llamada — §8.3),
-- las homologa por SIGNIFICADO contra los productos ganados (§8.6, no por nombre), dictamina
-- cumplimiento técnico SIN excluir a nadie salvo "producto totalmente distinto" (§8.8.1) y arma
-- 4 escenarios de compra ponderando precio + logística (§8.10).
--
-- CUATRO TABLAS:
--   · compras_cotizacion       → una fila por cotización recibida de un proveedor (puede cubrir
--     varios productos: ver compras_cotizacion_item). Incluye el registro manual de cotización
--     telefónica (§8.4: proveedor, RUT, precio, plazo, flete, nuevo/antiguo, quién y cuándo).
--   · compras_cotizacion_item  → el veredicto de la cotización PARA UN PRODUCTO puntual: cumple,
--     mejora (Oportunidad de Mejora embrionaria, §8.8.1), inferior negociable, inferior insalvable,
--     o "no es el producto" (único caso de exclusión real).
--   · compras_veredicto        → resumen del Auditor de Compras (IA) para un producto: qué
--     características son negociables y cuáles insalvables (§8.8.2), y detección de espacio de
--     negociación (§8.9).
--   · compras_escenario        → los 4 escenarios (§8.10.3) recalculados cada vez que cambian las
--     cotizaciones homologadas de un negocio.
--
-- Aplicar con `node scripts/aplicar-migration-91.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_cotizacion (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id            INT          NOT NULL,
  proveedor_nombre      VARCHAR(300) NOT NULL,
  proveedor_rut         VARCHAR(20)      NULL,
  proveedor_nuevo       TINYINT(1)       NULL,  -- NULL = todavía no consultado en OBUMA (§8.5)
  origen                VARCHAR(16)  NOT NULL DEFAULT 'texto', -- pdf|imagen|whatsapp|texto|correo|llamada
  descripcion_libre     TEXT             NULL,  -- lo que dijo el proveedor, tal cual, antes de homologar
  precio_unitario       DECIMAL(18,2)    NULL,
  precio_total          DECIMAL(18,2)    NULL,
  moneda                VARCHAR(6)   NOT NULL DEFAULT 'CLP',
  plazo_entrega_texto   VARCHAR(200)     NULL,
  plazo_entrega_dias    INT              NULL,
  incluye_flete         TINYINT(1)       NULL,
  direccion_bodega      VARCHAR(300)     NULL,
  ficha_tecnica_url     VARCHAR(600)     NULL,
  archivo_url           VARCHAR(600)     NULL,  -- la cotización misma (PDF/imagen/captura)
  archivo_nombre        VARCHAR(300)     NULL,
  registrado_por        INT              NULL,
  registrado_por_nombre VARCHAR(160)     NULL,
  tomada_at             DATETIME     NOT NULL,  -- cuándo se tomó (puede ser distinto de created_at si se carga después)
  vigencia_at           DATE             NULL,   -- §8.12: no obligatorio, no genera alerta
  notas                 TEXT             NULL,
  homologada_at         DATETIME         NULL,   -- cuándo corrió el Auditor de Compras sobre esta cotización
  created_at            DATETIME     NOT NULL,
  INDEX idx_compras_cotiz_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_cotizacion_item (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  cotizacion_id  INT          NOT NULL,
  producto_id    INT          NOT NULL,
  precio_unitario DECIMAL(18,2) NULL,
  cumple         VARCHAR(24)  NOT NULL DEFAULT 'CUMPLE',
    -- CUMPLE | MEJORA | INFERIOR_NEGOCIABLE | INFERIOR_INSALVABLE | NO_ES_EL_PRODUCTO
  detalle_desviacion TEXT     NULL,  -- ej. "mesa de 39cm vs 40cm exigidos" (§8.8.1)
  UNIQUE KEY uk_cotiz_producto (cotizacion_id, producto_id),
  INDEX idx_compras_cotiz_item_producto (producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_veredicto (
  producto_id    INT          NOT NULL PRIMARY KEY,
  resumen_ia     TEXT             NULL,  -- puntos críticos negociables vs insalvables (§8.8.2)
  espacio_negociacion_json LONGTEXT NULL, -- diferencias de precio entre cotizaciones del mismo producto (§8.9)
  generado_at    DATETIME         NULL,
  modelo         VARCHAR(60)      NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_escenario (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id    INT          NOT NULL,
  tipo          VARCHAR(24)  NOT NULL, -- MAS_RAPIDO | MINIMO_PRECIO | MINIMOS_VIAJES | EQUILIBRADO
  detalle_json  LONGTEXT     NOT NULL, -- qué cotización se eligió por producto, agrupación por proveedor, viajes
  costo_total   DECIMAL(18,2)    NULL,
  dias_estimados INT             NULL,
  viajes_estimados INT            NULL,
  generado_at   DATETIME     NOT NULL,
  elegido       TINYINT(1)   NOT NULL DEFAULT 0,
  elegido_justificacion TEXT NULL,  -- obligatoria si se elige uno distinto de MAS_RAPIDO (§8.10.4)
  elegido_por   INT              NULL,
  elegido_por_nombre VARCHAR(160) NULL,
  elegido_at    DATETIME         NULL,
  UNIQUE KEY uk_compras_escenario (negocio_id, tipo, generado_at),
  INDEX idx_compras_escenario_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
