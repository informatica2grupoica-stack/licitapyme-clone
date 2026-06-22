-- migration-19-match-score.sql
-- Agrega columna match_score a alertas_licitaciones.
-- match_score → relevancia 0.000–1.000 calculada por el matcher (app/lib/text-match.ts):
--   título ≈ 1.0 · categoría ≈ 0.8 · items ≈ 0.7 · descripción ≈ 0.65, + bonus multi-campo.
-- Permite ordenar el radar por "Mayor relevancia".
-- El código tiene fallback si esta columna aún no existe (no rompe el cron ni el radar).
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

ALTER TABLE alertas_licitaciones
  ADD COLUMN match_score DECIMAL(4,3) NULL AFTER match_contexto;
