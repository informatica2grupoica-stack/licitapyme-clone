# Anexos — motor de relleno

Reglas vigentes del motor: ver también `.claude/skills/motor-anexos/SKILL.md` y
`docs/anexos-motor-reglas.md`. Las entradas con fecha van arriba; al final, lo traspasado desde la
memoria personal el 2026-10-27.

## 2026-10-29 (tarde) — 2827-102-LE26: nombre de la licitación y de la empresa en blanco (generado desde Pre-postulación)
Generar desde Pre-postulación › Anexos a generar usa el mismo `/api/anexos/generar`. Regenerados los 5 anexos separados (docs 31467-31472) con el motor del disco:
- Anexo 1 (y 1B): «Nombre Licitación» es un título centrado sin dos puntos ni raya → no era casilla. `detectarCamposConDosPuntos` acepta, sin dos puntos, SOLO «Nombre (de la) Licitación/Proceso/Proyecto» exacto.
- Anexo 3: «I.-IDENTIFICACION DEL PROYECTO:» ahora lleva el nombre (patrón de `licitacion_nombre`, con numeral romano opcional; «II.- …DEL PROPONENTE» sigue sin tocarse porque es título de sección).
- Anexo 5: «de la Empresa proponente ___» (razón social) y «Dirección Comercial ___» (dirección) ya salen del diccionario, sin depender de la IA.
**Pendiente / ojo:** Anexo 5 trae el año **2025 impreso** («____2025»): día y mes quedan a mano a propósito (rellenarlos daría una fecha de 2025). `En___ a ___` (sin espacio tras «En») no calza `RE_ANTES_DIA`. Anexo 4 «Línea N°» sigue al humano. No se vio en la plataforma ni se corrió el banco de 400 .docx (suite 1657/1657, tsc limpio). Hoja en blanco al final de 1-3 y firma pisando texto: sin tocar.

## 2026-10-29 — PENDIENTE: la vista previa de «Separar anexos» debe ser una miniatura como se ve en Word
El dueño vio el modal `VistaPreviaSeparacion` (lista de títulos y líneas en texto) y pidió otra cosa:
**ver cada anexo como miniatura de página, tal cual se ve en el Word**, antes de guardar. No hecho.
Idea: `soloVer` arma cada fragmento .docx → conversor-doc (LibreOffice, `convertirDocxAPdf` en
`anexos-doc-legacy.ts`, igual que `app/api/anexos/vista-previa-pdf`) → imagen de la 1.ª página
(`pdfjs-dist`, ya instalado) → el modal las muestra con título, caja y «Guardar»; el texto queda como
detalle plegable. Ojo con el tiempo (una conversión por anexo): hacerlas en paralelo y con tope.
Anexos que dejó el dueño para ver cómo se llenan (2827-102-LE26, PDF generados el 29-oct 11:39 en
`C:\Users\droku\Downloads\ANEXO_Anexo 1…5*.pdf`). Lo visto, por revisar:
- Hoja final en blanco con solo el escudo en Anexos 1, 2 y 3.
- Anexo 3: «Nombre y firma» se va a la página 2; la raya de «en palabras» se parte y deja «__»;
  nombre/RUT del representante salen con letra más grande que el resto.
- Anexo 2: la firma pisa el final del último punto. Anexo 1: la firma queda bajo la tabla, no en su celda.
- Anexo 5: «En Constitución a 29 día del mes de octubre **2025**» — año 2025 (hoy es 2026): ver si viene fijo
  en la plantilla o lo escribe el motor; si es el motor, es un dato equivocado.
- Anexo 4: «Línea N°» queda vacío (se deja a la persona).

## 2026-10-29 — Formulario económico de 2827-102-LE26: casillas vacías, RUT en el nombre, firma ×5
Caso real: 2827-102-LE26, `ANEXOS.docx` (doc 30926), Anexo 3 «FORMULARIO PROPUESTA ECONÓMICA» y
Anexo 4 (tabla de precios). Todo general; reglas en `docs/anexos-motor-reglas.md`.
- `3.-NOMBRE DEL REPRESENTANTE LEGAL:` / `4.-R.U.T. …:` + raya se tomaban como leyenda de firma
  (dicen «representante legal») y bajo la raya del nombre salía el RUT. `esLeyendaDeFirmaConRaya`
  (anexos-detectar): con dos puntos y sin «firma» es un campo. Además la viñeta pegada («3.-NOMBRE»)
  no se quitaba en `normalizarEtiqueta`: ahora sí, solo para números.
