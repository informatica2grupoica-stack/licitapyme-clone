-- migration-201-viabilidad-empresa.sql
-- MULTI-CLIENTE (2026-11-18): configuración de la Viabilidad IA POR EMPRESA-CLIENTE (nada de esto toca a Grupo ICA ni su `viabilidad_config`).
-- `config` guarda solo lo que la empresa cambió (mínimo de presupuesto, qué tan estricto es el calce con lo que vende); lo demás usa el valor por defecto.
-- La empresa la edita en «Mi empresa» y LICITANK en la ficha de /admin/clientes. Solo AGREGA.
CREATE TABLE IF NOT EXISTS cliente_viabilidad_config (
  cliente_id INT      NOT NULL PRIMARY KEY,
  config     JSON     NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
