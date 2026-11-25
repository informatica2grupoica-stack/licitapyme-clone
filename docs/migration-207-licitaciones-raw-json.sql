-- migration-207: respuesta COMPLETA de la API de Mercado Público por licitación (decisión del dueño, 25-nov-2026: «que no falte nada»).
--   Hasta hoy solo se guardaban unas columnas + 6 campos por ítem; lo demás (fechas, criterios, garantías, contacto, adjudicación por línea:
--   proveedor y monto unitario) se perdía. raw_json guarda el objeto tal como lo entrega la API, sin tocar IA.
ALTER TABLE licitaciones_cache
  ADD COLUMN raw_json LONGTEXT NULL AFTER items_json;
