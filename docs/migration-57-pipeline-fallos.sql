-- migration-57-pipeline-fallos.sql
-- RASTRO DE FALLOS DEL PIPELINE IA (clasificación → análisis exhaustivo → viabilidad).
--
-- POR QUÉ: `procesarLicitacionCompleta()` nunca lanza — devuelve { ok:false, error }. El
-- llamador automático (auto-descargar) descartaba ese valor con un `.catch()` que jamás se
-- disparaba, así que una licitación que fallaba el análisis quedaba sin viabilidad SIN log,
-- sin marca y sin señal en la UI. Nadie se enteraba nunca.
--
-- Esta tabla es esa marca: una fila por licitación con problema, que se BORRA sola cuando el
-- pipeline vuelve a correr bien. O sea: si la tabla está vacía, no hay nada roto. Lo que quede
-- adentro es exactamente la lista de trabajo del doctor (scripts/doctor-pipeline.mts).
--
-- Aplicar en Bluehost → phpMyAdmin (base ooosywmy_ica_licitaciones), pestaña SQL, o con
-- `node scripts/aplicar-migration-57.mjs`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipeline_fallos (
  licitacion_codigo  VARCHAR(64)  NOT NULL PRIMARY KEY,
  etapa              VARCHAR(32)  NOT NULL,             -- ANALISIS | VIABILIDAD (EXCLUIDO por prefiltro NO es fallo)
  error              VARCHAR(500) DEFAULT NULL,         -- mensaje recortado del fallo
  intentos           INT          NOT NULL DEFAULT 1,   -- cuántas veces seguidas ha fallado
  primer_fallo_at    DATETIME     NOT NULL,
  ultimo_fallo_at    DATETIME     NOT NULL,
  INDEX idx_pipeline_fallos_etapa (etapa),
  INDEX idx_pipeline_fallos_ultimo (ultimo_fallo_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
