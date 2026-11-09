# Anexos — motor de relleno

Reglas vigentes del motor: ver también `.claude/skills/motor-anexos/SKILL.md` y
`docs/anexos-motor-reglas.md`. Las entradas con fecha van arriba; al final, lo traspasado desde la
memoria personal el 2026-10-27.

## 2026-11-09 — Revisión del dueño de 4022-19-LE26: Descripción del económico y ESPECIFICACIÓN con lo que ofertamos
El dueño abrió los anexos de 4022-19-LE26 (probados el 06-nov) y encontró dos cosas:
- **Económico, «Descripción» vacía.** Tabla «Descripción | Precio Total» de UNA fila (neto/IVA/total apilados a la derecha). Regla del dueño: ahí van los nombres de los ítems del costeo, y según el anexo la columna se llama Descripción, Ítem, Producto o Detalle. `resolverDescripcionDeItems` (anexos-tabla-por-orden.ts): solo con una fila de datos, sin columna «unitario», con una columna de total y la celda vacía; nombres unidos con «; ». Ojo: «Precio Total» NO es precio unitario (la regla se descartaba a sí misma con `esCandidatoDePrecioUnitario`). Verificado con el .docx real: los 7 productos.
- **Técnico, ESPECIFICACIÓN: va SOLO lo que nosotros ofertamos** = la columna derecha del Auditor (el dato ofertado leído de la ficha), NO el texto del requisito de las bases, y **sin marca ni modelo** (regla vigente de la ficha propia: nombrarlos nos amarra a entregar ese equipo; `sinMarcaNiModelo`). `textoEspecificacionDeFicha` reescrita: solo requisitos CUMPLE (o confirmados a mano) con valor ofertado; sin rótulos sueltos («marca,») ni coma decimal rota. `fichasDesdePanel` usa la misma limpieza que la ficha propia (`datoParaPresentar`, `datoDeComplemento`). Resultado 4022-19 L1: «Litio LiFePO4 12,8 V, 100 Ah, >6000 ciclos al 80% DOD.».
- **Auditor: «Lo que ofertamos» obligatorio al dar por cumplido un ❌/❓.** Pedido del dueño: en los requisitos «no cumple»/«falta dato» el asistente debe escribir lo que ofertamos para que pase a las fichas técnicas y el anexo y no quede vacío. `Confirmacion.valor` (se guarda en el evento `confirmacion_tecnica`), `confirmarCelda(..., valor)`, la ruta `confirmar_celda` rechaza (400) sin valor de 3+ caracteres salvo `exigirValor: false` (la aceptación EN LOTE del EM de lo ya complementado); la pantalla (`CeldaTecnica`, AuditorOpcionesPanel.tsx) tiene el cuadro obligatorio y muestra «Ofertamos: …» en lo confirmado. Lo usan `fichasDesdePanel` (anexo) y `especificacionesDeOpcion` (ficha propia en PDF). **Sin ver en el navegador** ni probado con un clic real (regla: las confirmaciones las hace el equipo).
**Pendiente / por mirar:** el tubo (L3 de 4022-19) sigue vacío: su requisito figura «cumple» pero sin dato ofertado en el Auditor (el asistente debe escribirlo); el «modelo» a veces es en realidad una medida («Perfil Tubo… 3" x2.0 X6MTS.») y al quitar el modelo se pierde esa medida; las confirmaciones ya hechas antes de este cambio no tienen valor ofertado.

## 2026-11-06 (noche) — Prueba de económicos con costeo real: 7 de 8 bien (2483-265 ya estaba bien: solo plazo y garantía pendientes, los compromete el oferente); falta 1 (1057898)
Pedido del dueño: probar la creación de anexos (admin/técnico/económico) sobre licitaciones reales **sin guardar nada**. Todo en memoria (`auditor-anexos-generacion.mts` + `analizarAnexoParaUI`/`generarAnexoFinal` con costeo real; solo SELECT a la BD).
**Barrido de 190 documentos (250 anexos):** 0 rotos, 0 ciegos; 122 con casillas pendientes, casi todos administrativos y por datos que la ficha no tiene o que decide el oferente (correcto). Ese auditor NO usa costeo/Auditor: no sirve para juzgar económicos ni técnicos.
**Económicos con costeo real (8):** 2827-102, 4844-24 y 4022-19 bien y calzan con el costeo; fallaban 3712-74, 808211-6, 1057898-112 y 2013-22.
**Arreglado (general, con test):**
- **Subtítulo de grupo dentro de la tabla de precios (3712-74-LP26, Anexo 7, 39 líneas):** «EQUIPOS» (una celda) justo bajo el encabezado terminaba la tabla y no se ofrecía ni un precio. `esSubtituloDeGrupo` (anexos-detectar.ts): un divisor de una celda no corta si la fila siguiente tiene tantas celdas como el encabezado (3+ columnas); los dos sitios que cortan usan la misma regla. Comparado contra el commit anterior en 300 documentos reales: solo cambian 2 (4610-85 «Calidad Técnica»), a mejor (las etiquetas de fila eran «2», «4», «1»).
- **Pie «NETO: $ / IVA: $ / BRUTO: $» en párrafos sueltos (808211-6-LE26, Anexo 8):** `detectarPieApiladoEnCelda` ahora también reconoce 2-3 párrafos seguidos que terminan en «$» (`PIE_SUELTO`); el monto va pegado al «$» sin repetirlo; el BRUTO ya no toma el párrafo vacío de la firma.
- **«por el VALOR NETO de $» (monto único):** `tipoDeMontoDeOferta` lo acepta (la frase ya dice que es la oferta). Salió neto $27.823.247, IVA $5.286.417, bruto $33.109.664 y el monto en palabras.
- **«NETO / IVA / VALOR TOTAL» (3712):** con neto e IVA explícitos, un «total» a secas es neto + IVA (antes repetía el neto: $78.530.667 en vez de $93.451.494). El guardarraíl contra el costeo no lo habría visto (compara el neto).
**Verificado:** reproducido con el .docx real + costeo de la BD; 3712 → 39 unitarios y totales por línea, pie 78.530.667 / 14.920.827 / 93.451.494; suite de anexos y tsc limpios. No visto en el navegador ni exportado a PDF con Word.
**Pendiente / por decidir:**
- **2013-22-LE26 Anexo 6 (carta oferta) — HECHO por orden del dueño (06-nov):** la tabla trae solo el N.º de ítem; la línea N del costeo va en la fila N: nombre del costeo en DESCRIPCIÓN, cantidad y valor total neto del costeo, y el pie (neto, IVA %, total con impuesto, monto en palabras). `anexos-tabla-por-orden.ts`. Solo actúa si las filas son 1..N, N = líneas del costeo, todas las casillas vacías y todas las líneas con cantidad; si no, no escribe. Verificado con el .docx real: 8 × $1.278.369 = $10.226.952, neto $14.928.058, IVA $2.836.331, total $17.764.389; entre los últimos 400 documentos reales con negocio solo se activa en 2013-22. La descripción de las BASES por línea NO se usa (no hay descripción por línea guardada; el dueño la pidió «si la tiene»): hoy va el nombre del costeo. El orden del costeo debe coincidir con el de la licitación — el equipo lo revisa en la pantalla.
- **1057898-112-LP26 Anexo 4 (propuesta por familia) NO se automatiza (revisado 06-nov con el .docx y el costeo reales):** la plantilla trae solo 2 bloques de producto (ficha + precios) y pide presentar UN anexo POR FAMILIA; el costeo tiene 8 productos (soportes, carros, camillas, pisos) sin guardar a qué familia pertenece cada uno. Llenar «bloque N = línea N» sería adivinar la familia y obligaría a duplicar bloques del papel del organismo (el documento debe salir idéntico, solo rellenado). Para hacerlo bien hace falta primero guardar la familia de cada línea (viene en las bases) y decidir si se genera un anexo por familia. Mientras, queda manual.
- **Técnicos con Auditor aprobado (medidos 06-nov, solo lo que hay en el caché):** 7 licitaciones con opción aprobada, pero solo 2 con anexo técnico propio. **4022-19-LE26 Anexo 3 «Oferta técnica»:** PRODUCTO y CANTIDAD salían del costeo pero **ESPECIFICACIÓN quedaba vacía en las 7 líneas** (las filas en blanco no nombran el producto, así que la ficha del Auditor no se cruzaba). Arreglado: `resolverTablaProductosEnBlanco` recibe las fichas, `fichaDeProducto` casa por parecido claro del nombre (60 %, sin empate) y solo con opción APROBADA, `textoEspecificacionDeFicha` escribe marca, modelo, fabricante, país y los requisitos que CUMPLEN con su valor ofertado (los NO cumple / falta dato no se escriben). Verificado con el .docx real: 7/7 líneas. **759-21-LE26 Anexo 5:** plazo del Auditor escrito; «Garantía extendida» queda pendiente (compromiso del oferente, el Auditor no la tiene). **1414396-26-LP26:** Anexo 6 (distribución de entrega) 7/7; los pendientes de los anexos 3 y 4 (SÍ/NO de integridad, meses de garantía) son del oferente. Los demás con aprobada (1350137-7, 2827-102) no tienen anexo técnico Word en el caché. Pendiente de revisar a ojo: el texto del requisito a veces repite el nombre del producto («Batería Litio…: Litio LiFePO4 12.8 V…»). Un primer intento con 8 procesos en paralelo agotó las conexiones de la BD del VPS: correr de a uno.
- Cosmético: «de $27.823.247(SIN IVA…» queda pegado al paréntesis; un test fija que «(Indicar)» va pegado, no se tocó.
- **Anexos técnicos con Auditor aprobado: sin medir** en esta pasada.
- Falla ajena a anexos: `compras-reloj-sugerido.test.mts` («plazos distintos por línea…») de la sesión de Compras.

## 2026-11-06 — Económico con columnas corridas y presupuesto de las bases como oferta (4170-63-LE26 Anexo Nº4)
Caso real: «ANEXO Nº4 OFERTA ECONÓMICA», tubos de hormigón (Galvarino), negocio 1633, costeo con unitarios netos 86.400 / 39.600 / 27.000. El PDF que mandó el dueño traía: el unitario bajo «Monto total», en la columna del total el **presupuesto máximo del municipio** por ítem ($19.063.800, «$ 7-514-850» tal cual del OCR, $3.927.000) y el pie IVA $29.070 / total $182.070 (19 % de la SUMA DE LOS UNITARIOS).
**Causas y arreglos (generales):**
- Las columnas se ubican por ancho de celda, pero solo se leía `w:type="pct"`; este Word mide en `dxa` → reparto parejo → con 4 columnas en el encabezado y 5 celdas por fila (columna fantasma a la derecha) todo corrido uno. Ahora `anchosParaAlinear` usa `pct` o `dxa` (misma unidad en encabezado y fila; si no, como antes) y corre las filas con `<w:gridBefore>`/`<w:wBefore>` (pie «NETO | $ | $» de 5827-4-LE26, que antes quedaba bajo GARANTÍA/CANTIDAD). anexos-detectar.ts.
- Sin cantidad bien ubicada no había total por línea, y la casilla quedaba «dato de la licitación» → la IA de BASES le ponía el presupuesto. **Regla nueva:** ninguna casilla de monto (monto, precio, valor unitario/total, neto, IVA, «$») pasa por la IA de bases (`RE_MONTO_DE_LA_OFERTA`, anexos-rellenar.ts). La de órdenes de compra sí (Monto de la experiencia).
**Resultado:** 86.400 / 39.600 / 27.000, totales 15.552.000 / 5.940.000 / 2.700.000, IVA $4.596.480, total $28.788.480; exportado con Word cada número bajo su columna, 1 hoja.
**Verificado:** reproducido con el .docx real + costeo de la BD; banco de alineación sobre los últimos 400 Word reales: 34 cambian la foto interna, 21 cambian en pantalla y todos con las mismas casillas/automáticos salvo 4170 y 1057448 (abajo); 2 tests nuevos en anexos-deteccion (fallan con la alineación vieja); suite 1766/1766, tsc. No visto en el navegador; desplegado 2026-11-06 (lo confirmó el dueño).
**Pendiente:** 1057448-25-LR26 «Anexo 7-A Personal Técnico Certificado»: el motor escribe razón social, RUT y teléfono de la EMPRESA en el listado de técnicos (antes y después; ahora al menos en su columna) — es un dato de terceros, no debería autocompletarse. «Plazo de entrega» del Anexo Nº4 queda pendiente (correcto: lo compromete el oferente).

## 2026-11-05 (auditoría QA) — Barrido de 400 documentos reales: 3 bugs generales arreglados
Pedido del dueño: auditar si el motor es eficiente y si aprende. `auditor-anexos-generacion.mts` sobre 400 docs (598 anexos), sin IA opcional: 7 rotos, 282 con casillas pendientes, 30 % de las casillas «de ficha» sin llenar, 0 ciegos.
**Arreglado (con test):**
- **XML roto al separar (2467-119-LE26):** el banner «ANEXO Nº1 / BASES ADMINISTRATIVAS» es un cuadro de texto con copia en `mc:Fallback`; la copia se leía como 2.º formulario y los 2 archivos salían corruptos. `dividirPorFormularios` ahora quita la copia (`eliminarRespaldoVmlDuplicado`; `/api/anexos/separar` no lo hacía) y, si un fragmento sale mal formado, **no divide** (nunca entrega archivos corruptos).
- **Razón social duplicada (2013-22-LE26 Anexo 11):** «Quien suscribe (razón social) ____» — el paréntesis pegado a una raya es su **rótulo**, no otra casilla (`listarBlancosInline`). Antes salía «Quien suscribe Inversiones X Inversiones X» y se perdía el rótulo.
- **«(Ciudad) DD/MM/AA» dejaba el formato a la vista (Anexos 5/10/11):** el formato de fecha escrito suelto es ahora casilla; campos nuevos `fecha_hoy_numerica` (05/11/2026) y `fecha_hoy_numerica_corta` (05/11/26). **Cambio de regla:** «dd/mm/aaaa» / «DD-MM-AAAA» antes escribía la fecha larga; ahora numérica del mismo largo («día/mes/año» sigue larga).
- **Aprendizaje:** `esCorreccionAprendible` rechaza (con motivo) montos, plazos y correcciones que no cambian nada. De las 16 correcciones guardadas ninguna tenía `campo`, así que **ninguna ha cambiado jamás un anexo**; varias eran montos/plazos de una licitación.
- El auditor ahora mide con los mismos datos de licitación que producción (código, nombre, comuna): «falta código/nombre» era un artefacto; bajó de 30,8 % a 29,7 % pendientes de ficha.
**No eran bugs:** los 5 `.doc` «rotos» fallaron solo desde el PC (el conversor está en la red docker); en el VPS `/convertir` responde 200 con un .doc real. Producción tiene `conversor-doc` con las 4 Quattrocento Sans.
**Pendiente / decisión del dueño:**
- `ANEXOS_IA_REPASO` está **apagado en producción**. Medido en 8 anexos de 2013-22-LE26: 1 corrección en 19 casillas, 0 degradadas, mismos totales; ~$0,002 por documento. Beneficio chico y barato; encenderlo es una variable en el `.env` del VPS (no se tocó).
- Comuna del organismo: 9 licitaciones sin fila en `licitacion_unidad_cache` (se llena sola cuando MP responde); se podría precalentar.
- 22 anexos «sin clasificar» (títulos como «(NOMBRE FIRMA Y TIMBRE)», «DEL PROPONENTE», «DECLARA:») caen en la caja genérica.
- Nombramiento de representante / experiencia: las casillas pendientes son cláusulas de un mandato entre dos partes y tablas que dependen de las OC; el banco no las mide con OC (en la app sí se pasan).
- Las 16 correcciones ya guardadas con basura (monto, plazo, «SÍ→SÍ», «(sin contexto)») siguen activas: se pueden desactivar (`activa=0`) con OK del dueño.
Suite 1764/1764, tsc limpio.

## 2026-11-05 (noche) — Botón «Firmar en Word» (4844-24-LE26)
Decisión del dueño tras descartar LibreOffice y OnlyOffice: cuando el anexo tiene línea de firma, el modal ofrece **«Firmar en Word»** junto a «Continuar a firma» (que sigue igual). Genera el .docx por `/api/anexos/generar` con `firmaEnWord: '1'` y cada lugar `firma:N` = su `porDefecto` (o «firma» si hay firma cargada); en `generarAnexoFinal` la firma (y el timbre, a la derecha, si la leyenda lo pide) va con `insertarImagenEnParrafo(..., { sobreLaRaya: true })`: imagen FLOTANTE (`wp:anchor`, `wrapNone`) apoyada sobre la raya (borde inferior 0,7 cm bajo el inicio del párrafo; alto máx. 2,2 cm), sin borrar la raya ni mover texto. El equipo abre el Word y lo guarda como PDF: sale idéntico al original. Este camino sí pasa por el guardarraíl del total contra el costeo (el de firma en PDF no).
**Verificado:** 4844 Anexo N°5 generado y exportado con Word → 1 hoja, firma sobre la raya sin tapar el plazo, Nombre/Rut abajo; test en anexos-docx-namespaces; suite 1753/1753, tsc. **No visto en el navegador** (otra sesión tenía `next dev` en la misma carpeta). Usa la firma principal de la empresa (no elige entre varias firmas). Sin desplegar.

## 2026-11-05 (tarde) — «Me lo das distinto»: el PDF salía en 2 hojas por fuentes faltantes en el conversor (4844-24-LE26)
**Regla del dueño (reiterada): el anexo generado es SIEMPRE el mismo documento del organismo, solo rellenado** — mismas hojas, Nombre/Rut abajo de la firma en la misma hoja, nada movido.
Causa (medida): el .docx rellenado es el mismo documento (exportado con Word: 1 hoja). El PDF lo hace el contenedor `conversor-doc` (LibreOffice en el VPS) y **hasta el original SIN rellenar sale en 2 hojas ahí**. Dos causas:
1. Faltaban **Quattrocento Sans** (143 textos) y **Bookman Old Style** (título) → Liberation, más ancha (montos partidos «$9.644.3/36»). Arreglo: el Dockerfile baja la Quattrocento Sans real de Google Fonts (OFL; mismo hash que la que baja Office desde su nube) + fonts-urw-base35 con alias Bookman Old Style → URW Bookman. Probado en el VPS con una imagen de prueba aparte (`fc-match` OK, la letra sale igual). **Falta reconstruir el contenedor real** (`docker compose build conversor-doc && docker compose up -d conversor-doc`).
2. Aun con la fuente correcta queda a 27 pt de caber: mismas columnas (medido con pdfjs, «$» en x=381/446 en los dos) y mismo interlineado, pero LibreOffice corta distinto que Word: «CANTIDAD» (58 pt en 58,2 útiles) sale «CANTIDA/D» y no corta entre guion y número («DS-530» baja entero). Es del motor de LibreOffice, no del relleno; **sin resolver**. Comprobado: Word da posiciones IDÉNTICAS para el original y el rellenado (1 hoja los dos).
**OnlyOffice probado y descartado (2026-11-05, contenedor aparte en el VPS, ya borrado):** con las mismas fuentes también da 2 hojas y queda peor en la tabla (total 33 pt bajo Word vs 27 pt de LibreOffice); solo acierta «CANTIDAD» en un renglón. Quedan: firmar sobre el .docx y sacar el PDF con Word, o convertir con el motor de Word en la nube (Microsoft Graph, necesita cuenta Microsoft 365).
**Regla del dueño:** en el pie «Total con IVA», la casilla bajo «VALOR UNITARIO CON IVA» = suma de los unitarios con IVA ($2.055.581 en este caso); solo cuando la columna total va justo a la derecha de la del unitario (anexos-totales-seccion.ts). Lección: cuando una plantilla pide una fuente que no está en el conversor, mirar `word/fontTable.xml` del .docx y agregarla al Dockerfile.

## 2026-11-05 — Anexo N°5 técnico + económico: precios CON IVA, celdas «$» y plazo (4844-24-LE26)
Caso real: «Anexo N°5 Formulario de oferta económica y plazo de entrega» (El Tabo), 5 productos, todo aprobado (Auditor: plazo «1 día habil», precio total neto $36.856.973; costeo con los 5 unitarios). Salía con empresa y plazo, sin un solo precio; el PDF del dueño traía 4 filas tecleadas a mano, la del escáner y el total en «$» vacío, la columna del total en otra letra y «1 día habil días hábiles».
**Causas y arreglos (generales):**
- La fila del escáner traía «$» en sus dos casillas y se tomaba por encabezado → `numCeldasConTexto` ya no cuenta celdas de solo «$» (anexos-detectar.ts).
- Columna «VALOR UNITARIO CON IVA» se descartaba a propósito (costeo = neto) → ahora es candidata y se escribe neto × 1,19 (`esPrecioUnitarioConIva`, `precioSegunColumna`); total por línea en la columna con IVA y pie «Total con IVA» = suma (anexos-totales-seccion.ts).
- Precios del costeo/Auditor en celda «$» no llevaban `dosPuntos` → no se escribían; el número reemplaza los espacios de relleno y va pegado («$602.771»), antes se partía en dos renglones (anexos-docx.ts).
- Plazo: el papel ya imprime «días hábiles» → solo el número (`plazoSinUnidadImpresa`).
- **Peligro encontrado**: al generar, la segunda pasada con IA sobre las bases le dio un monto propio a «Total con IVA» y, por ir antes, le ganaba al total calculado → `sinCasillasCalculadas` (lo calculado del costeo manda en su casilla).
- Guardarraíl: con unitarios redondeados el total queda a $8 de costeo × 1,19 → holgura ½ peso por unidad (auditor-verificacion-total.ts + ruta generar).
**Resultado:** 15 automáticos, 0 avisos; unitarios 602.771 / 553.826 / 428.890 / 83.707 / 386.387, total con IVA $43.859.790, plazo «1». Exportado a PDF con Word: mismo formato del organismo, nada partido. La casilla «Total con IVA» bajo la columna del unitario queda en «$» (no tiene sentido sumar unitarios). Suite 1752/1752, tsc.
**«Que aprenda»:** decisión de esta sesión: los montos no se aprenden, salen siempre del costeo/Auditor aprobados; lo que se aprende es el tipo de columna (regla general + test). Correcciones a mano de una casilla siguen yendo a `anexos_feedback` (falta la pantalla para verlas/borrarlas).
**Pendiente:** el PDF del servidor salió con letra serif en algunas celdas y la firma a la hoja 2: la plantilla usa «Quattrocento Sans», que probablemente no está instalada en el VPS para LibreOffice (no verificado). No desplegado; el dueño subió los cambios a git (3bc54e8).

## 2026-11-04 (tarde, 2) — «( X ) Persona Jurídica» en la lista de tipo de oferente (Formulario Nº1A)
Pedido del dueño con captura: la lista «( ) Persona Natural / ( ) Persona Jurídica / ( )Otra (Indicar)» se marca. **Corrección del mismo día (dueño): «la idea es que yo la pueda seleccionar»** — la primera versión la escribía fija en el texto. Ahora `detectarGruposParentesis` (anexos-detectar.ts) la vuelve un grupo de opciones como los checkboxes de Word (`parentesis: true`), la pantalla la trae **preseleccionada** en «Persona Jurídica» (`sugerida`, si la ficha es persona jurídica) y se puede cambiar o desmarcar con un clic; al generar, `marcarParentesis` (anexos-docx.ts) pone la X en la elegida sin cambiar el largo del texto. **Segunda corrección (dueño): «tiene que estar donde es la selección o se pueden confundir»** — el recuadro arriba del documento se quitó para estos grupos; los «( )» de la réplica (celda o párrafo) son botones ahí mismo (`TextoConOpciones` + contexto `OpcionesParentesisCtx` en AnexoRellenoModal, solo panel derecho). Visto en localhost con 1057922-28-LP26: «( ) Persona Natural ( X ) Persona Jurídica ( ) Otra», se cambia tocando el paréntesis. Los checkboxes nativos de Word siguen en el recuadro de arriba. Tests en anexos-deteccion.

## 2026-11-04 (tarde) — Test de llenado de los 10 anexos de 1057922-28-LP26
Pedido del dueño: «dime por qué no los llena», técnicos desde las fichas del asistente (y si no, aviso), empresa al 100%, casilla para lo que no se encuentra. Test: `analizarAnexoParaUI` + `generarAnexoFinal` sobre los 10 separados, mirando el Word resultante.
**Causas y arreglos (generales):**
- Ficha técnica: el motor leía SOLO el Auditor antiguo (`checklist_comercial_caracteristicas`); el nuevo (`auditor_opcion` + comparador v3) no llegaba. `fichasDelAuditorParaAnexo` / `resolverFichaTecnicaConAuditor`: con opción **aprobada** escribe marca, modelo y por requisito que cumple «SI» + ficha + ofertado. Sin aprobada, nada, y el porqué va en «Antes de generar».
- Detección de la tabla de especificaciones: fila «1 | CARACTERÍSTICAS GENERALES» se tomaba por encabezado; «CUMPLE SI/NO» se perdía por angosta; «[kg]»/«[cm]» salían como casillas; «PUNTAJE ASIGNADO» era casilla; filas largas perdían la columna en la etiqueta.
- **Peligro encontrado**: la IA de órdenes de compra escribía «SI» en «CUMPLE SI/NO» y la de bases elegía «15 días» y garantía 12. Plazo/garantía/«marcar X» y casillas de la ficha técnica ya no pasan por esas IA.
- Formulario Nº1A: rótulos solos en celda («Teléfono», «Giro», «Nombre» bajo REPRESENTANTE LEGAL) invisibles → `detectarRotulosSolosEnCelda`; «Banco con que opera»; domicilio «Calle | Nº | Depto | Ciudad» quedaba solo-manual (regla de lista contaba filas de rótulos); «Giro :» y «noviembrede» (espacios). Referente técnico = familia coordinador (nombre del representante, decisión del 31-ago); **tecnovigilancia** queda pendiente (cargo regulatorio).
- Formulario Nº1B «exclusivamente… UTP» se llenaba con nuestra razón social → ahora «no corresponde».
**Resultado (empresa 1):** 1-A de 14 a 46 datos (pendientes: tecnovigilancia, tributación, afecta/exenta, otros, país, fantasía); Formulario 2 camilla con la opción 950 aprobada (simulado en memoria) 71 llenos / 15 pendientes legítimos. Sin aprobación: 3 (empresa, fecha) + aviso.
**Pendiente / decidir:** «Nombre de fantasía» = razón social es regla documentada (se dejó); faltan en la ficha: nombre de fantasía, tipo de tributación (afecta/exenta), responsable de tecnovigilancia, referente técnico propio, celular, país; líneas 2-7 no están en el costeo como ofertadas (Auditor solo tiene línea 1); plazo de entrega y garantía del Formulario 2 aún no salen del Auditor (compromisos de Pre-postulación). No se miró el PDF ni se generó desde la pantalla. No desplegado.

## 2026-11-04 — Separar ponía malos nombres y Pre-postulación quedaba descuadrada (1057922-28-LP26)
El corte de «Formularios.docx» estaba bien (10 anexos), pero los nombres no: «FORMULARIO Nº1A/Nº1B» salían los dos «Formulario 1» (+ «_2»), y los 7 «FORMULARIO N°2 ESPECIFICACIONES TÉCNICAS <producto>» salían «…Técnicas», «…Técnicas_2», «…Técnicas S»… (el nombre corto cortaba justo antes del producto). En Pre-postulación eso dejaba una casilla «Formulario 1 2» sobrante y ningún archivo se reconocía como 1A/1B.
**Arreglo:** `anexos-dividir.ts`: la letra pegada al número cuenta («Nº1A» → «Formulario 1-A»); `nombresDeArchivoDesdeTitulos` — si varios anexos comparten tipo y número, las palabras clave salen de lo que viene después de lo que tienen en común, sin distinguir tildes («Formulario 2 - Camilla Transporte», «Formato 2 - Natural/Jurídica»). `checklist-comercial.ts` (`RE_NUM_FORMATO`): «Formulario N°1A» del informe ahora se lee como 1-A, así el archivo «Formulario 1-A» cae en su casilla y no abre otra.
**Verificado:** banco de separación con nombres (`--fragmentos` ahora imprime el nombre) contra el commit anterior: corte igual en los 400; cambian 11 nombres, todos a mejor. Suite completa y tsc limpios.
**Regla del dueño (mismo día): «si los separo es porque se deben llenar» → cada anexo separado tiene su casilla en Pre-postulación.** `casillasDeAnexosSeparados` (checklist-comercial.ts): archivos de Separar (`documentos_generados_separar`) que comparten número y tienen títulos distintos → una casilla por archivo, clave `anexo:separado:<slug>` (copia descripción/criticidad de la casilla del informe, sin ponderación); la genérica del informe con ese número sale de las vigentes y `podarFilasObsoletas` la borra si está virgen. La regla 4 de `planDeReconciliacion` no funde casillas `anexo:separado:`; `limpiarCasillasDeArchivosMovidos` también las borra cuando su archivo se va. Un número con un solo archivo (1-A, 1-B, Anexo 1) sigue en su casilla de siempre. `POST /api/anexos/separar` ahora llama `sanarChecklistDeLicitacion` al terminar (antes la casilla aparecía solo si algo más resincronizaba).
**Hecho en vivo (local contra la BD del VPS, a pedido del dueño):** se borraron los 10 separados viejos (ids 32072-32081) y se volvió a separar «Formularios.docx» (31414): 10 archivos con nombre nuevo y Pre-postulación «Administrativo 0/10» = 1A, 1B, Anexo 1 (su PDF firmado sigue cargado) + 7 «Formulario 2 - <producto>»; la genérica «Formulario N°2» y la sobrante «Formulario 1 2» desaparecieron solas. Detalle: las 7 salen en orden alfabético, no por número de línea. Producción necesita desplegar.

## 2026-10-29 (noche, 4) — Anexo 4: «Neto» y «Con Iva» con el monto a la izquierda del rótulo (2827-102-LE26)
La tabla «Detalle | Valor» trae el pie «Valor total / Neto / Con Iva» con los rótulos EN la columna Valor y la celda de la izquierda vacía; `calcularTotalesAlPie` escribía el monto en esa celda vacía («20.547.687 | Neto»). Ahora, si el rótulo vive en la columna de valores y la única casilla vacía queda a su izquierda, el monto se agrega en la celda del propio rótulo («Neto 20.547.687»): `RellenoPie.anexar` + `dosPuntos` en `anexos-rellenar`. Los precios por línea (19.773.000 y 774.687) y los totales (20.547.687 / 24.451.748) no cambian.
**Efecto colateral revisado:** en 4 documentos más del corpus (980313-41, 3992-32, 1057049-376, 4777-28) el pie tenía una celda «$» en la columna de totales y el monto se escribía en una celda vacía de otra columna (p. ej. «Cantidad»); ahora cae en la celda «$» del total. Suite 1663/1663, tsc. Sin ver el PDF; pendiente comprobar en vivo tras desplegar. Los bordes gruesos de las filas de ítems que se ven en el PDF vienen de la plantilla, no del motor (no revisado).

## 2026-10-29 (noche, 3) — Hoja 2 con solo la raya de firma y el escudo (Anexo 1 de 2827-102-LE26)
El dueño lo vio en el PDF generado: tabla de firma vacía al pie de la hoja 1; raya + «Nombre y Firma» + nombre + escudo SOLOS en la hoja 2. Causa (XML del fragmento en producción): 8 párrafos vacíos entre la tabla de firma y la raya y 4 después (uno con el escudo anclado) calzan justo en Word, pero con las métricas del conversor a PDF desbordan. La vista previa de Separar ya marcaba «2 páginas» para ese anexo.
**Arreglo:** `compactarVaciosDeRelleno` (anexos-docx.ts) baja la altura (line=80 exacto, sin quitar párrafos) de los vacíos en un tramo ≥6 seguidos antes de una raya/leyenda de firma (deja 3 normales) y de un tramo final ≥3 antes del cierre del cuerpo. Se aplica al armar cada fragmento (`dividirPorFormularios`) y al final de `generarAnexoFinal`. Nunca toca texto, tablas, saltos de página/sección ni campos; idempotente.
**Verificado:** 400 .docx reales: toca 178, 0 XML rotos, 0 párrafos ni textos distintos; test nuevo; suite 1662/1662, tsc. **No se midió el PDF** (sin conversor local): comprobar en vivo tras desplegar — «Separar» debe decir 1 página para el Anexo 1 y el PDF generado no debe traer hoja 2. Los anexos YA separados no se arreglan solos: borrar y separar de nuevo. Pendiente aparte: la firma no queda dentro de la celda «Firma del(los) Representante(s)».

## 2026-10-29 (noche, 2) — Razón social vacía en el Anexo 1 de 2827-102-LE26 (visto en producción, licitank.cl)
Separación y vista previa OK en producción (6 anexos, 3 y 4 económicos). Al generar el Anexo 1 desde Pre-postulación, «Razón Social o nombre completo persona natural» salía SIN casilla resuelta: `RE_TIPO_DE_PERSONA_AL_FINAL` (normalizarEtiqueta) se comía la «o» de «complet[o]» al quitar «persona natural» y la etiqueta quedaba «…nombre complet». Arreglado en `anexos-determinista.ts` (la «o» tiene que ser palabra suelta) + test. **Falta desplegar**; hasta entonces producción deja la razón social a mano. Pre-postulación bloquea económico y técnico por 2 pendientes del equipo (1 causal de inadmisibilidad del certificado; «Revisar compromisos» 0 de 0): no se tocan. Anexo 1: el pie «___ Nombre y Firma del Proponente + nombre» cae en la página 2, aparte de la celda de firma (ya es 2 páginas en el original separado); sigue pendiente (ver entrada de la miniatura).

## 2026-10-29 (noche) — Banco contra lo que llenó el equipo: `scripts/anexos-banco-humano.mts`
Compara, por palabras, lo que el motor escribe sobre el anexo en blanco con lo que una persona escribió en el .docx que subió a Documentos propios (74 .docx, 50 con original que calza). Veredicto por inserción: IGUAL / PARECIDO / DISTINTO / FALTA / SOBRA; la lista FALTA agrupada por etiqueta es el trabajo pendiente del diccionario. Descarta los documentos anteriores al último cambio de la ficha de la empresa (Comercial MP cambió de representante el 26-oct: Lidia Valenzuela → Carolina Gonzalez; sin ese filtro todo parece error).
**Arreglado (general):** «LICITACIÓN PÚBLICA ID:» / «ID Nº» (5 formularios de 1180885-8-LP26 sin ID); «Osorno, ___ de 2026» (un solo blanco = día y mes); «Cédula Nacional Identidad N°» sin «de»; «…de la ciudad de ___» (ciudad de la empresa); comuna derivada de «…, Comuna Talagante» ya no repite «Comuna». Regresión: 400 .docx HEAD vs disco, 44 párrafos distintos, ninguno peor (varios "Ciudad y fecha ___" pasan a llenarse).
**Hallazgos sin arreglar:** (1) la CIUDAD de las fórmulas «En ___, a…» salía o no según la corrida porque comuna/dirección de la unidad compradora solo venían de la llamada LIVE a MP (429). **Arreglado (misma noche):** `anexos-datos.ts` guarda cada respuesta buena en la tabla `licitacion_unidad_cache` (se crea sola, sin migración, como anexos_feedback) y la usa cuando MP no responde; probado con ticket roto: sin copia → vacío, con copia → «Constitución». Una licitación se calienta la primera vez que MP responde bien; las demás siguen dependiendo de MP hasta entonces. (2) La fecha usa el cierre de la licitación, no hoy (por diseño): en documentos viejos sale «agosto». (3) SÍ/NO, certificados y «Nombre: Cargo: Teléfono:» del emisor de un certificado quedan al humano. (4) Dato de la ficha: Comercial MP guarda el email como ventas1@… y el banco como Mercado Pago; el equipo escribió ventas@… y Banco de Chile (cuenta 134426105) — confirmar cuál es el vigente. (5) Con tan pocos pares comparables (22 tras el filtro) la métrica es orientativa; mejorará al subir más .docx corregidos.

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

## 2026-10-30 — Separar: la línea «LUGAR … DE … DEL 2026.» cortaba un anexo falso; RUT/representante en blanco (2483-265-LE26)

- **Separar** (`ANEXOS_1.DOC` de Quilicura, 5 anexos): el dueño recibió 10 archivos, 5 «Anexo N» y 5 «QUILICURA_DE_DEL_2026» con una sola línea.
  Causa: cada anexo cierra con `FIRMA…` y debajo `QUILICURA……… DE……… DEL 2026.`; la octava forma de `anexos-dividir.ts`
  (título tras un cierre) la tomó por el título del anexo siguiente. Arreglo general: una línea con relleno de puntos/rayas
  (`RE_LINEA_CON_RELLENO`) nunca es título y sigue siendo cierre. Reproducido localmente convirtiendo el .DOC con Word (COM):
  ahora 5 cortes, cada uno de título a fecha, 1 hoja cada uno (el Anexo 5 sale en 2 hojas en Word por una línea: la nota «(*)»; en
  el original cabe, con margen inferior de 21 pt — no resuelto, el .docx original separado por el conversor VPS puede diferir).
  Banco de separación (400 .docx): solo cambian 2 documentos y los dos pierden cortes falsos en líneas «EN ____, A ____ DE ____ 2026.» / «FECHA____.».
  Test en `anexos-dividir.test.mts`. Los archivos mal separados siguen en la BD: hay que volver a separar y borrar los «QUILICURA_…».
- **Relleno del Anexo 1**: tabla MEZCLADA (filas «DOMICILIO : | COMUNA :» y filas de 1 celda «RUT :», «NOMBRE REPRESENTANTE LEGAL :»).
  `indicesFilaTituloMergeada` tomaba las de 1 celda por título y el RUT, el representante y su RUT salían en blanco aunque la ficha
  los tenía. Arreglo: una fila de 1 celda que EMPIEZA nombrando un dato (`RE_FILA_UNICA_ES_CAMPO`) es campo; «DATOS DEL PROPONENTE:» sigue título.
  Verificado generando el anexo real: RUT, representante y RUT del representante se llenan. Test en `anexos-deteccion.test.mts`.
  «OFERENTE:» (razón social): era la primera fila de esa tabla, dentro de un cuadro flotante anclado en el párrafo «El arriba firmante
  declara bajo juramento:». `listarParrafos` (regex no-greedy) cortaba el ancla en el `</w:p>` de adentro y la etiqueta quedaba pegada
  a la oración. Arreglo: `Parrafo.textoCuadro` (texto del cuadro cuando el ancla trae texto propio antes) y `detectarCamposConDosPuntos`
  lo usa como etiqueta; `RE_FILA_UNICA_ES_CAMPO` también acepta «OFERENTE:»/«PROPONENTE:» a secas. Los índices de párrafo no cambian.
  Verificado generando el anexo real: sale «OFERENTE: Comercial MP SpA». Test en `anexos-deteccion.test.mts` (suite 1677/1677).
- **Anexo 4 (Programa de Integridad) y Anexo 3 (económico) de 2483-265-LE26** (ojo: el negocio 1598 tiene asignada la empresa 1, Inversiones Claro ARZ SPA):
  · Placeholders SUBRAYADOS en la oración («Yo, _nombre de representante legal o persona natural_, cédula N° _RUT_ _representante legal…_»)
    no se detectaban. `marcarPlaceholdersSubrayados` (anexos-docx.ts, corre dentro de `unificarRunsDeMarcadores`, o sea en las 3 rutas) los
    traduce a `<…>`, que el diccionario de marcadores ya resuelve. Solo si el tramo empieza por un nombre de campo y hay texto normal antes
    en el párrafo (un título subrayado no cuenta); runs subrayados separados por espacios = uno solo. «para la licitación pública para la ___»
    → nombre de la licitación (regla nueva en REGLAS_PREVIAS). Queda un « ” » de cierre suelto tras el nombre (el original trae solo la comilla de cierre).
  · Económico sin precio unitario («Cantidad | DESCRIPCIÓN | MONTO TOTAL NETO | MONTO TOTAL IVA INCLUIDO»): `calcularMontosTotalesPorLineaSinUnitario`
    (anexos-totales-seccion.ts) = cantidad × costeo, con IVA = ×(1+IVA%); una fila y un ítem se emparejan directo, con varios solo por
    parecido de descripción ≥0,6. «NOMBRE:» pelado junto a «RUT N°» pelado sin más señal = razón social (`resolverPeladaPorBloque`, regla 4).
    Verificado generando: neto 29.302.521 / con IVA 34.870.000.
  · Segunda vuelta del mismo económico (captura del dueño): «RUT N°» (sin dos puntos, en una celda) se emparejaba con el vacío de DEBAJO de la tabla
    y el RUT caía lejos de su celda → patrón 1 ya no empareja una etiqueta de celda con un vacío fuera de su tabla, y `RE_RUT_CON_NUMERO_AL_FINAL`
    hace de «RUT N°» un campo que se completa en su celda. «PLAZO DE ENTREGA ⇥ DÍAS HABILES» / «GARANTÍA …   MESES»: el hueco es tabulador o tira de
    espacios, no raya, así que no había casilla ni se podía escribir a mano → `marcarHuecosDeUnidad` (anexos-docx.ts, junto a `unificarRunsDeMarcadores`)
    lo vuelve «________». Pendiente por diseño: plazo y garantía los pone el equipo (ahora con casilla en su línea).
- Separar nunca devuelve PDF salvo un PDF ESCANEADO (se recorta el original) — la separación por título/firma es la que sirve; por página no se puede
  en Word sin maquetarlo.
