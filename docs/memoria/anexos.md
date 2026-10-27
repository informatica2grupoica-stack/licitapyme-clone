# Anexos — motor de relleno

Reglas vigentes del motor: ver también `.claude/skills/motor-anexos/SKILL.md` y
`docs/anexos-motor-reglas.md`. Las entradas con fecha van arriba; al final, lo traspasado desde la
memoria personal el 2026-10-27.

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