- Nombre del firmante 5 veces: el mismo pie salía como 5 lugares de firma. `unaFirmaPorBloque`.
- Valor total (con IVA), en palabras y plazo vacíos: el monto único y el plazo del Auditor solo
  miraban celdas de tabla. `resolverMontoYPlazoInline` (anexos-rellenar) los resuelve como raya en
  prosa; «sin tabla de ítems» se mira por anexo; `montoEnPalabras` nuevo (anexos-monto-oferta).
- «LICITACION ID____» sin dos puntos: etiqueta que abre el párrafo, último recurso.
- Pie «Valor total / Neto / Con Iva»: «Neto» suelto no era pie y el neto caía en «Valor total».
**Regla / decisión:** el 19% por defecto (dueño, 26-oct) ahora vale también para el monto único
(celda y raya), no solo el pie de tabla.
**Verificado:** documento real → nombre y RUT del representante, $24.255.757 con IVA, el mismo monto
en palabras, plazo «30 dias», LICITACION ID, Neto 20.382.989 / Con Iva 24.255.757, firmante una vez;
pantalla igual al Word; XML válido. Comparación determinista HEAD-previo (d07b23b) vs disco en 400
.docx: cambian 67; revisados — 19 celdas numeradas que ahora calzan, rayas que pasan de vacío a su
dato (ciudad, comuna y fecha, ID, nombre/RUT del representante), lugares de firma duplicados que
desaparecen, y 4 etiquetas con dos puntos que dejaron de ser firma (1754-55-LE26, 1216060-2-LP26,
2827-102-LE26) — mejoras. Se corrigieron en el camino dos retrocesos que mostró la comparación
(«Quien suscribe (razón social)» y el pie «raya / FIRMA / raya / NOMBRE» de 1057499-59-LE26). Suite
1641/1641, tsc limpio. El banco con IA (`anexos-banco.mts`) no se usó para comparar: solo 3 documentos.
**Ojo:** el commit 1bd999d del dueño se llevó una versión intermedia de esto; lo del disco la completa.
**Pendiente:** el motor de IA de respaldo (`anexos-ia-motor.ts`) no recibió estas reglas (son de
detección y deterministas). «Línea N° ___» del Anexo 4 queda al humano (el anexo cubre las 2 líneas).
No visto en la plataforma.

## 2026-10-28 — Separar anexos: título repetido, económicos sin clasificar y vista previa
Caso real: 2827-102-LE26 (barredoras), `ANEXOS.docx` (doc 30926): salían 7 trozos en vez de 6 y
los dos económicos en «Anexos Oferente».
- «ANEXO N.º 4» escrito dos veces seguidas con solo vacíos entre medio: se cortaba en ambos y el
  primero salía como un archivo con solo el título. `detectarFormularios` junta dos títulos
  seguidos cuando el segundo es el primero (o el primero + subtítulo) y no hay texto entre ellos.
  «FORMULARIO N°1 - A» / «- B» siguen siendo dos.
- Anexo 3: el subtítulo «FORMULARIO PROPUESTA ECONÓMICA» va en una tabla-recuadro con estilo
  «Título 1»; la búsqueda de subtítulo se cortaba en las tablas. Ahora toma el primer párrafo de
  la tabla solo si tiene estilo de título de Word (`RE_ESTILO_TITULO`).
- Anexo 4: «con iva» se suma a las palabras económicas (empataba con «representante legal»).
- Vista previa: «Separar» ya no guarda de una. `POST /api/anexos/separar` con `soloVer` corta en
  memoria y devuelve cada anexo con su texto; el modal `VistaPreviaSeparacion` (Documentos) deja
  ver el texto completo, cambiar la caja y desmarcar anexos, y al guardar manda `ajustes` por
  posición. Avisa en ámbar los anexos de ≤2 líneas (corte falso probable) y los sin clasificar.
