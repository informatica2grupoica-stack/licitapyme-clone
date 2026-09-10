-- migration-98-compras-fracaso.sql
-- MÓDULO DE COMPRAS — Estado de fracaso (spec §14.6), insumo directo de la trazabilidad §18.2:
-- "se registran... los motivos declarados y dictaminados en un fracaso."
--
-- DOBLE REGISTRO OBLIGATORIO, deliberadamente separado en dos columnas de motivo (spec):
--   · El ENCARGADO de entrega verifica que no se puede entregar y declara los motivos.
--   · El JEFE DE VENTAS hace un análisis INDEPENDIENTE y dictamina el motivo real.
-- "La distinción es deliberada: el encargado puede declarar 'no se alcanzó a entregar en plazo' y
-- el jefe de ventas concluir 'no se alcanzó porque no se gestionó'" — por eso son dos campos de
-- texto separados, nunca uno solo que el segundo sobrescriba.
--
-- Aplicar con `node scripts/aplicar-migration-98.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_fracaso (
  negocio_id              INT          NOT NULL PRIMARY KEY,
  motivo_declarado        TEXT         NOT NULL,  -- del encargado de entrega
  declarado_por           INT              NULL,
  declarado_por_nombre    VARCHAR(160)     NULL,
  declarado_at            DATETIME     NOT NULL,
  dictamen_jefe_ventas    TEXT             NULL,  -- análisis independiente, motivo REAL
  dictaminado_por         INT              NULL,
  dictaminado_por_nombre  VARCHAR(160)     NULL,
  dictaminado_at          DATETIME         NULL,
  created_at              DATETIME     NOT NULL,
  updated_at              DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
