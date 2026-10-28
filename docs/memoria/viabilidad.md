# Viabilidad IA, modalidad, prefiltro y radar

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## 2026-10-28 — El radar no recibía licitaciones: el intake no corría desde el 22-oct; prefiltro pasa a Kimi
Caso real: «no caen licitaciones de maquinaria». El scheduler del VPS llama a todos los cron con POST y
`/api/cron/alertas` (intake) solo exportaba GET → 405 en cada corrida. Antes del 22-oct el intake lo hacía otro
disparador (GET) contra la BD de Bluehost; al pasar la BD al VPS quedó sin nadie. Síntoma en BD: 128 de 170 palabras
clave con `ultima_busqueda` congelada en el 22-oct 11:00, y solo entraban al radar las que re-matcheaba el job
«enriquecer» (:30) → ~12 licitaciones/día en vez de ~80. Medido el 28-oct (solo lectura, API real + palabras clave
reales): 276 licitaciones calzan y no estaban en el radar (p. ej. 1173467-1-LE26 maquinaria agrícola, 3920-26-LR26
maquinaria vial). Arreglo: `export const POST = GET` en `app/api/cron/alertas/route.ts`.
Prefiltro: corría con el proveedor de texto por defecto (glm-4.7-flashx, no DeepSeek) y dejaba pasar convenios de
suministro explícitos. Ahora `prefiltro.ts` usa Kimi (`proveedorPreferido:'kimi'`, esfuerzo low, 16k tokens; si Kimi
falla cae a la cadena GLM) y guarda en `modelo` el que respondió de verdad.
**Regla / decisión (dueño, 28-oct):** el prefiltro va con Kimi.
**Verificado:** tsc; POST === GET al importar la ruta; prefiltro Kimi sobre 16 casos reales SIN guardar
(`scripts/scratch/probar-prefiltro-kimi.mts`): ~57 s y ~$0,066 por lote de 15; maquinaria agrícola/vial/reciclaje → PASA,
mantención de maquinarias → EXCLUIDO, 4 convenios de insumos médicos que GLM pasaba → EXCLUIDO. Diagnóstico:
`scripts/scratch/diag-intake-radar.mts`. NO desplegado ni corrido el intake en producción.
**Verificado en producción (28-oct, corrida de las 16:00 tras el deploy):** las 170 palabras clave buscadas, 0
congeladas; entraron 223 licitaciones nuevas al radar (212 aún abiertas), entre ellas 1173467-1-LE26 y 3920-26-LR26.
**Pendiente:** confirmar que el prefiltro de las 17:00 las decidió con Kimi (columna `modelo`). La API de MP devuelve 429 a las 16 consultas en paralelo de `obtenerUltimosDias` (tras 3
reintentos un día queda vacío en silencio) — no se tocó. Si sigue existiendo el disparador externo viejo (cron-job.org
u otro), apunta a la BD de respaldo: apagarlo.

## 2026-10-28 (noche) — COTIZAR_TOTALIDAD tiene que hablar de totalidad; «un solo oferente por familia» es por línea
Revisión de los 13 GLOBAL «por regla 2» con señales por línea, contra el texto de sus bases. La IA etiquetaba como
COTIZAR_TOTALIDAD frases que no dicen ofertar todo («oferta seria, única…» 2744-38-LE26, «Ofertar de acuerdo a lo
requerido» 734-63-LE26, «sumatoria de los ítems» / «todas las partidas y adicionales» / tabla de plazos 701426-14-LP26,
«todos los gastos asociados» 1042-15-LE26) y la regla 2 las volvía GLOBAL. En `viabilidad-v4/adjudicacion.ts` (y la
copia `cv/v4/`, idéntica): `hablaDeTotalidad` exige totalidad / todos los productos-ítems-líneas / 100 % / completa /
parcial / íntegro / el total (global) de / alguno de; «la familia» cuenta como línea; ADJUDICA_GLOBAL con «un solo
oferente POR línea/familia/lote» no cuenta (1057898-103 y -112-LP26, Salud Ñuble).
**Regla / decisión (dueño, 28-oct):** 1 línea en la API = GLOBAL; con más de una, las bases deciden según el prompt.
Esto no cambia: solo filtra qué frases de las bases cuentan.
**Verificado:** 1628 tests, tsc; decisor HEAD vs nuevo sobre las evidencias guardadas de 284 informes v4: cambian 9,
revisados uno a uno (6 → POR_LINEAS, 3 → NO_CLARO de 1 línea o sin frase; con la API real esos 1-línea siguen GLOBAL);
golden con evidencias v4: 3/3 igual. Siguen bien en GLOBAL 2950-49, 2709-83, 2981-293, 3712-74, 2730-133, 4055-87,
1488-39. Script: `scripts/scratch/_adjudicacion_antes_despues.mts`. NO re-analizado nada.
**Pendiente:** 3434-14-LE26 sigue GLOBAL: «Licitación por Línea… no oferte la totalidad de los productos» — la IA no
sacó la frase «por línea» como evidencia; la totalidad sola es ambigua. 1426099-12-LE26 («servicio íntegro», 3 centros
con presupuesto propio) sigue GLOBAL, dudoso.

