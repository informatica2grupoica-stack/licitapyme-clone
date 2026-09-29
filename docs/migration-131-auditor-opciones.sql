-- migration-131-auditor-opciones.sql
-- AUDITOR unificado de la licitación (29-sep-2026) — modelo de datos de la OPCIÓN.
-- Spec: ESPECIFICACION_AUDITOR_v1.md (§4 opción, §6 Lector, §3.3 eventos) y
-- NOTA_PROGRAMADOR_Unificacion_AUDITOR.md (§6 entidades).
--
-- Opción = línea del Costeo + producto (marca/modelo) + proveedor. Una línea puede tener varias.
-- fila_id = FilaEditorCosteo.id (misma clave estable de negocio_costeo_editor.datos_json que ya usan
-- negocio_auditor_compra_linea y compras_auditor_costeo_linea).
--
--   auditor_opcion     → la unidad de trabajo. estado: tanteo → formalizada → verificada →
--                        definitiva → en_aprobacion → aprobada (o descartada, desde cualquiera).
--   auditor_respaldo   → cada link / cotización / proforma / ficha cargado a una opción. NUNCA se
--                        sobrescribe ni se borra: el costo evoluciona (web → formal) y queda el
--                        historial. `sostiene_costo` marca cuál respalda el costo vigente.
--   auditor_extraccion → salida JSON del Lector (Prompt 6) sobre un respaldo. Una por lectura.
--   auditor_evento     → eventos que el código enruta entre los dos verificadores
--                        (documento_nuevo, producto_cambiado, complemento_requerido, etc.).
--
-- Las tablas de verificación técnica y de costo, capturas de links y costos asociados llegan en las
-- fases siguientes. Las tablas legadas negocio_auditor_compra_* (migration-129/130) NO se tocan:
-- se copian a estas como opción 1 de cada línea (backfill al final, idempotente).
--
-- Aplicar con `node scripts/aplicar-migration-131.mjs` (idempotente).

CREATE TABLE IF NOT EXISTS auditor_opcion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  fila_id VARCHAR(40) NOT NULL,
  marca VARCHAR(120) NULL,
  modelo VARCHAR(160) NULL,
  version_producto VARCHAR(160) NULL,
  sku_proveedor VARCHAR(120) NULL,
  proveedor_razon_social VARCHAR(200) NULL,
  proveedor_rut VARCHAR(20) NULL,
  via ENUM('liviana','completa') NOT NULL DEFAULT 'completa',
  estado ENUM('tanteo','formalizada','verificada','definitiva','en_aprobacion','aprobada','descartada') NOT NULL DEFAULT 'tanteo',
  motivo_descarte VARCHAR(500) NULL,
  origen VARCHAR(30) NOT NULL DEFAULT 'manual',
  firmada_por INT NULL,
  firmada_por_nombre VARCHAR(160) NULL,
  firmada_at DATETIME NULL,
  creado_por INT NULL,
  creado_por_nombre VARCHAR(160) NULL,
  creado_at DATETIME NOT NULL,
  actualizado_at DATETIME NOT NULL,
  INDEX idx_auditor_opcion_negocio_fila (negocio_id, fila_id),
  INDEX idx_auditor_opcion_estado (negocio_id, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditor_respaldo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  opcion_id INT NOT NULL,
  negocio_id INT NOT NULL,
  tipo ENUM('link_web','cotizacion_formal','proforma_importacion','respaldo_informal','historico_interno','ficha_tecnica','otro') NOT NULL,
  url VARCHAR(1000) NULL,
  documento_url VARCHAR(1000) NULL,
  documento_nombre VARCHAR(300) NULL,
  precio_declarado DECIMAL(14,2) NULL,
  precio_iva ENUM('incluido','neto','no_declarado') NOT NULL DEFAULT 'no_declarado',
  vigente TINYINT(1) NOT NULL DEFAULT 1,
  sostiene_costo TINYINT(1) NOT NULL DEFAULT 0,
  origen VARCHAR(30) NOT NULL DEFAULT 'manual',
  cargado_por INT NULL,
  cargado_por_nombre VARCHAR(160) NULL,
  cargado_at DATETIME NOT NULL,
  INDEX idx_auditor_respaldo_opcion (opcion_id),
  INDEX idx_auditor_respaldo_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditor_extraccion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  respaldo_id INT NOT NULL,
  opcion_id INT NOT NULL,
  modo ENUM('completo','comercial','dirigido') NOT NULL,
  extraccion_json LONGTEXT NOT NULL,
  motor VARCHAR(60) NULL,
  creado_at DATETIME NOT NULL,
  INDEX idx_auditor_extraccion_respaldo (respaldo_id),
  INDEX idx_auditor_extraccion_opcion (opcion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS auditor_evento (
  id INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id INT NOT NULL,
  opcion_id INT NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  emisor VARCHAR(30) NOT NULL,
  detalle TEXT NULL,
  resuelto TINYINT(1) NOT NULL DEFAULT 0,
  creado_at DATETIME NOT NULL,
  resuelto_at DATETIME NULL,
  INDEX idx_auditor_evento_opcion (opcion_id, resuelto),
  INDEX idx_auditor_evento_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- BACKFILL 1: cada fila con registro en negocio_auditor_compra_linea pasa a ser la opción 1 de su
-- línea. Sin marca/modelo/proveedor (nunca se registraron): quedan NULL, no se inventan.
-- via='completa' (la más estricta) hasta que el asistente elija la liviana.
INSERT INTO auditor_opcion
  (negocio_id, fila_id, via, estado, origen, creado_por, creado_por_nombre, creado_at, actualizado_at)
SELECT l.negocio_id, l.fila_id, 'completa', IF(l.cotizado = 1, 'formalizada', 'tanteo'), 'migracion_130',
       l.actualizado_por, l.actualizado_por_nombre, l.actualizado_at, l.actualizado_at
FROM negocio_auditor_compra_linea l
WHERE NOT EXISTS (
  SELECT 1 FROM auditor_opcion o
  WHERE o.negocio_id = l.negocio_id AND o.fila_id = l.fila_id AND o.origen = 'migracion_130'
);

-- BACKFILL 2: el documento de cotización de cada fila (el de la cotización agrupadora, o el legado
-- suelto de la fila) pasa a ser un respaldo de esa opción, con el precio cotizado. El IVA de ese
-- precio nunca se registró: queda 'no_declarado' (no se supone).
INSERT INTO auditor_respaldo
  (opcion_id, negocio_id, tipo, documento_url, documento_nombre, precio_declarado, precio_iva,
   vigente, sostiene_costo, origen, cargado_por, cargado_por_nombre, cargado_at)
SELECT o.id, l.negocio_id, 'cotizacion_formal', COALESCE(c.documento_url, l.documento_url),
       COALESCE(c.documento_nombre, l.documento_nombre), l.precio_cotizado, 'no_declarado',
       1, 0, 'migracion_130', l.actualizado_por, l.actualizado_por_nombre, l.actualizado_at
FROM negocio_auditor_compra_linea l
JOIN auditor_opcion o ON o.negocio_id = l.negocio_id AND o.fila_id = l.fila_id AND o.origen = 'migracion_130'
LEFT JOIN negocio_auditor_compra_cotizacion c ON c.id = l.cotizacion_id
WHERE COALESCE(c.documento_url, l.documento_url) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auditor_respaldo r WHERE r.opcion_id = o.id AND r.origen = 'migracion_130');
