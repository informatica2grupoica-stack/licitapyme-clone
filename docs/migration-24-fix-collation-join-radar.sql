-- migration-24-fix-collation-join-radar.sql
-- Arregla la lentitud del radar (/api/alertas): la query tardaba ~18 s.
--
-- CAUSA: alertas_licitaciones.licitacion_codigo es VARCHAR(100) utf8mb4
-- (collation utf8mb4_general_ci), pero prefiltro_licitacion y documentos_cache
-- tenían licitacion_codigo en VARCHAR utf8 (utf8_unicode_ci). El desajuste de
-- charset/collation impide que el JOIN use el índice → MySQL hace full-scan con
-- Block Nested Loop (EXPLAIN: prefiltro pf → type=ALL). Viabilidad, que sí está
-- en utf8mb4_general_ci, resolvía por eq_ref (rápido).
--
-- ════════════════════════════════════════════════════════════════════════════
-- PASO 1 (OBLIGATORIO y SEGURO) — alinear prefiltro_licitacion.
-- Es el culpable de los ~15 s. licitacion_codigo es PRIMARY KEY → el índice
-- resultante es 100×4 = 400 bytes, por debajo del límite InnoDB de 767 bytes en
-- cualquier formato de fila. Reconstruye ~2.9k filas (unos segundos).
-- Tras esto, el JOIN a prefiltro pasa de type=ALL a eq_ref.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE prefiltro_licitacion
  MODIFY COLUMN licitacion_codigo VARCHAR(100)
  CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- PASO 2 (OPCIONAL — NO ejecutar a ciegas).
-- documentos_cache.licitacion_codigo también está en utf8, pero el endpoint ya
-- neutraliza su impacto con un LEFT JOIN agrupado (tabla derivada materializada
-- una sola vez), así que normalmente NO hace falta tocarlo.
--
-- RIESGO: su índice UNIQUE uk_lic_doc (licitacion_codigo(50), documento_nombre(200))
-- mide hoy ~750 bytes (utf8). En utf8mb4 pasaría a ~800 bytes y supera el límite
-- de 767 → el ALTER FALLA si la tabla usa ROW_FORMAT COMPACT/REDUNDANT.
--
-- Antes de intentarlo, verifica el formato de fila:
--   SELECT row_format FROM information_schema.tables
--   WHERE table_schema = DATABASE() AND table_name = 'documentos_cache';
-- Solo si devuelve DYNAMIC o COMPRESSED es seguro ejecutar:
--
-- ALTER TABLE documentos_cache
--   MODIFY COLUMN licitacion_codigo VARCHAR(100)
--   CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
