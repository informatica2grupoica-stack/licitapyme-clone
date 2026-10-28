# Documentos, OCR, parser de planillas y manifiesto de productos

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## 2026-10-28 — Word: imágenes base64 inflaban el texto (1.289 caracteres → 1,27 M)
Caso real: visto al habilitar .dotx en 3712-74-LP26. Las tablas de Word se anexan con
`mammoth.convertToHtml()`, que por defecto incrusta cada imagen como `<img src="data:…;base64,…">`.
En `documentos_cache` había 99 de 5.435 docs `word` (64 licitaciones) así: 121,5 MB, todo el base64
dentro de `<img>`. Eso entraba al contexto de viabilidad, chat y parser. Ahora `extractTextFromDocument`
pide a mammoth un `src` vacío (`convertImage`) y quita los `<img>` del HTML de tablas
(`app/lib/document-extraction.ts`); filas y celdas de texto quedan igual.
**Verificado:** test nuevo con un .docx real (tabla + 200 imágenes) en `document-extraction.test.mts`;
1.610/1.610 y `tsc` limpio. Simulado sobre los 99 docs guardados (`scripts/scratch/_word-imagenes-base64.mts`,
solo lectura): 115,8 MB → 3,9 MB y `parsearPlanillaCosteo` no cambia ningún conteo (ni por documento ni
por licitación).
**Pendiente:** los 99 textos de `documentos_cache` siguen con base64 hasta re-extraerlos o limpiarlos
(quitar `<img…>` del texto guardado); no se tocó producción, falta OK del dueño. Falta desplegar.

## 2026-10-28 — Pulgadas como «&quot;» y filas de Word con comas que se perdían
Caso real 1: 3712-74-LP26. Los 39 productos estaban bien (calzan con el Anexo económico), pero el costeo
mostraba «Manguera Espiralada 2&quot;x50(m)»: GLM-OCR escribe la pulgada como entidad HTML y
`parsearTablasHtml` no la decodificaba. Ahora decodifica `&quot; &#39; &lt; &gt; &nbsp; &#N; &amp;`.
Los nombres raros «partátil», «demaledor», «Clarimetro» vienen así del propio anexo: no se corrigen.
Caso real 2: 2446-307-LE26. Alerta «las fuentes no coinciden: DECRETO (43) · FORMULARIO_N°4 (44) ·
PROYECTO.pdf (44)». Los tres documentos traen 44. El Formulario N°4 (.doc, tabulado) daba 42: `celdasDe`
leía como CSV toda línea con 3+ comas, y «36	5	Tineta látex amarillo rey, antihongos, inoloro, terminación
mate» se perdía (igual la 38). Con 42 < 43 se descartó y mandó la lista del modelo, que se saltó el ítem 24
«Kit de soplete; gas; guantes; escobilla 1200°c». Ahora una línea con 2+ tabs cuyo primer tab va antes de
la primera coma se lee por tabs (el CSV de Excel trae tabs DENTRO de celdas con viñetas y sigue como CSV).
**Verificado:** barrido sobre 2.116 licitaciones: 2.027 iguales, 86 solo cambian `&quot;` por `"`, 3 suben
de conteo con productos reales (2446-307-LE26 42→44, 5052-11-LE26 14→20, 2258-108-LR26 0→23), ninguna baja.
Una primera versión (tabs siempre antes que comas) rompía Excel (2320-32-LE26 13→0): descartada.
Tests nuevos en `planilla-costeo-parser.test.mts`; 1.609/1.609.
**Pendiente:** desplegar y re-analizar 2446-307-LE26 (otra sesión trabaja su presupuesto en paralelo).
37 informes guardados siguen con «&quot;» hasta re-analizarlos. Los 4 costeos digitales que lo tenían
(5040-11-LE26, 727202-72-LP26, 2446-274-LE26, 3712-74-LP26; 40 textos de «Detalle») se corrigieron en
producción el 2026-10-28 con OK del dueño (`scripts/scratch/_costeos_quot.mts`, solo `datos_json`, sin
versión nueva ni cambio de `actualizado_at`). Si alguien tenía el editor abierto, su autoguardado los
vuelve a dejar con «&quot;»: recargar la pestaña antes de seguir.