**Ojo:** el commit d07b23b del dueño se llevó una primera versión a medias de este arreglo (juntaba
de más: «Formulario Nº1A»/«Nº1B» de 1057922-25-LE26 por comparar solo el número, y un `<w:t>`
vacío contaba como texto). La versión del disco lo corrige; comparar el banco contra eb38d86.
**Verificado:** documento real → 6 anexos, cada uno de su título a su firma, 3 y 4 económicos.
Banco de 400 .docx contra eb38d86 con `--fragmentos`: cambian 3, todos mejoras (2827-102-LE26 y los
anexos 1 y 3 de 3253-91-LE26, que ahora llevan su subtítulo). Suite 1634/1634, tsc limpio.
No se vio el modal en el navegador (la app local pide sesión contra la BD real).
**Pendiente:** el relleno del económico se arregló el 29-oct (entrada de arriba). Siguen abiertos:
la línea 2 ($609.989 vs $774.687) se diagnosticó el 29-oct (ver `costeo.md`). Las notas internas de la ficha técnica L1 se arreglaron el
29-oct (ver `auditor.md`). En la BD no hay anexos separados de 2827-102-LE26 todavía: separar de
nuevo una vez desplegado.

## 2026-10-28 — Separar anexos: cada anexo terminaba con el título del siguiente
Caso real: 3712-74-LP26 (Los Vilos), `anexos-editablles.docx`, 7 anexos; mismo formato en
3712-76-LE26. La detección estaba bien; el armado no: el título va en una tabla cuyo 1.er párrafo
está vacío, ese párrafo caía en el rango del anexo anterior y la tabla entera entraba en los DOS
fragmentos. No lo causó el cambio del 27-oct. En `dividirPorFormularios` (`tituloAbreLaTabla`), una
tabla cuyo primer texto es el título del anexo siguiente queda solo en el siguiente. El banco ahora
acepta `--fragmentos` (compara con qué texto empieza y termina cada fragmento): sin eso este error no
se veía, porque el banco solo comparaba los cortes de `detectarFormularios`.
**Clasificación (mismo día, pedido del dueño):** «ANEXO N°3 ACEPTACIÓN DE LAS CONDICIONES… Y DE LAS
BASES ADMINISTRATIVAS» salía económico: las frases clave («aceptacion de condiciones») no toleraban
el artículo tras «de», el título no decidía y el cuerpo menciona la «Oferta Económica». Ahora toda
frase clave acepta «de la/las/el/los» (`armarPatron`). El banco `--fragmentos` muestra también la
categoría de cada fragmento.
**Verificado:** documento real → 7 anexos, cada uno de su título a «Los Vilos, __ de __ 2026.», 1 hoja
cada uno en Word (el 6, 2 hojas por su tabla de 39 filas); Anexo 3 administrativo. Banco `--fragmentos`
800 .docx vs HEAD: 22 cambian, todos mejoras — mismo error de tabla-membrete en 3712-74-LP26,
3712-76-LE26, 2288-33-LP26 (Canela), 1057448-45-LP26 y 1057448-49-LE26 (Iquique), 3480-21-LE26; y
4 categorías de sin_clasificar a administrativo (incl. 985737-16-LE26 «Declaración Aceptación de las
Bases»). Suite 1619/1619, tsc limpio. No visto en el navegador ni en el VPS.
**Pendiente:** en la BD siguen los separados viejos de esas licitaciones (en 3712-74-LP26, ids
30999–31004 y el del Anexo 7): hay que volver a separar una vez desplegado.

## 2026-10-28 — «Rellenar anexo» ya no está en Documentos
El dueño decidió que los anexos se rellenan y se cargan SOLO desde el Auditor (Auditor → Anexos,
«Generar anexo» en cada punto). En `DocumentosSection` se quitaron el botón «Rellenar anexo» (Word,
PDF y Excel económico), «Generar todos» y «Enviar al Auditor Técnico». El motor no cambió: los
modales `AnexoRellenoModal` / `AnexoRellenoExcelModal` siguen en uso desde el Auditor. Donde una nota
de abajo diga «abrir Rellenar anexo», hacerlo desde el Auditor.

