-- Migración 82 — VARIOS PRODUCTOS POR LÍNEA en linea_producto_ofertado.
--
-- POR QUÉ (27-ago-2026, caso real 2446-240-LE26): una línea real de la licitación puede juntar
-- VARIOS productos bajo el mismo precio ("Línea 1 — 2 productos: Hidrolavadora H300 + ...,
-- Vacuolavadora DB51 Dimer + ..."). El checklist ya lo sabe (fusionarProductosDeLinea en
-- auditor-tecnico-core.ts), pero linea_producto_ofertado (migration-79/80/81) tenía UNA fila por
-- línea — con `item_id` como PK única — así que marca/modelo/foto solo alcanzaban para el primer
-- producto y el segundo (con su propia marca, modelo y foto) quedaba completamente afuera.
--
-- `producto_index` (0-based) distingue cada producto DENTRO de la misma línea. Para el caso
-- normal —una línea, un producto— sigue siendo una sola fila con producto_index=0, EXACTAMENTE
-- como antes: nada cambia para el 95%+ de las líneas que no son un paquete. El nombre de cada
-- producto no se duplica acá: se deriva en caliente de productosCrudosDeLinea() (mismo informe que
-- ya alimenta el checklist), así que si el informe se reprocesa el nombre no queda desactualizado.
--
-- Aplicar con `node scripts/aplicar-migration-82.mjs` (o a mano en phpMyAdmin).
-- Esta versión de MySQL (Bluehost) NO soporta "ADD COLUMN IF NOT EXISTS" (ver migration-80): el
-- script aplicador ya comprueba antes si la columna existe.

ALTER TABLE linea_producto_ofertado
  ADD COLUMN producto_index INT NOT NULL DEFAULT 0 AFTER item_id;

ALTER TABLE linea_producto_ofertado
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (item_id, producto_index);
