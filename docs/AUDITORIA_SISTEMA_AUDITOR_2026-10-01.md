# AUDITORÍA DEL SISTEMA AUDITOR — paquete de 7 documentos
## Licitank · 1-oct-2026 · Auditoría de consistencia, flujo y trazabilidad

**Documentos auditados:** `ESPECIFICACION_AUDITOR_v1` (v1.1) · `NOTA_PROGRAMADOR_Unificacion_AUDITOR` · `PROMPT_4_Verificador_Tecnico_v2_0` · `PROMPT_4_Comparador_Tecnico_v3_0` · `PROMPT_5_Verificador_Costo_v2_0` · `PROMPT_6_Lector_Respaldos_v1_0` · `RESERVA_PREPOSTULACION_Bloque_TecAdm_y_Certificado`.
Citas: **ESP** = Especificación · **NOTA** = Nota al programador · **P4v2 / P4v3 / P5 / P6** = prompts · **RES** = Reserva.

**Qué NO pude verificar** (se citan pero no vinieron en el paquete): Especificación de Precompra v1, Módulo de Compras v2, `TABLA_DE_COSTEO_V3`, `CONTEXTO_Auditor_Tecnico_Revision.md`, Prompt 4 v1.1 y Prompt 5 v1.2, el informe de la 759-21-LE26. Todo lo que dependa de ellos queda marcado «no verificable».

**Método:** no revisé redacción; busqué contradicciones, funciones huérfanas, estados sin entrada o salida, datos sin dueño y decisiones sin evidencia. Donde corresponde, contrasté con lo que el sistema real hace hoy (sección 9), incluyendo **desvíos que introduje yo mismo** respecto de la especificación.

---

## 1. VEREDICTO

**El paquete NO está listo para usarse como fuente única de verdad.** El diseño base (opción, Lector, dos verificadores, cuadro por código, firma/aprobación) es sólido y coherente **hasta la aprobación de la opción**. Pero:

1. **El Prompt 4 v3.0 (30-sep) rompe el resto del paquete**: ninguno de los otros 6 documentos lo conoce, y elimina o duplica funciones de las que dependen la Especificación, el Prompt 5, la Reserva y la Nota (sección 4).
2. **Hay al menos 8 reglas contradictorias entre documentos** (IVA, despacho, mensaje al proveedor, granularidad, resumen, etc.; sección 5).
3. **Después de la aprobación el diseño no existe**: no hay definición de la OFERTA final, de los anexos, de su origen de datos ni de qué pasa si algo cambia tras generar un documento (sección 7). Es justo donde nace el riesgo de error de transcripción.

### Cobertura de los 18 objetivos

| # | Objetivo | Estado | Dónde falla / se sostiene |
|---|---|---|---|
| 1 | Flujo correctamente diseñado | 🟡 | Estados intermedios sin definir (ESP P-1, P-2); v3 no integrado |
| 2 | Sabe qué hacer en cada etapa | 🟡 | Se describe qué hace el sistema, no «cuál es el siguiente paso» por línea (sección 8.2) |
| 3 | Sabe qué necesita antes de continuar | 🟡 | Hay bloqueos, pero no precondiciones por etapa ni por anexo (sección 8.2) |
| 4 | Prompts y `.md` consistentes | ❌ | Sección 5 |
| 5 | Sin instrucciones contradictorias | ❌ | Sección 5 (incluye una contradicción **dentro** de P4v3) |
| 6 | Sin etapas faltantes | ❌ | Oferta final, anexos, cambio posterior, reapertura, servicios (sección 7) |
| 7 | Sin decisiones sin evidencia | 🟡 | «Lo confirmo» sin respaldo, adjetivos ✅ automáticos, IVA supuesto, compromisos «no cuantificado» |
| 8 | Cotizaciones integradas | 🟡 | Falta la cotización multi-producto/multi-línea y la cotización nueva sobre opción firmada |
| 9 | Producto/servicio bien identificado | 🟡 | Marca/modelo/SKU sí; sin regla de equivalencia de modelos; **no existe «servicio»** |
| 10 | Aprobado → oferta, anexos, documentación | ❌ | No hay entidad OFERTA ni mapeo a anexos |
| 11 | Documentos usan información validada | ❌ | Los anexos no leen un dato congelado ni versionado |
| 12 | Evita errores de transcripción | 🟡 | El cuadro por código sí; la parte final no |
| 13 | Trazabilidad completa | 🟡 | Se corta en dos puntos (sección 6) |
| 14 | Guiar paso a paso sin perder contexto | ❌ | No hay «estado derivado de la línea» ni «siguiente acción» |
| 15 | Detecta cuándo NO continuar | 🟡 | Bloqueos de producto/costo sí; bases modificadas, licitación vencida o estado terminal no |
| 16 | Detecta faltante/contradictorio/dudoso | ✅🟡 | Fuerte en producto y costo; débil frente a cambios en las bases |
| 17 | Distingue oficial / cotización / búsqueda / inferencia | 🟡 | P4v2 lo hace muy bien (origen del dato); **P4v3 lo pierde** |
| 18 | Fuente única de verdad del producto ofertado | ❌ | El precio nace en tres lugares; no hay snapshot de la oferta |

