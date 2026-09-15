-- migration-108-compras-proveedor-datos-obuma.sql
-- Pedido explícito del usuario (14-sep-2026): "necesito todos los datos de los proveedores... tienen
-- cuenta bancaria" — Obuma SÍ expone si el proveedor tiene cuenta bancaria cargada, su número, tipo
-- de cuenta y forma de pago (verificado en vivo contra un proveedor real, "COMERCIAL KMX LTDA":
-- proveedor_banco_cuenta=1, proveedor_nro_cuenta=1780550108, proveedor_tipo_cuenta="Cuenta
-- Corriente"). OJO: Obuma NO expone el NOMBRE del banco en ningún campo de proveedores.list.json —
-- solo el número de cuenta, el tipo y si tiene una cargada. No se inventa un campo "banco" con datos
-- que la API no entrega.
--
-- Estas columnas son de SOLO LECTURA desde Obuma (se pisan en cada sincronización, nunca las edita
-- una persona) — separadas a propósito de `banco`/`tipo_cuenta`/`numero_cuenta` que ya existían
-- (esas son 100% editables a mano en Licitank, para el caso de un proveedor que todavía no tiene
-- ficha en Obuma o cuyos datos de pago difieren). Mezclar ambas habría arriesgado que una
-- sincronización posterior pisara un dato que alguien corrigió a mano.
--
-- Aplicar con `node scripts/aplicar-migration-108.mjs`. Idempotente: columna con chequeo previo en
-- el script.

ALTER TABLE compras_proveedor
  ADD COLUMN obuma_tiene_cuenta_bancaria TINYINT(1) NULL,
  ADD COLUMN obuma_numero_cuenta         VARCHAR(60)  NULL,
  ADD COLUMN obuma_tipo_cuenta           VARCHAR(60)  NULL,
  ADD COLUMN obuma_forma_pago            VARCHAR(150) NULL;
