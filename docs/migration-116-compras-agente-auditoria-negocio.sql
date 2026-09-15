-- migration-116-compras-agente-auditoria-negocio.sql
-- Última auditoría completa del negocio (pedido explícito del usuario, 15-sep-2026: "no lo
-- pasamos a la base de datos que es lo que podemos hacer" — no puede ser "tiempo real" de verdad
-- porque cada corrida gasta créditos reales de Gemini, pero el ÚLTIMO resultado real sí se guarda,
-- para que todos vean el mismo estado sin tener que volver a gastar una revisión). UNA fila por
-- negocio — cada auditoría nueva reemplaza a la anterior, no se guarda historial.
--
-- Aplicar con `node scripts/aplicar-migration-116.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_agente_auditoria_negocio (
  negocio_id            INT           NOT NULL PRIMARY KEY,
  resumen                TEXT          NOT NULL,
  alertas_json           LONGTEXT      NOT NULL,
  fuentes_json           TEXT          NOT NULL,
  documentos_leidos_json TEXT          NOT NULL,
  creado_at              DATETIME      NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
