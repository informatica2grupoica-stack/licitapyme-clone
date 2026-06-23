-- ============================================================
-- MIGRACIÓN 22: Caché del texto extraído de cada documento
-- Evita re-leer (re-OCR con Gemini visión) en cada análisis de viabilidad.
-- Se guarda el texto una vez; los siguientes análisis lo reutilizan → rápido.
-- ============================================================
ALTER TABLE documentos_cache
  ADD COLUMN texto_extraido     LONGTEXT NULL AFTER size_bytes,
  ADD COLUMN metodo_extraccion  VARCHAR(40) NULL AFTER texto_extraido,
  ADD COLUMN texto_extraido_at  TIMESTAMP NULL AFTER metodo_extraccion;
