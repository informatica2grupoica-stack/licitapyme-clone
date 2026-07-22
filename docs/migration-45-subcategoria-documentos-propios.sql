-- Migration 45: columna subcategoria en documentos_cache
-- Permite organizar manualmente los "Documentos Propios" en cajas definidas por el
-- usuario (ej: "Cotización", "Anexos firmados"). Es 100% manual — arrastrar y soltar
-- en el front. NO tiene relación con la clasificación IA (columna `categoria`), que
-- sigue existiendo solo para los documentos oficiales de la licitación.
-- Ejecutar en Bluehost phpMyAdmin.

ALTER TABLE documentos_cache
  ADD COLUMN subcategoria VARCHAR(80) NULL AFTER categoria;
