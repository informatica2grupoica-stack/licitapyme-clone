-- migration-129-auditor-compra-comercial.sql
-- AUDITOR DE COMPRA (etapa comercial, 28-sep-2026): pestaña propia del negocio, debajo del
-- Auditor Técnico, visible solo cuando el negocio ganó (hayGanado). Por cada producto del Costeo
-- (negocio_costeo_editor) muestra su link y precio web (ya existen ahí, no se duplican) y agrega
-- lo que faltaba: si el producto SE COTIZÓ de verdad o no, y si se cotizó por fuera de la web
-- (proveedor directo), el documento de cotización formal de respaldo.
--
-- fila_id = FilaEditorCosteo.id (misma clave estable dentro de negocio_costeo_editor.datos_json
-- que ya usa compras_auditor_costeo_linea, migration-128) — así una fila conserva su estado aunque
-- se reordene o se recargue el costeo.
--
-- Aplicar con `node scripts/aplicar-migration-129.mjs` (idempotente).

CREATE TABLE IF NOT EXISTS negocio_auditor_compra_linea (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  fila_id VARCHAR(40) NOT NULL,
  cotizado TINYINT(1) NOT NULL DEFAULT 0,
  documento_url VARCHAR(1000) NULL,
  documento_nombre VARCHAR(300) NULL,
  actualizado_por INT NULL,
  actualizado_por_nombre VARCHAR(160) NULL,
  actualizado_at DATETIME NOT NULL,
  UNIQUE KEY uk_auditor_compra_linea (negocio_id, fila_id),
  INDEX idx_auditor_compra_linea_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
