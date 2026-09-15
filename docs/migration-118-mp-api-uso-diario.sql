-- migration-118-mp-api-uso-diario.sql
-- Contador de consultas diarias a la API de Mercado Público (api.mercadopublico.cl), hora de
-- Chile. Caso real 2026-09-15: el ticket agotó su cuota diaria (10.000 consultas/día) por
-- primera vez — los crons de 5 min (estados-asignadas + procesar-postuladas) venían creciendo
-- con el volumen de negocios/postuladas vivos y no había ningún freno proactivo, solo el
-- rate-limit por ráfaga (que es un mecanismo DISTINTO). Esta tabla es la base del gobernador de
-- cuota (ver presupuestoPorCorrida en mercado-publico.ts): reparte lo que queda del día entre
-- las corridas restantes para que la cuota alcance hasta medianoche en vez de agotarse temprano.
--
-- Aplicar con `node scripts/aplicar-migration-118.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS mp_api_uso_diario (
  fecha          DATE     NOT NULL PRIMARY KEY,
  consultas      INT      NOT NULL DEFAULT 0,
  actualizado_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
