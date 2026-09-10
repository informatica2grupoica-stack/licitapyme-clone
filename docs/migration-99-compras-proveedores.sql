-- migration-99-compras-proveedores.sql
-- MÓDULO DE COMPRAS — Catálogo de Proveedores. Hasta acá, un proveedor era solo texto libre
-- (nombre + RUT) tipeado de nuevo en cada cotización — sin ficha, sin datos de contacto, sin datos
-- bancarios para pagarle. Esta tabla es transversal (no cuelga de un negocio puntual), mismo
-- criterio arquitectónico que `compras_fletero` (migration-93): "OBUMA aporta identidad e
-- histórico económico... la caracterización operativa no existe en OBUMA y debe vivir en tabla
-- propia de Licitank, enganchada por RUT" (spec §13.3) — acá aplica igual: OBUMA puede tener el
-- proveedor si ya le compramos algo, pero datos de contacto/categoría/cuenta bancaria para
-- COTIZAR y PAGAR no existen ahí.
--
-- CATEGORÍA es texto libre a propósito (§1.3.5: "todo catálogo es enunciativo, nunca taxativo") —
-- no se cablea una lista cerrada de rubros.
--
-- `compras_cotizacion.proveedor_id` (ALTER) engancha la cotización a la ficha del catálogo cuando
-- existe, SIN volverlo obligatorio: seguir permitiendo tipear nombre/RUT sueltos para el caso de un
-- proveedor nuevo que todavía no se ha dado de alta (mismo principio de no bloquear el flujo, §1.3.5).
--
-- Aplicar con `node scripts/aplicar-migration-99.mjs`. Idempotente: CREATE TABLE IF NOT EXISTS +
-- columna con chequeo previo en el script.

CREATE TABLE IF NOT EXISTS compras_proveedor (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  rut                 VARCHAR(20)      NULL,
  nombre_empresa      VARCHAR(300) NOT NULL,  -- razón social
  nombre_fantasia     VARCHAR(300)     NULL,
  categoria           VARCHAR(150)     NULL,  -- rubro — texto libre (§1.3.5)
  giro                VARCHAR(300)     NULL,
  contacto_nombre     VARCHAR(200)     NULL,
  correo              VARCHAR(200)     NULL,
  telefono            VARCHAR(60)      NULL,
  direccion           VARCHAR(400)     NULL,
  comuna              VARCHAR(150)     NULL,
  region              VARCHAR(150)     NULL,
  -- Datos de transferencia — mismo criterio que la captura del contacto de pagos (§17.3): sin esto
  -- se termina llamando al proveedor recién cuando hay que pagarle, con la orden de compra frenada.
  banco               VARCHAR(150)     NULL,
  tipo_cuenta         VARCHAR(60)      NULL,
  numero_cuenta       VARCHAR(60)      NULL,
  titular_cuenta      VARCHAR(200)     NULL,
  rut_titular         VARCHAR(20)      NULL,
  correo_pagos        VARCHAR(200)     NULL,  -- a veces distinto del contacto comercial
  obuma_proveedor_id  VARCHAR(60)      NULL,  -- homologación con OBUMA, manual (mismo patrón que SKU, §7.4)
  notas               TEXT             NULL,
  activo              TINYINT(1)   NOT NULL DEFAULT 1,
  creado_por          INT              NULL,
  creado_por_nombre   VARCHAR(160)     NULL,
  created_at          DATETIME     NOT NULL,
  updated_at          DATETIME     NOT NULL,
  INDEX idx_compras_proveedor_rut (rut),
  INDEX idx_compras_proveedor_categoria (categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- (el script aplicador comprueba si la columna ya existe antes de correr este ALTER)
ALTER TABLE compras_cotizacion
  ADD COLUMN proveedor_id INT NULL;  -- engancha a compras_proveedor cuando existe (opcional)
