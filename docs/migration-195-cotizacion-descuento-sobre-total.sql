-- migration-195: el descuento global de una cotización se aplica SOBRE EL TOTAL de cada producto, como en el documento y en la factura
-- (3789-30-LE26, Sinergia: descontar pieza por pieza y redondear cada una daba $1,24 de más en el lote).
-- descuento_sobre_total = 1 → la base y los adicionales de los items de esa cotización están a PRECIO DE LISTA (como vienen impresos)
--                             y compras_cotizacion.descuento_pct se aplica una vez a (base + adicionales) de cada producto.
-- descuento_sobre_total = 0 → cotización antigua: los precios guardados ya traen el descuento (no cambia nada).
-- Cuelga de negocios (cliente por JOIN), igual que el resto de compras_cotizacion.
ALTER TABLE compras_cotizacion ADD COLUMN descuento_sobre_total TINYINT(1) NOT NULL DEFAULT 0 AFTER descuento_pct;
