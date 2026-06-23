-- migration-26-viabilidad-feedback.sql
-- Feedback loop del análisis de viabilidad: correcciones del experto que se destilan
-- en reglas e inyectan en el prompt dinámico (ver app/lib/viabilidad-feedback.ts).
-- NO es obligatorio aplicar este script: el endpoint crea la tabla con
-- CREATE TABLE IF NOT EXISTS la primera vez que se guarda un comentario.
-- Queda aquí para registro/portabilidad.

CREATE TABLE IF NOT EXISTS viabilidad_feedback (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo VARCHAR(64) NOT NULL,
  usuario_id        INT NULL,
  veredicto_ia      VARCHAR(32) NULL,       -- snapshot del veredicto de la IA
  veredicto_humano  VARCHAR(16) NULL,       -- viable | no_viable | parcial
  comentario        TEXT NOT NULL,          -- texto del experto tal cual
  regla             TEXT NOT NULL,          -- regla destilada (lo que se inyecta al prompt)
  ambito            VARCHAR(40) NOT NULL DEFAULT 'global',
  activa            TINYINT NOT NULL DEFAULT 1,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_codigo (licitacion_codigo),
  INDEX idx_activa (activa)
);
