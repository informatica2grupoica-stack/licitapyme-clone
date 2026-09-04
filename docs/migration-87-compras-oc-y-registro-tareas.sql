-- migration-87-compras-oc-y-registro-tareas.sql
-- MÓDULO DE COMPRAS — cierre de la Fase 1 (spec "ESPECIFICACIÓN FUNCIONAL — MÓDULO DE COMPRAS
-- v2.0"). La migración 86 dejó el esqueleto de entrada (§3 asignación, §4 resumen, §5 tareas).
-- Faltaban tres cosas de esas mismas secciones, y son las que agrega esta migración:
--
--   1. §3.6 ORDEN DE COMPRA DEL CLIENTE — "el módulo recibe y registra la orden de compra del
--      organismo como parte de la documentación, y la fecha de aceptación". No había dónde
--      anotarla. Es un dato que manda: "si el monto o alcance adjudicado difiere de lo ofertado,
--      manda siempre la orden de compra" — por eso se guarda su monto y una marca de que difiere,
--      no solo el número.
--
--   2. §5.3 / §5.4 REGISTRO DE LO QUE SE HIZO EN LA TAREA — el contacto inicial "queda registrado
--      en el sistema", y la validación de la cotización tiene una salida explícita: "cotización
--      validada, o hallazgo levantado". Hasta ahora una tarea solo podía pasar a HECHA: no había
--      dónde dejar CON QUIÉN se habló ni QUÉ contestó el proveedor.
--
--      El formulario de cada tarea vive en el CATÁLOGO (`campos_json`), no en el código —
--      §1.3.5: "ningún catálogo se implementa como lista cerrada en código, se implementa como
--      configuración editable". Agregar una pregunta es un UPDATE, no un deploy. Y toda tarea con
--      formulario lleva su salida por texto libre ("observaciones"), como exige esa misma sección.
--
--   3. `hallazgo` — la tarea se cerró, pero lo que se encontró NO es lo esperado (§5.4: "cualquier
--      hallazgo abre automáticamente una incidencia y gatilla la búsqueda de alternativa"). La Zona
--      de Incidencias (§9) todavía no existe; la marca sí, para que cuando se construya tenga de
--      dónde leer los hallazgos ya levantados en vez de empezar de cero.
--
-- NO es idempotente por sí sola (MySQL no tiene ADD COLUMN IF NOT EXISTS): el runner
-- `node scripts/aplicar-migration-87.mjs` tolera los errores de "columna ya existe" (1060/1061),
-- así que correrla dos veces es seguro POR ESA VÍA. A mano en phpMyAdmin, la segunda corrida da
-- error de columna duplicada — es esperable y no rompe nada.

-- ── 1. Orden de compra del cliente (§3.6) ────────────────────────────────────────────────────
ALTER TABLE compras_asignacion
  ADD COLUMN oc_numero               VARCHAR(64)      NULL,   -- N° de la OC del organismo en Mercado Público
  ADD COLUMN oc_emitida_at           DATE             NULL,   -- fecha de emisión que trae la OC
  ADD COLUMN oc_aceptada_at          DATE             NULL,   -- fecha en que el EM la aceptó en el portal
  ADD COLUMN oc_monto                DECIMAL(15,2)    NULL,   -- monto de la OC (manda sobre lo ofertado)
  ADD COLUMN oc_difiere              TINYINT(1)   NOT NULL DEFAULT 0,  -- alcance/monto distinto a lo ofertado
  ADD COLUMN oc_observacion          TEXT             NULL,   -- en qué difiere, o cualquier nota de la OC
  ADD COLUMN oc_registrada_por       INT              NULL,
  ADD COLUMN oc_registrada_por_nombre VARCHAR(160)    NULL,
  ADD COLUMN oc_actualizada_at       DATETIME         NULL;

-- ── 2. Registro de ejecución de la tarea (§5.3/§5.4) ─────────────────────────────────────────
ALTER TABLE compras_tarea
  ADD COLUMN registro_json  LONGTEXT         NULL,  -- respuestas al formulario del catálogo
  ADD COLUMN registro_at    DATETIME         NULL,
  ADD COLUMN hallazgo       TINYINT(1)   NOT NULL DEFAULT 0;  -- se cerró, pero con hallazgo (§5.4)

-- ── 3. Formulario de cada tarea, editable sin deploy (§1.3.5) ────────────────────────────────
ALTER TABLE compras_tarea_catalogo
  ADD COLUMN campos_json LONGTEXT NULL;

-- Contacto inicial con el cliente (§5.3). Es la PRIMERA vez que hablamos con el comprador: la
-- licitación entera se postula sin contacto real. Lo que importa registrar es con quién quedó
-- abierto el canal, porque es el interlocutor que después permite negociar prórrogas y mejoras.
UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"canal","etiqueta":"Cómo se hizo el contacto","tipo":"texto","placeholder":"Llamada, correo, visita..."},
  {"clave":"contraparte","etiqueta":"Con quién se habló","tipo":"texto","placeholder":"Nombre y cargo"},
  {"clave":"contacto_datos","etiqueta":"Teléfono / correo de esa persona","tipo":"texto"},
  {"clave":"acuso_oc","etiqueta":"¿Se acusó recibo de la orden de compra?","tipo":"si_no"},
  {"clave":"dudas_cliente","etiqueta":"Dudas o exigencias que planteó el cliente","tipo":"parrafo"},
  {"clave":"riesgos_anticipados","etiqueta":"Qué se le anticipó que puede no cumplirse al pie de la letra","tipo":"parrafo"},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'contacto_inicial';

-- Validación técnica real (§1.3.3). El Auditor Técnico valida coherencia, no veracidad: puede dar
-- por buena la ficha de un producto que no existe. Este es el gate humano que lo ataja.
UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"producto","etiqueta":"Producto que se va a comprar","tipo":"texto","placeholder":"Marca y modelo"},
  {"clave":"fabricante","etiqueta":"Fabricante identificable","tipo":"texto"},
  {"clave":"ficha_real","etiqueta":"¿La ficha corresponde a un producto que existe de verdad?","tipo":"si_no"},
  {"clave":"producto_correcto","etiqueta":"¿El producto cotizado es el que se ofertó y el que cumple?","tipo":"si_no"},
  {"clave":"fuente","etiqueta":"Dónde se verificó","tipo":"texto","placeholder":"Sitio del fabricante, distribuidor oficial..."},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'validacion_tecnica_real';

