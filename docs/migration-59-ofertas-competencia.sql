-- migration-59-ofertas-competencia.sql
-- MÓDULO DE EVALUACIÓN EN LÍNEA (Frente F.2) — cimiento de datos.
--
-- Hasta ahora `licitacion_apertura` (migración 41) solo respondía SÍ/NO: "¿ya se aperturó?".
-- Detectaba el evento y ahí moría. Esta migración guarda lo que hay DENTRO de la apertura:
-- contra quién competimos y a qué precio.
--
-- TRES PIEZAS:
--   · oferta_competencia            → una fila por (licitación, proveedor, línea). El dato duro.
--   · oferta_competencia_documento  → los archivos que cada competidor subió. Se registra el link
--     primero y se baja el binario después (misma disciplina que la descarga de bases: detectar y
--     descargar son pasos separados, así una descarga que falla no pierde el hallazgo).
--   · columnas de estado en licitacion_apertura → cuándo se leyó, cuántas salieron, qué falló.
--
-- POR QUÉ `linea_numero` CON DEFAULT 0 Y NO NULL:
-- forma parte de la clave única. En MySQL, NULL nunca es igual a NULL, así que una UNIQUE con
-- columna NULL deja pasar duplicados infinitos del mismo proveedor. 0 = "oferta global, sin
-- desglose por línea"; 1..N = la línea correspondiente cuando la apertura sí la desglosa.
--
-- POR QUÉ SE GUARDA `es_nuestra`:
-- en la apertura aparecemos NOSOTROS también (cualquiera de las empresas del grupo). Marcarlo al
-- momento de leer permite comparar "mi oferta vs. el resto" sin re-cruzar RUTs en cada consulta,
-- y sobrevive a que después se edite la ficha de la empresa.
--
-- RUT NORMALIZADO: sin puntos, con guión, DV en mayúscula (76902659-2). El portal los escribe de
-- tres formas distintas según la página; normalizar al escribir es lo único que hace que la clave
-- única funcione de verdad.
--
-- CHARSET utf8mb4_general_ci a propósito: es el de `negocios`, con quien se une por
-- licitacion_codigo. `licitacion_apertura` es unicode_ci, así que los JOINs contra ELLA llevan
-- COLLATE explícito en el código (ver detectar-aperturas.ts y el historial de "Illegal mix of
-- collations").
--
-- Aplicar con `node scripts/aplicar-migration-59.mjs` (o a mano en phpMyAdmin).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS oferta_competencia (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo  VARCHAR(64)   NOT NULL,
  proveedor_rut      VARCHAR(20)   NOT NULL,   -- normalizado: 76902659-2
  proveedor_nombre   VARCHAR(255)  NOT NULL,
  nombre_oferta      VARCHAR(400)  DEFAULT NULL,         -- "Nombre Oferta" del Resumen de ofertas
  -- Estado que MP le puso a la oferta: Aceptada / Inadmisible / Rechazada / Desestimada.
  -- Se guarda porque un oferente declarado inadmisible NO es competencia real: contarlo infla
  -- el número de rivales y ensucia la comparación de precios.
  estado             VARCHAR(40)   DEFAULT NULL,
  linea_numero       INT           NOT NULL DEFAULT 0,   -- 0 = oferta global (sin desglose)
  linea_descripcion  VARCHAR(400)  DEFAULT NULL,
  monto              DECIMAL(18,2) DEFAULT NULL,         -- NULL = la apertura no publicó montos
  moneda             VARCHAR(10)   DEFAULT NULL,
  es_nuestra         TINYINT(1)    NOT NULL DEFAULT 0,   -- el RUT calza con una empresa del grupo
  fuente             VARCHAR(40)   NOT NULL,             -- qué página del portal lo entregó
  leida_en           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_oferta (licitacion_codigo, proveedor_rut, linea_numero),
  KEY idx_oferta_codigo (licitacion_codigo),
  KEY idx_oferta_rut (proveedor_rut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS oferta_competencia_documento (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo  VARCHAR(64)   NOT NULL,
  -- NOT NULL con '' en vez de NULL a propósito: forma parte de la clave única, y en MySQL
  -- NULL != NULL, así que un proveedor sin RUT resuelto duplicaría el archivo en cada pasada.
  proveedor_rut      VARCHAR(20)   NOT NULL DEFAULT '',
  -- Categoría del anexo en la ficha de apertura. Son las 5 pestañas que MP muestra por oferente:
  -- DECLARACION_JURADA · INFORMACION_PROVEEDOR · ADMINISTRATIVOS · TECNICOS · ECONOMICOS (+ OTRO).
  -- Es lo que se pidió ver agrupado: "de cada oferente, sus anexos por tipo".
  categoria          VARCHAR(30)   NOT NULL DEFAULT 'OTRO',
  tipo_mp            VARCHAR(120)  DEFAULT NULL,   -- columna "Tipo" de la tabla de adjuntos
  descripcion        VARCHAR(400)  DEFAULT NULL,   -- columna "Descripción"
  tamano_kb          INT           DEFAULT NULL,   -- columna "Tamaño" (KB), tal como la publica MP
  nombre             VARCHAR(400)  NOT NULL,
  -- Página-categoría que contiene este archivo (ViewBidAttachment.aspx?enc=...). Se guarda para
  -- poder volver a entrar y re-resolver el link real del archivo cuando el `enc` expire.
  url_contenedor     VARCHAR(1000) DEFAULT NULL,
  url_mp             VARCHAR(1000) NOT NULL,       -- link al archivo en el portal (efímero)
  url_r2             VARCHAR(600)  DEFAULT NULL,   -- copia propia (NULL = aún no descargado)
  bytes              INT           DEFAULT NULL,
  content_type       VARCHAR(120)  DEFAULT NULL,
  descargado_at      DATETIME      DEFAULT NULL,
  error              VARCHAR(300)  DEFAULT NULL,   -- último fallo de descarga (no enmudecer)
  detectado_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- url_mp indexada por prefijo: los enc= son largos y MySQL no indexa 1000 chars en utf8mb4.
  -- Clave por (licitación, proveedor, categoría, nombre) y NO por url_mp: el `enc` de MP cambia
  -- entre lecturas del mismo archivo, así que indexar por URL crearía una fila nueva en cada
  -- pasada del cron para el mismo PDF.
  UNIQUE KEY uq_ofdoc (licitacion_codigo, proveedor_rut, categoria, nombre(120)),
  KEY idx_ofdoc_pendiente (descargado_at),
  KEY idx_ofdoc_proveedor (licitacion_codigo, proveedor_rut, categoria)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Estado de la LECTURA de la apertura (distinto de la DETECCIÓN, que ya vive en la tabla).
-- Esta versión de MySQL no soporta ADD COLUMN IF NOT EXISTS (verificado con migration-51):
-- el script aplicar-migration-59.mjs comprueba antes y solo corre lo que falta.
ALTER TABLE licitacion_apertura ADD COLUMN ofertas_leidas_en   DATETIME     DEFAULT NULL;
ALTER TABLE licitacion_apertura ADD COLUMN ofertas_encontradas INT          NOT NULL DEFAULT 0;
ALTER TABLE licitacion_apertura ADD COLUMN ofertas_intentos    INT          NOT NULL DEFAULT 0;
ALTER TABLE licitacion_apertura ADD COLUMN ofertas_diagnostico VARCHAR(400) DEFAULT NULL;
