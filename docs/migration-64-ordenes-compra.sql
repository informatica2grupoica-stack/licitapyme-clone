-- migration-64-ordenes-compra.sql
-- ÓRDENES DE COMPRA de Mercado Público (API /servicios/v1/publico/ordenesdecompra).
--
-- POR QUÉ una tabla y no consultar la API en cada carga de pantalla:
--   1. La API NO permite preguntar "¿cuál es la OC de la licitación X?". Solo se puede pedir el
--      listado de UN día (~16.000 OC de todo Chile, con Codigo/Nombre/CodigoEstado y nada más) o
--      el detalle de UNA orden por su código. Encontrar las nuestras exige barrer los días y
--      cruzar — eso lo hace el cron una vez, no cada visita a la ficha.
--   2. El listado diario es un listado de MOVIMIENTOS, no de creaciones: una misma OC reaparece el
--      día que cambia de estado. Guardar el estado anterior es lo que permite avisar "la OC pasó a
--      Aceptada" en vez de re-avisar la misma OC todos los días.
--   3. Uso posterior (pedido explícito del usuario, 4-ago-2026): las OC alimentan los CERTIFICADOS
--      DE EXPERIENCIA de la memoria comercial — para eso hacen falta el organismo comprador, el
--      monto y los ítems, no solo el código. Por eso se guarda el detalle completo, no un puntero.
--
-- Idempotente: se puede correr dos veces sin romper nada.

CREATE TABLE IF NOT EXISTS ordenes_compra (
  id                  INT AUTO_INCREMENT PRIMARY KEY,

  -- Identificación. `codigo` es el de Mercado Público (ej. "2446-778-SE26") y es la huella única.
  codigo              VARCHAR(60)  NOT NULL,
  nombre              VARCHAR(600) DEFAULT NULL,
  -- Licitación de origen. Puede venir del campo CodigoLicitacion del detalle o del NOMBRE de la
  -- orden ("ORDEN DE COMPRA DESDE 2446-134-LE26"), que es como se detectan la mayoría.
  licitacion_codigo   VARCHAR(60)  DEFAULT NULL,
  -- Empresa nuestra a la que corresponde (se resuelve por el negocio de esa licitación). NULL si
  -- todavía no se pudo determinar — nunca se inventa.
  empresa_id          INT          DEFAULT NULL,

  -- Estado (códigos de la API: 4 enviada a proveedor, 5 en proceso, 6 aceptada, 9 cancelada,
  -- 12 recepción conforme, 13 pendiente de recepcionar, 14 recepcionada parcialmente,
  -- 15 recepción conforme incompleta). Se guarda el código Y el texto: el código es estable, el
  -- texto es el que la API entrega y el que se muestra.
  codigo_estado       INT          DEFAULT NULL,
  estado              VARCHAR(120) DEFAULT NULL,
  codigo_tipo         VARCHAR(10)  DEFAULT NULL,   -- OC, SE, AG, CM, TD…
  tipo                VARCHAR(120) DEFAULT NULL,

  fecha_creacion      DATETIME     DEFAULT NULL,
  fecha_envio         DATETIME     DEFAULT NULL,
  fecha_aceptacion    DATETIME     DEFAULT NULL,
  fecha_cancelacion   DATETIME     DEFAULT NULL,

  moneda              VARCHAR(10)  DEFAULT NULL,
  total_neto          DECIMAL(18,2) DEFAULT NULL,
  impuestos           DECIMAL(18,2) DEFAULT NULL,
  total               DECIMAL(18,2) DEFAULT NULL,

  -- Comprador: lo que va en un certificado de experiencia ("le vendimos esto a este organismo").
  comprador_organismo VARCHAR(300) DEFAULT NULL,
  comprador_unidad    VARCHAR(300) DEFAULT NULL,
  comprador_rut       VARCHAR(20)  DEFAULT NULL,
  comprador_contacto  VARCHAR(200) DEFAULT NULL,
  comprador_mail      VARCHAR(200) DEFAULT NULL,

  -- Proveedor (nosotros). `proveedor_codigo` es el código interno de Mercado Público: se descubre
  -- solo desde la primera OC nuestra y sirve para la consulta directa por proveedor, que es mucho
  -- más barata que barrer el listado diario completo.
  proveedor_codigo    VARCHAR(30)  DEFAULT NULL,
  proveedor_nombre    VARCHAR(300) DEFAULT NULL,
  proveedor_rut       VARCHAR(20)  DEFAULT NULL,

  items_json          LONGTEXT     DEFAULT NULL,   -- Items.Listado tal cual lo entrega la API
  raw_json            LONGTEXT     DEFAULT NULL,   -- respuesta completa, por si mañana hace falta un campo más

  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_oc_codigo (codigo),
  KEY idx_oc_licitacion (licitacion_codigo),
  KEY idx_oc_empresa (empresa_id),
  KEY idx_oc_estado (codigo_estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- OJO con la collation: utf8mb4_general_ci, la MISMA que el resto de las tablas que se cruzan por
-- licitacion_codigo (negocios, documentos_cache, viabilidad_licitacion). Cuatro tablas de este
-- proyecto quedaron en unicode_ci y sus JOINs mueren en silencio — ver la bitácora de collations.

-- Código interno de proveedor en Mercado Público, por empresa. No es el RUT (probado: la API
-- devuelve 0 resultados con el RUT en cualquier formato) sino un id propio del portal, ej. 26855.
-- Se descubre solo la primera vez que aparece una OC nuestra y a partir de ahí permite la consulta
-- directa `?fecha=X&CodigoProveedor=N`, que devuelve solo nuestras órdenes en vez de las ~16.000
-- del día. Se puede editar a mano si se conoce.
ALTER TABLE empresas ADD COLUMN mp_codigo_proveedor VARCHAR(30) DEFAULT NULL;

-- ── es_nuestra ────────────────────────────────────────────────────────────────────────────────
-- BUG REAL encontrado en la primera corrida contra la API (4-ago-2026): el cruce por el NOMBRE de
-- la orden encuentra las órdenes DE LA LICITACIÓN, y si la perdimos esa orden es del COMPETIDOR
-- que ganó. Sin este flag, la orden de "HIJOS PLANELLA JUEGOS INFANTILES SPA" se guardó como
-- nuestra, con nuestro empresa_id, y hasta le robó el código de proveedor a nuestra ficha.
--
-- Se decide comparando el RUT del proveedor de la orden contra los RUT de nuestras empresas. Las
-- ajenas NO se descartan —saber a quién le emitieron la orden y por cuánto es inteligencia
-- competitiva del mismo valor que el acta— pero nunca avisan ni se asocian a una empresa nuestra.
ALTER TABLE ordenes_compra ADD COLUMN es_nuestra TINYINT(1) NOT NULL DEFAULT 0;