---

## 2. HALLAZGOS CRÍTICOS (bloquean uso real)

### C-1 · P4 v3.0 no está integrado: el paquete tiene dos «Prompt 4» vigentes a la vez
- **Dónde:** NOTA §4 marca P4v2 como *Vigente*; ESP §13 describe 12 ajustes (T1–T12) «incorporados en v2.0»; P4v3 (30-sep) dice reemplazar a v2 en esta etapa pero **no actualiza ningún otro documento**.
- **Escenario de falla:** un programador implementa lo que dice la NOTA (L0 → L1-T por opción → L0-D → L2) y otro lo que dice P4v3 (una llamada por línea con documentos crudos). Los dos cumplen «la documentación».
- **Corrección:** declarar por escrito qué reemplaza a qué. La matriz de la sección 4 propone el destino de cada función.

### C-2 · v3.0 elimina controles de seguridad que el paquete exige en otros documentos
Orden de gravedad:
1. **Segunda pasada de rojos** (P4v2 Parte IX; ESP §11.2): la RES dice que el certificado de admisibilidad «debe **consumir** la segunda pasada». Con v3 **nada la produce**. El certificado quedaría sin la verificación que lo sostiene. P4v2 Parte I lo dice textual: *«Un CUMPLE falso es el error más caro del sistema»*.
2. **Criticidad (INADMISIBLE/PUNTAJE/COMPROMISO) y «criticidad sospechosa»**: v3 trata todas las filas igual. Un ❓ en un requisito inadmisible y uno en un requisito de puntaje se ven y se cierran igual.
3. **Compromisos con costo → costos asociados** (ESP §8.3, P4v2 Parte VIII, NOTA §5.6): v3 no los detecta. El precio de venta se fija **antes** de saber que hay capacitación, instalación o despacho que costear. Ejemplo real de la prueba: línea 13 dice *«con servicio de instalación incluido»*; v3 lo evalúa como un requisito más (✅/❓) y **no agrega su costo**, así que el «costo de la mejor opción» queda subestimado.
4. **`complemento_requerido`** (P4v2 T10): P5 entrada C y V1/V5 dependen de este evento. Con v3 es una entrada huérfana: un accesorio exigido y no costeado ya no se detecta.
5. **Emparejamiento TÉCNICO por confirmar, deducción documentada y búsqueda dirigida (L0-D)**: desaparecen. v3 solo dice «busca en TODO el documento».

### C-3 · «Lo confirmo» (v3) contradice las reglas de habilitación
- **v3 nota al programador:** el asistente cierra un ❓ con un clic **sin respaldo**.
- **P4v2 Parte VI:** *«El asistente NUNCA declara sin respaldo»*; origen DECLARADO/CONFIRMACION_INFORMAL **siempre requiere EM**, sea cual sea la criticidad. **ESP §7** lo repite.
- **Escenario:** un ❓ de una exigencia inadmisible se cierra con un clic, sin EM y sin documento; el certificado lo da por cumplido; la oferta sale y se declara inadmisible. Es exactamente el riesgo que P4v2 existe para evitar.
- **Corrección:** el clic solo para filas no inadmisibles; para las inadmisibles, flujo DECLARADO (respaldo + EM).

### C-4 · No existe la «fuente única de verdad» de lo que se oferta
- **El precio nace en tres lugares:** el Lector (P6 bloque C), P4v3 Paso 3 (extrae y normaliza precio e IVA) y P5 V4. La NOTA §3.2 promete «una sola versión del dato»; P4v3 la rompe. Si difieren, solo se dice «manda el código» sin decir **de cuál fuente**.
- **No hay entidad OFERTA.** NOTA §6 lista Opción, Respaldo, Extracción, Verificaciones, Costo asociado, Evento, Pregunta, Proveedor. Faltan **Requisito (con ID estable)**, **Empresa postulante**, **Oferta (snapshot congelado)** y **Documento generado (anexo)**. Sin ellas, los anexos «saben» lo que el costeo o el manifiesto tengan hoy, no lo que se aprobó.
- Propuesta en la sección 8.

