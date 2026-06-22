-- migration-13-analisis-completo.sql
-- Agrega columnas nuevas para el análisis exhaustivo IA.
-- MySQL 5.7 compatible (sin IF NOT EXISTS).
-- Ejecutar en Bluehost → phpMyAdmin → base licitapyme → pestaña SQL

ALTER TABLE analisis_ia_licitacion
  ADD COLUMN plazo_entrega_dias        INT          NULL AFTER plazo_ejecucion_dias,
  ADD COLUMN modalidad_adjudicacion    VARCHAR(200) NULL,
  ADD COLUMN tipo_contrato             VARCHAR(100) NULL,
  ADD COLUMN lugar_entrega             TEXT         NULL,
  ADD COLUMN contacto                  JSON         NULL,
  ADD COLUMN especificaciones_tecnicas JSON         NULL,
  ADD COLUMN documentos_a_presentar    JSON         NULL,
  ADD COLUMN resumen_bases_admin       JSON         NULL,
  ADD COLUMN resumen_bases_tecnicas    JSON         NULL;
