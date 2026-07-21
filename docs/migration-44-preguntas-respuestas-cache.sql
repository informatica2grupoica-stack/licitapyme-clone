-- migration-44-preguntas-respuestas-cache.sql
-- Cache del foro de "Preguntas y Respuestas" que se lee del PORTAL de Mercado Público (la API
-- pública no lo expone, solo las fechas — ver app/lib/mp-preguntas-respuestas.ts). Traerlo abre
-- un navegador real (~10-15s), así que se persiste para no repetirlo en cada carga de la página
-- y para que el cron (app/lib/preguntas-respuestas.ts, /api/cron/preguntas) lo mantenga al día
-- sin que el usuario tenga que apretar el botón "Actualizar".
--
-- fecha_publicacion_respuestas EN DATETIME (no texto) para que el cron pueda filtrar con SQL
-- directo quién ya debería tener respuestas publicadas. `respondido` = 1 cuando esa fecha ya
-- pasó Y se scrapeó al menos una vez después — a partir de ahí se considera un HECHO FINAL (como
-- adjudicacion_cache con la adjudicación) y el cron deja de reintentarlo.
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

CREATE TABLE IF NOT EXISTS preguntas_respuestas_cache (
  licitacion_codigo            VARCHAR(64)  NOT NULL,
  fecha_inicio_preguntas       DATETIME     DEFAULT NULL,
  fecha_fin_preguntas          DATETIME     DEFAULT NULL,
  fecha_publicacion_respuestas DATETIME     DEFAULT NULL,
  preguntas                    LONGTEXT     DEFAULT NULL,  -- JSON: PreguntaRespuesta[]
  n_preguntas                  INT          NOT NULL DEFAULT 0,
  respondido                   TINYINT(1)   NOT NULL DEFAULT 0, -- 1 = hecho final, el cron ya no reintenta
  ultimo_error                 VARCHAR(255) DEFAULT NULL,
  consultado_en                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (licitacion_codigo),
  KEY idx_respondido (respondido),
  KEY idx_fecha_pub_respuestas (fecha_publicacion_respuestas)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
