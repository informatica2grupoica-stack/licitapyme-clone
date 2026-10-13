-- migration-145-compras-precompra.sql
-- PRE-COMPRA (13-oct-2026): Compras se abre al pasar la licitación a POSIBLE ADJ, antes de la
-- adjudicación firme, para adelantar cotizaciones, tareas y costeo. Es la MISMA fila de
-- compras_asignacion (mismas tareas, cotizaciones, etc.), solo marcada.
--   precompra = 1  → aún no hay adjudicación firme (se bloquea comprar de verdad: OC a proveedores y SKU en Obuma).
--   precompra = 0  → ganada (comportamiento de siempre). Al adjudicarse, se apaga y ganado_at pasa a la fecha real.
--   precompra_at   → cuándo se abrió como pre-compra (queda como registro aunque luego gane).
-- Si no se adjudica, se cierra con cierre_legado = 'PRECOMPRA_SIN_ADJUDICAR' (sin columnas nuevas).
-- Aplicar con `node scripts/aplicar-migration-145.mjs`. Idempotente.

ALTER TABLE compras_asignacion
  ADD COLUMN precompra TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN precompra_at DATETIME NULL;