### C-5 · Cambio después de aprobar: la regla existe, pero no sus consecuencias
- ESP §4.2: cambia producto o precio de una opción firmada/aprobada → vuelve a VERIFICADA y se repite la aprobación.
- **Ningún documento dice qué pasa con lo ya generado a partir de esa opción** (anexo económico, técnico, certificado, compromisos confirmados). Quedan **obsoletos sin que nada lo marque**.
- Tampoco existe el camino «iniciar un cambio» desde APROBADA: la regla se activa «si cambia», pero no hay acción que lo haga cambiar. Estado sin salida (ver sección 6).

### C-6 · El precio se compara contra un presupuesto con una métrica que no es el margen
- P4v3 Paso 5: ✅ si «la diferencia es **20% o más del presupuesto**».
- P5: `margen_minimo` 20% **sobre la venta** (regla dura) y P5 Parte IX compara «espacio de maniobra» (**% sobre el costo**, p. ej. «32,7%») contra ese 20%.
- Mezcla tres cosas: holgura sobre presupuesto, *markup* sobre costo y margen sobre venta. 20% de markup equivale a 16,7% de margen.
- **Escenario:** costo = 80% del presupuesto → v3 muestra ✅. Pero nadie gana vendiendo al 100% del presupuesto; vendiendo al precio de mercado público (más bajo) el margen real queda bajo el 20% y v3 igual dice ✅.
- **Corrección:** una sola fórmula de margen (la del costeo digital) y que el semáforo use el **precio de venta esperado**, no el presupuesto.

---

## 3. HALLAZGOS ALTOS

