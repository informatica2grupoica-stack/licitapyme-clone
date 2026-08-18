# Motor de anexos — todas las reglas

Referencia completa de lo que el sistema hace para rellenar un anexo. Extraído del código el
18-ago-2026. Si cambias una regla, actualiza este documento.

**Regla de oro del motor: preferir una casilla PENDIENTE antes que un dato equivocado.** Un blanco
lo llena un humano en 3 segundos; un RUT ajeno en una declaración jurada es un problema legal.

---

## 0. El flujo completo, de punta a punta

```
Documento de Mercado Público (.doc / .docx / .pdf)
   │
   ├─ 1. SEPARAR          anexos-dividir.ts       ¿trae varios anexos pegados? → un archivo por anexo
   │                                              + clasifica administrativo / técnico / económico
   ├─ 2. DETECTAR          anexos-detectar.ts     ¿dónde hay que escribir? (5 patrones + reglas especiales)
   ├─ 3. RESOLVER          anexos-determinista.ts ¿qué dato va en cada casilla? (6 capas, sin IA)
   │       └─ respaldo IA  anexos-ia-motor.ts     solo la cola larga, APAGADO por defecto
   ├─ 4. COMPLETAR         3 capas de IA que sí están activas (bases / precios / experiencia)
   └─ 5. ESCRIBIR          anexos-docx.ts         escribe el XML + verifica integridad
```

Rutas API: `POST /api/anexos/separar`, `/analizar`, `/generar`, `/feedback`. Las tres primeras son
**admin-only**.

---

## 1. SEPARAR — reconocer varios anexos en un archivo

`anexos-dividir.ts`. Si el documento trae **2 o más** encabezados, se corta en un `.docx` por anexo.
Con menos de 2 no se toca nada.

### Las 5 formas de encabezado reconocidas

| # | Forma | Ejemplo real | Caso |
|---|---|---|---|
| 1 | Palabra + N° + número | `FORMULARIO N°1`, `ANEXO Nº 3` | el común |
| 2 | Número entre paréntesis al final | `PAUTA DE EVALUACIÓN (ANEXO 11)` | 1058086-43-LP26 |
| 3 | Letra entre comillas | `ANEXO “A”` | 761391-104-LE26 |
| 4 | Categoría + número | `FORMULARIO A-1`, `T-6`, `E-2` | 1057536-107-LE26 |
| 5 | La palabra **FORMATO** | `FORMATO Nº1-A` | 2296-48-LE26 |

Las palabras aceptadas son **FORMULARIO**, **ANEXO** y **FORMATO**. Se tolera cualquier orden y
cantidad de puntuación entre la "N" y el número (`N°`, `Nº`, `N.º`, `N.°`, `N 3`).

### Guardarraíles de la separación

- **Largo máximo del encabezado: 80 caracteres.** Una oración que *menciona* "Formulario N°1" no es
  un encabezado.
- **Excepción**: si el encabezado quedó *pegado sin espacio* al texto siguiente
  (`FORMULARIO N°3EXPERIENCIA` — lo produce el conversor LibreOffice), se acepta aunque sea larga.
  En prosa real siempre hay un espacio después del número, así que no reabre el falso positivo.
- **El plural no cuenta**: `ANEXOS`, `FORMULARIOS`, `FORMATOS` (portada genérica) se ignoran.
- **Títulos dentro de tablas** sí se leen (cajita de 1 celda, o el documento entero dentro de una
  tabla), párrafo por párrafo.
- **Lo repetido es dato, no título**: si el mismo texto aparece más de una vez dentro de una tabla,
  es un valor de columna, no un encabezado.
- **Títulos en cuadros de texto flotantes** se ignoran como borde de corte (romperían el XML).

### Nombre del archivo resultante

Sale del título real. Si el encabezado viene "pelado" (solo el número), se busca el título en los
párrafos siguientes. Una línea **entre comillas** corta la búsqueda solo si está **repetida** en el
documento (es el nombre de la licitación); si aparece una sola vez, es el título y se usa.

### Clasificación automática por categoría

Determinista, por conteo de palabras clave. Si hay empate o cero coincidencias → `sin_clasificar`.
Nunca adivina.

