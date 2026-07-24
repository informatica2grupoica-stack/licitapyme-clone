-- migration-49-checklist-comercial-documentos.sql
-- INFORMACIÓN COMERCIAL: soporte para VARIOS documentos por punto del checklist.
--
-- Hasta ahora `checklist_comercial.documento_url`/`documento_nombre` guardaban UN solo
-- archivo por punto, y subir uno nuevo pisaba al anterior. Un punto puede necesitar más
-- de una evidencia (p.ej. la boleta de garantía + el comprobante de la sucursal, o varias
-- cotizaciones de respaldo), así que se separa a una tabla hija: un punto → N documentos.
--
-- Las columnas viejas (documento_url/documento_nombre) se DEJAN en checklist_comercial sin
-- tocar (por si algo externo aún las lee) pero el código deja de escribirlas: todo documento
-- nuevo entra por aquí. Los 4 puntos que ya tenían un documento cargado se migran abajo para
-- no perder esa evidencia.
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklist_comercial_documentos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  item_id            INT          NOT NULL,
  negocio_id         INT          NOT NULL,          -- redundante a propósito: filtrar por negocio sin JOIN
  url                VARCHAR(600) NOT NULL,
  nombre             VARCHAR(300) NOT NULL,
  subido_por         INT          DEFAULT NULL,
  subido_por_nombre  VARCHAR(160) DEFAULT NULL,
  subido_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ccd_item (item_id),
  KEY idx_ccd_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill: los puntos que ya tenían un documento cargado bajo el esquema viejo.
INSERT INTO checklist_comercial_documentos (item_id, negocio_id, url, nombre, subido_por, subido_por_nombre, subido_at)
SELECT id, negocio_id, documento_url, documento_nombre, cargado_por, cargado_por_nombre, COALESCE(cargado_at, created_at)
  FROM checklist_comercial
 WHERE documento_url IS NOT NULL
   AND id NOT IN (SELECT DISTINCT item_id FROM checklist_comercial_documentos);
