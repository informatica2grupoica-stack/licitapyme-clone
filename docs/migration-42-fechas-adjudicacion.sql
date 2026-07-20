-- migration-42-fechas-adjudicacion.sql
-- Guarda en el cache de adjudicación la FECHA ESTIMADA DE ADJUDICACIÓN y la FECHA DE
-- APERTURA TÉCNICA que ya trae la ficha MP (Fechas.FechaEstimadaAdjudicacion /
-- Fechas.FechaActoAperturaTecnica). El cron procesar-postuladas ya consulta esa ficha
-- para saber el resultado; ahora, de paso, persiste estas dos fechas — cero llamadas
-- nuevas a Mercado Público. Sirven para que /postuladas muestre "cuándo se decide cada
-- una" y ordene por la más cercana.
ALTER TABLE adjudicacion_cache
  ADD COLUMN fecha_estimada_adjudicacion DATETIME NULL AFTER fecha_adjudicacion,
  ADD COLUMN fecha_apertura_tecnica      DATETIME NULL AFTER fecha_estimada_adjudicacion;
