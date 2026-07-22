-- Migration 46: columna fecha_fin_preguntas en negocios
-- Cierre del período de preguntas de la licitación (campo oficial FechaFinPreguntas de la API de
-- Mercado Público, NO el scraper del foro de preguntas/respuestas — ver preguntas_respuestas_cache,
-- que es otra cosa). Se rellena SIN costo extra: refrescar-estados.ts ya consulta la API por cada
-- negocio asignado (cada 2h en background, y on-demand al abrir el detalle o al asignar); ahora de
-- paso guarda esta fecha. Alimenta el slider "Destacadas" de Negocios (alerta 1-2 días antes).
-- Ejecutar en Bluehost phpMyAdmin.

ALTER TABLE negocios
  ADD COLUMN fecha_fin_preguntas DATETIME NULL AFTER licitacion_cierre;
