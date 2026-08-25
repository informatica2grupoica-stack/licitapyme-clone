-- migration-77-anexos-oferta-paginacion.sql
-- La grilla de anexos de la apertura (ViewBidAttachment) muestra 6 archivos por página y pagina
-- el resto. El lector solo leía la primera página: un oferente con 15 anexos quedaba con 6.
--
-- POR QUÉ HACE FALTA GUARDAR EL NÚMERO DE PÁGINA:
-- el botón "Ver" es un ImageButton de ASP.NET cuyo nombre (DWNL$grdId$ctl03$search) se REINICIA
-- en cada página. Para bajar el archivo Nº3 de la página 2 hay que navegar primero a la página 2
-- y recién ahí apretar ctl03; si no, MP entrega el archivo Nº3 de la página 1 — el PDF
-- equivocado, en silencio. Sin esta columna, la fila guardada no sabe a qué página volver.
--
-- Aplicar con `node scripts/aplicar-migration-77.mjs` (o a mano en phpMyAdmin).
ALTER TABLE oferta_competencia_documento
  ADD COLUMN pagina_grilla INT NOT NULL DEFAULT 1;
