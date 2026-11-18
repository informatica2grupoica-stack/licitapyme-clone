-- migration-200-opciones-empresa.sql
-- MULTI-CLIENTE (2026-11-18): opciones de funcionamiento de cada empresa guardadas en la propia empresa (sin tocar código):
-- por ahora `aprobaciones_auditor` = 'auto' | 'siempre' | 'nunca' (auto = se pide aprobación solo si la empresa tiene más de un usuario).
-- Las cambia el admin de la empresa en «Mi empresa» y LICITANK en la ficha de /admin/clientes. NULL = valores por defecto. Solo AGREGA.
ALTER TABLE clientes ADD COLUMN config_json JSON NULL;
