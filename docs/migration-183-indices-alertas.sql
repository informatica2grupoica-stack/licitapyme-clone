-- migration-183: índices de alertas_licitaciones para el dashboard y el radar (prueba de carga del 09-nov-2026).
-- Causa: idx_alertas_cliente (cliente_id, licitacion_codigo) filtra mal porque cliente_id casi no varía (cardinalidad 2) y no había índice
-- por licitacion_cierre: cada COUNT(DISTINCT licitacion_codigo) revisaba 12-44 mil filas (100-270 ms, repetido en cada carga del dashboard).
-- Aplicar con scripts/aplicar-migration-183.mjs (local por defecto). Solo agrega índices: no cambia datos ni consultas.
ALTER TABLE alertas_licitaciones
  ADD INDEX idx_alertas_cliente_cierre (cliente_id, licitacion_cierre, licitacion_codigo),
  ADD INDEX idx_alertas_cliente_creada (cliente_id, created_at, licitacion_codigo);
