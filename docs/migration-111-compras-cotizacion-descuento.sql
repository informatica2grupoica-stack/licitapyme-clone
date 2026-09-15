-- migration-111-compras-cotizacion-descuento.sql
-- Pedido explícito del usuario (14-sep-2026, caso real: cotización de Trotec Chile con 4% de
-- descuento sobre el subtotal) — el formulario y la extracción automática de cotizaciones (§8.2)
-- no tenían forma de capturar un descuento. El "precio unitario" que se leía del documento era el
-- precio BRUTO (antes del descuento), y ese es el que terminaba comparándose en el cuadro
-- comparativo, los escenarios y el margen — subestimando lo barata que salió la compra de verdad.
--
-- `precio_unitario` SIGUE siendo el precio NETO final (post-descuento) — es la columna que ya usan
-- el cuadro comparativo, los escenarios y el margen, y no había motivo para tocarles la fuente.
-- `precio_unitario_bruto` y `descuento_pct` son solo para mostrar el desglose ("bruto → descuento →
-- neto") y quedar en el registro — el NETO calculado es el que manda en todos los cálculos.
--
-- Aplicar con `node scripts/aplicar-migration-111.mjs`. Idempotente: columna con chequeo previo.

ALTER TABLE compras_cotizacion
  ADD COLUMN precio_unitario_bruto DECIMAL(14,2) NULL,
  ADD COLUMN descuento_pct         DECIMAL(5,2)  NULL;