## 2026-10-28 (noche) — 1028897-42-LP26 salía GLOBAL siendo por línea; presupuestos de $29 guardados
Caso real: 1028897-42-LP26 (3 líneas con presupuesto propio, «línea a la cual postula»). El detector de cláusulas
tomó «se debe ofertar y valorizar cada bien requerido» como COTIZAR_TOTALIDAD y la regla 2 la volvía GLOBAL →
score por PROYECTO ($108,9M). `totalidadDentroDeLinea` (`viabilidad-v4/adjudicacion.ts` y `cv/v4/`) ahora también
reconoce «ofertar/valorizar/cotizar cada bien/producto/artículo»; sin el verbo no («ficha técnica de cada producto»,
1013353-36-LP26, sigue GLOBAL). Medido sobre 284 informes v4: solo cambia 1028897.
**Verificado:** tests de adjudicación (58/58) y tsc; NO re-analizada (el informe guardado sigue GLOBAL hasta re-analizar
con el código desplegado).
**Pendiente:** (1) los GLOBAL dudosos se resolvieron en la entrada siguiente («COTIZAR_TOTALIDAD tiene que hablar
de totalidad»). (2) Presupuesto guardado mal leído (puntos de miles
como decimales) en 2736-44-LE26 ($29), 3729-86-LE26 y 1126920-34-LE26, los tres en nivel EXCLUIDO; el código ya lo
arregla, falta re-analizar — `scripts/scratch/_presupuesto_descuadrado.mjs`.

## 2026-10-28 (tarde) — 2446-307-LE26: $28 billones y el ítem 5 del Formulario N°4 perdido
Re-análisis de las 16:38 (VPS): presupuesto bruto 28.003.098.000.000 y manifiesto de 43 (faltaba «Juego de
herramientas de 151 piezas»); el costeo digital quedó con 43 filas desordenadas y 5 hojas vacías (Línea 2, 4, 5,
6 y 37). Dos causas generales:
1. `interpretarMonto` (`viabilidad-v4/presupuesto.ts` y `cv/v4/`) multiplicaba ×1.000.000 por la palabra
   «millones» de la glosa en letras («$28.003.098.-(Veintiocho millones…)»). Ahora «millones» solo multiplica
   una cifra menor a 1.000.000 (igual que el tope del «M$»). El arreglo del bruto descuadrado (×0,5–×2) usaba
   ese mismo monto malo para «corregir» al modelo.