**Administrativo (26 palabras):** declaracion jurada · identificacion del oferente · identificacion
del proponente · antecedentes legales · antecedentes administrativos · representante legal ·
domicilio · boleta de garantia · garantia de seriedad · garantia de fiel cumplimiento · toma de
razon · pacto de integridad · inhabilidad · union temporal de proveedores · utp · plazo de entrega ·
experiencia del oferente · vigencia de la oferta · certificado de antecedentes · no tener deudas ·
discapacidad · responsabilidad penal · persona juridica · persona natural · constitucion de la
sociedad · poder del representante

**Técnico (20 palabras):** especificaciones tecnicas · ficha tecnica · propuesta tecnica · oferta
tecnica · cumplimiento tecnico · anexo tecnico · certificado de calidad · muestra · capacidad
tecnica · equipo de trabajo · personal tecnico · cronograma · plan de trabajo · metodologia ·
garantia tecnica del producto · ficha de producto · catalogo tecnico · memoria tecnica · hoja de
datos de seguridad · certificacion iso

**Económico (14 palabras):** oferta economica · propuesta economica · precio unitario · presupuesto
detallado · cotizacion · valor total · monto total · estructura de costos · forma de pago · precio
neto · anexo economico · cuadro de precios · lista de precios · iva incluido

Cada archivo separado va a su caja de "Documentos y Bases" (`ANEXOS_ADMINISTRATIVOS`, `_TECNICOS`,
`_ECONOMICOS`, o `ANEXOS_OFERENTE` si no se clasificó). **Nunca** a Documentos Propios.

---

## 2. DETECTAR — dónde hay que escribir

`anexos-detectar.ts`. Cinco patrones de casilla:

| Patrón | Qué reconoce |
|---|---|
| **1** | Celda vacía de tabla, con la etiqueta en la celda de al lado o en la columna |
| **2** | Blanco *inline*: raya de guiones bajos (`____`, mínimo 4) o línea de puntos |
| **2b** | **Marcador** de relleno (ver abajo) |
| **3** | Opción a marcar (`es ___ / no es ___`) |
| **5** | `Etiqueta:` al final del párrafo, sin nada después |

### Marcadores reconocidos (patrón 2b)

| Forma | Ejemplo | Validación |
|---|---|---|
| `<<…>>` | `<<NOMBRE O RAZÓN SOCIAL>>` | debe traer una letra |
| `<…>` | `<nombre de representante legal>` | idem — **1247197-54-LE26** |
| `«…»` | `«RUT»` | idem |
| `{{…}}` | `{{razon_social}}` | idem |
| `[…]` | `[Insertar RUT]` | idem |
| `(…)` | `(razón social empresa)` | **solo** si el interior es un nombre de campo conocido |

El paréntesis es el único restringido, porque en prosa real hay paréntesis por todas partes. La
lista de campos válidos entre paréntesis: nombre, apellido, rut, cédula (de identidad), razón
social, domicilio, dirección, comuna, ciudad, región, cargo, giro, fecha, correo (electrónico),
e-mail, teléfono, fono, celular, representante (legal) — con o sin remate "de la empresa / del
oferente / del adjudicatario".

Un paréntesis que envuelve **todo** el texto de la etiqueta ES la etiqueta (`(Rut de Empresa)`); si
hay texto afuera, es una acotación y se descarta (`Nombre (si correspondiere)`).

### Reglas especiales de detección

**Secciones por tipo de oferente.** Si el documento se divide en Persona Natural / Persona Jurídica
/ UTP, solo se rellena la **jurídica**. Las otras dos se omiten sin preguntar. `postulaComoUTP`
invierte la decisión solo para los bloques UTP, cuando el usuario confirma que esta vez sí se
presenta en unión temporal.

- Dentro de una sección UTP **omitida**, un campo *suelto* (no una fila de tabla) sí se rellena: el
  encabezado UTP a veces abarca todo el formulario y dejaría sin llenar los datos del proponente.
  La *tabla* de integrantes nunca se rellena.

**Anexo que no corresponde presentar.** Si el propio documento avisa que es solo para UTP o solo
para persona natural, el anexo entero se marca "no aplica" con su motivo. El usuario puede forzarlo.

**Fecha partida en casillas.** Nunca pasa por IA: es siempre la fecha de hoy, en el mismo orden.

| Forma | Roles asignados |
|---|---|
| `__ / __ / __` | día · mes en **número** · año |
| `__ de __ de __` | día · mes en **palabra** · año |
| `__ de __ 2026` | día · mes en palabra (año ya impreso) |
| `__ DE __ DE 20__` | día · mes · **últimos 2 dígitos** del año |
| `__ DE __ DE 202_` | día · mes · **último dígito** del año |

