-- migration-38-estados-pipeline-limpios.sql
-- Normaliza negocios.estado_pipeline a CLAVES limpias (UPPER_SNAKE_CASE, sin prefijo
-- numérico y sin sufijos _JV/_CG). Antes convivían ids como '1ASIGNADO', '3EN_PROCESO',
-- '7POSTULADO_JV', 'ADJ_JV', '2CARPETA_OK' (legado) — inconsistentes y confusos para
-- cualquier desarrollador nuevo. El texto visible (label) vive solo en app/lib/pipeline.ts.
--
-- Mapeo:
--   1ASIGNADO, 2CARPETA_OK        -> ASIGNADO   (CARPETA OK se fusiona en ASIGNADO)
--   3EN_PROCESO                   -> EN_PROCESO
--   4ANEXOS                       -> ANEXOS
--   5ANEXO_LISTO                  -> ANEXO_LISTO
--   6VISADO                       -> VISADO
--   7POSTULADO_JV, 7POSTULADO_CG  -> POSTULADA
--   ADJ_JV, ADJ_CG                -> ADJUDICADA
--   8POSIBLE_ADJ                  -> POSIBLE_ADJ
--   9PERDIDA                      -> PERDIDA
--   DESCARTADA                    -> DESCARTADA (sin cambio)
--
-- Idempotente: los CASE solo tocan los ids viejos; si ya está migrado, no cambia nada.

UPDATE negocios SET estado_pipeline = CASE estado_pipeline
  WHEN '1ASIGNADO'     THEN 'ASIGNADO'
  WHEN '2CARPETA_OK'   THEN 'ASIGNADO'
  WHEN '3EN_PROCESO'   THEN 'EN_PROCESO'
  WHEN '4ANEXOS'       THEN 'ANEXOS'
  WHEN '5ANEXO_LISTO'  THEN 'ANEXO_LISTO'
  WHEN '6VISADO'       THEN 'VISADO'
  WHEN '7POSTULADO_JV' THEN 'POSTULADA'
  WHEN '7POSTULADO_CG' THEN 'POSTULADA'
  WHEN 'ADJ_JV'        THEN 'ADJUDICADA'
  WHEN 'ADJ_CG'        THEN 'ADJUDICADA'
  WHEN '8POSIBLE_ADJ'  THEN 'POSIBLE_ADJ'
  WHEN '9PERDIDA'      THEN 'PERDIDA'
  ELSE estado_pipeline
END
WHERE estado_pipeline IN (
  '1ASIGNADO','2CARPETA_OK','3EN_PROCESO','4ANEXOS','5ANEXO_LISTO','6VISADO',
  '7POSTULADO_JV','7POSTULADO_CG','ADJ_JV','ADJ_CG','8POSIBLE_ADJ','9PERDIDA'
);

-- Nuevo valor por defecto de la columna (antes era '1ASIGNADO').
ALTER TABLE negocios ALTER COLUMN estado_pipeline SET DEFAULT 'ASIGNADO';