2. El filtro de «ítems inventados» (`descartarItemsInventados`) se aplicaba también al manifiesto que sale de
   la planilla de un documento de la licitación, y el ítem 5 («DADOS REG. DE 6PT. DE 13-1/4" DR.: 4-4.5-5…14mm»)
   no calzaba palabra a palabra. Ya no se aplica cuando el manifiesto viene de `tabla_canonica` o de una
   planilla que no es un `COSTEO_` propio (`viabilidad-ia.ts` y `cv/viabilidad-ia.ts`).
**Verificado:** re-análisis local contra la BD del VPS: 44 ítems desde el Formulario N°4, conteo cuadra (F4 44 ·
PROYECTO 44 · API 44), bruto $28.003.098, neto $23.532.015, nivel ALTO. Costeo del negocio 1522: 44 filas en el
orden del F4, una sola hoja, precios y links intactos (`scripts/scratch/_2446_307_ordenar_costeo.mts`).
Tests 1.624/1.624. **Pendiente:** desplegar (si no, otro re-análisis en el VPS vuelve a dejar 43 y $28 billones).
El dueño habló de «34 ítems»: el Formulario N°4 trae 44 (y la API 44 líneas).

## 2026-10-28 — 3712: presupuesto por línea del convenio con UNA línea en la API + .dotx sin leer
Caso real: 3712-74-LP26 (negocio 1511). La tarjeta de viabilidad mostraba bien el total ($93.503.799 IVA
incl.), pero `presupuesto.por_linea_interpretado` traía L1/L2/L3 = las «líneas de intervención» del convenio
(Correspondencia_3837.pdf: M$ 28.097 / 40.294 / 25.113) y el manifiesto `presupuesto_linea` = 28.097.000:
la única hoja del costeo tomaba $23,6M neto de tope en vez de $78,6M (Consuelo lo escribió a mano en la
versión 5). Ahora, si la API trae una sola línea, no hay presupuesto por línea (`viabilidad-ia.ts` y
`cv/viabilidad-ia.ts`, junto a `por_linea_interpretado`). Además el `.dotx` («Anexos_editables_….dotx»)
salía `metodo=error` en cada análisis: `document-extraction.ts` ya lo lee con mammoth (mismo zip que .docx)
y `lectura-documentos.ts` lo cuenta como legible. Lo que contiene ya venía en las bases (Anexo económico de
39 insumos), así que el conteo de 3712 no cambia. La lectura de 3712 SÍ fue completa: bases y convenio por
GLM-OCR; los COSTEO_*.xlsx propios salen en «documentos leídos» pero se excluyen de las fuentes.
**Verificado:** tests 1.609/1.609, `tsc` limpio, .dotx de prueba leído con `extractTextFromDocument`.
NO verificado: re-análisis real de 3712 (falta desplegar).
**Pendiente:** desplegar y re-analizar 3712; el presupuesto de la hoja del costeo guardado ya lo corrigió
Consuelo a mano. La alerta «DECRETO… (43) · FORMULARIO_N°4… (44) · PROYECTO.pdf (44)» es de 2446-307-LE26,
no de 3712 (ver documentos-ocr.md).

## 2026-10-28 — Presupuesto $28 en vez de $28.003.098 (IA leyó los puntos de miles como decimal)
Caso real: 2446-307-LE26. La IA trajo `monto_texto` «$28.003.098» bien, pero `bruto` = 28.003098 y el código
le creyó (solo corregía con el texto si el bruto faltaba o era un «M$»). Efecto en cadena: neto 24, multa
≈ $0, nivel EXCLUIDO, y el costeo guardado quedó con presupuesto 28. Ahora en `viabilidad-ia.ts` (y
`cv/viabilidad-ia.ts`) si el bruto del modelo está fuera de ×0,5–×2 del monto del texto, manda el texto.
La tarjeta Presupuesto ya no muestra 44 chips L1…L44: con más de 6 líneas, «Tope por línea (N líneas)»
plegado en lista compacta. El «$0 que sube» es la animación del contador, no un dato.
**Verificado:** tests viabilidad-v4 (45/45), tsc limpio en esos archivos. Tarjeta NO vista en navegador.
Re-analizado el mismo día (script local con el arreglo): bruto $28.003.098, neto $23.532.015, multa 1 %/día
hábil ≈ $235.320, nivel ALTO. Esta vez la IA trajo bien el bruto, así que el arreglo no llegó a actuar.
**Pendiente:** el presupuesto del costeo editable (28) hay que revisarlo a mano (la re-viabilidad no toca el
costeo guardado). `presupuesto_display` (`viabilidad.ts:795`) rotula «neto» un monto que es IVA incluido.

## 2026-10-27 — «Completar cada línea» se leía como «ofertar todas las líneas» (adjudicación GLOBAL falsa)
Caso real: 4697-25-LP26 (negocio 1376). Bases: «Licitación por Línea», 2 líneas con monto propio (Equipos
$36.419.000, Equipamiento $46.882.000), evaluación y facturación separadas. Salía GLOBAL por la regla 2 de CA
(COTIZAR_TOTALIDAD gana) con la frase «el no ofertar un producto del lote quedará fuera de bases», que pide
completar CADA lote, no ofertar todos. Ahora `marcarEvidenciasQueCuentan` (`viabilidad-v4/adjudicacion.ts` y
`cv/v4/adjudicacion.ts`) no cuenta como COTIZAR_TOTALIDAD una frase de «cada línea / su respectiva línea / del
lote / línea ofertada / por línea», salvo que diga ofertar «la totalidad de las líneas», «por el todo», «un
solo proveedor» o «adjudicación global» sin «por separado / o bien». La marca `completar_cada_linea` y el
análisis pone el requisito «Ofertar todos los productos de cada línea que se oferte». La regla 2 no cambió.
**Verificado:** test `adjudicacion-totalidad-por-linea.test.mts` con frases reales; re-decisión de los 278
informes guardados (solo lectura): cambian 18, todos con frase de «cada línea»; 16 GLOBAL → POR_LINEAS
(4697-25/26, 986278-23, 1388961-49, 3035-12, 4858-63, 1305544-50, 1002588-103, 2546-58, 2403-77, 1175-82,
1028897-42, 1233615-62, 4295-86, 1423921-19, 1057898-108); 4473-23 y 2427-98 siguen GLOBAL por otra
evidencia. Golden set con IA no corrido. NO cambia lo guardado: hay que re-analizar esas licitaciones.
**Pendiente:** frases sin palabra de línea («ofertar la totalidad de productos requeridos», «familia
completa» en 1057898-103) siguen contando como totalidad; ahí decide la persona.

## 2026-10-27 — Costeo «por línea» con una sola línea en la API
Caso real: 3712-74-LP26. Re-analizada con el parser nuevo, salió costeo `por_linea` aunque la API trae 1
línea, las bases dicen «1 línea licitatoria», hay que ofertar todo y la adjudicación es GLOBAL. El modelo
tomó las «líneas de intervención» del convenio de financiamiento (Correspondencia_3837.pdf: Equipamientos
M$ 28.097, Instrumentos M$ 40.294…) como presupuesto por línea y marcó heterogeneidad alta; la regla de
«líneas heterogéneas con presupuesto propio» cambiaba el costeo. Ahora esa regla exige `lineasApi !== 1`
(`viabilidad-ia.ts` y `cv/viabilidad-ia.ts`); las reglas de formato de la oferta no cambian.
**Verificado:** `tsc` limpio, tests 1.560/1.560. NO verificado: re-análisis de 3712 con este cambio (falta
desplegar). En la BD hay 11 informes con costeo por línea y «una sola línea» en la API (2709-83-LE26,
727202-72-LP26, 3729-86-LE26, 1057509-335/317/345/366-LE26, 1126920-34-LE26, 1057510-70-LE26,
1555621-1-LE26 y 3712): no todos por esta regla; quedan así hasta re-analizarlos.

## 2026-10-27 — «El análisis se interrumpió»: despliegues a mitad de análisis + re-lectura de 10 MB
Caso real: 3712-74-LP26, dos re-análisis seguidos (10:15 y 10:28 hora Chile) cortados en `leyendo_documentos`.
**Causa confirmada con los logs del VPS:** los mató el despliegue. Análisis desde 13:28:12 UTC, contenedor
recreado 13:38:48 UTC (commit de las 10:36); el intento anterior coincide con el commit de las 10:17.
`deploy.sh` ahora hace `docker compose build`, espera hasta 15 min a que no haya jobs `procesando` con
latido vivo y recién ahí `docker compose up -d` (`FORZAR=1` lo salta).
Lo que agravaba la causa (el análisis duraba 13 min en vez de unos 2):
`Correspondencia_3837.pdf` (45 págs, ya leído con `pdf-glm-ocr`) se re-OCR-eaba en CADA análisis:
`numeracionTablaIncompleta` tomaba la columna «Cantidad» (9, 9, 9, 18…) como numeración que parte
en 9. Arreglos: el detector solo mira tablas cuya 1ª columna sube (`zai-ocr.ts`); un documento ya
leído completo por GLM-OCR no se re-lee por numeración (`viabilidad-ia.ts` y `cv/viabilidad-ia.ts`);
el GET ya no declara huérfano un job que sigue vivo en el mismo proceso, y el mensaje nombra la fase.
Skill nueva `viabilidad-interrumpida` con `diagnosticar.mjs <codigo>` (solo lectura).
**Verificado:** barrido sobre 4.067 documentos con tablas: 252 marcados antes → 176 ahora (80 falsos
de columnas de cantidad dejan de marcarse, 4 nuevos marcados); `tsc` limpio; diagnóstico corrido
sobre 3712; `bash -n deploy.sh`. NO verificado: la espera de `deploy.sh` corriendo en el VPS ni un
re-análisis real con el arreglo (falta desplegar).
**Regla:** no desplegar con `docker compose up -d --build` a mano; usar `deploy.sh`. Las fechas de la
BD leídas con mysql2 desde el PC salen corridas de hora: formatearlas en SQL.
**Pendiente:** desplegar y re-analizar 3712-74-LP26 (con OK del dueño). `Anexos_editables_….dotx`
sale `metodo=error` en cada análisis: los .dotx no se extraen.

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

- Otorgar el permiso `reglas_ia` al Asesor y al superusuario en `/admin/usuarios` (al 2026-10-27
  ningún usuario lo tiene).
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
