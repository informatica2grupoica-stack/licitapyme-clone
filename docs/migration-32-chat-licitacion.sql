-- migration-32-chat-licitacion.sql
-- Chatbot de preguntas sobre UNA licitación.
--
-- Dos tablas:
--   1) licitacion_contexto_chat — cachea el CORPUS completo de la licitación (la
--      concatenación de documentos_cache.texto_extraido, ya poblado por la viabilidad IA)
--      para no re-descargar ni re-OCR-ear en cada pregunta. Se reconstruye cuando cambian
--      los documentos (num_documentos) o se re-extrae texto (texto_extraido_at más nuevo).
--   2) chat_licitacion — historial de la conversación por sesión (sesion_id). Para el chat
--      de corpus completo el frontend usa el sesion_id fijo "corpus"; para el chat rápido
--      de un solo documento usa "doc:<nombre>" (recortado a 64 chars).
--
-- Nota: el texto por documento vive en documentos_cache.texto_extraido (migración 22).
-- Aquí NO se re-extrae nada: solo se cachea/consulta lo ya extraído.

CREATE TABLE IF NOT EXISTS licitacion_contexto_chat (
  licitacion_codigo VARCHAR(64) NOT NULL,
  contexto_texto    LONGTEXT    NOT NULL,
  num_chars         INT         NOT NULL,
  num_documentos    INT         NOT NULL DEFAULT 0,
  actualizado_en    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (licitacion_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_licitacion (
  id                BIGINT      NOT NULL AUTO_INCREMENT,
  licitacion_codigo VARCHAR(64) NOT NULL,
  sesion_id         VARCHAR(64) NOT NULL,
  rol               ENUM('usuario','asistente') NOT NULL,
  mensaje           MEDIUMTEXT  NOT NULL,
  modelo            VARCHAR(48) DEFAULT NULL,
  usuario_id        INT         DEFAULT NULL,
  creado_en         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sesion (sesion_id, creado_en),
  KEY idx_lic (licitacion_codigo, creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