-- Validación de la cotización preexistente (§5.4). Son literalmente las preguntas que la spec
-- manda hacerle al vendedor, una por una. La salida es binaria: validada, o hallazgo levantado.
UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"proveedor","etiqueta":"Proveedor de respaldo","tipo":"texto","placeholder":"Razón social o nombre"},
  {"clave":"vendedor","etiqueta":"Vendedor con quien se habló","tipo":"texto"},
  {"clave":"existe","etiqueta":"¿El producto existe?","tipo":"si_no"},
  {"clave":"stock","etiqueta":"¿Hay stock?","tipo":"si_no"},
  {"clave":"cumple_specs","etiqueta":"¿Cumple todas las especificaciones?","tipo":"si_no"},
  {"clave":"ficha_correcta","etiqueta":"¿La ficha técnica es la correcta y es del proveedor?","tipo":"si_no"},
  {"clave":"entrega_inmediata","etiqueta":"¿Hay entrega inmediata?","tipo":"si_no"},
  {"clave":"plazo_proveedor","etiqueta":"Si no es inmediata, cuánto demora","tipo":"texto"},
  {"clave":"plazo_calza","etiqueta":"¿Ese plazo calza con nuestro plazo comprometido?","tipo":"si_no"},
  {"clave":"precio_vigente","etiqueta":"¿El precio sigue vigente?","tipo":"si_no"},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'validacion_cotizacion';

-- Validación del costeo como presupuesto (§1.3.2). El costeo es el punto de partida, no la meta:
-- se confirma y después se mejora comprando mejor.
UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"costo_correcto","etiqueta":"¿El costo estimado por el asistente es correcto?","tipo":"si_no"},
  {"clave":"desviacion","etiqueta":"Desviación detectada","tipo":"texto","placeholder":"Ej. el sensor salía 20% más caro"},
  {"clave":"espacio_mejora","etiqueta":"Dónde se ve espacio para mejorar el costo","tipo":"parrafo"},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'validacion_costeo';

-- Aceptación de la orden de compra (§5.2). La ejecuta el EM en el portal, coordinado con el
-- encargado — acá solo se deja constancia de quién y cuándo.
UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"acepto","etiqueta":"Quién la aceptó en el portal","tipo":"texto"},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'aceptar_oc';

-- Fijación y validación del reloj de entrega (§15.1). Validación manual obligatoria: el hito de
-- inicio sale de los documentos y el sistema no puede fijarlo solo.
UPDATE compras_tarea_catalogo SET campos_json = '{"campos":[
  {"clave":"hito_inicio","etiqueta":"Hito desde el que corre el plazo","tipo":"texto","placeholder":"Emisión de OC, aceptación de OC, firma de contrato, decreto"},
  {"clave":"fecha_inicio","etiqueta":"Fecha de ese hito","tipo":"texto","placeholder":"DD-MM-AAAA"},
  {"clave":"plazo_dias","etiqueta":"Plazo ofertado","tipo":"texto","placeholder":"Ej. 45 días corridos"},
  {"clave":"fecha_entrega","etiqueta":"Fecha tope de entrega que resulta","tipo":"texto","placeholder":"DD-MM-AAAA"},
  {"clave":"observaciones","etiqueta":"Observaciones","tipo":"parrafo"}
]}' WHERE clave = 'reloj_entrega';
