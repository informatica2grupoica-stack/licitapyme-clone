-- migration-105-compras-sku-obuma-codigo.sql
-- El "SKU propio" (compras_sku.sku_propio, §7.3) es nuestro identificador legible interno
-- ("SENSOR-INSITU-LEVELTROLL500-VENTEADO"). El código comercial que genera Obuma al crear el
-- producto de verdad (§7, activado 10-sep-2026) es un código NUMÉRICO distinto, propio del ERP
-- ("6026427204" = 60 + subcategoría + correlativo) — no se pisan entre sí, se guardan aparte.
--
-- Aplicar con `node scripts/aplicar-migration-105.mjs`.

ALTER TABLE compras_sku
  ADD COLUMN obuma_codigo_comercial VARCHAR(40) DEFAULT NULL;
