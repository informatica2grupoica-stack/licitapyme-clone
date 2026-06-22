-- migration-10-match-fuente.sql
-- Agrega columna match_fuente y match_contexto a alertas_licitaciones
-- match_fuente  → dónde se encontró: titulo, descripcion, items (o combinaciones)
-- match_contexto → fragmento del texto donde coincidió la palabra clave
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

ALTER TABLE alertas_licitaciones
  ADD COLUMN match_fuente   VARCHAR(100) NULL AFTER licitacion_tipo,
  ADD COLUMN match_contexto VARCHAR(500) NULL AFTER match_fuente;
