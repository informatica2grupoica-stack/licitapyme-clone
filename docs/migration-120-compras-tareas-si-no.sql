-- migration-120-compras-tareas-si-no.sql
-- MÓDULO DE COMPRAS — tareas: las preguntas que solo se contestan con Sí o No pasan a selector
-- (`"tipo":"si_no"` en `compras_tarea_catalogo.campos_json`, el mismo botón Sí/No que ya usan
-- "¿Hay stock?", "¿El precio sigue vigente?", etc.). Lo que es dato real (nombre, correo, fechas,
-- plazos) y las observaciones se quedan como texto.
--
--   1. validacion_tecnica_real — "Fabricante identificable" era texto y la gente escribía "si".
--   2. boleta_fiel_cumplimiento y firma_contrato — no tenían formulario, solo el recuadro libre
--      "Qué se hizo". Ahora: pregunta Sí/No + Observaciones. La clave `observaciones` es la misma
--      que usaba el recuadro libre, así que lo ya anotado se sigue viendo.
--
-- Además normaliza los registros ya guardados de "Fabricante identificable" ("si" → "Sí"), porque el
-- selector marca el botón solo con el valor exacto "Sí"/"No". Eso no se puede hacer en SQL puro de
-- forma portable, lo hace el runner: `node scripts/aplicar-migration-120.mjs`. Idempotente.

UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"producto","etiqueta":"Producto que se va a comprar","tipo":"texto","placeholder":"Marca y modelo"},
  {"clave":"fabricante","etiqueta":"¿Hay un fabricante identificable?","tipo":"si_no"},
  {"clave":"ficha_real","etiqueta":"¿La ficha corresponde a un producto que existe de verdad?","tipo":"si_no"},
  {"clave":"producto_correcto","etiqueta":"¿El producto cotizado es el que se ofertó y el que cumple?","tipo":"si_no"},
  {"clave":"fuente","etiqueta":"Dónde se verificó","tipo":"texto","placeholder":"Sitio del fabricante, distribuidor oficial..."},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'validacion_tecnica_real';

UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"entregada","etiqueta":"¿Se entregó la boleta de fiel cumplimiento?","tipo":"si_no"},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'boleta_fiel_cumplimiento';

UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"firmado","etiqueta":"¿Se firmó el contrato?","tipo":"si_no"},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'firma_contrato';
