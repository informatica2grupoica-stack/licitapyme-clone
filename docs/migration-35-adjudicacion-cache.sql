-- migration-35-adjudicacion-cache.sql
-- Cache del RESULTADO DE ADJUDICACIÓN que publica Mercado Público.
--
-- Lo usa /api/licitacion-adjudicacion/[codigo] (apartado "Postuladas"):
--   · Si la licitación YA está adjudicada en el cache → se responde desde BD y NUNCA
--     se vuelve a consultar MP (la adjudicación es un hecho final, no cambia).
--   · Si aún NO está adjudicada → solo se re-consulta MP cuando el cache tiene más de
--     TTL horas (consultado_en), para no golpear la API en cada carga de la página
--     y evitar el rate-limit (Codigo 10500 / HTTP 429).
--   · Si la tabla no existe (migración pendiente), el endpoint degrada a consulta en
--     vivo sin cache — nunca bloquea la funcionalidad.
--
-- `lineas` guarda el detalle aperturado por línea (ganador, RUT, monto unitario) como
-- JSON serializado; no se consulta por dentro, solo se lee completo.

CREATE TABLE IF NOT EXISTS adjudicacion_cache (
  licitacion_codigo      VARCHAR(64)  NOT NULL,
  es_adjudicada          TINYINT(1)   NOT NULL DEFAULT 0,
  estado                 VARCHAR(64)  DEFAULT NULL,
  codigo_estado          INT          DEFAULT NULL,
  fecha_adjudicacion     DATETIME     DEFAULT NULL,
  tipo_adjudicacion      INT          DEFAULT NULL,   -- 2 = total, 1 = por línea
  numero_resolucion      VARCHAR(64)  DEFAULT NULL,
  numero_oferentes       INT          DEFAULT NULL,
  url_acta               TEXT         DEFAULT NULL,
  monto_adjudicado_total DECIMAL(18,2) DEFAULT NULL,
  lineas                 LONGTEXT     DEFAULT NULL,   -- JSON: [{producto, proveedor, rutProveedor, montoUnitario, ...}]
  consultado_en          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (licitacion_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
