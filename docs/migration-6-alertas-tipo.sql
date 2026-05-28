-- migration-6-alertas-tipo.sql
-- Agrega columna licitacion_tipo a alertas_licitaciones
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

ALTER TABLE alertas_licitaciones
  ADD COLUMN licitacion_tipo VARCHAR(20) NULL
  AFTER licitacion_region;

-- Índice para filtrado por tipo (opcional pero recomendado)
CREATE INDEX idx_alertas_tipo ON alertas_licitaciones (licitacion_tipo);
