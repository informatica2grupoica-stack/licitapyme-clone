-- migration-172-cliente-evaluacion.sql
-- MULTI-CLIENTE: evaluación de una empresa-cliente por su RUT (OC + actas de Mercado Público) que le propone y carga
-- palabras clave y perfil. Una fila por empresa (la última evaluación). Tabla NUEVA: no toca nada existente.
CREATE TABLE IF NOT EXISTS cliente_evaluacion (
  cliente_id  INT PRIMARY KEY,
  estado      VARCHAR(20) NOT NULL,
  progreso    VARCHAR(500) NULL,
  resultado   JSON NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
