-- migration-84-empresa-firmas.sql
-- VARIAS FIRMAS POR EMPRESA (pedido explícito del usuario, 1-sep-2026: "tener la posibilidad de
-- tener varias firmas... actualmente tenemos para subir una").
--
-- Hasta ahora la firma escaneada era UNA sola columna en `empresas` (firma_url/firma_nombre, ver
-- migration-51) y subir otra pisaba la anterior. En la práctica una misma empresa firma con más
-- de una persona (representante legal titular y suplente, apoderado por rubro, gerente técnico),
-- y cuál va en cada anexo depende del documento — no es un dato fijo de la empresa.
--
-- La columna `empresas.firma_url` NO se elimina: se mantiene sincronizada con la firma marcada
-- como PRINCIPAL (ver app/lib/empresa-firmas.ts). Así todo lo que ya la lee — el relleno de .docx
-- (anexos-rellenar.ts paso 3), la ficha técnica comercial, el motor de IA — sigue funcionando sin
-- cambios y sin quedarse sin firma; lo nuevo es que el usuario puede ELEGIR otra al firmar el PDF.
--
-- COLLATE explícito utf8mb4_unicode_ci, igual que migration-51 (esta tabla se une con `empresas`).
-- Sin FK, mismo criterio que empresa_documentos (el borrado de empresa lo maneja la aplicación).
--
-- Aplicar con: node scripts/aplicar-migration-84.mjs
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS empresa_firmas (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id         INT          NOT NULL,
  -- De quién es la firma ("Juan Pérez — Rep. legal"). Es lo que el usuario ve al elegir cuál
  -- arrastrar sobre el PDF, así que nunca puede quedar vacía: si no la escribe, se usa el nombre
  -- del archivo.
  etiqueta           VARCHAR(160) NOT NULL,
  url                VARCHAR(600) NOT NULL,
  nombre             VARCHAR(300) DEFAULT NULL,
  -- La que se usa cuando NADIE elige (el .docx, la ficha técnica, y el default del PDF). Una sola
  -- por empresa — lo garantiza la aplicación, no un índice: MySQL no tiene índices únicos
  -- parciales y `UNIQUE (empresa_id, es_principal)` prohibiría tener dos firmas NO principales.
  es_principal       TINYINT(1)   NOT NULL DEFAULT 0,
  orden              INT          NOT NULL DEFAULT 0,
  subido_por         INT          DEFAULT NULL,
  subido_por_nombre  VARCHAR(160) DEFAULT NULL,
  subido_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_empfirma_empresa (empresa_id, orden, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: la firma única que ya tenía cada empresa pasa a ser su primera firma, marcada como
-- principal. Sin esto, una empresa con firma cargada aparecería SIN ninguna firma en la pantalla
-- nueva aunque el .docx sí la siguiera estampando — el peor de los dos mundos.
INSERT INTO empresa_firmas (empresa_id, etiqueta, url, nombre, es_principal, orden)
SELECT e.id,
       COALESCE(NULLIF(TRIM(e.representante_nombre), ''), 'Firma principal'),
       e.firma_url,
       e.firma_nombre,
       1,
       0
  FROM empresas e
 WHERE e.firma_url IS NOT NULL AND TRIM(e.firma_url) <> ''
   AND NOT EXISTS (SELECT 1 FROM empresa_firmas f WHERE f.empresa_id = e.id);
