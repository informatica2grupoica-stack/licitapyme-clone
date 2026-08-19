-- migration-70-auditor-tecnico-jobs.sql
-- ESTADO DE "COMPARAR CONTRA UN DOCUMENTO" (Auditor Técnico) PERSISTIDO EN BD.
--
-- POR QUÉ (19-ago-2026, reportado por el usuario en 3489-29-LP26): esa licitación tiene 88 líneas
-- técnicas. La comparación corría DENTRO de la petición HTTP, secuencialmente, con una llamada de
-- IA por línea (hasta 90s cada una): imposible que quepa — el túnel corta a los ~100s. Ahora el
-- POST arranca un trabajo de fondo y responde de inmediato; el front hace polling sobre esta
-- tabla y muestra "47/88 comparadas".
--
-- Igual que viabilidad_jobs (migración 68), vivir en BD y no en memoria hace que el estado
-- sobreviva a un reinicio del contenedor, y permite detectar jobs HUÉRFANOS: si estado
-- ='procesando' pero `actualizado_at` lleva rato sin moverse, el job murió con el proceso y el
-- GET lo reporta como interrumpido en vez de dejar la pantalla girando para siempre.
-- `run_id` evita que una corrida vieja pise el estado de una más nueva del mismo negocio.
--
-- Aplicar con: node scripts/aplicar-migration-70.mjs
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS auditor_tecnico_jobs (
  negocio_id        INT          NOT NULL PRIMARY KEY,
  run_id            VARCHAR(40)  NOT NULL,             -- identifica ESTA corrida
  estado            VARCHAR(16)  NOT NULL,             -- procesando | error | listo
  fase              VARCHAR(60)  DEFAULT NULL,         -- leyendo documento | ubicando especificaciones | comparando
  documento_nombre  VARCHAR(300) DEFAULT NULL,
  total             INT          NOT NULL DEFAULT 0,   -- líneas técnicas a comparar
  procesadas        INT          NOT NULL DEFAULT 0,   -- avance, para la barra de progreso
  error             VARCHAR(500) DEFAULT NULL,
  resumen_json      TEXT         DEFAULT NULL,         -- ResumenComparacion, para la tabla de resultados al terminar
  iniciado_at       DATETIME     NOT NULL,
  actualizado_at    DATETIME     NOT NULL,
  INDEX idx_auditor_tecnico_jobs_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
