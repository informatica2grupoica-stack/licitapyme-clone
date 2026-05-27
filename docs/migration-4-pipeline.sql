-- migration-4-pipeline.sql
-- Agrega columna estado_pipeline a negocios
-- Ejecutar en Bluehost → phpMyAdmin → pestaña SQL
-- Compatible con MySQL 5.7

ALTER TABLE negocios
  ADD COLUMN estado_pipeline VARCHAR(50) NULL DEFAULT '1ASIGNADO'
  AFTER licitacion_descripcion;
