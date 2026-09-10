-- migration-106-compras-orden-compra-obuma.sql
-- MÓDULO DE COMPRAS — Órdenes de compra REALES contra Obuma (spec §11.1: "estos hitos los EJECUTA
-- OBUMA" — hasta ahora "Orden de compra emitida" era un checkbox manual, mismo criterio de
-- confianza que "el usuario dice que pasó" sin verificarlo). Pedido explícito del usuario
-- (10-sep-2026, con confirmación de soporte de Obuma de que /comprasOc.create.json existe y
-- funciona): crear la OC de verdad en Obuma desde Licitank, quedar registrada allá, y guardar acá
-- el vínculo — no un número tipeado a mano.
--
-- UNA FILA POR PROVEEDOR (pedido explícito: "las ordenes de compra son por proveedor") — un negocio
-- con productos de 3 proveedores distintos genera hasta 3 órdenes de compra separadas, cada una con
-- SUS ítems nada más. `items_json` es la foto de qué se pidió y a qué precio en el momento de crear
-- la OC (igual que `compras_escenario.detalle_json`) — no se recalcula después: si el escenario
-- cambia más adelante, esta OC ya emitida no debe mentir sobre lo que de verdad se mandó.
--
-- Aplicar con `node scripts/aplicar-migration-106.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_orden_compra_obuma (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id            INT           NOT NULL,
  proveedor_id          INT               NULL,  -- FK lógica a compras_proveedor (sin FK dura, mismo criterio que el resto del módulo)
  proveedor_nombre      VARCHAR(300)  NOT NULL,
  proveedor_rut         VARCHAR(20)       NULL,
  obuma_compra_oc_id    VARCHAR(40)   NOT NULL,   -- comprasOc.create.json → compra_oc_id devuelto por Obuma
  obuma_folio           VARCHAR(40)       NULL,   -- el folio legible que Obuma asigna (confirmado al releer)
  items_json            TEXT          NOT NULL,   -- foto de los ítems mandados (productoId, descripción, cantidad, precio, subtotal)
  incluye_flete         TINYINT(1)    NOT NULL DEFAULT 0,
  flete_monto           DECIMAL(14,2)     NULL,
  subtotal_neto         DECIMAL(14,2) NOT NULL,   -- mercadería, sin flete
  total_neto            DECIMAL(14,2) NOT NULL,   -- mercadería + flete (si incluye_flete)
  forma_pago_codigo     VARCHAR(40)       NULL,
  forma_pago_nombre     VARCHAR(150)      NULL,
  fecha_oc              DATE          NOT NULL,
  creado_por            INT               NULL,
  creado_por_nombre     VARCHAR(160)      NULL,
  created_at            DATETIME      NOT NULL,
  UNIQUE KEY uq_compras_oc_obuma_negocio_proveedor (negocio_id, proveedor_id),
  INDEX idx_compras_oc_obuma_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