| ID | Hallazgo | Evidencia | Escenario / corrección |
|---|---|---|---|
| **A-1** | **Regla de IVA contradictoria (3 versiones)** | P4v3 Paso 3: web chilena ⇒ con IVA (÷1,19); sin saber ⇒ «tal cual + IVA sin confirmar». P5 Parte I y V3: *«PROHIBIDO suponer… IVA_NO_DECLARADO»*. ESP §5: «IVA no declarado en el link → se informa». P5 Parte VIII no aclara si IVA_NO_DECLARADO bloquea | Mismo documento, tres tratamientos. Costo ±19%. Definir **una** regla y dónde vive (código) |
| **A-2** | **Despacho/instalación: tres tratamientos** | P4v3: «anótalo en la nota, no lo sumes». P5 V5: costo oculto que **bloquea** si real > costeado. P5 V10-c: «costo puesto en bodega» incluye despacho. ESP §9: fila de costo = unitario neto, «nada más» | La «más barata» por neto unitario puede ser la más cara puesta en bodega. Decidir si el costo comparado incluye despacho/instalación |
| **A-3** | **Mensaje al proveedor: ESP vs v3** | ESP §10: un mensaje con técnicas + **comerciales** + **datos faltantes del proveedor (OBUMA)**. P4v3 Paso 4: solo técnicas, máx. 3, y *«nunca por IVA, vigencia, stock ni datos de la empresa»* | Los datos para crear al proveedor en OBUMA (ESP §12.5, P5 V11) quedan sin canal de solicitud: V11 «solo alerta» y nadie los pide |
| **A-4** | **Granularidad de la llamada** | ESP/NOTA/P4v2/P5: **por opción** («una matriz por opción»). P4v3: **por línea** (compara todas las opciones juntas) | Cada documento nuevo re-evalúa toda la línea. En la prueba real: 168 s la línea completa vs 54 s una sola opción. Si el diseño es por línea, el modelo de datos de la NOTA §6 («verificación: id · opción») no calza |
| **A-5** | **v3 hace de nuevo la asignación masiva documento → línea** | P4v3 Paso 1 asigna documentos a líneas. P4v2 Parte III: *«No hay asignación masiva ficha ↔ línea: la opción la define»*; NOTA §2: el enlace manual es donde nace *«aprobar técnicamente un modelo y costear otro»* | Dos asignadores (el de v3 y el del código/Lector) pueden discrepar; no se define cuál manda |
| **A-6** | **Filas del cuadro: las hace el modelo (v3) o el código (ESP)** | ESP §9: filas = requisitos heredados, «lo arma el código… ninguna fila se omita, se agrupe ni se infiera». P4v3 Paso 2: el modelo parte la descripción por comas y «y» | La prueba del propio P4v3 (líneas pegadas como texto) no ejercita el camino de producción (requisitos de Fase 2 con ID). Además v3 **se contradice**: separa en «y» (Paso 2) y luego trata «Conectividad HDMI y USB» como **una** fila (reglas de no inventar incumplimientos) |
| **A-7** | **Requisito sin ID estable** | P4v2/P4v3 usan `n` (posición). ESP P-9 reconoce la dependencia de Fase 2 pero no el riesgo de re-numeración | Si Fase 2 se re-corre o cambia el foro, `n` se corre: verificaciones, confirmaciones y celdas quedan pegadas al requisito equivocado |
| **A-8** | **v3 ignora foro, criterios y cronograma** | P4v2 entradas E, F, G. P4v3 no los recibe | Evalúa contra texto base que el foro pudo modificar («las respuestas del foro mandan sobre el texto original», P4v2 Parte I). No hay noción de «versión de las bases» en ninguna verificación guardada |
| **A-9** | **Sin «servicio» como tipo de opción** | Todo el paquete asume producto con ficha | Licitaciones mixtas (línea 13: «con servicio de instalación»; líneas de solo servicio) no tienen camino: sin ficha, sin marca/modelo, evidencia distinta (experiencia, certificaciones) |
| **A-10** | **Dos aprobaciones sobre un solo estado** | ESP §4.2: APROBADA = «la aprobó el EM (y el precio de venta, CA o el EM)» | Producto y precio son aprobaciones independientes con quienes distintos; un estado único no puede representar «producto aprobado, precio pendiente» |
| **A-11** | **ESP §16 «toda la salida del AUDITOR nunca llega al portal» vs §8.4** | El precio de venta se fija en el AUDITOR y va en el anexo económico | Hay que acotar: *costos, márgenes y comparaciones no salen; precio de venta e identidad del producto sí*. Y los generadores de anexos deben tener una lista blanca de campos |
| **A-12** | **Compromisos «no cuantificado» sin dueño de la decisión** | P4v2 Parte VIII / RES: «cuantifica solo lo que exige la base». Pero un criterio que da puntaje por más meses de garantía (caso real 759-21-LE26, Anexo 5) **no** exige una cantidad | Nadie define quién decide cuántos meses ofertar ni dónde se anota; el anexo 5 queda con un campo sin origen. RES: «un check bloquea», pero no hay campo donde escribir el valor |

---

## 4. MATRIZ v2.0 → v3.0: qué función se perdió y quién la cubre

| Función en P4v2 / ESP | ¿Está en v3? | ¿Quién la cubre hoy? | Acción propuesta |
|---|---|---|---|
| Entrada = extracción del Lector (ESP §3.1) | ❌ (documentos crudos) | — | Decidir: v3 puede leer crudo **solo** si el Lector sigue siendo la única fuente de precio/IVA (C-4) |
| Veredicto de fila / bloqueos / habilitaciones por código | ✅ (por código) | Código | Mantener |
| 4 estados por celda | ✅ (✅🟩❌❓) | — | Mapear: CUMPLE_CON_COMPLEMENTO no existe en v3 |
| Origen del dato (FICHA, FICHA_WEB, INFORMAL, DECLARADO…) | ❌ | — | Reponer como campo de la celda (sirve a C-3 y a ESP §7) |
| Criticidad + sospechosa | ❌ | Código puede traerla de Fase 2 | Código: marcar 🔴 por criticidad heredada; sospechosa por código |
| Segunda pasada de rojos | ❌ | **Nadie** | Reponer **solo para INADMISIBLE**, en la pasada final (reutiliza P4v2 Parte IX) |
| Búsqueda dirigida (L0-D) | ❌ | **Nadie** | Opcional; v3 ya pide barrer todo el documento. Si hay OCR (hallazgo I-7), reponer |
| `compromiso_con_costo` | ❌ | RES / Pre-postulación (más tarde) | **Mover antes de fijar precio** o aceptar el desfase por escrito |
| `complemento_requerido` | ❌ | **Nadie** | Reponer (P5 lo espera) |
| `ruta_insalvable`, `sobredimensionamiento` | ❌ | **Nadie** | Reponer como reglas de código sobre celdas |
| Letra vs mérito técnico + pregunta al foro | ❌ | **Nadie** | Reponer solo para filas 🔴 |
| Suma de tolerancias en peor caso (±% ±dígitos) | ❌ | **Nadie** | Reponer en el bloque de números |
| Mensaje por proveedor (técnico + comercial + OBUMA) | ❌ (solo 3 técnicas) | Código arma | Decidir A-3 |
| Foro, criterios, cronograma | ❌ | **Nadie** | Reponer entradas E, F, G |
| Preguntas por ítem con 5 campos de ayuda | ❌ (por diseño: «nada de diagnósticos») | — | Decisión CA 30-09 válida; documentarla como cambio de producto, no como omisión |