Con el año **completo** impreso (`DE 2026`), el blanco siguiente no se toca. Largo máximo de la
línea de fecha: 120 caracteres.

**Líneas de firma.** Se detecta dónde va la firma por: la leyenda de texto (`FIRMA REPRESENTANTE
LEGAL`), el borde inferior de un párrafo, o el borde superior de una celda de tabla. Solo se firma
donde la etiqueta dice que la firma es **nuestra** — nunca en el bloque de un tercero. La leyenda
misma no genera un campo fantasma. Una leyenda tipo `Nombre, RUT y Firma` marca que hay que poner
las tres cosas.

**Alternativas excluyentes.** `___ registra saldos insolutos` / `___ no registra saldos insolutos`:
dos blancos con la misma frase, una negada. Es una decisión del oferente sobre sí mismo, no un dato
de la ficha → **siempre** queda al humano.

**Etiqueta de campo vs. oración.** Un párrafo que termina en `:` es un campo solo si es una frase
nominal: máximo **9 palabras** y sin vocabulario de oración (`que`, `declaro`, `suscribe`,
`asimismo`, `mediante`, `además`…). Esto evita el peor bug conocido: escribir el RUT al final de
`"El oferente que suscribe declara bajo juramento que:"`.

---

## 3. RESOLVER — qué dato va en cada casilla (sin IA)

`anexos-determinista.ts`. **Es el camino principal desde el 17-ago-2026.** Seis capas, en orden.
La primera que resuelve, gana.

### Capa 0 — Estructura del documento (`campoFijo`)
Manda sobre todo. Un `RUT:` que cuelga de `FIRMA REPRESENTANTE LEGAL:` no admite discusión.

### Capa 1 — Diccionario de etiquetas inequívocas
**36 campos, 102 patrones.** Solo entran las etiquetas que, tal como vienen escritas, ya dicen a
quién describen. `Nombre`, `RUT` o `Cargo` a secas **no están** — los resuelve la capa 2.

Normalización previa (`normalizarEtiqueta`): sin tildes, minúsculas, sin paréntesis de acotación,
sin puntuación de relleno, sin viñeta inicial (`3.-`, `a)`, `A.-`, `-`, `•`). **El guion se
conserva** (lo necesita el sufijo `N°1-A`).

Sufijo opcional aceptado en casi todos los campos de empresa — *"del/de la empresa · oferente ·
proponente · participante · postulante · contribuyente · prestador · proveedor"*. Y en los de
persona — *"del/de la representante (legal) · apoderado · declarante · firmante · suscriptor"*.

