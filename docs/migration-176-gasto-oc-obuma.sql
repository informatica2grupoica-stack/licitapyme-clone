-- migration-176: un gasto extra puede quedar enlazado a la OC de Obuma que ya lo respalda (387-55-LE26: transporte OC 4015).
-- Columna NULL: los gastos existentes no cambian. Aplicar con scripts/aplicar-migration-176.mjs (local por defecto).
ALTER TABLE compras_gasto
  ADD COLUMN oc_obuma_folio VARCHAR(30) NULL AFTER comprobante_url,
  ADD KEY idx_cg_oc (negocio_id, oc_obuma_folio);
