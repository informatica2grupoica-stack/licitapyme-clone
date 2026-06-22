-- migration-15-documentos-detalle.sql
-- Guarda el detalle por documento del análisis exhaustivo: cuáles se analizaron
-- (texto extraído OK) y cuáles quedaron pendientes y por qué (escaneado ilegible,
-- formato no soportado .rar/.zip, plano/imagen, error de descarga).
-- Permite mostrar en la ficha "X de Y documentos analizados".
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

ALTER TABLE analisis_ia_licitacion
  ADD COLUMN documentos_detalle JSON NULL AFTER documento_analizado;
