-- migration-93-compras-logistica.sql
-- MÓDULO DE COMPRAS — Logística y fleteros (spec §13).
--
-- DECISIÓN DE ARQUITECTURA (§13.1): "compras y logística se diseñan integrados hoy... el
-- desarrollo debe mantener frontera limpia entre ambos para no pagar una refactorización cara" —
-- por eso `compras_fletero` es una tabla PROPIA, transversal a todos los negocios (no cuelga de
-- `compras_asignacion`), lista para separarse en su propio módulo el día que haga falta.
--
-- POR QUÉ NO SE REUSA OBUMA (§13.3): "OBUMA aporta identidad e histórico económico del fletero.
-- La caracterización operativa (capacidad, tipo de camión, costo por kilómetro, pionetas, zonas,
-- nota, pana) no existe en OBUMA y debe vivir en tabla propia de Licitank, enganchada por RUT."
-- `rut` queda como el enganche (sin FK real: OBUMA no es una tabla local).
--
-- DOS CATEGORÍAS CON VARIABLES DISTINTAS (§13.3.1-§13.3.4):
--   · UNICA (carga única, la habitual): el plazo NO es variable de ranking — es inmediata por
--     definición. En Cadena de Urgencia (§15.3) SOLO compite esta categoría (§13.3.4).
--   · CONSOLIDADA: acá el plazo SÍ manda (`plazo_despacho_dias`), se manda la carga y el proyecto
--     se somete a los plazos del fletero.
-- "Si alguna vez quedó en pana, queda descartado por no confiable" (§13.3.2) — `quedo_en_pana` es
-- una marca dura, no una nota baja: una vez en TRUE, `sugerirFleteros()` lo excluye siempre.
--
-- `compras_fletero_zona` en tabla propia (no JSON) para poder responder el caso de prueba real de
-- la spec (§13.5): "entrega en Coyhaique → el sistema devuelve los tres proveedores que llegan a
-- Coyhaique con sus precios tentativos" — eso es un WHERE zona = ..., no un parseo de JSON.
--
-- MODALIDAD DE RETIRO (§13.2: interna/externa/mixta, "se define en el primer instante... la
-- define el humano, el sistema propone, no decide") vive como columna directa en
-- `compras_asignacion` — es una decisión POR NEGOCIO, no del catálogo de fleteros.
--
-- Aplicar con `node scripts/aplicar-migration-93.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS / ALTER guardado.

CREATE TABLE IF NOT EXISTS compras_fletero (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  rut                 VARCHAR(20)      NULL,   -- enganche con OBUMA (identidad e histórico económico, §13.3)
  nombre              VARCHAR(300) NOT NULL,
  categoria           VARCHAR(16)  NOT NULL,   -- UNICA | CONSOLIDADA (§13.3.2/§13.3.3)
  capacidad_camion    VARCHAR(120)     NULL,
  tipo_camion         VARCHAR(120)     NULL,
  precio              DECIMAL(18,2)    NULL,   -- tarifa base del flete
  costo_km            DECIMAL(12,2)    NULL,
  incluye_descarga    TINYINT(1)   NOT NULL DEFAULT 0,
  tiene_pionetas      TINYINT(1)   NOT NULL DEFAULT 0,
  plazo_despacho_dias INT              NULL,   -- solo aplica/manda en CONSOLIDADA (§13.3.3)
  quedo_en_pana       TINYINT(1)   NOT NULL DEFAULT 0,  -- §13.3.2: una vez TRUE, descartado de por vida
  nota                DECIMAL(3,1)     NULL,   -- 1.0-5.0, la define el encargado tras la experiencia (§13.4)
  activo              TINYINT(1)   NOT NULL DEFAULT 1,
  creado_por          INT              NULL,
  creado_por_nombre   VARCHAR(160)     NULL,
  created_at          DATETIME     NOT NULL,
  updated_at          DATETIME     NOT NULL,
  INDEX idx_compras_fletero_categoria (categoria, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_fletero_zona (
  fletero_id INT         NOT NULL,
  zona       VARCHAR(120) NOT NULL,  -- comuna/ciudad/región que cubre, texto libre normalizado en minúsculas
  PRIMARY KEY (fletero_id, zona)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- (el script aplicador comprueba si la columna ya existe antes de correr este ALTER — mismo
-- criterio que el resto de migraciones de Compras, ver aplicar-migration-87.mjs)
ALTER TABLE compras_asignacion
  ADD COLUMN modalidad_retiro VARCHAR(16) NULL,  -- INTERNA | EXTERNA | MIXTA (§13.2)
  ADD COLUMN modalidad_retiro_por INT NULL,
  ADD COLUMN modalidad_retiro_por_nombre VARCHAR(160) NULL,
  ADD COLUMN modalidad_retiro_at DATETIME NULL;