| Campo | Etiquetas que reconoce (ejemplos reales) |
|---|---|
| `razon_social` | Razón Social · Nombre o Razón Social · Nombre de la Empresa · Empresa · **PROPONENTE** · Oferente · Postulante · **NOMBRE EMPRESA** · **NOMBRE OFERENTE O RAZÓN SOCIAL** · Identificación del Oferente · Nombre de fantasía · Nombre del proveedor postulante a la licitación |
| `rut` | RUT · R.U.T. · R.U.T. N° · Rol Único Tributario · RUT de la Empresa · **RUT o C.I** · RUT/RUN · RUT o cédula |
| `giro` | Giro · Giro comercial · Giro del negocio · Actividad económica · Rubro · **GIRO SII** · **GIRO SERVICIOS DE IMPUESTOS INTERNOS** · **PROFESIÓN, OFICIO O GIRO** |
| `direccion` | Dirección · Domicilio · Domicilio legal/comercial/particular · Dirección completa · **DOMICILIO Y COMUNA** · **Domicilio comercial que acredita** |
| `direccion_calle` | Calle · Calle y número · Nombre de calle · Avenida/Calle |
| `direccion_numero` | N° · Número · Nro · Número de la calle |
| `comuna` / `ciudad` | Comuna · Ciudad · Localidad |
| `region` | Región · Región y comuna · Ciudad y región · Región/Comuna |
| `telefono1` | Teléfono · Fono · Celular · Móvil · Fono contacto · N° de teléfono · **TELÉFONO FIJO Y CELULAR** · Teléfono/Celular · **Teléfono principal y alternativo** · **Teléfono del representante legal** |
| `email1` | Correo · Correo electrónico · **E-mail** · Mail · Casilla electrónica · Correo para notificaciones · **Correo electrónico principal y alternativo** · **del representante legal** |
| `representante_nombre` | Nombre (completo) del Representante Legal · Representante Legal · Apoderado · Nombre del firmante · Quien suscribe · Individualización del representante |
| `representante_rut` | RUT del Representante · Cédula de Identidad · **N° DE CÉDULA NACIONAL DE IDENTIDAD** · C.I. N° · RUN · Número de cédula |
| `representante_cargo` | Cargo · Cargo o función · Cargo que desempeña · Calidad en que comparece |
| `representante_nombres` / `_apellidos` | Nombres · Nombres de pila / Apellidos · Apellido paterno y materno |
| `tipo_persona_juridica` | Tipo de persona/sociedad/empresa · Naturaleza jurídica |
| `fecha_escritura` | Fecha de escritura pública (de constitución) |
| `fecha_sociedad` | Constitución (de la sociedad) · Antecedentes de constitución |
| `notaria` | Notaría · Notario · Notaría de |
| `numero_repertorio` | Repertorio · Repertorio N° · Número de repertorio |
| `fojas_numero_anio` | Fojas · Fojas número · Inscripción de fojas/comercio |
| `banco_nombre` | Banco · Nombre del banco · Institución bancaria/financiera |
| `banco_tipo_cuenta` | Tipo de cuenta · Cuenta corriente/vista |
| `banco_numero` | N° de cuenta · Número de cuenta · Cuenta N° · Cuenta bancaria |
| `banco_email` | Correo para pagos / aviso de pago / transferencias |
| `banco_titular_nombre` / `_rut` | Titular (de la cuenta) / RUT del titular |
| `fecha_hoy` | Fecha · Fecha de la oferta/presentación/propuesta/declaración |
| `licitacion_codigo` | ID · ID licitación · Código de licitación · N° de adquisición · ID Mercado Público |
| `licitacion_nombre` | Nombre de la licitación · Licitación pública · Nombre del proceso/proyecto · Denominación |
| `licitacion_organismo` | Organismo (comprador/licitante) · Entidad licitante · Municipalidad licitante · Mandante · Comprador |
| `licitacion_organismo_rut` | RUT del organismo/entidad/mandante |
| `licitacion_unidad_compradora` | Unidad compradora |
| `socio_nombre` | Nombre del socio/accionista · Socio/Accionista · Socios o accionistas |
| `socio_participacion` | Porcentaje de participación/derechos · % de participación · Participación societaria |

### Capa 2 — Etiqueta pelada, desambiguada por BLOQUE

`NOMBRE`, `RUT`, `CÉDULA` a secas se deciden mirando las otras casillas cercanas. **Bloque** =
casillas separadas por **4 párrafos o menos**. Orden de señales:

1. **Casilla hermana explícita** (la más fuerte). Si el bloque ya tiene una casilla propia de la
   empresa (`NOMBRE DE LA EMPRESA`), el pelado es la **persona** — y viceversa.
2. **Encabezado que precede al bloque** (hasta 3 párrafos arriba). Palabras de persona:
   representante, apoderado, declarante, firmante, don/doña, suscribe, persona natural, encargado,
   administrador de contrato, contacto. Palabras de empresa: oferente, proponente, empresa, razón
   social, proveedor, postulante, sociedad, contribuyente.
3. **Pie de firma** sin más contexto: quien firma es la persona.
4. Si el bloque **no da ninguna señal** → pendiente. No se adivina.

### Capa 3 — Declaración jurada corrida (blanco a mitad de oración)

**15 reglas de texto previo.** Ejemplos: `Yo, ___` → nombre del representante · `cédula de identidad
N° ___` → su RUT · `en representación de ___` → razón social · `con domicilio en ___` → dirección ·
`para y en nombre de ___` → razón social · `denominada ___` → nombre de la licitación.

**14 reglas de marcador**, que miran lo que el organismo escribió *dentro* del marcador. **El DATO
manda sobre el TITULAR**: `RUT representante legal` → RUT del representante (no su nombre).
`RUT empresa` → RUT de la empresa.

Cuidado documentado: `"o persona natural según corresponda"` viene pegado a **todos** los marcadores
de algunos organismos, así que no sirve para desambiguar. Lo que decide es la palabra pegada al dato.