---

## 5. CONTRADICCIONES ENTRE DOCUMENTOS (tabla de reglas)

| # | Regla | Dice un documento | Dice otro | Propuesta |
|---|---|---|---|---|
| R-1 | IVA no declarado | P4v3: supone según origen (web = con IVA) | P5: prohibido suponer; ESP §5: «se informa» | Una regla, en código |
| R-2 | Despacho | P4v3: no suma | P5 V5/V10-c: lo incluye o bloquea | Una definición de «costo comparado» |
| R-3 | Mensaje al proveedor | ESP §10: técnico + comercial + datos OBUMA | P4v3: solo técnico, máx. 3 | Definir los 2 mensajes (bloqueante vs. administrativo) |
| R-4 | Unidad de trabajo | ESP/NOTA/P4v2/P5: opción | P4v3: línea | Ver A-4 |
| R-5 | Quién arma las filas del cuadro | ESP §9: código | P4v3 Paso 2: modelo | Código (requisitos de Fase 2) |
| R-6 | «Resumen» | P4v3 Paso 5 (costo vs presupuesto) | P5 Parte IX / C3 (posición de precio, 4 niveles) | Cuál manda y cuándo se ve cada uno |
| R-7 | Declarar sin respaldo | P4v3: «Lo confirmo» sin respaldo | P4v2 / ESP §7: respaldo + EM | C-3 |
| R-8 | Qué sale al portal | ESP §16: «toda la salida del AUDITOR» no sale | ESP §8.4: precio de venta va en la oferta | A-11 |
| R-9 | Dónde se audita el costo | P4v3 cabecera: «la auditoría profunda del costo pasa a Precompra» | P5 v2.0 *vigente*: V1–V11 bloquean la firma en el AUDITOR | Decidir qué queda en el AUDITOR (código sí, IA como alerta) |
| R-10 | Mínimo/«sin link» | ESP §5 (vía liviana): «sin link no se registra costo» | ESP §4.2: se puede pasar TANTEO → FORMALIZADA sin link; flujo real: cotización primero | Reescribir §5 y §4.2 con «respaldo = link **o** documento» |
| R-11 | Fórmula Ruta B | P5 Parte V: `FOB × (dólar+10) × 1,06 × 1,3 × 1,19` y luego «normalizar a neto» | — | Dividir por 1,19 anula el factor: definir si el costeo guarda costo con o sin IVA, y explicar 1,06 y 1,3 (hoy son constantes sin significado documentado) |
| R-12 | Espacio de maniobra | P5 Parte IX: «% sobre costo» | P5 `margen_minimo`: % sobre venta | Una fórmula |
| R-13 | Anexos | ESP §2: **todos** los anexos esperan a lo técnico y económico | Realidad: los administrativos no dependen de ello | Documentar el candado parcial (la decisión ya se tomó en el sistema) |
| R-14 | Terminología | «asistente» = el operador humano en todos los docs | «asistente» = la IA en esta auditoría | Glosario |

---

## 6. ESTADOS, ENTRADAS Y SALIDAS

### 6.1 Estados de licitación
`ASIGNADOS → EN PROCESO → PRE-POSTULACIÓN → POSTULADO` (ESP §2).
- **Sin definir:** ANEXOS OK y VISADO (ESP P-1, NOTA §13-1). El pipeline real tiene además POSIBLE_ADJ, ADJUDICADA, PERDIDA, DESCARTADA, REVOCADA, DESIERTA.
- **Sin criterio de salida:** EN PROCESO → PRE-POSTULACIÓN solo dice «se puede con algunas líneas» (§11.4). PRE-POSTULACIÓN → POSTULADO **no se describe** (¿qué condición? ¿quién lo cambia? ¿se congela?).
- **Sin guardia de estado terminal:** nada impide trabajar o aprobar una licitación vencida, descartada o perdida (la bandeja de aprobaciones real listaba negocios DESCARTADA/PERDIDA con «Aprobar» activo).

