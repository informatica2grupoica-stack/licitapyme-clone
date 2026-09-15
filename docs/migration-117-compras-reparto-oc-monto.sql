-- migration-117-compras-reparto-oc-monto.sql
-- Monto total de la OC cuando se marca "Orden de compra emitida" a mano (spec §11.1) — pedido
-- explícito del usuario (15-sep-2026, tras ver que el agente marcaba como "inconsistencia grave"
-- una OC registrada a mano con valor $0: "creo que nunca me pidió el valor de la OC"). Correcto:
-- el checklist solo pedía el N° de OC (oc_numero), nunca el monto — así que cualquier OC marcada
-- a mano (no creada vía la integración real con Obuma, que sí trae el total) quedaba sin costo
-- registrado en ningún lado. Se agrega el campo para que se pueda capturar cuando corresponda.
--
-- Aplicar con `node scripts/aplicar-migration-117.mjs`. Idempotente: chequeo previo de la columna.

ALTER TABLE compras_reparto_administrativo
  ADD COLUMN oc_monto DECIMAL(14,2) NULL AFTER oc_numero;
