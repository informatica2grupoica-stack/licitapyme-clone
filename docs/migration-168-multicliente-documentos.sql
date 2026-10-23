-- migration-168-multicliente-documentos.sql
-- MULTI-CLIENTE, PASO C: de quién es cada documento de `documentos_cache`.
--
-- La tabla mezcla DOS cosas que hasta hoy convivían sin problema (una sola empresa):
--   1) Documentos OFICIALES de Mercado Público (bases, anexos del organismo…): públicos, iguales para todos → se COMPARTEN.
--   2) Documentos PROPIOS que alguien de la empresa generó o subió (anexos rellenados, costeo, órdenes de compra,
--      archivos subidos a mano): privados de esa empresa.
--
-- `cliente_id`:  0 = oficial compartido · N = documento propio de la empresa N.
-- DEFAULT 1 A PROPÓSITO (falla cerrado): cualquier código que todavía no sepa de empresas y escriba un documento lo deja como
-- PROPIO de Grupo ICA, que es lo que ha sido siempre; jamás queda "compartido" por olvido. Solo quien baja documentos
-- oficiales de Mercado Público escribe 0 explícito (app/services/documentosService.server.ts).
--
-- Respaldo de lo existente (aplicar-migration-168.mjs, solo la primera vez que se crea la columna):
--   · oficial (cliente_id 0) = categoría que NO es propia (ni DOCUMENTOS_PROPIOS ni ANEXOS_*) y que no se subió a mano
--     (documentos_origen_manual). Todo lo demás queda como propio de ICA (1).
--
-- La llave única pasa a incluir la empresa: dos empresas pueden tener un archivo con el mismo nombre en la misma licitación.

ALTER TABLE documentos_cache ADD COLUMN cliente_id INT NOT NULL DEFAULT 1, ALGORITHM=INSTANT;
ALTER TABLE documentos_cache ADD INDEX idx_docs_cliente (cliente_id, licitacion_codigo);
ALTER TABLE documentos_cache DROP INDEX unique_doc, ADD UNIQUE INDEX uq_doc_cliente (licitacion_codigo, documento_nombre, cliente_id);
