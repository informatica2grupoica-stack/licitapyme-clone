-- migration-134-auditor-costo-extendido.sql
-- AUDITOR unificado (29-sep-2026) — parte "de mercado" del VERIFICADOR DE COSTO (Prompt 5 v2.0) y posición de precio (Parte IX):
--   auditor_verificacion_costo → por opción: V9 (¿el proveedor vende al Estado?), V10 (referencias de mercado del MISMO producto),
--                                V10-b (dispersión) y S5 (precios de mercado público). Una fila por corrida (historial).
--   auditor_posicion_precio    → por licitación: resumen de posición de precio (presupuesto · mercado público · mercado privado ·
--                                nuestro costo) con su lectura en lenguaje simple. Una fila por cálculo (historial).
--
-- Aplicar con `node scripts/aplicar-migration-134.mjs` (idempotente: CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS auditor_verificacion_costo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  opcion_id INT NOT NULL,
  resultado_json LONGTEXT NOT NULL,
  error VARCHAR(500) NULL,
  creado_por INT NULL,
  creado_at DATETIME NOT NULL,
  INDEX idx_auditor_vc_opcion (opcion_id, id),
  INDEX idx_auditor_vc_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditor_posicion_precio (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  resultado_json LONGTEXT NOT NULL,
  lectura TEXT NULL,
  creado_por INT NULL,
  creado_at DATETIME NOT NULL,
  INDEX idx_auditor_pp_negocio (negocio_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
