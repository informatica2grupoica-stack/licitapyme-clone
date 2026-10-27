# Viabilidad IA, modalidad, prefiltro y radar

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## Decisiones vigentes del dueño

- **GLM para viabilidad aunque sea más lento que DeepSeek** (2026-07-21): la calidad narrativa
  del informe es mejor y el golden set no lo mide. DeepSeek queda solo para el chatbot de
  documentos. No reabrir sin que el dueño lo pida.
- **«CA» en las specs = el perfil del Asesor + el superusuario del dueño.** No es «cualquier
  admin»: permiso propio `reglas_ia`, no heredado por admin (`esCA()` en `api-auth.ts`).
  Solo CA crea reglas de IA (pantalla `/reglas-ia`).
- **Prompt dinámico por composición**: prompt base fijo + «Reglas aprendidas del experto»
  inyectadas en cada análisis. Nunca reescribir el prompt maestro con IA. Cada regla es auditable,
  desactivable y borrable.
- **Modalidad (suma alzada vs por línea) la decide la capa determinista** (frases-ancla en
  `planilla-costeo-parser.ts`), no el feedback loop ni el LLM. Manda el FORMATO de la oferta
  económica: un único total consolidado al pie = suma alzada, aunque haya precio por ítem; la
  frase «adjudicación múltiple» sola no implica por línea.
- **Prefiltro (PROMPT 0)**: excluir por NATURALEZA del objeto, no por palabra clave. Descartar de
  más es grave (oportunidad perdida); pasar de más cuesta unos tokens. Solo se descargan
  documentos y se calcula viabilidad de PASA o REVISION_HUMANA. Las EXCLUIDO se ven con badge.
- La descarga de documentos ya no se hace para todas las PASA: se descarga al asignar; la
  viabilidad se dispara desde el botón (cadena limpia, 2026-07-08).
- Presupuesto se MUESTRA con IVA («IVA incl.»), pero gate y score siguen sobre el NETO (umbrales
  de compras públicas son netos).
- Informe técnico PDF eliminado (2026-08-13): gastaba tokens sin uso. El buscador de equipamiento
  es otra función y sigue viva.
- Word de anexos genéricos/específicos de la v3.3: diferido; viven como datos en el JSON.
- Hay que leer TODAS las páginas de todos los documentos; el sistema nunca debe caer por un solo
  modelo (cadena de respaldo GLM).

## Cómo procesar un error de viabilidad que reporta el dueño (protocolo acordado)

1. Ver el texto real (`documentos_cache.texto_extraido`) antes de culpar al prompt.
2. Patrón de texto reconocible → código determinista (detector/frase-ancla, «gated» para no
   sobre-disparar) con barrido de falsos positivos sobre ~150 licitaciones.
3. Criterio de juicio sin patrón exacto → regla aprendida (feedback loop, sin deploy).
4. Re-analizar con `scripts/reanalizar-viabilidad.mts <cod>` y fijar el caso en
   `scripts/regresion/gold.json`.
5. El golden set es la verificación DESPUÉS de arreglar, nunca el paso 1.
6. Cambios al prompt: aditivos, un cambio = un flag, lo estable arriba y los documentos abajo
   (caché de Z.AI), decidir con A/B.
- Un dato que se «pierde en medio» de 170k caracteres se arregla con una lectura dirigida por
  código, no alargando el prompt.
- En una cadena multi-proveedor, el error del último eslabón no es el diagnóstico.
- Llamadas grandes a `crearChatIA` con timeouts: usar streaming + `streamIdleMs` (corte por
  inactividad), no timeout total.
- No indexar fichas técnicas por `linea` del manifiesto (puede ser constante o agrupar productos).
- El arreglo corrige análisis futuros; los informes guardados quedan con el veredicto viejo hasta
  re-analizar. Re-analizar gasta IA y toca checklist/costeo: pedir OK antes.

## Pendientes conocidos

- Otorgar el permiso `reglas_ia` al Asesor y al superusuario en `/admin/usuarios`.
- Golden v4: Valdivia (1057937-12-LP26) no pasa (encabezados de ficha leídos como productos).
- Re-analizar licitaciones que quedaron mal guardadas: las 22 de «subconjunto de ítems»;
  3480-14-LE26, 1057509-148-LE26, 1057547-301-LE26 (regenerar costeo por línea); 859378-8-LE26;
  1057448-45-LP26 (tabla repetida; viabilidad y checklist del negocio 1330 siguen malos).
- Auditoría masiva del párrafo «licitación de tipo múltiple» sobre lo ya analizado
  (`scripts/auditar-modalidad.mts`), no pedida aún.
- Documentos propios (costeo, informe técnico) entran al contexto del LLM aunque se excluyen de
  los detectores: sacarlos también de `recortarDocsParaAnalisis`.
- Unificar el piso de presupuesto: prefiltro $8M vs viabilidad $10M (franja muerta).
- PROMPT 3 real (búsqueda de producto) sin construir; `trigger_busqueda` sin consumidor.
- Foro de preguntas y respuestas de MP no se lee: las aclaraciones que viven solo ahí no llegan.
- Compra Ágil (gran parte del volumen) no está integrada.
- Tanda 2 de viabilidad v4: producto de referencia, carpeta de documentos por empresa, editor de
  catálogos. Bandejas/radar aún usan el score del perfil inicial.
- Telemetría de costo por modelo usa una sola tarifa; curar/fusionar reglas aprendidas cuando se
  acumulen; timeouts de 240 s por modelo en la cadena (propuesto acortar los primeros, sin decidir).
- Doctor del pipeline: falta re-OCR y descomprimir zip.
