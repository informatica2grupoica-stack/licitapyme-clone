-- migration-126-compras-cierre-resultado.sql
-- MÓDULO DE COMPRAS — Cierre con resultado final (24-sep-2026).
-- Cuando el negocio termina, Compras congela el costo real y la utilidad real: sin este paso el
-- ciclo se perdía al entregar (el costo real vivía solo en el editor, sin cierre). Una fila por
-- negocio; volver a cerrar la pisa (cada cierre queda además en la bitácora, historial_eventos).
-- Sin FK a propósito: mismo criterio que el resto de las tablas compras_* .
--
-- Aplicar con `node scripts/aplicar-migration-126.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS compras_cierre_resultado (
  negocio_id            INT            NOT NULL PRIMARY KEY,
  venta_neta            DECIMAL(16,2)  NOT NULL,
  costo_estimado        DECIMAL(16,2)  NOT NULL,
  costo_real            DECIMAL(16,2)  NOT NULL,
  gastos_adicionales    DECIMAL(16,2)  NOT NULL DEFAULT 0,  -- parte del costo real fuera de lo ofertado
  utilidad_real         DECIMAL(16,2)  NOT NULL,
  margen_real_pct       DECIMAL(8,2)       NULL,            -- utilidad / venta
  variacion_costo_pct   DECIMAL(8,2)       NULL,            -- (real - estimado) / estimado
  filas_con_real        INT            NOT NULL,
  filas_totales         INT            NOT NULL,
  incompleto            TINYINT(1)     NOT NULL DEFAULT 0,  -- se cerró con ítems sin costo real
  motivo_incompleto     TEXT               NULL,            -- obligatorio si incompleto = 1
  snapshot_json         LONGTEXT           NULL,            -- consolidado completo al momento del cierre
  cerrado_por           INT                NULL,
  cerrado_por_nombre    VARCHAR(160)       NULL,
  cerrado_at            DATETIME       NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
