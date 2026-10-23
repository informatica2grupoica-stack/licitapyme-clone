-- migration-170-clientes-viabilidad.sql
-- MULTI-CLIENTE: Viabilidad IA PROPIA de las empresas-cliente. Tablas NUEVAS: no se toca ninguna tabla ni motor de Grupo ICA.
--   cliente_perfil     → qué vende cada empresa (lo que la IA usa para dictaminar).
--   cliente_viabilidad → el dictamen por LICITACIÓN y EMPRESA (la lectura de los documentos oficiales se comparte; el dictamen no).
CREATE TABLE IF NOT EXISTS cliente_perfil (
  cliente_id   INT PRIMARY KEY,
  descripcion  TEXT NULL,
  rubros       TEXT NULL,
  productos_si TEXT NULL,
  productos_no TEXT NULL,
  monto_min    BIGINT NULL,
  monto_max    BIGINT NULL,
  regiones     VARCHAR(500) NULL,
  reglas       TEXT NULL,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cliente_viabilidad (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id       INT NOT NULL,
  licitacion_codigo VARCHAR(100) NOT NULL,
  veredicto        VARCHAR(20) NOT NULL,
  puntaje          INT NULL,
  dictamen         JSON NOT NULL,
  modelo           VARCHAR(80) NULL,
  docs_leidos      INT NOT NULL DEFAULT 0,
  creado_por       INT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cliente_viab (cliente_id, licitacion_codigo),
  INDEX idx_cliente_viab_mes (cliente_id, created_at)
);
