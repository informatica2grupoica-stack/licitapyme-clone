-- migration-109-compras-proveedor-resumen-compras.sql
-- Pedido explícito del usuario (14-sep-2026): estadísticas y filtros en /compras/proveedores — para
-- eso hace falta saber "le hemos comprado" y "cuánto" SIN una llamada a Obuma por proveedor cada vez
-- que se carga la pantalla (con 388 proveedores sería carísimo). Se guarda un RESUMEN (cantidad de
-- OC, monto total, fecha de la última) que se recalcula en cada sincronización con Obuma — el
-- detalle folio a folio y los ítems siguen viviendo 100% en vivo (ver historialComprasObuma /
-- itemsCompraOcObuma en compras-proveedores.ts), esto es solo para listar/filtrar/contar rápido.
--
-- Aplicar con `node scripts/aplicar-migration-109.mjs`. Idempotente: columna con chequeo previo.

ALTER TABLE compras_proveedor
  ADD COLUMN obuma_compras_cantidad    INT     NULL,
  ADD COLUMN obuma_compras_monto_total BIGINT  NULL,
  ADD COLUMN obuma_ultima_compra_fecha DATETIME NULL;
