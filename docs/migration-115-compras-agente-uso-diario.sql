-- migration-115-compras-agente-uso-diario.sql
-- Tope diario de uso del agente de documentos de Compras (pedido explícito del usuario,
-- 14-sep-2026: "si te preocupa el gasto puedo agregar un tope diario o un contador visible" →
-- "realizalo"). Cada revisión llama a Gemini de verdad (lectura de PDFs + auditoría), con costo
-- real — esta tabla lleva la cuenta de cuántas llamadas se hicieron HOY (hora de Chile) para
-- poder cortar al llegar al tope y mostrar un contador en la UI.
--
-- Aplicar con `node scripts/aplicar-migration-115.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_agente_uso_diario (
  fecha          DATE     NOT NULL PRIMARY KEY,
  llamadas       INT      NOT NULL DEFAULT 0,
  actualizado_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
