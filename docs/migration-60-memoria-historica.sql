-- migration-60-memoria-historica.sql
-- MEMORIA HISTÓRICA (Frente F.3) — el histórico OC ↔ factura como "casos de experiencia".
--
-- DOS PROPÓSITOS (los del plan):
--   1. Responder rápido cuando MP pide experiencia previa: la OC + su factura SON la prueba.
--   2. Orientar postulaciones, filtros y costeo con lo que ya hicimos bien antes.
--
-- ════════ LA DECISIÓN QUE ESTA MIGRACIÓN ZANJA: MULTI-CLIENTE ════════════════
-- Hoy NINGUNA tabla del sistema tiene columna de cliente/tenant: toda la base asume un solo
-- dueño. Eso está bien para lo ya construido, pero la memoria histórica es EL activo que se
-- comercializa: si Licitank se vende a otro cliente, su histórico no puede mezclarse con el de
-- Tecnomaq ni un solo registro.
--
-- Se resuelve ahora porque ahora es gratis: estas tablas nacen vacías. Agregar `cliente_id` a
-- una tabla vacía cuesta 0; agregarlo después, con años de OC cargadas, obliga a migrar datos
-- de producción y a auditar cada consulta ya escrita.
--
-- ALCANCE DELIBERADAMENTE ACOTADO: NO se agrega cliente_id a `negocios`, `alertas` ni al resto
-- del sistema. Eso sí sería una migración de datos en producción y no es lo que se pidió. Lo que
-- se hace es dejar la COSTURA puesta donde importa:
--   · `clientes`            → la tabla de tenants (hoy: uno).
--   · `empresas.cliente_id` → a qué cliente pertenece cada empresa del grupo. Éste es el puente:
--                             un caso de experiencia se ata a una empresa, y la empresa a un
--                             cliente. Sin esto habría que adivinar el dueño de cada OC.
--   · `experiencia_*.cliente_id` NOT NULL → toda consulta de memoria filtra por cliente desde el
--                             primer día, aunque hoy siempre valga 1. Un filtro que existe desde
--                             el inicio no se olvida nunca; uno que se agrega después se olvida
--                             en la mitad de las consultas.
--
-- ════════ MODELO DE DATOS ════════════════════════════════════════════════════
--   experiencia_caso      → QUÉ hicimos: una OC ejecutada para una entidad, por una empresa del
--                           grupo, en una fecha, por un monto. La unidad de experiencia.
--   experiencia_item      → QUÉ productos la componen, normalizados a línea de negocio. Es lo que
--                           permite "ya vendimos este genérico antes, a este precio".
--   experiencia_documento → el RESPALDO: la OC y su(s) factura(s). El link OC→factura del plan es
--                           esta tabla: mismo caso_id, tipo distinto.
--
-- `licitacion_codigo` es NULLABLE a propósito: buena parte del histórico viejo son OC de compra
-- ágil o trato directo que nunca pasaron por una licitación nuestra. Exigirlo dejaría fuera
-- justo la experiencia más antigua, que es la que más cuesta reconstruir.
--
-- `precio_unitario` se guarda por ítem y no solo el total del caso: el costeo (Frente D) pregunta
-- "¿a cuánto vendimos ESTE producto?", no "¿cuánto sumó esa OC?".
--
-- CHARSET utf8mb4_unicode_ci: se une con `empresas` (que es unicode_ci). Los cruces contra
-- `negocios`/`licitaciones` (general_ci) llevan COLLATE explícito en el código — ver el historial
-- de "Illegal mix of collations".
--
-- Aplicar con `node scripts/aplicar-migration-60.mjs` (o a mano en phpMyAdmin).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Tenants ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(180) NOT NULL,
  rut         VARCHAR(20)  DEFAULT NULL,
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El cliente 1 es el dueño actual del sistema. Id fijo: el default de las columnas de abajo
-- apunta a él, así que no puede quedar al azar del AUTO_INCREMENT.
INSERT INTO clientes (id, nombre, rut) VALUES (1, 'Grupo ICA', NULL)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- 2) Puente empresa → cliente --------------------------------------------------
-- Esta versión de MySQL no soporta ADD COLUMN IF NOT EXISTS: el script aplicar-migration-60.mjs
-- comprueba antes y solo corre lo que falta.
ALTER TABLE empresas ADD COLUMN cliente_id INT NOT NULL DEFAULT 1;
ALTER TABLE empresas ADD INDEX idx_empresas_cliente (cliente_id);

