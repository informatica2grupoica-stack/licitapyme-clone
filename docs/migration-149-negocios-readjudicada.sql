-- migration-149: marca manual «readjudicada a nosotros» (15-oct-2026). Cuando el organismo readjudica por decreto y la ficha de
-- Mercado Público sigue mostrando al otro proveedor, esta marca prevalece sobre el acta: el Resultado muestra Ganada y el cron no
-- devuelve el negocio a Perdida. Se aplica con scripts/aplicar-migration-149.mjs (idempotente).
ALTER TABLE negocios ADD COLUMN readjudicada_nota VARCHAR(300) NULL, ADD COLUMN readjudicada_at DATETIME NULL, ADD COLUMN readjudicada_por VARCHAR(160) NULL;
