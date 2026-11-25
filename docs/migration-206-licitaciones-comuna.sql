-- migration-206: comuna del organismo comprador en el caché de licitaciones (pedido del dueño, 25-nov-2026).
--   Mercado Público entrega ComunaUnidad en el detalle; se guarda para mostrar «Angol», «Pichilemu»… en Radar y Puente.
ALTER TABLE licitaciones_cache
  ADD COLUMN comuna VARCHAR(120) NULL AFTER region;
