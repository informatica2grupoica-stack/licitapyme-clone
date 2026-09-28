-- migration-130-auditor-compra-cotizaciones.sql
-- AUDITOR DE COMPRA — cotizaciones por documento (28-sep-2026). Hasta acá cada fila guardaba a lo
-- más UN documento propio, y ningún precio distinto del "precio web" ya cargado en el Costeo.
-- Pedido del usuario: una cotización real puede venir en UN SOLO documento que cubre VARIOS
-- productos a la vez, y cada producto cotizado así trae su propio precio nuevo (el de la
-- cotización, no el de la web) — hay que poder guardarlo y mostrarlo.
--
--   negocio_auditor_compra_cotizacion → un documento de cotización subido (puede cubrir 1+ filas
--                                       del Costeo a la vez).
--   negocio_auditor_compra_linea      → se le agregan `cotizacion_id` (a qué documento pertenece,
--                                       si vino de uno) y `precio_cotizado` (el precio nuevo de esa
--                                       cotización para ESTA fila puntual — cada producto dentro
--                                       de un mismo documento puede traer un precio distinto).
--                                       documento_url/documento_nombre (migration-129) se
--                                       mantienen como respaldo legado de cuando el documento
--                                       vivía suelto por fila, sin cotización agrupadora.
--
-- Aplicar con `node scripts/aplicar-migration-130.mjs` (idempotente).

CREATE TABLE IF NOT EXISTS negocio_auditor_compra_cotizacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  documento_url VARCHAR(1000) NOT NULL,
  documento_nombre VARCHAR(300) NULL,
  creado_por INT NULL,
  creado_por_nombre VARCHAR(160) NULL,
  creado_at DATETIME NOT NULL,
  INDEX idx_auditor_compra_cotizacion_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- (el script aplicador comprueba si las columnas ya existen antes de correr estos ALTER)
ALTER TABLE negocio_auditor_compra_linea
  ADD COLUMN cotizacion_id INT NULL;
ALTER TABLE negocio_auditor_compra_linea
  ADD COLUMN precio_cotizado DECIMAL(14,2) NULL;