## 2026-10-27 — Anexos 3 (técnico) y 4 (económico) de 4022-19-LE26 salían casi vacíos
Caso real: Municipalidad de Putre, `Anexo 3 - Oferta Técnica.docx` y `Anexo 4 - Oferta Económica.docx`
(mismo formato en 4022-16-LE26). El dueño pidió «que me genere el anexo técnico» y revisar el económico.
**Económico — neto / IVA / total apilados en UNA celda.** La celda «Precio Total» trae los rótulos
«Valor neto», «Impuesto IVA», «Valor Total» uno debajo del otro, sin casilla al lado: ningún patrón
los veía y el neto terminaba en la celda «Descripción» de la izquierda. Ahora cada rótulo es su
casilla (`detectarPieApiladoEnCelda`, `anexos-detectar.ts`) y se escribe al final de su línea con
el costeo (`rolesPieApilado` / `resolverPieApilado`, `anexos-monto-oferta.ts`): neto, IVA 19% (o la
tasa que declare el rótulo) y neto + IVA. Solo sin tabla de ítems; el IVA «(si aplicará)» o cualquier
texto ajeno en la celda descarta la regla. La pantalla muestra los tres valores (`segmentosInline`).
**Técnico — tabla PRODUCTO | ESPECIFICACIÓN | CANTIDAD toda en blanco.** El producto i del costeo va en
la fila i (`anexos-oferta-tecnica-tabla.ts`), con el nombre limpio (sin el «- Modelo» repetido que
guarda el costeo). **Regla / decisión:** esta tabla se llena desde el COSTEO aunque la línea del
Auditor no esté aprobada (el dueño: «termínalos todos», 27-oct). ESPECIFICACIÓN queda pendiente (el
costeo no guarda especificaciones); con más productos que filas, o si cualquier fila trae texto, no
se escribe nada.
**NO se cambió «Nombre» suelto:** en un bloque «Nombre / RUT / Dirección / Email» sigue quedando
pendiente con las dos sugerencias (representante legal por defecto, razón social a un clic), que es
la decisión explícita del dueño del 1-sep-2026 (capa 2b). Ojo: el RUT del mismo bloque sale con el de
la empresa, así que si elige el representante queda nombre de persona con RUT de empresa.
**Pendiente:** decidir si, cuando el bloque trae Dirección/Email de la empresa, el valor por defecto
de «Nombre» debería ser la razón social. «Plazo de entrega» y «Vigencia de la oferta» quedan en blanco
(el plazo está PENDIENTE en el Auditor; la vigencia no se toma de las bases).
**Verificado:** docx reales de la BD con costeo, bases y Auditor reales: económico $8.267.078 / IVA
$1.570.745 / total $9.837.823; técnico 7 productos con su cantidad. Barrido de 800 .docx reales: la
regla solo dispara en los anexos de Putre. Suite 1602/1602, tsc limpio. No visto en el navegador ni
generado de nuevo en la plataforma: hay que abrir «Rellenar anexo» en 4022-19-LE26 una vez desplegado.

## 2026-10-27 — Separar anexos cortaba en «LICITACIÓN PÚBLICA» (8 trozos en vez de 5)
Caso real: 4022-19-LE26 (Municipalidad de Putre), `ANEXOS_ELECTRIC_DOMIC_4022-19-LE26.docx`; mismo
formato en 4022-16-LE26.
Títulos «ANEXO ADMINISTRATIVO 1», «ANEXO TÉCNICO 3», «ANEXO  5» (número sin N°) no se reconocían y
el respaldo cortaba en el membrete «LICITACIÓN PÚBLICA», 2-3 líneas tarde: el título de cada anexo
quedaba al final del anterior, archivos «LICITACIÓN_PÚBLICA_N», hojas en blanco. En
`app/lib/anexos-dividir.ts`: décima forma de título (número sin N°, solo párrafos sueltos), la
séptima forma sube por todo el bloque de título (y no toma la 2ª línea de una firma, «LEGAL»), el
membrete repetido no sirve de subtítulo, y cada fragmento sale sin saltos de página en los bordes
ni relleno vacío al final (deja 2 vacíos para la fecha). Skill nueva `separar-anexos` y banco
`scripts/anexos-banco-division.mts`.
**Regla / decisión:** cualquier cambio en la separación se pasa por el banco de separación y se
revisa cada documento que cambia (skill `separar-anexos`).
**Verificado:** documento real → 5 anexos, cada uno de su título a su fecha, 1 hoja cada uno en
Word, categoría correcta y `generarAnexoFinal` con los mismos campos llenos. Banco de 400 .docx
reales vs HEAD: 45 cambian, revisados — anexos nuevos bien separados (2713-187-LP26,
812799-55-LE26, 856-26-LR26, 2661-45-LR26 Anexo 2) y cortes falsos que desaparecen; ningún anexo
real perdido. No se probó en el navegador ni en el VPS.
**Pendiente:** en la BD siguen los anexos mal separados de 4022-19-LE26 (`LICITACIÓN_PÚBLICA*.docx`
y los generados desde ellos en Documentos Propios): hay que volver a separar una vez desplegado.
Cortes raros que ya existían y siguen (3789-40-LE26 «, ___ DE 2026», 45-52-LE26 «RUT»,
1057429-98-LE26 «O»): no tocados.

