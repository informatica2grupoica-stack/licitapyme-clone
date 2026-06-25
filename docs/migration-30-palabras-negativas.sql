-- migration-30-palabras-negativas.sql
-- Palabras clave NEGATIVAS (de exclusión): si una licitación matchea una de estas,
-- NO genera alerta aunque calce una palabra positiva. Ej.: positiva "cámara" pero
-- negativa "fotográfica" para excluir cámaras de fotos cuando buscas cámaras de vigilancia.
--
-- Reutiliza la tabla palabras_clave existente con una bandera. Una palabra negativa:
--   - tiene es_negativa = 1
--   - participa solo como filtro de exclusión (no crea alertas por sí misma)
--   - se evalúa con el mismo matcher field-aware (nombre/categoría/ítems/descripción).
--
-- El endpoint /api/palabras-clave y el cron degradan con gracia si la columna no existe
-- (try/catch), así que aplicar este script es opcional pero recomendado.

ALTER TABLE palabras_clave
  ADD COLUMN es_negativa TINYINT(1) NOT NULL DEFAULT 0;

-- Índice para filtrar rápido positivas vs negativas al cargar.
CREATE INDEX idx_palabras_clave_negativa ON palabras_clave (es_negativa, activo);
