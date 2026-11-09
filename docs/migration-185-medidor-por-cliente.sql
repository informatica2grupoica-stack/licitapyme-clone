-- migration-185: MEDIDOR POR CLIENTE (multiempresa, Etapa 1 — ver docs/memoria/multiempresa.md).
-- Para saber cuánto cuesta cada empresa-cliente y que una no agote lo de las demás:
--  1) ia_uso.cliente_id: de qué empresa fue cada llamada a la IA. Lo viejo queda en 1 (Grupo ICA).
--  2) mp_api_uso_cliente: consultas a la API de Mercado Público por día y por empresa. mp_api_uso_diario (total del ticket) sigue igual.
--  3) Topes por empresa en `clientes` (NULL = sin tope):
--       tope_ia_usd_mes → USD de IA por mes calendario (hora Chile). Nuevos clientes: 10 USD.
--       tope_mp_diario  → consultas a MP por día. Nuevos clientes: 500 (una evaluación por RUT gasta ~300).
--     Grupo ICA (1) queda sin topes.
-- Aplicar con scripts/aplicar-migration-185.mjs (idempotente; local por defecto, --produccion con OK del dueño).

ALTER TABLE ia_uso ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE ia_uso ADD INDEX idx_ia_uso_cliente (cliente_id, created_at);

CREATE TABLE IF NOT EXISTS mp_api_uso_cliente (
  fecha          DATE NOT NULL,
  cliente_id     INT  NOT NULL,
  consultas      INT  NOT NULL DEFAULT 0,
  actualizado_at DATETIME NOT NULL,
  PRIMARY KEY (cliente_id, fecha)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE clientes ADD COLUMN tope_ia_usd_mes DECIMAL(10,2) NULL DEFAULT 10.00;
ALTER TABLE clientes ADD COLUMN tope_mp_diario  INT           NULL DEFAULT 500;
UPDATE clientes SET tope_ia_usd_mes = NULL, tope_mp_diario = NULL WHERE id = 1;