-- 3) Casos de experiencia ------------------------------------------------------
CREATE TABLE IF NOT EXISTS experiencia_caso (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id         INT           NOT NULL DEFAULT 1,
  empresa_id         INT           DEFAULT NULL,   -- qué empresa del grupo lo ejecutó
  oc_numero          VARCHAR(60)   NOT NULL,       -- número de orden de compra (MP o interno)
  oc_fecha           DATE          DEFAULT NULL,
  monto              DECIMAL(18,2) DEFAULT NULL,
  moneda             VARCHAR(10)   NOT NULL DEFAULT 'CLP',
  entidad_nombre     VARCHAR(255)  NOT NULL,       -- mandante/comprador
  entidad_rut        VARCHAR(20)   DEFAULT NULL,
  licitacion_codigo  VARCHAR(64)   DEFAULT NULL,   -- NULL: compra ágil / trato directo
  categoria          VARCHAR(120)  DEFAULT NULL,   -- línea de negocio principal
  descripcion        TEXT          DEFAULT NULL,
  estado             VARCHAR(24)   NOT NULL DEFAULT 'CERRADO',  -- CERRADO | EN_EJECUCION
  origen             VARCHAR(24)   NOT NULL DEFAULT 'MANUAL',   -- MANUAL | IMPORTACION | MP
  creado_por         INT           DEFAULT NULL,
  creado_por_nombre  VARCHAR(160)  DEFAULT NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- La OC es única DENTRO de un cliente, no globalmente: dos clientes distintos pueden tener
  -- una OC con el mismo número y ninguno debe bloquear al otro.
  UNIQUE KEY uq_caso_oc (cliente_id, oc_numero),
  KEY idx_caso_cliente (cliente_id, oc_fecha),
  KEY idx_caso_entidad (cliente_id, entidad_rut),
  KEY idx_caso_categoria (cliente_id, categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS experiencia_item (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  caso_id           INT           NOT NULL,
  cliente_id        INT           NOT NULL DEFAULT 1,  -- denormalizado a propósito: las búsquedas
                                                       -- de producto filtran por cliente sin JOIN
  descripcion       VARCHAR(500)  NOT NULL,
  categoria         VARCHAR(120)  DEFAULT NULL,        -- línea de negocio normalizada
  marca             VARCHAR(120)  DEFAULT NULL,
  modelo            VARCHAR(120)  DEFAULT NULL,
  cantidad          DECIMAL(14,3) DEFAULT NULL,
  unidad            VARCHAR(30)   DEFAULT NULL,
  precio_unitario   DECIMAL(18,2) DEFAULT NULL,        -- a cuánto lo VENDIMOS
  costo_unitario    DECIMAL(18,2) DEFAULT NULL,        -- a cuánto lo COMPRAMOS (si se conoce)
  proveedor         VARCHAR(200)  DEFAULT NULL,
  KEY idx_item_caso (caso_id),
  KEY idx_item_busqueda (cliente_id, categoria),
  -- Búsqueda por texto del producto: es LA consulta del módulo ("¿ya vendimos esto?").
  FULLTEXT KEY ft_item_descripcion (descripcion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS experiencia_documento (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  caso_id           INT           NOT NULL,
  cliente_id        INT           NOT NULL DEFAULT 1,
  tipo              VARCHAR(16)   NOT NULL,        -- OC | FACTURA | OTRO
  numero            VARCHAR(60)   DEFAULT NULL,    -- folio de la factura / nº de la OC
  fecha             DATE          DEFAULT NULL,
  monto             DECIMAL(18,2) DEFAULT NULL,
  url               VARCHAR(600)  DEFAULT NULL,    -- copia en R2
  nombre            VARCHAR(300)  DEFAULT NULL,
  texto_extraido    LONGTEXT      DEFAULT NULL,    -- MarkItDown/OCR, para releer sin re-procesar
  subido_por        INT           DEFAULT NULL,
  subido_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_doc_caso (caso_id, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
