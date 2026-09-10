-- migration-94-compras-incidencias.sql
-- MÓDULO DE COMPRAS — Zona de incidencias (spec §9). Etapa TRANSVERSAL, no secuencial (§9.1): el
-- proyecto tiene o no tiene incidencia, y la incidencia NUNCA detiene el reloj de entrega (§9.7).
--
-- CATÁLOGO ENUNCIATIVO (§1.3.5 + §9.3: "habrá tipos no previstos, el diseño debe admitirlos") —
-- `compras_incidencia_tipo` es tabla editable, y `compras_incidencia.tipo_libre` es la salida de
-- texto libre para cuando ningún tipo del catálogo calza (se puede "promover" a catálogo después,
-- ver `promoverTipoIncidencia` en app/lib/compras-incidencias.ts).
--
-- DOS NATURALEZAS (§9.3/§9.4):
--   · DEFENSIVA — algo salió mal (stock agotado, plazo incompatible, etc.).
--   · OFENSIVA  — Oportunidad de Mejora: "nada salió mal", aparece un producto que cubre la
--     necesidad real a un costo notoriamente menor. Lleva su propio circuito de DOBLE APROBACIÓN
--     (detecta encargado → aprueba jefe de ventas → aprueba el cliente) modelado en columnas `om_*`
--     — no se separó en tabla propia porque es la MISMA entidad "incidencia" con campos extra que
--     solo tienen sentido cuando naturaleza=OFENSIVA (NULL en toda incidencia defensiva).
--
-- ORIGEN — doble vía (§9.2): MANUAL (el encargado la describe) o AUTOMATICA (el sistema la detecta;
-- hoy el disparador real es un "hallazgo" marcado en una tarea de Validación, ver
-- guardarRegistroTarea en app/lib/compras.ts — ahí es donde "sin stock" o "plazo incompatible" se
-- descubre primero en la práctica).
--
-- Aplicar con `node scripts/aplicar-migration-94.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS +
-- INSERT IGNORE del catálogo inicial.

CREATE TABLE IF NOT EXISTS compras_incidencia_tipo (
  clave       VARCHAR(64)  NOT NULL PRIMARY KEY,
  naturaleza  VARCHAR(16)  NOT NULL,  -- DEFENSIVA | OFENSIVA
  titulo      VARCHAR(200) NOT NULL,
  descripcion TEXT             NULL,
  orden       INT          NOT NULL DEFAULT 0,
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  promovido_de_texto_libre TINYINT(1) NOT NULL DEFAULT 0  -- nació de un tipo_libre repetido (§1.3.5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS compras_incidencia (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id          INT          NOT NULL,
  producto_id         INT              NULL,  -- a qué producto afecta (opcional: puede ser del proyecto entero)
  tarea_id            INT              NULL,  -- si nació de un hallazgo (origen AUTOMATICA), la tarea que lo detectó
  naturaleza          VARCHAR(16)  NOT NULL,  -- DEFENSIVA | OFENSIVA
  origen              VARCHAR(16)  NOT NULL,  -- MANUAL | AUTOMATICA
  tipo_clave          VARCHAR(64)      NULL,  -- FK "blanda" a compras_incidencia_tipo
  tipo_libre          VARCHAR(200)     NULL,  -- cuando no calza ningún tipo del catálogo
  descripcion         TEXT         NOT NULL,
  estado              VARCHAR(16)  NOT NULL DEFAULT 'ABIERTA',  -- ABIERTA | CERRADA

  -- Oportunidad de Mejora (§9.4) — solo se llenan cuando naturaleza = OFENSIVA
  om_ahorro_estimado          DECIMAL(18,2) NULL,
  om_producto_alternativo     VARCHAR(500)      NULL,
  om_aprobada_jefe_ventas     TINYINT(1)    NOT NULL DEFAULT 0,
  om_aprobada_jefe_ventas_por INT               NULL,
  om_aprobada_jefe_ventas_por_nombre VARCHAR(160) NULL,
  om_aprobada_jefe_ventas_at  DATETIME          NULL,
  om_planteada_cliente_at     DATETIME          NULL,  -- nunca antes de om_aprobada_jefe_ventas (regla dura §9.4)
  om_aprobada_cliente         TINYINT(1)        NULL,  -- NULL=sin respuesta todavía, 1/0 aprobó/rechazó
  om_constancia               TEXT              NULL,  -- "quién autorizó, con quién se habló, cuándo" (§9.4)

  abierta_por         INT              NULL,
  abierta_por_nombre  VARCHAR(160)     NULL,
  abierta_at          DATETIME     NOT NULL,
  cerrada_por         INT              NULL,
  cerrada_por_nombre  VARCHAR(160)     NULL,
  cerrada_at          DATETIME         NULL,
  resolucion          TEXT             NULL,
  created_at          DATETIME     NOT NULL,
  updated_at          DATETIME     NOT NULL,
  INDEX idx_compras_incidencia_negocio (negocio_id, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Catálogo inicial ENUNCIATIVO (§9.3) — nunca taxativo: se le pueden agregar filas sin deploy.
INSERT IGNORE INTO compras_incidencia_tipo (clave, naturaleza, titulo, descripcion, orden) VALUES
('stock_agotado',            'DEFENSIVA', 'Stock agotado', 'El proveedor no tiene stock del producto.', 10),
('producto_no_disponible',   'DEFENSIVA', 'Producto no disponible', 'El proveedor ya no ofrece el producto.', 20),
('producto_descontinuado',   'DEFENSIVA', 'Producto descontinuado', 'El fabricante descontinuó el producto.', 30),
('modelo_similar_cumple',    'DEFENSIVA', 'Modelo similar que cumple totalmente', 'Existe un modelo distinto que cumple todo lo exigido.', 40),
('modelo_similar_supera',    'DEFENSIVA', 'Modelo similar que supera lo exigido', 'Existe un modelo distinto que supera lo exigido.', 50),
('modelo_similar_le_falta',  'DEFENSIVA', 'Modelo similar al que le falta una característica', 'Existe un modelo distinto al que le falta algo exigido.', 60),
('plazo_incompatible',       'DEFENSIVA', 'Imposibilidad de cumplir el plazo', 'No se puede cumplir el plazo de entrega comprometido.', 70),
('rechazo_en_entrega',       'DEFENSIVA', 'Producto rechazado al momento de la entrega', 'El cliente no recibe el producto en el momento de la entrega (§9.6 — distinto de postventa).', 80),
('oportunidad_mejora',       'OFENSIVA',  'Oportunidad de Mejora', 'Aparece un producto que cubre la necesidad real a un costo notoriamente menor (§9.4).', 90);
