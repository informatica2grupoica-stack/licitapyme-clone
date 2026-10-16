-- migration-152: la compra rápida distingue «Por comprar» (se aprueba ANTES de comprar) de «Ya comprada» (se compró en tienda y el jefe
-- de ventas la ratifica; llega con aviso). Agrega compras_compra_rapida.ya_comprada. Se aplica con scripts/aplicar-migration-152.mjs (idempotente).
ALTER TABLE compras_compra_rapida ADD COLUMN ya_comprada TINYINT(1) NOT NULL DEFAULT 0 AFTER motivo;
