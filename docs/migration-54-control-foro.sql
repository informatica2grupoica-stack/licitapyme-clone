-- migration-54-control-foro.sql
-- CONTROL DE CAMBIOS DEL FORO (Auditor Técnico, Fase 6, spec §11) — guarda la "foto" del foro
-- de preguntas/respuestas al momento en que el Auditor Técnico empieza a trabajar sobre el
-- negocio, para poder detectar más adelante si algo cambió (nuevas preguntas, respuestas
-- publicadas, contenido editado). preguntas_respuestas_cache (migración 44) SOBREESCRIBE en
-- cada scrape — sin esta foto no había con qué comparar.
--
-- `ultimo_delta` congela el detalle del último cambio detectado para poder seguir mostrándolo
-- en la pestaña Auditor Técnico aun después de que `snapshot` avanza al estado actual (si no,
-- el aviso desaparecería en el instante en que se procesa, y el spec pide que quede visible:
-- "las bases cambiaron desde el análisis de viabilidad").
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL, o con
-- `node scripts/aplicar-migration-54.mjs`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checklist_comercial_foro_snapshot (
  negocio_id          INT          NOT NULL PRIMARY KEY,
  snapshot            LONGTEXT     DEFAULT NULL,   -- JSON: PreguntaRespuesta[] al último chequeo
  capturado_at        DATETIME     NOT NULL,
  ultimo_delta        LONGTEXT     DEFAULT NULL,   -- JSON: CambioForo[] del último cambio detectado
  ultimo_delta_at     DATETIME     DEFAULT NULL,
  bloques_revertidos  VARCHAR(120) DEFAULT NULL    -- ej. "TECNICO,COMERCIAL" si hubo reversión de aprobación
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
