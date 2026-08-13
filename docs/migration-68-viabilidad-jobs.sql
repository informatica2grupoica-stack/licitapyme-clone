-- migration-68-viabilidad-jobs.sql
-- ESTADO DEL ANÁLISIS DE VIABILIDAD IA PERSISTIDO EN BD (reemplaza el Map en memoria de
-- app/api/licitacion-viabilidad-ia/[codigo]/route.ts).
--
-- POR QUÉ (13-ago-2026, reportado por el usuario en 1171142-100-LE26): el estado "está
-- procesando" vivía SOLO en memoria del proceso Node. Si el contenedor se reinicia mientras un
-- análisis corre (p.ej. al desplegar con `docker compose up -d --build`, exactamente lo que
-- pasó hoy con los commits de la sesión), el job muere sin dejar rastro: el GET de polling
-- vuelve a ver "no hay nada corriendo, sin error, sin informe" y la pantalla se corta en
-- silencio a la vista del usuario — sin decir jamás qué pasó.
--
-- Esta tabla sobrevive reinicios. Además guarda `fase` (para la barra de progreso del front) y
-- detecta jobs HUÉRFANOS: si `estado='procesando'` pero `actualizado_at` no se mueve hace más
-- del tope + margen, el GET lo trata como interrumpido y lo marca error en vez de fingir que no
-- hay nada corriendo. `run_id` evita que un job viejo (p.ej. cortado por el tope de 10 min)
-- pise el estado de un re-análisis posterior del mismo código.
--
-- Aplicar con: node scripts/aplicar-migration-68.mjs
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS viabilidad_jobs (
  licitacion_codigo  VARCHAR(64)  NOT NULL PRIMARY KEY,
  run_id             VARCHAR(40)  NOT NULL,             -- identifica ESTA corrida (evita pisar una corrida más nueva)
  estado             VARCHAR(16)  NOT NULL,             -- procesando | error
  fase               VARCHAR(32)  DEFAULT NULL,         -- leyendo_documentos | analizando_ia | verificando | guardando
  error              VARCHAR(500) DEFAULT NULL,
  iniciado_at        DATETIME     NOT NULL,
  actualizado_at     DATETIME     NOT NULL,
  INDEX idx_viabilidad_jobs_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
