-- migration-52-bandeja-aprobaciones.sql
-- BANDEJA DE APROBACIÓN TRANSVERSAL (Auditor Técnico, Fase 2) — no crea tablas nuevas: la
-- aprobación de bloque (técnico/comercial) se computa desde checklist_comercial en tiempo real
-- (ver estadoDeBloque() en app/lib/checklist-comercial.ts), no se persiste.
--
-- Esta migración es SOLO un índice de apoyo: hasta ahora todas las consultas a
-- checklist_comercial eran POR NEGOCIO (idx_checklist_negocio ya cubre eso). La bandeja
-- transversal consulta TODOS los negocios a la vez filtrando por (bloque), un patrón de acceso
-- nuevo que idx_checklist_negocio no sirve bien (negocio_id va primero en ese índice).
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL, o con
-- `node scripts/aplicar-migration-52.mjs`.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE checklist_comercial
  ADD INDEX idx_checklist_bloque_estado (bloque, estado, negocio_id);
