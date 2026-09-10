-- migration-102-compras-gastos.sql
-- MÓDULO DE COMPRAS — Registro de gastos (pedido explícito del usuario 09-sep-2026): "aparte de los
-- productos que tiene la licitación a veces salen gastos extras... aplicar más ítems si es
-- necesario como el mismo flete, horas extras o productos", y verlos TODOS juntos para saber cuánto
-- se gastó realmente en el negocio — no mezclado dentro de la tarjeta de Entrega, que es sobre la
-- ENTREGA física (acta, firmas), no sobre plata. Esta es la primera vez que el módulo registra un
-- costo REAL incurrido — todo lo anterior (escenarios §8.10, costo aterrizado §12.3) es una
-- ESTIMACIÓN para decidir/comparar, no un gasto que de verdad se pagó.
--
-- Catálogo editable (§1.3.5 — "ningún catálogo se cablea en código"), mismo patrón que
-- compras_incidencia_tipo: se siembra con las categorías obvias (flete, horas extras, producto
-- extra, otro) y se puede promover una categoría nueva desde texto libre.
--
-- Aplicar con `node scripts/aplicar-migration-102.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS +
-- INSERT IGNORE de las categorías base.

CREATE TABLE IF NOT EXISTS compras_gasto_categoria (
  clave                      VARCHAR(64)  NOT NULL PRIMARY KEY,
  etiqueta                   VARCHAR(150) NOT NULL,
  orden                      INT          NOT NULL DEFAULT 999,
  activo                     TINYINT(1)   NOT NULL DEFAULT 1,
  promovido_de_texto_libre   TINYINT(1)   NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_gasto (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id        INT          NOT NULL,
  categoria_clave   VARCHAR(64)      NULL,  -- FK lógica a compras_gasto_categoria (sin FK dura, mismo criterio que el resto del módulo)
  descripcion       VARCHAR(500) NOT NULL,
  monto             DECIMAL(14,2) NOT NULL,
  moneda            VARCHAR(8)   NOT NULL DEFAULT 'CLP',
  fecha_gasto       DATE             NULL,  -- cuándo ocurrió el gasto (puede diferir de cuándo se registró)
  comprobante_url   VARCHAR(500)     NULL,  -- boleta/factura/foto, si la hay
  notas             TEXT             NULL,
  registrado_por        INT              NULL,
  registrado_por_nombre VARCHAR(160)     NULL,
  created_at        DATETIME     NOT NULL,
  INDEX idx_compras_gasto_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO compras_gasto_categoria (clave, etiqueta, orden) VALUES
('flete', 'Flete / transporte', 10),
('horas_extras', 'Horas extras', 20),
('producto_extra', 'Producto o insumo extra', 30),
('otro', 'Otro', 999);
