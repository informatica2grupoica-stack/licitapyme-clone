-- migration-27-index-radar-dedup.sql
-- Optimización MENOR y opcional del radar (/api/alertas), ámbito ADMIN.
--
-- HALLAZGO (medido): alertas_licitaciones NO tiene códigos duplicados hoy
-- (3346 filas = 3346 códigos distintos), así que la deduplicación MAX(id) GROUP BY
-- es barata (~350 ms) y NO era el cuello de botella. El cuello real era el LEFT JOIN
-- a documentos_cache (~2 s), ya resuelto en el endpoint sacándolo del SQL.
--
-- Este índice es un extra opcional: hoy la dedup resuelve por el índice
-- unique_alerta (usuario_id, licitacion_codigo) con "Using temporary; Using filesort".
-- Un índice que empiece por licitacion_codigo permite "Using index for group-by"
-- (loose index scan) → la dedup baja de ~350 ms a ~50 ms. Ganancia chica pero gratis.
--
-- SEGURO: crear índice no bloquea lecturas (InnoDB online DDL). Reversible con DROP.
-- 100×4 + 8 ≈ 408 bytes, bajo el límite InnoDB de 767.
--
-- Verificar mejora:
--   EXPLAIN SELECT MAX(id) FROM alertas_licitaciones GROUP BY licitacion_codigo;
--   -- antes:   key=unique_alerta, Extra="Using index; Using temporary; Using filesort"
--   -- después: key=idx_alertas_codigo_id, Extra="Using index for group-by"
-- ════════════════════════════════════════════════════════════════════════════

CREATE INDEX idx_alertas_codigo_id
  ON alertas_licitaciones (licitacion_codigo, id);
