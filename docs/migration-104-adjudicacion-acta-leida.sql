-- migration-104-adjudicacion-acta-leida.sql
-- Sella CUÁNDO se leyó el acta (éxito o no), separado de si trajo anexos. Sin esto,
-- licitacionesEnComprasSinActa() (app/lib/acta-adjudicacion.ts, cron compras-asignacion) reintenta
-- para siempre un negocio cuyo organismo simplemente no publicó ningún anexo en el acta — 2
-- llamadas a Mercado Público cada 15-30 min sin que nada vaya a cambiar. Con esta columna, "ya se
-- leyó" (con o sin anexos) queda separado de "trajo algo para guardar".
--
-- Aplicar con `node scripts/aplicar-migration-104.mjs`.

ALTER TABLE adjudicacion_cache
  ADD COLUMN acta_leida_at DATETIME DEFAULT NULL;
