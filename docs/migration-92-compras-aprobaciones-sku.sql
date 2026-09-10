-- migration-92-compras-aprobaciones-sku.sql
-- MÓDULO DE COMPRAS — Compuertas de aprobación (spec §10) y creación de SKU (spec §7).
--
-- COMPUERTAS: dos compuertas SEPARADAS E INDEPENDIENTES (§10.3: "compuerta separada e
-- independiente") — Compra (§10.2) y Margen (§10.3) — modeladas como una sola tabla con `tipo`
-- porque comparten exactamente el mismo ciclo de vida (PENDIENTE → APROBADA/APROBADA_CON_
-- MODIFICACION/RECHAZADA, §10.4) y el mismo mecanismo de invalidación (§10.5: "todo cambio
-- posterior a una aprobación la invalida y devuelve el proyecto a la bandeja" — ver
-- invalidarAprobacionesCompras en app/lib/compras.ts).
--
-- SKU (§7.1-§7.4): se crea DESPUÉS de aprobada la compra. Nomenclatura dura: se nombra por lo que
-- se compra, nunca por lo que pidió el cliente (§7.3). SKU de proveedor es deseable, no obligatorio;
-- SKU de cliente NUNCA se registra (§7 tabla "Código | Obligatoriedad"). La sincronización real con
-- OBUMA queda en standby por decisión propia de la spec (§7.5) — los campos de homologación quedan
-- listos pero se llenan a mano hasta que exista ese enganche.
--
-- Aplicar con `node scripts/aplicar-migration-92.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_aprobacion (
  negocio_id             INT          NOT NULL,
  tipo                   VARCHAR(16)  NOT NULL,  -- COMPRA | MARGEN
  estado                 VARCHAR(24)  NOT NULL DEFAULT 'PENDIENTE',
    -- PENDIENTE | APROBADA | APROBADA_CON_MODIFICACION | RECHAZADA (§10.4)
  detalle_json           LONGTEXT         NULL,  -- snapshot: escenario elegido (COMPRA) o margen calculado (MARGEN)
  motivo                 TEXT             NULL,  -- justificación de escenario no-principal / motivo de margen bajo 20%
  propuesto_por          INT              NULL,
  propuesto_por_nombre   VARCHAR(160)     NULL,
  propuesto_at           DATETIME         NULL,
  resuelto_por           INT              NULL,
  resuelto_por_nombre    VARCHAR(160)     NULL,
  resuelto_at            DATETIME         NULL,
  comentario_resolucion  TEXT             NULL,
  created_at             DATETIME     NOT NULL,
  updated_at             DATETIME     NOT NULL,
  PRIMARY KEY (negocio_id, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_sku (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id          INT          NOT NULL,
  producto_id         INT          NOT NULL,
  sku_propio          VARCHAR(80)  NOT NULL,  -- regla dura §7.3: por lo que COMPRAMOS, no por lo pedido
  sku_proveedor       VARCHAR(80)      NULL,  -- deseable, no obligatorio (§7 tabla de obligatoriedad)
  proveedor_nombre    VARCHAR(300)     NULL,
  marca               VARCHAR(150)     NULL,
  modelo              VARCHAR(150)     NULL,
  verificado_obuma    TINYINT(1)   NOT NULL DEFAULT 0,  -- ¿se buscó en OBUMA antes de crear? (§7.2)
  obuma_producto_id   VARCHAR(60)      NULL,            -- si YA existía (homologación §7.4)
  creado_por          INT              NULL,
  creado_por_nombre   VARCHAR(160)     NULL,
  created_at          DATETIME     NOT NULL,
  UNIQUE KEY uk_compras_sku_producto (producto_id),
  INDEX idx_compras_sku_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