### 6.2 Estados de la opción (ESP §4.2)
| Estado | Entrada definida | Salida definida | Problema |
|---|---|---|---|
| TANTEO | «tiene un link con precio» | → FORMALIZADA | Una cotización sin link no entra |
| FORMALIZADA, VERIFICADA | sí | sí | — |
| DEFINITIVA | firma | → EN APROBACIÓN | Solo una por línea: no hay división de una línea entre dos productos (A-9 relacionado) |
| EN APROBACIÓN | solicitud + pasada final | APROBAR / MODIFICAR / RECHAZAR | Sin dueño, sin plazo ni escalamiento |
| APROBADA | EM (+ precio) | **ninguna** (solo «si cambia, vuelve a VERIFICADA») | **Sin acción que inicie el cambio** (C-5) |
| DESCARTADA | «desde cualquier estado» o `ruta_insalvable` | **ninguna en ESP** (P4v2 §0.3 dice «el asistente puede reabrirla», ESP no) | Contradicción menor ESP vs P4v2 |
| *(pausa por `producto_cambiado`)* | evento | «el asistente decide» | **No es un estado**: no se sabe qué ve el usuario mientras tanto |

### 6.3 Etapas sin entrada ni salida declaradas
- **Cotización multi-producto de un proveedor** (un PDF con ítems de varias líneas): ESP §4.1 supone «documento dentro de la opción». La realidad (la 759-21-LE26 tiene cotizaciones de 9 ítems) exige reparto por línea con regla y bitácora; solo P4v3 lo toca.
- **Cotización nueva sobre una opción ya firmada:** no se especifica (ESP §4.2 dice que vuelve a VERIFICADA; el costo «no se sobrescribe»).
- **Cambio de vía liviana ↔ completa** después de verificar: sin regla.

### 6.4 Trazabilidad requisito → oferta: dónde se corta
`Requisito (Fase 2)` → `Fila` → `Opción` → `Respaldo/Extracción (cita)` → `Verificación (versión de prompt)` → `Firma/Aprobación` ⇢ **corte 1** ⇢ `Oferta` ⇢ **corte 2** ⇢ `Anexo/PDF`.
- **Corte 1:** no existe la OFERTA como objeto versionado.
- **Corte 2:** el anexo no guarda de qué versión de oferta ni de qué datos de empresa salió.
- **Debilidad intermedia:** el requisito no tiene ID estable (A-7), la verificación no guarda *qué extracciones* la alimentaron ni *qué versión de las bases*, y «Lo confirmo» no deja fuente.

---

## 7. ETAPAS FALTANTES (Objetivo 6, 10, 11)
1. **OFERTA FINAL** (por línea y total): producto, cantidad, unidad, precio de venta, plazo ofertado, garantía ofertada. Hoy esos datos están repartidos entre costeo, opciones, compromisos y el informe.
2. **Diccionario de campos de anexo**: para cada anexo (identificación del oferente, económico, técnico, declaraciones juradas), de dónde sale **cada** campo y qué pasa si falta (vacío, nunca inventado). Hoy el paquete no define el origen de ningún campo de anexo.
3. **EMPRESA POSTULANTE**: razón social, RUT, representante, poderes, firma. No existe como entidad en los 7 documentos.
4. **Control de coherencia anexo ↔ oferta**: al generar o antes de subir, comparar lo impreso con la OFERTA.
5. **Invalidación**: cuando cambia la OFERTA, marcar los anexos como OBSOLETOS.
6. **Reapertura / cambio controlado** de una opción aprobada.
7. **Servicios** como tipo de opción.

---

## 8. PROPUESTAS DE DISEÑO

