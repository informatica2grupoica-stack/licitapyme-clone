-- migration-113-compras-reparto-respaldo.sql
-- Pedido explícito del usuario (14-sep-2026): los hitos del Proceso Administrativo (§11 — "Orden de
-- compra emitida", "Pago registrado", etc.) se marcaban con un simple checkbox, sin poder dejar
-- ningún respaldo de que de verdad pasó. Ahora cada hito puede tener un archivo (opcional) y una
-- nota (OBLIGATORIA al marcar el hito como hecho — se exige en el backend, no solo en la UI).
--
-- Tabla aparte (no columnas nuevas en compras_reparto_administrativo) porque son 6 hitos × 2 campos
-- — más limpio como fila por hito que 12 columnas más en una tabla ya ancha, y escala mejor si en el
-- futuro se agrega un hito nuevo.
--
-- Aplicar con `node scripts/aplicar-migration-113.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_reparto_respaldo (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id              INT           NOT NULL,
  hito                    VARCHAR(40)   NOT NULL, -- mismo enum que HitoReparto en compras-reparto.ts
  nota                    TEXT          NOT NULL,
  archivo_url             VARCHAR(600)      NULL,
  archivo_nombre          VARCHAR(300)      NULL,
  actualizado_por         INT               NULL,
  actualizado_por_nombre  VARCHAR(160)      NULL,
  updated_at              DATETIME      NOT NULL,
  UNIQUE KEY uk_compras_reparto_respaldo (negocio_id, hito)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
