-- migration-33-negocios-descarte.sql
-- Descarte de un negocio a nivel de gestión: cuando una licitación asignada pasa a
-- estado_pipeline = 'DESCARTADA', se exige un MOTIVO y se registra QUIÉN y CUÁNDO.
-- El apartado "Descartadas" (solo admin) muestra estos datos + el detalle de la licitación.
--
-- El estado en sí ya vive en negocios.estado_pipeline (pipeline.ts). Aquí solo se agregan
-- los metadatos del descarte. Columnas nullable → el código tolera su ausencia.

ALTER TABLE negocios
  ADD COLUMN descarte_motivo VARCHAR(500) NULL AFTER estado_pipeline,
  ADD COLUMN descarte_por    INT          NULL AFTER descarte_motivo,
  ADD COLUMN descarte_at     TIMESTAMP    NULL AFTER descarte_por;