## 2026-10-27 — La fecha salía centrada encima de la firma
Caso real: 1414396-26-LP26, Anexo N°5 (oferta económica).
El Word trae «Fecha:» + párrafo vacío CENTRADO + raya de firma. El patrón 1
(`detectarCandidatosCeldaCrudos`, `app/lib/anexos-detectar.ts`) tomaba el vacío centrado como
casilla. Ahora, si el rótulo termina en «:» y el vacío de abajo tiene otra alineación, lo toma el
patrón de dos puntos y queda «Fecha: 27 de octubre de 2026».
**Verificado:** docx real + test nuevo; suite 1542/1542. No visto en navegador.

## 2026-10-27 — «Total Neto» repetido en la columna Producto del pie
Caso real: 1414396-26-LP26, Anexo N°5.
Las celdas vacías a la izquierda del rótulo del pie (sin bordes en el Word) llegaban a los
motores y alguno escribía el rótulo (probablemente el cruce con bases por IA). Ahora
`celdasDeRellenoDelPie` las saca de los candidatos ANTES de resolver, en `analizarAnexoParaUI` y
`generarAnexoFinal` (`app/lib/anexos-rellenar.ts`).
**Verificado:** docx real, y el 2026-10-27 con costeo, bases y Auditor reales de la BD: pie limpio,
línea 7 = 19.049.408, «Fecha: 28 de octubre de 2026» en la misma línea (la fecha de firma es el
día de cierre de la licitación, a propósito).

## 2026-10-26 — Anexo económico Word: totales por línea y licitaciones por línea
Caso real: 1414396-26-LP26, Anexo N°5 («Línea | Producto | Cantidad(A) | Precio Unitario(B) |
Total Neto(A*B)» + pie Total Neto / IVA / Total Bruto). Solo salía el precio unitario.
Cuatro reglas generales en `app/lib/anexos-totales-seccion.ts`:
1. Columna «total / subtotal / A*B» a la derecha del precio = cantidad × precio
   (`calcularTotalesPorLinea`). Una columna «con IVA» o «bruto» no se toca.
2. Si cada ítem del costeo encontró su línea, las líneas sin precio son líneas no ofertadas y no
   bloquean el total del pie. Si falta un ítem del costeo, el total sigue sin escribirse.
3. IVA sin porcentaje en ninguna fila → 19%. Si el documento dice otro %, manda el documento.
   «IVA (si aplicará)» lo decide el usuario.
4. Las celdas vacías a la izquierda del rótulo del pie no son casillas.
**Regla / decisión:** las cuatro las pidió el dueño; el 19% reemplaza la regla vieja de dejar el
IVA pendiente. Siempre reglas generales, nunca arreglos para una licitación.
**Verificado:** docx real: 4.762.352 × 4 = 19.049.408; IVA 3.619.388; Bruto 22.668.796.
**Pendiente:** no comparado contra otros anexos económicos del banco. El motor de Excel
(`anexos-excel-precios.ts`) tiene su propio cálculo y no se tocó.

## 2026-10-26 — «Mi representada ___ (SÍ/NO)» se llenaba con la razón social
Caso real: 1414396-26-LP26, Anexo N°3 (programa de integridad).
La regla «mi representada ___ → razón social» se comía el blanco que va antes de «(SÍ/NO)». Ahora
un blanco seguido de «(Sí/No)» nunca se autocompleta (`campoDeBlancoInline`), su etiqueta es la
pregunta de la derecha (`rotuloDeSiNo`) y queda como decisión del usuario con botones Sí / No.
De paso: «representación de ___» sin «en» delante también se llena con la razón social.
**Regla / decisión:** la respuesta SÍ/NO de integridad la elige siempre el oferente.
**Verificado:** docx real + tests.

---

## Decisiones vigentes del dueño (traspaso, ago–oct 2026)

- **Arquitectura vigente** (2026-08-17, «hazlo 100% con código»): el anexo administrativo se llena
  con `anexos-determinista.ts`. El motor IA queda de respaldo apagado (`ANEXOS_IA_RESPALDO=1`).
  La IA nunca pone el valor: el valor sale literal de la ficha.
- **Un motor separado por formato**: Word, PDF y Excel no comparten función (2026-09-04).
- **«Una sola persona»**: oferente, representante legal, encargado de la propuesta y contacto de
  la licitación son siempre la misma persona de la ficha. El ruteo por rol es respaldo, nunca
  manda sobre una etiqueta que ya resuelve sola.
