-- migration-14-viabilidad-licitacion.sql
-- Fase 2 — Analizador de Viabilidad (PROMPT 2).
-- Guarda el Score de Viabilidad (0-100), semáforo y desglose por cada licitación,
-- calculado de forma híbrida (scoring determinista + IA ligera para juicios cualitativos).
-- Se calcula una vez (al descargar documentos o vía batch) y queda cacheado.
-- MySQL 5.7 compatible. Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

CREATE TABLE IF NOT EXISTS viabilidad_licitacion (
  id                          INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo           VARCHAR(100) NOT NULL,
  score_total                 INT NULL,
  semaforo                    VARCHAR(20) NULL,   -- VERDE | AMARILLO | NARANJA | ROJO | ROJO_DURO
  descalificacion_automatica  TINYINT(1) NOT NULL DEFAULT 0,
  area_negocio                VARCHAR(20) NULL,   -- FERRETERIA | EQUIPAMIENTO | MIXTO
  desglose                    JSON NULL,
  penalizaciones              JSON NULL,
  informe_ejecutivo           JSON NULL,
  trigger_busqueda            JSON NULL,
  confianza_analisis          DECIMAL(3,2) NULL,
  notas_analista              TEXT NULL,
  modelo                      VARCHAR(50) NULL,
  created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_viabilidad_codigo (licitacion_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
