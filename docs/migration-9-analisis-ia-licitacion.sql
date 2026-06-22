-- migration-9-analisis-ia-licitacion.sql
-- Análisis automático con IA (Gemini) de las bases de cada licitación:
-- presupuesto, criterios de evaluación, plazos, requisitos, garantías,
-- multas y análisis experto. Se calcula una vez por licitación y queda
-- guardado para no volver a llamar a la IA cada vez que se abre la ficha.
-- Ejecutar en Bluehost → phpMyAdmin → licitapyme → SQL

CREATE TABLE IF NOT EXISTS analisis_ia_licitacion (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo     VARCHAR(100) NOT NULL,
  presupuesto_monto     BIGINT NULL,
  presupuesto_moneda    VARCHAR(10) NULL,
  plazo_ejecucion_dias  INT NULL,
  criterios_evaluacion  JSON NULL,
  requisitos            JSON NULL,
  garantias             JSON NULL,
  multas                JSON NULL,
  analisis_experto      JSON NULL,
  documento_analizado   VARCHAR(255) NULL,
  modelo                VARCHAR(50) NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_analisis_ia_codigo (licitacion_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
