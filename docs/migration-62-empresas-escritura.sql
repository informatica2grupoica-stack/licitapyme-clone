-- migration-62-empresas-escritura.sql
-- Separa la escritura de constitución en campos propios. Hasta ahora `empresas.fecha_sociedad`
-- era UN solo texto libre que juntaba fecha + tipo de sociedad + notaría ("20 de Agosto de 2018
-- — sociedad por acciones, Segunda Notaría La Serena"). Varios anexos reales de Mercado Público
-- piden estos datos en casillas SEPARADAS (Fecha de la Escritura / Notaría / Número de
-- Repertorio / Fojas-Número-Año, caso real 1058086-43-LP26) — con un solo campo combinado no hay
-- forma confiable de partir el texto para llenarlas sin arriesgar un dato mal cortado (ver
-- anexos-diccionario.ts: por eso "Notaría" quedaba pendiente en vez de repetir el bloque entero).
--
-- `fecha_sociedad` NO se toca ni se borra (sigue existiendo con los datos que ya tenía, mismo
-- criterio que las columnas legadas de checklist_comercial_documentos) — el diccionario deja de
-- usarla para "Notaría"/"N° de Repertorio"/"Fojas" y pasa a las columnas nuevas; las empresas que
-- ya existían necesitan que alguien re-escriba estos 3 datos una vez en /empresas.
--
-- Aplicar con: node scripts/aplicar-migration-62.mjs (Bluehost no soporta
-- "ADD COLUMN IF NOT EXISTS", el script ya comprueba antes si la columna existe).
ALTER TABLE empresas ADD COLUMN fecha_escritura     VARCHAR(120) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN notaria             VARCHAR(160) DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN numero_repertorio   VARCHAR(60)  DEFAULT NULL;
ALTER TABLE empresas ADD COLUMN fojas_numero_anio   VARCHAR(60)  DEFAULT NULL;
