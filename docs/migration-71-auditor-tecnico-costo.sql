-- migration-71-auditor-tecnico-costo.sql
-- COSTO REAL DE IA POR CORRIDA DEL AUDITOR TÉCNICO.
--
-- POR QUÉ (19-ago-2026): "Comparar contra un documento" en 3489-29-LP26 son 88 líneas, cada una
-- con 1-2 llamadas a glm-5.2. Es la operación más cara de todo el sistema y hasta ahora el gasto
-- solo quedaba en el log del contenedor (`[ia] 💰 ...`, ver logTelemetriaIA en gemini.ts), donde
-- nadie lo ve. Estas columnas guardan el acumulado REAL de la corrida — tokens que la propia API
-- reportó, no una estimación — para mostrarlo en pantalla mientras avanza y al terminar.
--
-- Se usa el acumulador que ya existía para viabilidad (conAcumuladorCostoIA / costoAcumuladoActual).
--
-- Aplicar con: node scripts/aplicar-migration-71.mjs
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE auditor_tecnico_jobs
  ADD COLUMN llamadas_ia INT           NOT NULL DEFAULT 0,
  ADD COLUMN tokens_in   BIGINT        NOT NULL DEFAULT 0,
  ADD COLUMN tokens_out  BIGINT        NOT NULL DEFAULT 0,
  ADD COLUMN costo_usd   DECIMAL(10,5) NOT NULL DEFAULT 0;
