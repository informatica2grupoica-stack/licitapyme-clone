-- Migración 76 — Fecha de POSTULACIÓN.
-- Hasta ahora no se guardaba CUÁNDO se postuló una licitación: el tablero de Postuladas
-- solo mostraba la fecha en que se DECIDE (adjudicación real o estimada de la ficha MP).
-- `postulada_en` marca el momento en que el negocio pasó a estado POSTULADA.
--
-- Se llena en app/api/negocios/[id]/route.ts en la transición a POSTULADA (solo la
-- PRIMERA vez: si se revierte y se vuelve a postular, se conserva la fecha original).

ALTER TABLE negocios
  ADD COLUMN postulada_en DATETIME NULL AFTER estado_pipeline;

-- ── Backfill con DATO REAL, sin inventar ─────────────────────────────────────
-- Dos rastros distintos guardan CUÁNDO se cambió la etapa. Se usan los dos porque
-- ninguno cubre todo: la bitácora de la campana (historial_eventos) solo se escribe
-- cuando el actor NO es el propio asignado, mientras que actividad_usuario registra
-- siempre. Medido el 25-ago-2026: historial 80 filas, actividad 104, combinadas 104
-- de 257 que pasaron por postulación — pero 54 de las 56 hoy VIVAS en POSTULADA.
-- Lo que no tenga rastro queda en NULL y la UI muestra "—": preferimos el vacío
-- honesto a una fecha aproximada.

-- Fuente 1 (la de mayor cobertura): registro de actividad.
-- OJO con el COLLATE: entidad_id es utf8mb4_general_ci y el CAST sale unicode_ci,
-- el JOIN sin igualar colaciones muere con "Illegal mix of collations".
UPDATE negocios n
JOIN (
  SELECT entidad_id, MIN(created_at) AS primera
  FROM actividad_usuario
  WHERE entidad_tipo = 'negocio' AND accion = 'cambio_pipeline'
    AND descripcion LIKE '%a POSTULADA%'
  GROUP BY entidad_id
) a ON a.entidad_id COLLATE utf8mb4_general_ci = CAST(n.id AS CHAR) COLLATE utf8mb4_general_ci
SET n.postulada_en = a.primera
WHERE n.postulada_en IS NULL
  AND n.estado_pipeline IN ('POSTULADA','POSIBLE_ADJ','ADJUDICADA','PERDIDA');

-- Fuente 2: bitácora de la campana. Rellena las que la fuente 1 no tenía y corrige
-- hacia atrás si guardó un cambio ANTERIOR (la primera postulación es la que vale).
UPDATE negocios n
JOIN (
  SELECT licitacion_codigo, MIN(created_at) AS primera
  FROM historial_eventos
  WHERE tipo = 'CAMBIO_ETAPA' AND mensaje LIKE '%en POSTULADA%'
  GROUP BY licitacion_codigo
) h ON h.licitacion_codigo = n.licitacion_codigo
SET n.postulada_en = h.primera
WHERE n.estado_pipeline IN ('POSTULADA','POSIBLE_ADJ','ADJUDICADA','PERDIDA')
  AND (n.postulada_en IS NULL OR h.primera < n.postulada_en);

CREATE INDEX idx_negocios_postulada_en ON negocios (postulada_en);
