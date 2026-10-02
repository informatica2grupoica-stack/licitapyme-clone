-- migration-137: Viabilidad v4.0 + Nivel de atractivo v4.1 (02-oct-2026)
--
-- POR QUÉ: la especificación 2 (CAMBIOS_Fase2_Score_v4_1) reemplaza el score 0-100 que asignaba
-- el modelo por un NIVEL DE ATRACTIVO que calcula el código (EXCLUIDO..MUY_ALTO) y una ACCIÓN
-- para el asistente (Sigue / Consulta a CA / Suelta / Revisa salida / Confirma el dato).
-- Decisión del usuario: el nivel va en COLUMNAS NUEVAS; `score_total`/`semaforo` quedan con el
-- puntaje del perfil inicial (el análisis IA ya no los pisa).
--
-- `viabilidad_config` guarda los catálogos editables de la v4 (familias, admisibilidad imposible,
-- certificado de marca, frases de consecuencia, obviedades, tramos/escalones/pisos/techos del
-- nivel, feriados). La fila 'v4' es un JSON que se MEZCLA sobre los valores por defecto del
-- código (app/lib/viabilidad-v4/config.ts): lo que no esté en la fila usa el default.
--
-- `viabilidad_feedback.sin_destilar`: una regla que la IA no pudo destilar ya no se guarda como
-- el comentario crudo inyectable; queda marcada y NO entra al prompt hasta que CA la revise.
--
-- Idempotente (el script aplicador revisa columnas existentes antes de cada ALTER).

ALTER TABLE viabilidad_licitacion ADD COLUMN nivel_atractivo VARCHAR(12) NULL;
ALTER TABLE viabilidad_licitacion ADD COLUMN nivel_num TINYINT NULL;
ALTER TABLE viabilidad_licitacion ADD COLUMN accion_asistente VARCHAR(20) NULL;
ALTER TABLE viabilidad_licitacion ADD COLUMN nivel_presupuesto_neto BIGINT NULL;
ALTER TABLE viabilidad_licitacion ADD COLUMN nivel_calculado_en DATETIME NULL;

CREATE TABLE IF NOT EXISTS viabilidad_config (
  clave          VARCHAR(40)  NOT NULL PRIMARY KEY,
  valor          LONGTEXT     NOT NULL,
  actualizado_por INT         NULL,
  actualizado_en DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE viabilidad_feedback ADD COLUMN sin_destilar TINYINT NOT NULL DEFAULT 0;
ALTER TABLE viabilidad_feedback ADD COLUMN desactivada_por INT NULL;
ALTER TABLE viabilidad_feedback ADD COLUMN desactivada_en DATETIME NULL;
