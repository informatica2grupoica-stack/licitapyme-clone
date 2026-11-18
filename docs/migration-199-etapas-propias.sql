-- migration-199-etapas-propias.sql
-- MULTI-CLIENTE (2026-11-18): cada empresa puede crear sus propias etapas de avance del negocio (nombre, color, orden), cada una
-- «equivale» a una etapa base del sistema para que alertas, KPIs, cron y resultados sigan funcionando igual.
-- negocios.estado_pipeline SIGUE guardando la etapa base; negocios.etapa_id (NULL = la etapa del sistema) dice cuál etapa propia se ve.
-- Solo AGREGA: no cambia datos existentes.
CREATE TABLE IF NOT EXISTS etapas_cliente (
  id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT          NOT NULL,
  nombre     VARCHAR(40)  NOT NULL,
  color      VARCHAR(7)   NOT NULL,
  base       VARCHAR(30)  NOT NULL,
  orden      INT          NOT NULL DEFAULT 0,
  activo     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_etapas_cliente (cliente_id, activo, orden)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE negocios ADD COLUMN etapa_id INT NULL;
