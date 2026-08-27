-- Migración 80 — FOTO DEL PRODUCTO QUE OFERTAMOS, por línea.
--
-- POR QUÉ (27-ago-2026, idea del usuario): NUESTRA ficha técnica (ver migration-79 y
-- app/lib/ficha-tecnica.ts) imprime marca/modelo/fabricante por línea, pero no una foto del
-- equipo — y las fichas de los proveedores casi siempre traen una (ver ejemplo Tecnomaq que dio
-- origen a esto). app/lib/ficha-imagen-extraer.ts la saca del PDF del proveedor cuando se compara
-- la ficha (mismo momento en que ya se lee marca/modelo — ver producto-ofertado.ts); esta columna
-- es donde queda guardada esa foto, ya subida a R2 (mismo patrón que empresas.logo_url/firma_url).
--
-- Aplicar con `node scripts/aplicar-migration-80.mjs` (o a mano en phpMyAdmin).
-- Esta versión de MySQL (Bluehost) NO soporta "ADD COLUMN IF NOT EXISTS" (verificado con
-- migration-51/migration-59): el script aplicador ya comprueba antes si la columna existe, así
-- que este ALTER plano es seguro — solo corre cuando de verdad falta.

ALTER TABLE linea_producto_ofertado
  ADD COLUMN imagen_url VARCHAR(500) NULL AFTER garantia_meses;
