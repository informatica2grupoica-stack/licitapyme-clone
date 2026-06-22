-- migration-21-prefiltro-licitacion.sql
-- PROMPT 0 — Prefiltro de perfil inicial (Fase 0).
-- Filtro de primera línea sobre la METADATA de portada (nombre/objeto/descripción/
-- ítems/región/presupuesto). Corta barato lo que es claramente un no-go por la
-- NATURALEZA del objeto (servicio, obra civil, capacitación, convenio, commodity)
-- o por presupuesto < $8M neto, ANTES de descargar/clasificar (Fase 1) y de la
-- viabilidad (Fase 2). Modelo: DeepSeek.
--
-- La decisión es POR LICITACIÓN (código), compartida entre usuarios — igual que
-- viabilidad_licitacion. El código tiene fallback si la tabla no existe (no rompe
-- el radar ni el cron).
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

CREATE TABLE IF NOT EXISTS prefiltro_licitacion (
  licitacion_codigo VARCHAR(40)  NOT NULL PRIMARY KEY,
  decision          VARCHAR(20)  NOT NULL,             -- PASA | EXCLUIDO | REVISION_HUMANA
  categoria         VARCHAR(40)  NULL,                 -- servicio | obra_civil | alta_ejecucion_tecnica | capacitacion_pura | consultoria | convenio_suministro | commodity | presupuesto | null
  confianza         DECIMAL(4,3) NULL,                 -- 0.000 – 1.000
  motivo            VARCHAR(500) NULL,
  evidencia         VARCHAR(500) NULL,                 -- frase exacta de nombre/objeto/descripción
  monto_neto        BIGINT       NULL,                 -- presupuesto neto usado en el pre-check (si vino)
  modelo            VARCHAR(40)  NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_decision (decision)
);
