-- migration-17-seed-keyword-categorias.sql
-- Asigna las palabras clave del admin (usuario_id = 1) a sus categorías padre:
--   1 = EQUIPAMIENTO   ·   2 = MAQUINARIA   ·   3 = MATERIALES EN GENERAL
-- Requiere haber corrido ANTES la migración 16 (columna palabras_clave.categoria_id).
-- Idempotente: los UPDATE son por id; los INSERT solo entran si la keyword no existe.
-- Ejecutar en Bluehost → phpMyAdmin → ica_licitaciones → SQL

-- ── MATERIALES EN GENERAL (categoria_id = 3) ──────────────────────────────────
UPDATE palabras_clave SET categoria_id = 3
 WHERE usuario_id = 1 AND id IN (3,4,5,6,7,8,9,10,11,12,13,14,15,16,17);

-- ── MAQUINARIA (categoria_id = 2) ─────────────────────────────────────────────
UPDATE palabras_clave SET categoria_id = 2
 WHERE usuario_id = 1 AND id IN (18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,
                                 35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,
                                 52,53,54,55,56,57,58,59,60,61,62,63);

-- ── EQUIPAMIENTO (categoria_id = 1) ───────────────────────────────────────────
-- (se omiten 69 pintura, 70 madera, 71 impregnado, 72 fierro, 130 amc: no estaban en tus listas)
UPDATE palabras_clave SET categoria_id = 1
 WHERE usuario_id = 1 AND id IN (64,65,66,67,68,73,74,75,76,77,78,79,80,81,82,83,84,
                                 85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,
                                 102,103,104,105,106,107,108,109,110,111,112,113,116,
                                 117,118,119,120,121,122,123,124,125,126,127,128,129,
                                 131,132,133,134);

-- Correcciones de typo + categoría (estaban mal escritas y nunca calzaban en la búsqueda)
UPDATE palabras_clave SET keyword = 'honeywell',        categoria_id = 1 WHERE id = 114;
UPDATE palabras_clave SET keyword = 'johnson controls', categoria_id = 1 WHERE id = 115;

-- ── Keywords nuevas que faltaban (insertadas solo si no existen) ───────────────
-- Materiales
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'soldadora', 3, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='soldadora');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'alargador electrico', 3, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='alargador electrico');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'materiales electricos', 3, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='materiales electricos');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'malla acmafor', 3, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='malla acmafor');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'huincha aisladora', 3, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='huincha aisladora');

-- Maquinaria
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'sisal', 2, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='sisal');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'enfardadora', 2, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='enfardadora');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'retro', 2, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='retro');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'excavadora', 2, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='excavadora');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'retroexcavadora', 2, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='retroexcavadora');

-- Equipamiento
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'pulverizacion', 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='pulverizacion');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'smc', 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='smc');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'termogravimetro', 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='termogravimetro');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'termogravimetrico', 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='termogravimetrico');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'submarino', 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='submarino');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'acuatico', 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='acuatico');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'acuicultura', 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='acuicultura');
INSERT INTO palabras_clave (usuario_id, keyword, categoria_id, activo)
SELECT 1, 'mindray', 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM palabras_clave WHERE usuario_id=1 AND keyword='mindray');
