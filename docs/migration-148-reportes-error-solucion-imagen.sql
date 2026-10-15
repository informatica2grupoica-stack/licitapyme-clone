-- migration-148-reportes-error-adjuntos.sql
-- Archivos de respaldo que el admin adjunta al resolver un error reportado (PDF, Word, TXT,
-- imágenes, etc.) para dar una solución VISUAL a quien lo reportó, que los ve con el ícono de ojo
-- en /mis-reportes. Se guardan en R2; aquí solo el registro. Siguen la visibilidad de
-- `solucion_visible` (migration-124): si la solución es "solo administradores", los adjuntos
-- tampoco salen hacia el perfil.
--
-- Aplicar con `node scripts/aplicar-migration-148.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS reportes_error_adjuntos (
  id          INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reporte_id  INT           NOT NULL,
  nombre      VARCHAR(255)  NOT NULL,              -- nombre original del archivo
  url         VARCHAR(1000) NOT NULL,              -- R2
  mime        VARCHAR(120)  NULL,
  tamano      INT           NULL,                  -- bytes
  subido_por  INT           NULL,
  created_at  DATETIME      NOT NULL,
  INDEX idx_reportes_error_adjuntos_reporte (reporte_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
