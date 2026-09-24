-- migration-127-comparador-fichas.sql
-- AUDITOR TÉCNICO · COMPARADOR DE FICHAS (PROMPT 4 v1.0).
--
-- QUÉ AGREGA: lo que el comparador nuevo guarda además del veredicto de siempre —
--   1) checklist_comercial_caracteristicas.analisis_json: por característica, el origen del dato
--      (FICHA / CONFIRMACION_INFORMAL / DECLARADO / CONTRADICE_FICHA / HEREDADO / NO_LEGIBLE), la
--      marca SOBRECUMPLE, el emparejamiento o la equivalencia normativa propuestos (esperan
--      confirmación humana), el conflicto entre fichas, los CINCO campos de ayuda, la
--      reverificación de rojos, el ámbito (técnico / técnico-administrativo) y el check de
--      confirmación de los compromisos.
--   2) auditor_comparador_linea: una fila por línea con lo que es de la LÍNEA y no de una
--      característica — inventario de fichas, mapa ficha↔línea, archivos sin asignar, mensajes al
--      proveedor y lo que no se pudo leer.
-- tipo (VARCHAR(20)) ya cabe CUALITATIVO / NORMATIVO: no hace falta tocar la columna.
-- Sin FOREIGN KEY (mismo criterio que la familia checklist_comercial_*).
-- Aplicar: node scripts/aplicar-migration-127.mjs   (idempotente)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE checklist_comercial_caracteristicas ADD COLUMN analisis_json MEDIUMTEXT NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS auditor_comparador_linea (
  item_id        INT NOT NULL PRIMARY KEY,   -- checklist_comercial.id (tipo='linea_tecnica')
  negocio_id     INT NOT NULL,
  resultado_json MEDIUMTEXT NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