- **Reglas de llenado** (2026-09-01): oferente = empresa; licitación = nombre de la licitación;
  contacto = representante; el teléfono es uno solo (`telefono1`); en un bloque «representante
  legal» el dato es de la persona salvo que la etiqueta diga oferente/empresa.
- **Todo anexo, formato o formulario va al bloque Administrativo** del Auditor, nunca se reparte
  a Técnico/Comercial por el tema del título.
- Dentro de una sección UTP omitida, los campos sueltos del «proponente» son datos de la empresa;
  solo la tabla de integrantes queda excluida. Botón «Sí nos corresponde — completar igual».
- Corregir un valor autocompletado NO siempre enseña una regla: a veces es un error puntual
  (pedido del 2026-09-01). Las reglas aprendidas son por TIPO de etiqueta, no por documento.
- «Estado civil» y datos que no existen en la ficha quedan pendientes y se llenan a mano.
- Dirección partida: si la dirección no trae «N°», calle/número quedan pendientes (no se adivina).
- Firma: posición libre sobre el PDF (como ecert); la firma sobre el económico Excel quedó para
  otra fase.
- Permisos (2026-10-05): Postulación solo admin; asistentes con costeo, auditor técnico, auditor
  de compra y anexos, sin aprobar.

## Lecciones del motor

- «Cero candidatos» es el fallo más caro: en pantalla se ve igual a «no pide nada» y el usuario no
  tiene dónde escribir a mano. Cuando un anexo sale con 0 automáticos, correr `resolverDeterminista`
  aparte.
- El reclamo «no me llena al 100%» casi siempre es de DETECCIÓN, no de resolución.
- Si una etiqueta obvia queda pendiente, mirar primero el ROTULADO (prefijo «N°», sinónimos) y
  arreglarlo en el punto único (`normalizarEtiqueta`), nunca entrada por entrada.
- Dentro de un `<w:tc>` mandan las filas, no la tipografía (centrado, largo de la etiqueta).
- Una mejora medida que da casi cero: buscar el guardarraíl que la anula.
- Los errores que importan se ven en el papel: exportar el `.docx` a PDF y mirarlo. Validar el
  `.docx` con un parser real (lxml / python-docx), no con regex propios.
- Contar `<w:drawing>` no prueba que la firma esté bien puesta (puede caer fuera del cuadro).
- En el componente de firma sobre PDF hay que medir en el navegador con mouse real
  (`elementFromPoint`, ancho antes/después); los eventos sintéticos pasan y el control igual falla.
- Medición (ago-2026): el 74% de lo que llena una persona en un anexo es contenido de oferta
  (descripción técnica, precios, plazos, marcas, checkboxes), no datos de la empresa. El techo lo
  ponen los datos que existen: el 88% de las planillas de costeo llegaban sin precios.
- `itemsPrecioDeCosteo` descarta la fila entera si no hay precio, aunque traiga descripción y
  cantidad que un anexo técnico necesita.

## Pendientes (traspaso)

- Poder VACIAR una casilla que el motor llenó solo (una corrección vacía se ignora).
- Aprender de un pendiente administrativo llenado a mano: preguntar al dueño si automático o con
  botón explícito antes de construir.
- Underline decorativo alrededor de un dato ya escrito («____Nombre____», «___12___ MESES») se
  detecta como casilla: detectado, sin tocar por decisión (toca la detección compartida).
- Pantalla para ver/curar/borrar reglas aprendidas de anexos (existe la API, falta la UI).
- `clasificarAnexo` manda «DESCRIPCIÓN TÉCNICA DE LOS PRODUCTOS» a administrativo (debería ser
  técnico).
- Firma dual oferente + evaluador en un párrafo se descarta por diseño: avisarla en cobertura.
- Tablas anidadas mal delimitadas en varias funciones de `anexos-detectar.ts` (cierran en el
  primer `</w:tbl>`); la versión correcta existe duplicada en `anexos-dividir.ts` y
  `anexos-documento-ui.ts`.
- `dividirPorFormularios` descarta lo que no es `<w:p>`/`<w:tbl>` (cuadros de texto) al separar.
- Rebuild del conversor en el VPS para las fuentes (Arial salía como DejaVu en el PDF).
- Cargo del representante de una empresa de la ficha tenía una profesión en vez del cargo: falta
  el dato real.
- `.doc` en local no se procesan sin `DOC_CONVERSOR_URL` (en el VPS sí).
