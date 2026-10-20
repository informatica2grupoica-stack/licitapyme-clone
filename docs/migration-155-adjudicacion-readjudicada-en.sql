-- migration-155: código de la licitación donde se readjudicó (p.ej. 2827-72-LP26 → 2827-72-R126), 20-oct-2026.
-- MP deja la original con «… – Readjudicada en Id <código>»; el sistema trae esa ficha UNA vez, mezcla sus líneas
-- sobre las de la original y guarda aquí el código para no volver a consultarla. Se aplica con scripts/aplicar-migration-155.mjs.
ALTER TABLE adjudicacion_cache ADD COLUMN readjudicada_en VARCHAR(64) NULL;