## 2026-10-27 — Parser de planillas: «X1…X6» como productos y la lista repetida (80 → 39)
Caso real: 3712-74-LP26 (Los Vilos, SSR). Salían 80 productos: 34 fichas técnicas sin número, el plazo
(«120 días corridos») como producto ×120, la pauta de evaluación («X1 | Oferta económica | 30%») como X1…X6,
y los 39 insumos del Anexo económico numerado. El header de la primera tabla queda vigente en las tablas
siguientes del documento. En `parsearTablasHtml` (`planilla-costeo-parser.ts`): una fila con «%» o con
«días corridos/hábiles» en la cantidad no es producto; una fila sin número que nombra un producto numerado
(mismas palabras y todas sus medidas, con a lo más una palabra distinta) se quita; la misma tabla sin
número copiada con otro espaciado u OCR («50gramos»/«50 gramos», «flerro»/«fierro», «(It)»/«(lt)») se
quita; a igual autoridad y cantidad gana la lista numerada.
**Verificado:** barrido sobre 1.455 licitaciones: 1.390 iguales, 65 cambian. Revisadas a mano: salen
pautas de evaluación, multas y plazos (29-99-LP26, 3328-77/78/82/97-LE26, 1242131-8-LR26, 1298354-15-LP26…)
y copias de tablas (2723-46-LP26 821→458, 4563-10-LP26 526→470, 3378-43-LR26 71→50). Siete quedan sin planilla
porque, sin la basura, tienen menos de 8 productos (1002772-64-LP26 tiene 7): ahí manda la lista de la IA.
Tests 1.551/1.551 + test nuevo del caso; caso agregado a `scripts/regresion/gold.json` (39 ítems).
Re-análisis real de 3712 en producción (2026-10-27 12:01, código desplegado `b279e8e`): 39 productos desde
el Anexo económico, sin X1…X6 ni plazo; checklist del negocio 1511 sanado.
**Pendiente:** 1293138-6-LR26 sube de 4.541 a 4.610 (la regla vieja de «fuentes complementarias» une
ahora el decreto con el anexo): revisar si esos 69 son reales.

## Reglas vigentes del dueño

- **El código nunca rellena un dato que el documento no trae**: va null o vacío. Si un consumidor
  necesita un valor, que lo ponga el consumidor (la celda del Excel queda en blanco para que la
  llene una persona), nunca el parser, que representa «lo que dice el documento». Antes de
  escribir un default, preguntar qué chequeo aguas abajo se apoya en que ese campo venga vacío.
- **La fidelidad del listado la garantiza la capa determinista**: el LLM trunca listas largas por
  pereza estructural. «El parser manda si trae ≥ ítems que el modelo.»
- **Un fallo de lectura que no se registra no existe para el usuario**: todo fallo de lectura de un
  documento debe quedar escrito y avisarse; el análisis no puede seguir sin las bases en silencio.
- Los documentos de Mercado Público no se obtienen por scraping simple: hace falta el flujo de
  descarga con IP chilena (`mp-descarga-orquestador.ts`). Archivos con extensión fuera de
  pdf/doc/docx/xls/xlsx disparan «revisar bases manualmente».
- Regla V-16 del validador: el manifiesto solo lleva productos (ni rótulos de formulario, ni
  criterios de evaluación).

## Cómo diagnosticar

- «No lee todos los ítems»: volcar `documentos_cache.texto_extraido` y probar
  `parsearPlanillaCosteo` con ese texto; casi siempre el OCR está bien y es un formato que el parser
  no reconoce. Correr un barrido sobre toda la caché antes de dar por bueno un filtro nuevo.
- «Faltan datos que sí están en las bases»: revisar primero `metodo_extraccion` y la densidad del
  texto cacheado (PDF escaneado guardado como texto sin OCR) ANTES de tocar el prompt.
- Grillas de MP (competencia/apertura) paginan: 10 oferentes / 6 anexos por página, y el nombre
  del botón (`ctlNN`) se reinicia en cada página.
- Tablas de Word llegan separadas por TAB: el parser tiene que leerlas o el cuadro económico nunca
  gana.
- Un filtro de siglas borró equipamiento médico real (DEA, MAF): todo filtro nuevo se prueba sobre
  la caché completa.

## Pendientes conocidos

- 55 documentos con páginas sin OCR por sanar (`scripts/sanar-ocr-huecos.mts`) y re-analizar sus
  licitaciones.
- Formulario ETT («SI ___ NO ___ Obs:») que se cuela entero como listado de productos (caso
  722-3-LR26): requiere clasificar el documento, no filtrar filas.
- Excel `COSTEO_2026-66-LE26` en caché pendiente de revisión del dueño.
