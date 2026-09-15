-- migration-112-compras-cotizacion-flete-monto.sql
-- Pedido explícito del usuario (14-sep-2026): "si pongo no incluye flete es porque nos cobran el
-- flete pero no me deja poner cuánto es, y en la cotización sale que cobran el valor" — hasta acá,
-- cuando una cotización marcaba "no incluye flete", el escenario le sumaba SIEMPRE el flete interno
-- fijo (VIAJE_INTERNO_CLP, $40.000, spec §8.10.2) sin importar cuánto cobrara el proveedor de
-- verdad en el documento. `flete_monto` guarda ese cargo REAL (leído del documento o tipeado a
-- mano) — cuando existe, el escenario usa ESE número en vez de adivinar con el fijo interno.
--
-- Aplicar con `node scripts/aplicar-migration-112.mjs`. Idempotente: columna con chequeo previo.

ALTER TABLE compras_cotizacion
  ADD COLUMN flete_monto DECIMAL(14,2) NULL;