### 8.1 Fuente única de verdad: `OFERTA_LINEA` (snapshot)
Se crea al firmar (DEFINITIVA), se versiona al aprobar y se re-versiona ante cualquier cambio.
```
OFERTA_LINEA { oferta_id, version, licitacion, linea, opcion_id,
  marca, modelo, sku, proveedor_rut, cantidad, unidad,        ← de la licitación y la opción
  precio_venta_unit_neto, plazo_ofertado, garantia_ofertada_meses,
  estado_aprobacion_producto, estado_aprobacion_precio, aprobada_por/at,
  bases_version, extracciones_usadas[], verificaciones_usadas[] }
EMPRESA_POSTULANTE { empresa_id, version, datos…, firma }
ANEXO_GENERADO { anexo_id, tipo, oferta_version[], empresa_version, archivo, hash, estado: VIGENTE|OBSOLETO }
```
Reglas: (a) los anexos leen **solo** estas tablas; (b) ningún costo, margen ni comparación entra en el generador (lista blanca de campos, A-11); (c) si `oferta.version` cambia, los anexos dependientes pasan a OBSOLETO y el candado de PRE-POSTULACIÓN se reabre; (d) un campo sin origen queda vacío con aviso, nunca se completa.

### 8.2 Contrato de etapas (lo que falta para guiar paso a paso)
Estado derivado de cada línea, con **una** acción siguiente:

| Estado de la línea | Siguiente acción | Condición de salida |
|---|---|---|
| SIN_OPCION | Subir cotización, o link, o ficha | ≥ 1 opción con documento leído |
| CON_DOCS_SIN_COMPARAR | Comparar | Comparación corrida |
| COMPARADA_CON_PENDIENTES | Resolver ❌/❓ (preguntar, ficha, EM) | Ninguna fila inadmisible abierta |
| LISTA_PARA_FIRMAR | Firmar | Sin bloqueos de costo ni técnicos |
| FIRMADA → EN_APROBACION → APROBADA | Pasada final, EM, precio | Doble aprobación (producto y precio) |
| NO_OFERTADA | — | Motivo registrado |

Para cada anexo, lo mismo: **precondiciones** (qué aprobaciones y datos necesita) y **salida** (archivo + versión).

### 8.3 Glosario y roles (unificar)
- **Operador** (humano que cotiza; hoy «asistente») ≠ **IA**.
- **EM** = Encargado de Mercado Público (definido en P4v2). **CA**: no se define en ningún documento; **asesor** (aprobador del sistema antiguo) y **jefe de ventas/admin** no se mapean a EM/CA. Hay que fijar la matriz rol → permiso.
- **Proveedor** = quien vende y cobra; **fabricante** = marca; **oferente** = nuestra empresa postulante; **distribuidor/revendedor** = tipos de emisor. P6 y OBUMA ya distinguen; falta el término «oferente» y su entidad.

---

## 9. LO QUE VERIFIQUÉ EN EL SISTEMA REAL (evidencia y desvíos)

**Hallazgos del sistema que confirman problemas del diseño:**
- **I-1** El costeo digital exige un link por ítem cotizado. En el costeo de prueba guardado (4993-70-LR26) quedó un link `ww.c.cl`: la obligación incentiva datos de relleno (R-10).
- **I-2** La detección de compromisos con costo del comparador anterior creó **52 «compromisos»** que eran **5 distintos** repetidos (la NOTA dice «sin duplicar» pero no define la clave de identidad). Se limpiaron por similitud.
- **I-3** Coexisten **dos sistemas de aprobación** (bandeja `/aprobaciones` por «asesor» y firma/aprobación del Auditor). Ni ESP ni NOTA mencionan el sistema antiguo (qué pasa con él). La bandeja listaba negocios descartados y perdidos.
- **I-4** Tras pasar al comparador v3, la opción **ya aprobada** quedó con su cuadro técnico vacío (los resultados v2 seguían guardados): faltó una regla de migración de datos entre versiones de prompt.
- **I-5** Se perdieron dos acciones del servidor (`crear_opcion`, `agregar_ficha`) sin que nada fallara; subir fichas devolvía «acción desconocida». **No hay pruebas de contrato de la API** (ESP/NOTA nombran la suite de regresión H-19 solo para prompts). Un error de orden de hooks en la pantalla llegó a producción sin que `tsc` ni las pruebas lo vieran.
- **I-6** Los anexos, los compromisos y el checklist leen de tablas distintas (checklist, costeo, auditor_*, empresas). El «Resumen del Auditor» recién agregado calcula el margen desde el costeo, no desde una oferta congelada (C-4): si el costeo cambia, el resumen cambia sin que ninguna aprobación lo respalde.
- **I-7** P4/P6 afirman que los motores «leen imágenes» y que la imagen es evidencia; el sistema convierte a texto por OCR (GLM-OCR + Tesseract). El OCR perdió precios en una lista de precios real (Climatización Rancagua); hubo que agregar «Volver a leer» con doble OCR. La regla C3 de P4v2 («el resultado no puede depender de si el motor ve o no ve») **no se puede cumplir** con OCR.