Un marcador que es una **instrucción** al oferente (`indicar`, `indique`, `marque`, `completar`,
`adjuntar`, `describir`, `detallar`, `explicar`) **nunca** se autocompleta.

**Localidad de firma**: `En ____ a 12 de agosto` → comuna del **ORGANISMO**, no de la empresa. Es el
único caso donde se usa la comuna del organismo. Un marcador `<comuna>` o `<ciudad>` es del oferente.

**Bloque de un TERCERO** (institución, cliente, mandante, quien certifica, contratante, emisor del
certificado, quien recibió el servicio): ninguna capa rellena ahí con datos nuestros.

### Capa 4 — Datos de ESTA licitación
Salen de la API de Mercado Público, nunca de un juicio: código, nombre, organismo, RUT del
organismo, unidad compradora, comuna del organismo.

### Capa 6 — Reglas fijas de política de la empresa
- **Programa de integridad**: la pregunta SÍ/NO se responde siempre **SÍ**. Si pide *describir* el
  programa, queda al humano.
- Socios y accionistas: nombre y porcentaje de participación desde la ficha.

### Capa 2b (respaldo IA) — APAGADO por defecto
`ANEXOS_IA_RESPALDO=1` lo enciende. Solo recibe lo que el diccionario no cubrió, y **solo agrega**:
nunca pisa lo que el determinista ya resolvió. Modelo: **GLM-4.7** con `soloGlm: true` (DeepSeek está
excluido a propósito: una auditoría lo encontró confundiendo campos en declaraciones juradas).

---

## 4. Guardarraíl anti-invención

Aplica a **todas** las capas, incluida la IA:

1. **Campo reconocido pero sin valor en la ficha → pendiente.** Nunca se inventa.
2. **El valor tiene que existir en la ficha** (`valorExisteEnFicha`): si la IA propone un texto que
   no está en los datos de la empresa, se descarta.
3. **El campo tiene que calzar con la etiqueta** (`campoCalzaConLaEtiqueta`): un RUT donde dice
   "NOMBRE" se ataja sin llamar a nadie.
4. **Campos de fecha partida** (`fecha_hoy_dia`, `_mes`, `_anio`, `_mes_palabra`) solo se usan dentro
   de un triplete detectado. Sueltos no valen — evita que un título termine con "06" pegado.
5. **Verificación de integridad**: se cuenta el número de párrafos antes y después de escribir. Si
   cambió, no se sube nada. Y todos los fragmentos se validan como XML bien formado **antes** de
   subir el primero.

## Clasificación del pendiente

Cada casilla sin resolver lleva una categoría y un motivo legible:

| Categoría | Significado |
|---|---|
| `perfil_empresa` · `perfil_representante_legal` · `perfil_bancario` | pide un dato de la ficha que falta |
| `datos_licitacion` | dato de la licitación |
| `especifico_licitacion` | precio, cantidad, plazo, marca, modelo, especificación |
| `decision_del_usuario` | marque con X, describa, indique, justifique, seleccione |
| `firma_timbre` | firma o timbre |
| `declaracion_tercero` | lo completa alguien externo (cliente, otro integrante de UTP, el organismo) |
| `no_aplica_al_oferente` | la etiqueta no corresponde a ningún dato nuestro |

---

## 5. Capas de IA que SÍ están activas

Estas tres no dependen de `ANEXOS_IA_RESPALDO`, porque resuelven cosas que no salen de la ficha:

1. **Especificaciones desde las BASES** (`resolverEspecificacionesDesdeBasesConIA`). Segunda
   oportunidad solo para lo que quedó como `especifico_licitacion`. Ninguna otra categoría entra:
   una firma o una decisión del usuario no las responde un texto de bases.
2. **Precios desde el COSTEO** (`anexos-precios-ia.ts` + `motor-comercial.ts`). El costeo aporta
   descripción + precio unitario de venta por ítem. El parser lee **cualquier planilla**, no solo la
   plantilla V3: detecta el encabezado, exige columna de precio de venta, excluye la sección "REAL"
   (Compras) y descarta las filas de pie. Reconoce por línea (hoja `LINEAn` **o** columna `Línea`) y
   suma alzada.
3. **Experiencia desde ÓRDENES DE COMPRA** (`resolverExperienciaDesdeOrdenesCompra`). Llena tablas de
   "Experiencia del Oferente" con OC reales (Aceptada / Recepción conforme). Regla de pertinencia: si
   el objeto de la OC no calza con el rubro que pide la licitación, **no se usa** — mejor fila vacía
   que una OC que no acredita.

