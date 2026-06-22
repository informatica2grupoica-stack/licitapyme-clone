-- Migration 12: Columna categoria en documentos_cache
-- Permite persistir la clasificación IA de cada documento (Gemini Clasificador v1.3)
-- Ejecutar en Bluehost phpMyAdmin

ALTER TABLE documentos_cache
  ADD COLUMN categoria VARCHAR(50) NULL AFTER documento_nombre;
