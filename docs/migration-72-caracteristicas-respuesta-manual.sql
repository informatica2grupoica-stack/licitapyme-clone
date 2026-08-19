-- migration-72-caracteristicas-respuesta-manual.sql
-- RESPUESTA MANUAL Y ADJUNTO POR CARACTERÍSTICA (Auditor Técnico, nivel 3).
--
-- POR QUÉ (19-ago-2026): lo que una persona contesta a mano en una casilla (o el veredicto que
-- el asesor corrige) se guardaba bien, pero la siguiente comparación contra ficha —
-- `accion: 'comparar_ficha'`— pisaba TODAS las filas de la línea sin distinguir, así que el
-- trabajo manual se perdía y había que rehacerlo cada vez que se subía otro documento o se
-- reabría el modal desde "Enviar al Auditor". `respuesta_manual` marca esas filas como
-- intocables para la IA: la comparación las salta y las reporta como respetadas.
--
-- `adjunto_url`/`adjunto_nombre` son el respaldo de UNA casilla (el certificado de la
-- capacitación, la garantía firmada), distinto de los documentos de la línea completa que ya
-- viven en checklist_comercial_documentos: acá el archivo prueba ese requisito puntual.
--
-- Aplicar con: node scripts/aplicar-migration-72.mjs
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE checklist_comercial_caracteristicas
  ADD COLUMN respuesta_manual TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN adjunto_url      VARCHAR(500)     NULL DEFAULT NULL,
  ADD COLUMN adjunto_nombre   VARCHAR(300)     NULL DEFAULT NULL;

-- Lo que se contesta a mano ya no es una cita corta de una ficha: en requisitos de servicio
-- (capacitaciones, garantías, compromisos de ejecución) la respuesta es un párrafo completo que
-- se pega desde las bases. 300 caracteres lo truncaban en silencio.
ALTER TABLE checklist_comercial_caracteristicas
  MODIFY COLUMN valor_ofertado_texto VARCHAR(1000) DEFAULT NULL;

-- Backfill: lo que ya venía de una respuesta humana o de una corrección del asesor queda
-- protegido de inmediato, sin esperar a que alguien lo vuelva a tocar.
UPDATE checklist_comercial_caracteristicas
   SET respuesta_manual = 1
 WHERE origen = 'manual' OR corregido_at IS NOT NULL;
