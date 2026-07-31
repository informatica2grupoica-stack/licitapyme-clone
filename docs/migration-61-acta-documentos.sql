-- migration-61-acta-documentos.sql
-- ANEXOS DE LA ADJUDICACIÓN (Frente F.2, segunda mitad) — los documentos del acta.
--
-- Hasta ahora la sección "Resultado" de una licitación ganada solo tenía un LINK que sacaba al
-- usuario a Mercado Público. Todo lo que importa vive detrás de ese link: el ACTA DE EVALUACIÓN
-- (cómo puntuaron a cada oferente), la resolución que adjudica y las declaraciones juradas.
--
-- La página es `PreviewAwardAct.aspx?qs=…` ("Resolución de Acta de Adjudicación"), cuya URL ya
-- viene de la API de MP y está cacheada en `adjudicacion_cache.url_acta`. No hay que descubrirla.
--
-- MECANISMO DE DESCARGA: el MISMO que los anexos de oferta — ImageButton de ASP.NET
-- `DWNL$grdId$ctlNN$search` que baja el archivo por POSTBACK con __VIEWSTATE. Por eso se guarda
-- el nombre del control y no una URL: no existe un enlace directo que guardar.
-- Ver app/lib/mp-ofertas.ts → descargarAnexoPorPostback().
--
-- TABLA APARTE Y NO REUSAR `oferta_competencia_documento`: son cosas distintas. Los anexos de
-- oferta pertenecen a UN OFERENTE y existen desde la apertura; estos pertenecen al ORGANISMO y
-- existen desde la adjudicación. Meterlos en la misma tabla obligaría a un proveedor_rut falso
-- y a filtrar por él en cada consulta.
--
-- CHARSET utf8mb4_general_ci: se une con `negocios`/`adjudicacion_cache` por licitacion_codigo.
--
-- Aplicar con `node scripts/aplicar-migration-61.mjs` (o a mano en phpMyAdmin).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS acta_documento (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  licitacion_codigo  VARCHAR(64)   NOT NULL,
  nombre             VARCHAR(400)  NOT NULL,   -- columna "Anexo" (nombre del archivo)
  -- Columna "Tipo". MP mezcla rótulos legibles ("Resolución/Decreto Adjudicación") con códigos
  -- internos ("DOCUMENT_TYPE_ACTA_EVALUACION_ADJ_ATTACHMENT"); se guarda CRUDO y se traduce al
  -- mostrar, para no perder el dato original si mañana aparece un código nuevo.
  tipo_mp            VARCHAR(160)  DEFAULT NULL,
  descripcion        VARCHAR(400)  DEFAULT NULL,
  tamano_kb          INT           DEFAULT NULL,
  fecha_adjunto      VARCHAR(40)   DEFAULT NULL,  -- tal como lo publica MP (texto)
  control_postback   VARCHAR(80)   DEFAULT NULL,  -- DWNL$grdId$ctlNN$search
  url_acta           VARCHAR(1000) DEFAULT NULL,  -- página contenedora (para re-resolver el POST)
  url_r2             VARCHAR(600)  DEFAULT NULL,  -- copia propia (NULL = aún no descargado)
  bytes              INT           DEFAULT NULL,
  content_type       VARCHAR(120)  DEFAULT NULL,
  descargado_at      DATETIME      DEFAULT NULL,
  error              VARCHAR(300)  DEFAULT NULL,
  detectado_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Por (licitación, nombre): el control ctlNN cambia de posición si el organismo agrega un
  -- anexo, así que indexar por él duplicaría los archivos en cada lectura.
  UNIQUE KEY uq_acta_doc (licitacion_codigo, nombre(180)),
  KEY idx_acta_pendiente (descargado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
