-- Migración 81 — CONFIRMACIÓN de la foto del producto, separada de la de marca/modelo.
--
-- POR QUÉ (27-ago-2026): probando la extracción automática de fotos (migration-80,
-- ficha-imagen-extraer.ts) contra 15 fichas de proveedor reales, 2 de las que SÍ encontraron
-- imagen trajeron la EQUIVOCADA (una textura decorativa de marketing, una franja de logos de
-- certificación) en vez del producto. Reusar `confirmado_por` (que ya gatea marca/modelo/
-- fabricante) habría mezclado dos cosas distintas: alguien puede confirmar que la marca está bien
-- sin haber mirado si la foto corresponde, o viceversa. Columna aparte, gate aparte.
--
-- `imagen_confirmada = 0` (default) mientras la foto venga de la extracción automática — la ficha
-- técnica (ficha-tecnica.ts) la imprime igual, pero con un aviso, hasta que una persona la
-- confirme o suba otra desde la pantalla.
--
-- Aplicar con `node scripts/aplicar-migration-81.mjs` (o a mano en phpMyAdmin).
-- Esta versión de MySQL (Bluehost) NO soporta "ADD COLUMN IF NOT EXISTS" (ver migration-80): el
-- script aplicador ya comprueba antes si la columna existe.

ALTER TABLE linea_producto_ofertado
  ADD COLUMN imagen_confirmada TINYINT(1) NOT NULL DEFAULT 0 AFTER imagen_url;