Y una cuarta, informativa: **alertas de inadmisibilidad** desde las bases (garantías, firma de puño y
letra, cotizar el 100%).

---

## 6. Aprendizaje (feedback loop)

`anexos-feedback.ts`. El usuario corrige una casilla con el lápiz y la regla se guarda **por TIPO de
etiqueta**, no por licitación: la próxima vez que aparezca esa etiqueta en cualquier anexo, ya está
aprendida. Las reglas aprendidas se inyectan en el prompt (`bloqueReglasAprendidasAnexo`).

---

## 7. Firma y timbre

- La firma se estampa como **imagen** (`firma_url` de la ficha), sobre la línea de firma detectada.
- El timbre igual (`timbre_url`), si la empresa lo tiene cargado.
- Si las bases exigen **firma de puño y letra**, se avisa: hay que imprimir, firmar a mano y
  escanear. La firma digital no sirve y el aviso aparece en el checklist del auditor.
- `keepNext` mantiene la firma y su leyenda en la misma página.

---

## 8. Datos de la ficha de empresa

Los que el motor puede escribir. Si falta uno, la casilla queda pendiente (nunca inventada):

`razon_social` · `rut` · `giro` · `direccion` (+ derivados `direccion_calle`, `direccion_numero`) ·
`comuna` · `ciudad` (= comuna: en Chile no se distinguen de forma confiable) · `region` ·
`tipo_persona_juridica` · `fecha_sociedad` · `fecha_escritura` · `notaria` · `numero_repertorio` ·
`fojas_numero_anio` · `representante_nombre` (+ derivados `_nombres`, `_apellidos`) ·
`representante_rut` · `representante_cargo` · `email1` · `telefono1` · `banco_nombre` ·
`banco_tipo_cuenta` · `banco_numero` · `banco_email` · `firma_url` · `timbre_url` ·
`socio_nombre` · `socio_participacion` · `programa_integridad_respuesta`

Derivados de fecha (solo para tripletes): `fecha_hoy` (fecha larga) · `fecha_hoy_dia` ·
`fecha_hoy_mes` · `fecha_hoy_mes_palabra` · `fecha_hoy_anio` · `fecha_hoy_dia_mes`.

**Regla de contacto (18-ago-2026):** el teléfono y el correo son los **mismos** para la empresa y
para el representante. "Principal" y "alternativo" también son el mismo dato. Esto vale **solo** para
contacto: el nombre y el RUT del representante son de una persona distinta.

**Regla de dirección:** cuando el mismo párrafo pide la comuna en su propia casilla, la dirección se
escribe **sin** la comuna, para que el dato no salga tres veces.

---

## Lo que el motor NO hace

Límite honesto, para no prometer de más:

- **No lee anexos escaneados** (imagen sin capa de texto). Se avisa en vez de generar un archivo vacío.
- **No procesa** `.xlsx` ni `.pdf` como anexo a rellenar (el PDF sí se puede *separar*, convirtiéndolo
  a Word).
- **No inventa** especificaciones técnicas, marcas ni modelos: salen de la ficha técnica del producto.
- **No decide** por el usuario en alternativas excluyentes ni en preguntas de "describa/justifique".
- **No rellena** el bloque de un tercero ni la tabla de integrantes de una UTP.
- **Los `.doc` legados** necesitan el conversor (`DOC_CONVERSOR_URL`, microservicio `conversor-doc/`
  con LibreOffice). Sin él se avisa; no se adivina.

---

## Cobertura de pruebas

**285 tests** en `app/lib/__tests__/` (`npx tsx --test app/lib/__tests__/*.test.mts`). Cada regla de
este documento tiene al menos un test, y cada bug real encontrado dejó su test de regresión con el
código de la licitación donde apareció.

Bancos de medición contra documentos reales:
- `scripts/anexos-banco.mts` — auto vs. pendiente por documento (`--generar` escribe los `.docx`
  finales para abrirlos en Word y mirarlos: ningún contador reemplaza eso).
- `scripts/anexos-golden.mts` — compara lo que escribe el sistema contra lo que escribió un humano en
  anexos ya presentados. Veredictos: OK · DISTINTO (error de precisión, el grave) · FALTA (cobertura)
  · DEMÁS (dato de más).