**Desvíos que yo introduje respecto de la especificación** (requieren decisión explícita de CA, o revertirse):
| # | Desvío | Regla vulnerada |
|---|---|---|
| D-1 | **Precio manual sin documento** (queda en TANTEO, no firmable) | P5 §VI «DECLARADO — NO SE ACEPTA: SIN_RESPALDO»; ESP §8.2 «Costo: solo número, con respaldo» |
| D-2 | **«Sí cumple…»** permite cerrar un ❌ con un motivo escrito, sin rol EM | P4v2 / ESP §7: CONTRADICE_FICHA y DECLARADO exigen EM |
| D-3 | Resultados v2 (legado) y v3 se marcan `reverificado = true` automáticamente | ESP §11.2 y RES: la segunda pasada debe correr; ahora el certificado la da por hecha |
| D-4 | Cotización nueva de un producto con opción firmada/aprobada crea **otra opción** | ESP §4.2: la misma opción vuelve a VERIFICADA y se repite la aprobación |
| D-5 | La IA asigna productos «sin línea» a una línea con confianza alta, sin confirmación | No existe en ESP; queda bitácora (`asignacion_ia`) y es reversible |
| D-6 | El candado de PRE-POSTULACIÓN bloquea solo los anexos económico y técnico | ESP §2 / RES: todos los anexos (el usuario lo decidió; falta documentarlo) |
| D-7 | Pestaña «Postulación» muestra costos y margen junto a los PDF a subir | ESP §16: riesgo de mezcla de salida del AUDITOR con lo que sale al portal (los PDF no contienen costos; confirmar con lista blanca) |

---

## 10. PLAN DE CORRECCIÓN (priorizado)

**P0 — antes de usar en licitaciones reales**
1. Resolver C-1: declarar en la NOTA y la ESP el estado de P4v3 y la matriz de la sección 4.
2. C-3: «Lo confirmo» y «Sí cumple» **no** aplican a filas INADMISIBLE sin EM (revertir/limitar D-2).
3. C-2.1: reponer la **segunda pasada solo para INADMISIBLE** en la pasada final (revertir D-3).
4. A-1 y A-2: una regla de IVA y una definición de «costo comparado».
5. C-4: crear `OFERTA_LINEA` y `EMPRESA_POSTULANTE`; que los anexos lean solo eso.

**P1**
6. A-7 / A-8: ID estable de requisito y versión de bases en cada verificación (invalida la verificación si cambia).
7. C-2.3 / A-12: detectar compromisos con costo **antes** de fijar el precio, y un campo explícito para el valor ofertado cuando «no cuantificado».
8. C-5: acción «Cambiar producto/precio» desde APROBADA y regla de OBSOLETO para los anexos.
9. A-3: definir los dos mensajes al proveedor (bloqueante y administrativo).
10. Glosario y matriz de roles (R-14, 8.3).

**P2**
11. A-9 servicios; división de una línea entre dos opciones; cotización multi-producto.
12. Diccionario de campos de anexo con su origen (sección 7-2).
13. Pruebas de contrato de la API y suite de regresión con los casos fijos (LS-150, Karcher HDS 8/18-4 C y la 759-21-LE26).
14. C-6 / R-12: una fórmula de margen y semáforo contra precio esperado.

---

## 11. DECISIONES QUE NECESITO DE CA

1. ¿El comparador v3 **reemplaza** a v2 en EN PROCESO, o convive (v3 rápido + gate de rojos al aprobar)?
2. **Regla de IVA** única (¿la web se supone con IVA? ¿una cotización sin IVA declarado bloquea?).
3. ¿Quién puede cerrar un ❓ y un ❌ en una exigencia **inadmisible**? ¿Siempre EM?
4. ¿El **precio manual sin documento** se permite? ¿Hasta qué estado?
5. ¿El **costo comparado** incluye despacho e instalación?
6. ¿El mensaje al proveedor incluye lo comercial y los datos OBUMA, o solo lo técnico (máx. 3)?
7. ¿Qué son **CA**, **EM** y **asesor** en el sistema (usuarios y permisos)?
8. Estados **ANEXOS OK** y **VISADO**: ¿se eliminan o se redefinen? ¿Cuándo pasa a POSTULADO?
9. ¿Una línea puede dividirse en dos opciones definitivas (dos productos/proveedores)?
10. ¿Se agregan **servicios** al alcance del AUDITOR?
