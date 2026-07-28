-- migration-55-congelamiento.sql
-- CONGELAMIENTO Y TRASPASO A COMPRAS (Auditor Técnico, Fase 7, spec §12) — al postular, el
-- Auditor se congela y queda como registro histórico inmutable (spec §12.1). Esta tabla es
-- ese registro: una fila por negocio, escrita UNA sola vez (INSERT IGNORE — nunca se
-- sobreescribe), con el paquete de traspaso completo que alimentaría el módulo de Compras
-- (spec §12.2/12.3).
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL, o con
-- `node scripts/aplicar-migration-55.mjs`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklist_comercial_congelamiento (
  negocio_id            INT          NOT NULL PRIMARY KEY,
  congelado_at          DATETIME     NOT NULL,
  congelado_por         INT          DEFAULT NULL,
  congelado_por_nombre  VARCHAR(160) DEFAULT NULL,
  paquete_traspaso       LONGTEXT     NOT NULL   -- JSON: PaqueteTraspaso (ver app/lib/congelamiento.ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
