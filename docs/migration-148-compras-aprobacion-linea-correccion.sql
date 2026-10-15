-- migration-148: el encargado marca un producto rechazado como «corregido» (15-oct-2026). El estado pasa a CORREGIDA, se conserva
-- el motivo del rechazo (comentario) y se guarda quién corrigió, cuándo y qué hizo. Se aplica con scripts/aplicar-migration-148.mjs (idempotente).
ALTER TABLE compras_aprobacion_linea ADD COLUMN corregido_por_nombre VARCHAR(160) NULL, ADD COLUMN corregido_at DATETIME NULL, ADD COLUMN nota_correccion TEXT NULL;
