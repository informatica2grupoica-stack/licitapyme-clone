-- migration-5-comentarios-pipeline.sql
-- Agrega columna pipeline_estado a comentarios_negocio
-- Ejecutar en Bluehost → phpMyAdmin → pestaña SQL
-- Compatible con MySQL 5.7

ALTER TABLE comentarios_negocio
  ADD COLUMN pipeline_estado VARCHAR(50) NULL
  AFTER etiqueta_id;
