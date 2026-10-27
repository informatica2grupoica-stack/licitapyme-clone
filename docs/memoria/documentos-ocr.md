# Documentos, OCR, parser de planillas y manifiesto de productos

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

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
NO verificado: el re-análisis real de 3712 con el arreglo (falta desplegar).
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
