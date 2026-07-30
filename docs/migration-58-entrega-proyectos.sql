-- migration-58-entrega-proyectos.sql
-- MÓDULO DE ENTREGA DE PROYECTOS (Frente F.1) — Fase 1: cimiento de datos.
--
-- Cuando MP confirma que GANAMOS (dato oficial del acta, nunca una etiqueta puesta a mano), se
-- abre una "entrega": el paquete que el área de entrega necesita para tomar el proyecto, más el
-- registro de quién debe acusar recibo y quién ya lo hizo.
--
-- DOS TABLAS, DOS RESPONSABILIDADES:
--   · entrega_proyecto → QUÉ se entrega. Una fila por negocio ganado, con el resumen ejecutivo
--     congelado al momento de ganar. Se congela por la misma razón que el traspaso a Compras
--     (migración 55): es el registro de lo que se comprometió, no una vista que cambia sola.
--   · entrega_acuse   → QUIÉN lo recibió. Una fila por persona que debe reconocer el proyecto.
--     `acusado_at NULL` = todavía no acusa recibo. La alerta deja de ser bloqueante para esa
--     persona cuando su fila tiene fecha.
--
-- POR QUÉ TABLA APARTE Y NO REUSAR `historial_eventos.leido`: "leído" significa que la campana se
-- abrió; "acuso recibo" significa que alguien se hace cargo de un proyecto ganado. Conflactarlos
-- haría que pasar el mouse por la campana cuente como recibir el proyecto.
--
-- CHARSET: utf8mb4_general_ci a propósito — es el de `negocios`/`usuarios`, así los JOINs no
-- mueren con "Illegal mix of collations" (ver migration-24 y el historial de ese problema).
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL, o con
-- `node scripts/aplicar-migration-58.mjs`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS entrega_proyecto (
  negocio_id         INT          NOT NULL PRIMARY KEY,
  licitacion_codigo  VARCHAR(64)  NOT NULL,
  abierta_at         DATETIME     NOT NULL,           -- cuándo se confirmó que ganamos
  origen             VARCHAR(24)  NOT NULL,           -- ACTA_MP | MANUAL (siempre ACTA_MP en Fase 2)
  resumen            LONGTEXT     NOT NULL,           -- JSON: ResumenEjecutivo (app/lib/entrega-proyecto.ts)
  completada_at      DATETIME     DEFAULT NULL,       -- cuándo TODOS acusaron recibo
  INDEX idx_entrega_codigo (licitacion_codigo),
  INDEX idx_entrega_abierta (abierta_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS entrega_acuse (
  negocio_id     INT       NOT NULL,
  usuario_id     INT       NOT NULL,
  notificado_at  DATETIME  NOT NULL,
  acusado_at     DATETIME  DEFAULT NULL,   -- NULL = pendiente (alerta bloqueante activa)
  PRIMARY KEY (negocio_id, usuario_id),
  INDEX idx_acuse_pendiente (usuario_id, acusado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
