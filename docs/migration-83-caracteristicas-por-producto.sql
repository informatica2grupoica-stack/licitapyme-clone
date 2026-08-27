-- Migración 83 — CARACTERÍSTICAS clasificadas POR PRODUCTO, no solo por línea.
--
-- POR QUÉ (27-ago-2026, caso real 2446-240-LE26): la migración 82 separó marca/modelo/foto por
-- producto cuando una línea real junta varios ("Hidrolavadora H300" + "Vacuolavadora DB51 Dimer"
-- bajo la misma línea de precio), pero las 28 características técnicas de esa línea seguían
-- clasificándose y comparándose TODAS JUNTAS, sin ninguna marca de a cuál producto pertenece cada
-- una — la tabla "Comparación técnica" no se podía separar. Pedido explícito del usuario.
--
-- `producto_index` (0-based, mismo criterio que linea_producto_ofertado — migración 82) distingue
-- cada producto DENTRO de la misma línea. Para el caso normal —una línea, un producto— sigue
-- siendo 0 para todas sus características, EXACTAMENTE como antes: nada cambia para el 95%+ de
-- las líneas que no son un paquete.
--
-- LA CLAVE ÚNICA CAMBIA: era (item_id, clave_caracteristica) — si dos productos de la MISMA línea
-- tienen una característica con el mismo texto ("Potencia", "Garantía"), el slug sale igual y el
-- INSERT IGNORE de la segunda se habría descartado en silencio, pensando que ya existía. Pasa a
-- (item_id, producto_index, clave_caracteristica).
--
-- NO HAY BACKFILL: las características YA clasificadas de una línea-paquete no tienen forma de
-- saber retroactivamente a cuál producto pertenecen (se guardaron sin esa marca). Quedan todas en
-- producto_index=0 hasta que la línea se reinicie y se vuelva a validar — ver auditor-tecnico.ts
-- (clasificarCaracteristicasLinea ahora corre una vez POR PRODUCTO en vez de una vez por línea).
--
-- Aplicar con `node scripts/aplicar-migration-83.mjs` (o a mano en phpMyAdmin).
-- Esta versión de MySQL (Bluehost) NO soporta "ADD COLUMN IF NOT EXISTS" (ver migration-80): el
-- script aplicador ya comprueba antes si la columna existe.

ALTER TABLE checklist_comercial_caracteristicas
  ADD COLUMN producto_index INT NOT NULL DEFAULT 0 AFTER item_id;

ALTER TABLE checklist_comercial_caracteristicas
  DROP INDEX uq_caracteristica,
  ADD UNIQUE KEY uq_caracteristica (item_id, producto_index, clave_caracteristica);
