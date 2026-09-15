-- migration-110-compras-historial-oc-local.sql
-- Pedido explícito del usuario (14-sep-2026): "necesito que esté todo en nuestra base de datos así
-- es más rápido y los avisos que me dé son más eficientes". Hasta acá, el historial de compras
-- (OC + ítems) se consultaba EN VIVO contra Obuma cada vez que alguien abría una ficha de proveedor
-- o buscaba un producto — lento (varias llamadas HTTP por consulta) y no permitía cruzar contra los
-- ítems que se están cotizando SIN antes buscar producto por producto contra la API.
--
-- Ahora las órdenes de compra reales (cabecera) y sus ítems se guardan localmente:
--   - compras_historial_oc: 1 fila por OC de Obuma (cabecera). La sincronización de cabeceras es
--     barata (~4 llamadas paginadas para las ~4.000 OC de la empresa, ver comprasOcCompleto).
--   - compras_historial_oc_item: 1 fila por línea de producto de esa OC. Traer los ÍTEMS es caro
--     (una llamada POR CADA OC — no hay endpoint que los traiga todos de una vez), así que se
--     sincroniza INCREMENTAL: `items_sincronizados_at` marca qué OC ya tiene sus ítems guardados;
--     `sincronizarItemsHistorialOc` en compras-proveedores.ts procesa un lote pendiente por llamada
--     y se puede volver a invocar hasta completar el histórico completo, sin bloquear ni arriesgar
--     la cuota diaria de Obuma en una sola ráfaga.
--
-- Sin FOREIGN KEY (mismo criterio que el resto del módulo de Compras — compras_cotizacion.proveedor_id
-- tampoco la tiene): `historial_oc_id` referencia a compras_historial_oc.id por convención de código,
-- no por constraint de la base.
--
-- Aplicar con `node scripts/aplicar-migration-110.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_historial_oc (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  obuma_compra_oc_id      VARCHAR(60)  NOT NULL,
  obuma_proveedor_id      VARCHAR(60)  NOT NULL,
  folio                   VARCHAR(60)      NULL,
  fecha                   DATETIME         NULL,
  total                   BIGINT           NULL,
  estado                  VARCHAR(60)      NULL,
  items_sincronizados_at  DATETIME         NULL, -- null = todavía no se trajeron los ítems de esta OC
  created_at              DATETIME     NOT NULL,
  updated_at              DATETIME     NOT NULL,
  UNIQUE KEY uk_compras_historial_oc_obuma_id (obuma_compra_oc_id),
  INDEX idx_compras_historial_oc_proveedor (obuma_proveedor_id),
  INDEX idx_compras_historial_oc_pendientes (items_sincronizados_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_historial_oc_item (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  historial_oc_id   INT           NOT NULL, -- referencia a compras_historial_oc.id (sin FK, mismo criterio que el resto del módulo)
  producto_nombre   VARCHAR(300)  NOT NULL,
  cantidad          DECIMAL(12,2)     NULL,
  precio_unitario   BIGINT            NULL,
  subtotal          BIGINT            NULL,
  created_at        DATETIME      NOT NULL,
  INDEX idx_compras_historial_oc_item_oc (historial_oc_id),
  INDEX idx_compras_historial_oc_item_nombre (producto_nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
