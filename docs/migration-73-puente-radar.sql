-- migration-73: Puente del Radar (bandeja de reparto)
--
-- POR QUÉ (20-ago-2026): el asesor revisa el radar y quiere EMPUJAR un lote de licitaciones a
-- una bandeja intermedia ("el puente") para después repartirlas entre varios perfiles con una
-- regla (equitativa, por carga real, por categoría, por monto, por región...). Hasta ahora el
-- radar solo permitía "todas las seleccionadas a UN perfil", que es justo lo que no sirve
-- cuando hay 30 licitaciones y 3 asistentes.
--
-- Dos tablas:
--   puente_radar   → lo que está esperando dueño. Una fila por licitación (UNIQUE por código),
--                    con los datos de la licitación CONGELADOS al entrar (igual que `negocios`),
--                    para que el reparto no dependa de volver a consultar MP.
--   puente_repartos→ bitácora de cada tanda repartida (estrategia + config + resultado). Sirve
--                    para auditar "por qué a Juan le tocaron estas 10" y para deshacer.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS puente_radar (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo     VARCHAR(100) NOT NULL,
  licitacion_nombre     TEXT             NULL,
  licitacion_organismo  VARCHAR(255)     NULL,
  licitacion_monto      DECIMAL(18,2)    NULL,
  licitacion_cierre     DATETIME         NULL,
  licitacion_estado     VARCHAR(60)      NULL,
  licitacion_tipo       VARCHAR(20)      NULL,
  licitacion_region     VARCHAR(120)     NULL,
  categoria_nombre      VARCHAR(120)     NULL,   -- línea de negocio (palabras_clave → etiquetas)
  viabilidad_semaforo   VARCHAR(20)      NULL,
  agregado_por          INT          NOT NULL,
  agregado_en           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_puente_codigo (licitacion_codigo),
  KEY idx_puente_agregado (agregado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS puente_repartos (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  estrategia     VARCHAR(40)  NOT NULL,   -- equitativa | carga | categoria | monto | region | viabilidad | manual
  config_json    TEXT             NULL,   -- perfiles elegidos + reglas + semilla del barajado
  resultado_json MEDIUMTEXT       NULL,   -- [{codigo, usuarioId, motivo, ok}]
  total          INT          NOT NULL DEFAULT 0,
  total_ok       INT          NOT NULL DEFAULT 0,
  ejecutado_por  INT          NOT NULL,
  ejecutado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_repartos_fecha (ejecutado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
