-- Migración 78 — SELECTOR DE LÍNEAS A OFERTAR.
--
-- POR QUÉ: en una licitación por línea casi nunca se postula a TODAS. Hasta ahora el sistema no
-- tenía dónde guardar esa decisión, así que cada módulo la adivinaba por su cuenta:
--   · el checklist TÉCNICO creaba una fila `linea_tecnica` por CADA línea del informe, aunque
--     solo se ofertara una (caso real 986278-14-LE26: se postula solo a la Línea 7 y salían las 7);
--   · el costeo dejaba que el asistente marcara `checklist_comercial.ofertamos = 0` línea por
--     línea, pero solo en los ítems de PRECIO y solo al cargar el Excel — tarde y parcial;
--   · el Motor Comercial alertaba descuadres contra líneas que jamás se iban a ofertar.
--
-- Esta tabla es la FUENTE DE VERDAD a nivel negocio. `checklist_comercial.ofertamos` (que ya
-- existe y que auditor-generacion.ts y el costeo ya respetan) pasa a ser su PROYECCIÓN: al
-- guardar la selección se propaga a todas las filas con linea_numero. No se inventa un segundo
-- mecanismo de exclusión — se le da un origen único al que ya funcionaba.
--
-- SEMÁNTICA DELIBERADA — la ausencia de filas significa "todavía no se decidió", NO "no se oferta
-- nada". Un negocio sin filas acá se comporta exactamente como antes de esta migración. Así el
-- filtro es fail-open: olvidarse de contestar el banner nunca hace desaparecer trabajo.
--
-- Se guarda el nombre de la línea y quién/cuándo decidió porque esta tabla es, además, el
-- material de aprendizaje: con selecciones humanas confirmadas acumuladas se puede después
-- proponer automáticamente a qué líneas ir (segunda etapa, no incluida acá).
--
-- Aplicar con `node scripts/aplicar-migration-78.mjs` (o a mano en phpMyAdmin).
-- Idempotente: CREATE TABLE IF NOT EXISTS. No hay backfill — no existe ningún rastro real de
-- qué líneas se ofertaron en los negocios pasados, y no se inventan datos.

CREATE TABLE IF NOT EXISTS negocio_lineas_oferta (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  negocio_id        INT          NOT NULL,
  licitacion_codigo VARCHAR(100) NOT NULL,
  linea_numero      INT          NOT NULL,   -- número REAL de la línea (ver lineasTecnicasDelInforme)
  nombre_linea      VARCHAR(300)     NULL,   -- foto del nombre al decidir, para leer la decisión después
  ofertamos         TINYINT(1)   NOT NULL DEFAULT 1,
  decidido_por      INT              NULL,   -- usuarios.id
  decidido_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_negocio_linea (negocio_id, linea_numero),
  KEY idx_nlo_negocio (negocio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
