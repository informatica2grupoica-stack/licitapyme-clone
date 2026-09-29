# ESPECIFICACIÓN FUNCIONAL — AUDITOR
## Licitank · Módulo de cotización, verificación y costeo · v1.1 · Documento para el programador

> Consolida la sesión de diseño del 28 y 29 de septiembre de 2026.
> **Unifica** en un solo módulo lo que antes eran dos: el Auditor Técnico (que operaba en ANEXOS) y el
> Auditor de Compras (que operaba sobre el costeo). Los dos prompts se mantienen, pero como
> **verificadores internos** del AUDITOR, no como módulos separados.
> Se apoya en: PROMPT_4 Auditor Técnico Comparador v1.1 · PROMPT_5 Auditor de Compras v1.2 ·
> Especificación Precompra v1.0 · Especificación Módulo de Compras v2.0 · TABLA_DE_COSTEO_V3 ·
> formatos de carga OBUMA de proveedores y productos.
> Motores: **Kimi y z.ai**. Todo prompt es portable: no depende de funciones exclusivas de un motor.
> **v1.1:** los prompts ya están escritos: `PROMPT_6_Lector_Respaldos_v1_0.md`,
> `PROMPT_4_Verificador_Tecnico_v2_0.md` y `PROMPT_5_Verificador_Costo_v2_0.md`. Leer primero
> `NOTA_PROGRAMADOR_Unificacion_AUDITOR.md`.

---

## 1. QUÉ ES Y QUÉ PROBLEMA RESUELVE

**El problema.** El asistente cargaba la ficha técnica en un módulo y la cotización en otro. Alguien
tenía que enlazarlas a mano, y ese enlace es exactamente donde nace el error más caro del proceso:
aprobar técnicamente un modelo y costear otro. Además se duplicaba trabajo (el mismo PDF subido dos
veces) y los resultados de los dos auditores no se coordinaban.

**La solución.** Un solo módulo, el **AUDITOR**, donde el asistente hace todo el trabajo de
cotización de la licitación: busca el producto, registra links y cotizaciones, recibe fichas, compara,
costea y elige. El AUDITOR **contiene el costeo digital nativo**.

**Principio de diseño: un lugar de trabajo, dos verificadores.** Todo se carga una vez, en un solo
expediente. Pero la verificación técnica y la de costo siguen siendo dos prompts separados, por tres
razones: precisión (un prompt con el doble de contexto rinde peor), control cruzado (dos miradas
independientes sobre el mismo producto) y mantención (ajustar uno no arriesga al otro, mientras no
exista suite de regresión — H-19).

**Objetivo del módulo, en este orden:**
1. **Ayudar** al asistente a cotizar rápido y bien: ordenar, comparar y resolver solo lo simple.
2. **Controlar** que el producto cumple y que el costo es real, con respaldo.
3. **Decidir** con información: cuadro comparativo final de todas las opciones.
4. **Entregar** los datos definitivos (proveedor, producto, costo, respaldos) a Precompra y a Compras,
   ya en el formato de carga de OBUMA.

---

## 2. FLUJO DE ESTADOS

```
ASIGNADOS → EN PROCESO → PRE-POSTULACIÓN → POSTULADO
```

| Estado | Qué ocurre |
|---|---|
| **EN PROCESO** | AUDITOR activo: costeo digital, verificación técnica y de costo, cuadro comparativo, firma y aprobación |
| **PRE-POSTULACIÓN** | Anexos, bloque técnico-administrativo y certificado de admisibilidad, con lo técnico y lo económico ya confirmado |

- **Se elimina el estado ANEXOS.**
- El AUDITOR se activa al pasar la licitación a **EN PROCESO**.
- Todo lo de generación de anexos e inadmisibilidad documental pasa al estado nuevo
  **PRE-POSTULACIÓN**. No tiene sentido armar anexos sin lo técnico y lo económico confirmados.
- Los estados intermedios que existían (ANEXOS OK, VISADO) quedan por redefinir (pendiente P-1).

---

## 3. ARQUITECTURA

### 3.1 Cuatro piezas

| # | Pieza | Responsable | Qué hace |
|---|---|---|---|
| 1 | **LECTOR** | Modelo (**Prompt 6 v1.0**) | Lee **una sola vez** cada link o documento que entra y extrae todo a campos ordenados: proveedor, producto, condiciones comerciales y características técnicas, con cita |
| 2 | **VERIFICADOR TÉCNICO** | Modelo (**Prompt 4 v2.0**) | Compara las características extraídas contra los requisitos de la licitación |
| 3 | **VERIFICADOR DE COSTO** | Modelo (**Prompt 5 v2.0**) | Verifica que el costo es real, correcto y con respaldo |
| 4 | **CUADRO COMPARATIVO** | **Código** | Arma la comparación final de todas las opciones de una línea (sección 9) |

Los dos verificadores **no leen el documento crudo**: trabajan sobre la extracción del Lector. Así se
evita leer dos veces el mismo PDF (costo) y que cada uno lea algo distinto (riesgo).

**Excepción:** cuando un verificador necesita comprobar una cita (por ejemplo, la segunda pasada de
los ítems 🔴), vuelve al documento fuente. La extracción del Lector es el punto de partida, no la
última palabra.

### 3.2 Qué hace el código y qué hace el modelo

Regla heredada: **la aritmética, la navegación y los bloqueos no se delegan al modelo.**

| Tarea | Responsable |
|---|---|
| Visitar links y guardar captura fechada (imagen + texto) | Código |
| Dólar observado BCCh del día + $10 | Código |
| Conversiones neto/IVA, costo unitario, diferencias %, margen, fórmula Ruta B | Código |
| Contraste link vs costo en la vía liviana | Código (con la extracción del Lector) |
| Veredicto de la fila, bloqueos, habilitaciones | Código a partir del JSON |
| Armado del cuadro comparativo | Código |
| Mapeo de datos a formato OBUMA, validación de RUT, resolución de IDs de catálogo | Código |
| Leer, extraer, comparar, explicar, redactar preguntas y ayudas | Modelo |

### 3.3 Coordinación entre los dos verificadores

Los verificadores no conversan entre sí. **El código coordina** mediante eventos sobre la opción:

| Evento | Lo emite | Provoca |
|---|---|---|
| `documento_nuevo` | Lector | Reauditoría técnica y de costo de la opción |
| `producto_cambiado` (marca, modelo o SKU distinto al de la opción) | Lector / Verificador de costo | Alerta de identidad; reauditoría técnica completa |
| `complemento_requerido` (accesorio o documento de tercero) | Verificador técnico | Verificador de costo exige que esté costeado |
| `compromiso_con_costo` (capacitación, instalación, despacho a región, etc.) | Verificador técnico | Se crea la línea de costo asociado en el costeo (sección 8.3) |
| `ruta_insalvable` | Verificador técnico | La opción queda **DESCARTADA**; su costo deja de sumar |
| `sobredimensionamiento` (≥ 50% sobrecumple) | Verificador técnico | Aviso al asistente: buscar la versión base, puede ser más barata |
| `respuesta_proveedor` | Asistente (carga) | Pasa por el Lector y reaudita en los dos verificadores |

---

## 4. LA OPCIÓN — UNIDAD DE TRABAJO

### 4.1 Definición

**Opción = línea de la licitación + producto (marca/modelo) + proveedor.**

Una línea puede tener varias opciones. Es como trabaja realmente el asistente: tantea dos o tres
productos o proveedores antes de elegir.

- **Mínimo: 1 opción por línea** (se ajustará con el uso).
- Sin máximo por ahora.
- Todos los documentos (links, cotizaciones, proformas, fichas, WhatsApp, correos) se cargan **dentro
  de la opción**. No hay enlace manual entre ficha y cotización: pertenecen a la misma opción.
- Si un documento trae un producto distinto al de la opción, el sistema lo detecta (evento
  `producto_cambiado`) y le pregunta al asistente si corresponde crear una opción nueva.

### 4.2 Ciclo de vida

```
TANTEO → FORMALIZADA → VERIFICADA → DEFINITIVA → EN APROBACIÓN → APROBADA
   └──→ DESCARTADA (desde cualquier estado)
```

| Estado | Condición |
|---|---|
| **TANTEO** | Tiene al menos un link con precio. El verificador técnico ya corre sobre lo que diga la página (origen FICHA_WEB) |
| **FORMALIZADA** | Llegó una cotización o proforma, del mismo proveedor o de otro |
| **VERIFICADA** | Sin bloqueos técnicos ni de costo |
| **DEFINITIVA** | El asistente la **firma** como la opción a ofertar. Solo una por línea |
| **EN APROBACIÓN** | Se solicitó la aprobación (sección 11) |
| **APROBADA** | La aprobó el EM (y el precio de venta, CA o el EM) |
| **DESCARTADA** | La descartó el asistente, o el verificador técnico la declaró INSALVABLE |

**Reglas:**
- **Puede quedar DEFINITIVA solo con link**, sin cotización formal.
- El paso de TANTEO a FORMALIZADA no es obligatorio.
- **El costo no se sobrescribe.** Cada respaldo queda en el historial de la opción, con fecha, tipo y
  valor. Se ve cómo evolucionó el origen del dato: de precio web a cotización formal.
- **Cambio después de firmar:** si cambia el producto o el precio de una opción DEFINITIVA o APROBADA,
  vuelve a VERIFICADA y **se repite la aprobación**.

---

## 5. DOS VÍAS DE VERIFICACIÓN

La vía la **elige el asistente, línea por línea**. Una misma licitación puede tener líneas por las dos
vías.

| | **VÍA LIVIANA** | **VÍA COMPLETA** |
|---|---|---|
| Para | Ferretería, commodities, productos de descripción simple | Equipos, instrumentos, maquinaria, todo lo que tenga exigencias técnicas relevantes |
| Qué se verifica | Link activo · precio del link = costo registrado · unidad · IVA | Verificador técnico completo + verificador de costo completo |
| Quién | Código, sobre la extracción del Lector en modo comercial | Lector + los dos verificadores |
| Cuadro comparativo | Solo producto y costo por opción | Completo (sección 9) |

**Regla obligatoria:** si la línea tiene exigencias 🔴 INADMISIBLE heredadas de Fase 2, **la vía
completa es obligatoria**. El sistema no permite elegir la liviana y lo dice: "esta línea tiene
exigencias que pueden dejarnos fuera: requiere verificación completa".

**Vía liviana — regla del contraste (código):**
- Sin link no se puede registrar costo (regla que ya funciona hoy).
- El código compara el precio extraído del link, normalizado a neto unitario, contra el costo
  registrado.
  - Link **más caro** que lo costeado → se aplica la regla de margen del PROMPT_5 (V4: bloquea si el
    margen del proyecto cae 2 puntos o más, o queda bajo el 20%; si no, informa y actualiza).
  - Link **más barato** → informa.
- Unidad o empaque distinto (caja vs unidad) → bloquea, como V2.
- IVA no declarado en el link → se informa; doble IVA o IVA omitido → bloquea, como V3.
- Link caído o que redirige a otro producto → SIN RESPALDO.

---

## 6. EL LECTOR

**Prompt 6 — Lector de Respaldos v1.0** (documento aparte). Tres modos: COMPLETO, COMERCIAL y
DIRIGIDO (búsqueda dirigida de características que el verificador técnico no encontró).

**Entra:** cada link (texto y captura que guarda el sistema) o documento cargado a una opción.

**Sale:** una extracción ordenada en cuatro bloques, cada dato con su cita:

1. **Documento:** tipo (link web, cotización formal, proforma, ficha técnica, catálogo de familia,
   certificado, respaldo informal), emisor, fecha, vigencia, legibilidad.
2. **Proveedor:** todo lo que aparezca, en los campos del formato de carga OBUMA (sección 12).
3. **Condiciones comerciales:** precio, unidad, contenido del empaque, IVA, moneda, Incoterm, MOQ,
   stock, plazo de entrega, despacho, condiciones de pago, costos adicionales.
4. **Producto y características técnicas:** marca, modelo, SKU del fabricante, SKU del proveedor, y
   la lista de características tal como las declara el documento, en su idioma original con
   traducción al español.

**Datos faltantes.** Al terminar, el sistema compara lo extraído contra lo que necesitan los
verificadores y el formato OBUMA, y genera la lista de lo que falta. Esa lista entra al mensaje
unificado al proveedor (sección 10), priorizada: primero lo que bloquea la verificación, después lo
que falta para crear el proveedor.

**Modo comercial (vía liviana):** el Lector solo extrae los bloques 1, 2 y 3.

---

## 7. ORIGEN DEL DATO — SE AGREGA FICHA_WEB

Los seis orígenes del PROMPT_4 se mantienen con sus nombres. Se agrega uno:

| Origen | Qué es | Habilitación |
|---|---|---|
| FICHA | Documento formal del fabricante o distribuidor | Automática (🔴 pasa a segunda pasada automática) |
| **FICHA_WEB** (nuevo) | Especificación publicada en la página del link de tanteo | 🔴 INADMISIBLE → **requiere aprobación del EM**. Resto → automática (a confirmar, P-4) |
| CONFIRMACION_INFORMAL | Foto, captura, WhatsApp, correo | EM |
| DECLARADO | La ficha calla, el asistente lo declara con respaldo | EM |
| CONTRADICE_FICHA | La ficha dice lo contrario | EM |
| HEREDADO | Viene de la fase previa | — |
| NO_LEGIBLE | No se pudo leer | — |

**Mejora del origen:** cuando llega la ficha formal a una opción que se verificó con FICHA_WEB, el
verificador técnico vuelve a correr y los ítems pasan a origen FICHA si la ficha los respalda. Si la
ficha contradice a la web, prevalece la ficha y se alerta.

**Impacto en Precompra:** agregar FICHA_WEB al grupo **"Verificar primero"** (Precompra 6.4), junto
con CONFIRMACION_INFORMAL, DECLARADO y CONTRADICE_FICHA.

---

## 8. COSTEO DIGITAL

### 8.1 Qué es

El mismo contenido de la TABLA_DE_COSTEO_V3, nativo en la aplicación, con restricciones que impiden
llenar datos que no corresponden o agregar información irrelevante en las celdas.

**Columnas que se mantienen (sección asistente):** ítem · detalle del producto · unidad de medida ·
SKU del proveedor · cantidad original · valor con IVA · costo unitario neto · costo total neto ·
precio unitario de venta · precio unitario sin decimales · precio total neto · links · SKU propio.

**Columnas de la sección compras** (costo REAL, OC, factura, pago, estado de recepción): no se llenan
en el AUDITOR. Las usa el Módulo de Compras después de ganar.

**La hoja AUDITORÍA** (datos para la orden de compra) desaparece como hoja: sus datos salen de la
extracción del Lector y viven en la opción (sección 12).

### 8.2 Vínculo costeo ↔ opción

- Cada línea del costeo muestra el costo de la **opción DEFINITIVA** de esa línea.
- Mientras no haya definitiva, muestra el costo de la opción más avanzada o el que elija el asistente,
  marcado como **provisorio**.
- Los links y SKU de la línea salen de la opción: no se escriben dos veces.

**Restricciones mínimas de llenado** (el programador completa la lista):
- Cantidad y unidad de medida: **bloqueadas**, vienen de la licitación. No se alteran nunca (regla de
  admisibilidad del costeo).
- Costo: solo número, con respaldo (link o documento) en la opción.
- Detalle del producto: marca y modelo obligatorios en vía completa.
- Sin texto libre en celdas numéricas.

### 8.3 Costos asociados (compromisos de las bases con costo)

Cuando las bases exigen algo que cuesta pero no es un producto que se oferta (capacitación,
instalación, puesta en marcha, despacho a región, visitas técnicas), el verificador técnico lo detecta
y el sistema **crea automáticamente una línea de COSTO ASOCIADO** en el costeo.

- **Solo suma al costo.** No lleva precio de venta ni margen propio: no es un insumo sobre el cual
  agregar margen, es un costo a estimar. Su efecto es **bajar el margen real** del proyecto.
- **Lo estima el asistente.** Basta con su estimación; **no requiere respaldo**. Queda marcado como
  ESTIMACIÓN.
- Entra en el cálculo de margen de las reglas R1/R2 del PROMPT_5.
- Si el asistente cree que no aplica, puede anularla con comentario obligatorio.

### 8.4 Precio de venta

- Se fija **dentro del AUDITOR**.
- Al fijarlo se muestra la **posición de precio** del PROMPT_5 (Parte IX): presupuesto del organismo,
  precio de mercado público, precio de mercado privado y nuestro costo verificado.
- Lo aprueba **CA o el EM** (sección 11).

---

## 9. CUADRO COMPARATIVO

La herramienta con la que el asistente decide qué ofertar y a qué costo. **Lo arma el código**, a
partir de los requisitos heredados y los veredictos ya emitidos. El modelo no lo redacta: así se
garantiza la transcripción literal y que ninguna fila se omita, se agrupe ni se infiera.

### 9.1 Estructura

- **Filas:** cada requisito técnico de la línea, con el **texto literal** del requerimiento del
  cliente y su fuente (numeral de las bases o respuesta del foro). Un requisito compuesto es una sola
  fila (regla P2 del PROMPT_4 v1.1).
- **Columnas:** cada opción de la línea (no descartada), identificada por marca, modelo y proveedor.
- **Celda:** veredicto (✅ CUMPLE · ❌ NO CUMPLE · ➕ CUMPLE CON COMPLEMENTO · ⏳ SIN VEREDICTO) + valor
  ofertado corto + marca de origen cuando no es FICHA (🌐 web · 💬 informal · ✍️ declarado).
- **Fila final:** **costo unitario neto** de cada opción. Nada más por ahora.
- Las filas 🔴 INADMISIBLE van destacadas.
- Los requisitos técnico-administrativos **no** van en el cuadro: son compromisos nuestros, iguales
  para todas las opciones, y se confirman en PRE-POSTULACIÓN.

### 9.2 Ejemplo

Línea 1 — Luminancímetro (valores ilustrativos):

| Requerimiento (literal) | Opción A · Konica LS-150 · Distribuidor 1 | Opción B · Konica LS-160 · Distribuidor 1 | Opción C · Marca X M-200 · Proveedor 2 |
|---|---|---|---|
| 🔴 Rango de medición 0,01 a 99.990 cd/m² | ✅ 0,001–999.900 | ✅ 0,01–9.999.000 | ⏳ 🌐 no indica |
| 🔴 Precisión: al menos +/-2,5% | ✅ ±2,2% | ✅ ±2,2% | ❌ ±3% |
| 🔴 Ángulo de medición de al menos 1° | ✅ 1° | ❌ 1/3° | ✅ 1° |
| Menús en español | ⏳ | ⏳ | ✅ 🌐 |
| Debe incluir: certificado de calibración | ➕ cotizado | ➕ cotizado | ✅ 🌐 |
| … | | | |
| **COSTO UNITARIO NETO** | **$4.850.000** | **$6.120.000** | **$3.940.000** |

### 9.3 Visual

Colores por celda (verde, rojo, amarillo, gris) para que la lectura sea inmediata. Opcional: una
lectura en lenguaje simple que redacta el modelo al final ("la opción C es la más barata pero no cumple
precisión; la A cumple todo lo crítico y queda pendiente el idioma de los menús"). Esa lectura no
calcula ni decide.

---

## 10. MENSAJE UNIFICADO AL PROVEEDOR

- **Un solo mensaje por proveedor**, que junta las preguntas técnicas (verificador técnico), las
  comerciales (verificador de costo: precio neto, vigencia, stock, plazo, despacho) y los datos
  faltantes para crear el proveedor (Lector).
- Lo **genera el sistema** y lo **envía el asistente** a mano.
- Siempre en español. Sencillo, sin jerga interna.
- Orden dentro del mensaje: lo que bloquea primero; los datos administrativos del proveedor al final.
- Preguntas técnicas solo sobre la parte abierta de cada requisito, nunca sobre algo cualitativo
  (regla del PROMPT_4).
- La respuesta del proveedor se carga en la opción y dispara el evento `respuesta_proveedor`.

---

## 11. FIRMA, PASADA FINAL Y APROBACIÓN

### 11.1 Firma

El **asistente firma** una opción por línea como **DEFINITIVA**.

### 11.2 Pasada final automática

Al **solicitar la aprobación**, el sistema ejecuta automáticamente:
- Revisita todos los links, toma capturas nuevas y compara contra la auditoría anterior (PROMPT_5,
  punto 0.2). Aplica las reglas R1/R2 si el precio subió.
- Reverificación de los ítems 🔴 declarados CUMPLE (PROMPT_4, Parte IX, segunda pasada).
- Recalcula la posición de precio.

Si la pasada final encuentra un bloqueo, la solicitud no avanza y el asistente ve la ruta de salida.

### 11.3 Aprobación

| Qué se aprueba | Quién |
|---|---|
| Opción definitiva (producto + costo) | **EM** |
| Precio de venta y margen | **CA o el EM** |
| Excepciones de origen (informal, declarado, FICHA_WEB en 🔴) | EM |
| Cualquier cosa | CA tiene potestad total |

- El EM puede aprobar **línea por línea** a medida que se firman, o **toda la licitación** de una vez.
- Tres acciones, heredadas: APROBAR · APROBAR CON MODIFICACIÓN · RECHAZAR CON COMENTARIO.
- Cualquier cambio de producto o precio después de aprobar → la opción vuelve a VERIFICADA y se
  repite la aprobación.

### 11.4 Paso a PRE-POSTULACIÓN

- **Se permite avanzar con solo algunas líneas.** En el proceso puede que el costo de una línea no
  permita continuar.
- **Excepción que bloquea:** si la licitación es **GLOBAL** (según Fase 2) o las bases exigen ofertar
  todas las líneas, el avance parcial queda bloqueado y el sistema lo dice: "esta licitación exige
  ofertar todas las líneas".
- Las líneas que no se ofertan quedan registradas como **NO OFERTADA**, con motivo obligatorio.

---

## 12. SALIDA HACIA PRECOMPRA Y COMPRAS — FORMATO OBUMA

### 12.1 Qué se entrega

Por cada opción APROBADA, un paquete que pasa a Precompra al postular y a Compras al ganar:
proveedor (formato OBUMA) · producto (formato OBUMA) · costo verificado e historial de respaldos ·
ficha técnica y matriz de cumplimiento · respaldos y capturas.

El AUDITOR **no crea** el proveedor ni el producto en OBUMA. Deja los datos listos en el formato de
carga. **Los crea el encargado de compras** en Compras, donde también se gestionan los pagos.

Los datos del proveedor, incluida la cuenta bancaria, **no son dato restringido**: quedan disponibles
en todo el sistema para exportarse al crear el proveedor.

### 12.2 Mapeo — proveedor (CARGA_DE_PROVEEDORES_FULL_OBUMA)

| Columna OBUMA | Origen en el AUDITOR | Nota |
|---|---|---|
| proveedor_id | Vacío | Lo asigna OBUMA |
| proveedor_rut | Lector (cotización, factura, pie de página del sitio) | Formato `12.345.678-9`. El código valida el dígito verificador |
| proveedor_extranjero | 1 si el proveedor es extranjero (Ruta B), si no 0 | |
| proveedor_extranjero_id | Identificador tributario extranjero, si aparece | |
| proveedor_contacto | Nombre del vendedor | |
| proveedor_razon_social | Lector | |
| proveedor_nombre_fantasia | Lector (marca comercial del sitio o del membrete) | |
| proveedor_giro_comercial | Lector (membrete de cotización o factura) | |
| proveedor_direccion | Dirección comercial | |
| proveedor_comuna | **ID de catálogo OBUMA** | El Lector extrae el texto; el código lo convierte a ID |
| proveedor_region | **ID de catálogo OBUMA** | Ídem |
| proveedor_pais | Lector | |
| proveedor_telefono · proveedor_celular | Lector | |
| proveedor_email · proveedor_website | Lector | |
| proveedor_forma_pago | **ID de catálogo OBUMA** | Desde las condiciones de pago de la cotización |
| proveedor_banco_cuenta | **ID de catálogo OBUMA** del banco | Desde los datos de transferencia |
| proveedor_nro_cuenta | Lector | |
| proveedor_tipo_cuenta | Lector | Texto: "Cuenta Corriente", "Cuenta Vista", etc. |
| proveedor_diasdepago · proveedor_plazodepago | Condiciones de pago (ej.: 30 días) | |
| proveedor_observacion | **Dirección de bodega o de retiro**, licitación de origen, fecha | OBUMA no tiene campo de bodega: va aquí |
| Resto de columnas (saldos, crédito, registro, cuentas contables, tags, etc.) | No las llena el AUDITOR | Valores por defecto de OBUMA |

### 12.3 Mapeo — producto (lista-productos OBUMA)

| Columna OBUMA | Origen en el AUDITOR | Nota |
|---|---|---|
| producto_nombre | Nombre normalizado: tipo de producto + marca + modelo | Regla de formato a confirmar (P-6) |
| producto_modelo | Modelo | |
| producto_fabricante | Marca | |
| producto_descripcion | Descripción corta | |
| producto_descripcion_larga | Características técnicas principales de la ficha | |
| producto_codigo_comercial | SKU propio; si no existe, SKU del proveedor | En el ejemplo coincide con el código del proveedor. Confirmar (P-6) |
| codigo_producto | SKU del proveedor | Relación producto ↔ proveedor |
| producto_codigo_barra | EAN o código de barras, si aparece | |
| producto_garantia · producto_garantia_observacion | Garantía de fábrica (meses y condiciones) | |
| producto_plazo_entrega | Plazo de entrega del proveedor | |
| producto_costo_clp_neto | Costo unitario neto verificado | |
| producto_costo_importacion · _moneda · _factor_equilibrio | Ruta B: FOB, moneda y factor | |
| producto_web_link | Link del respaldo | |
| producto_brochure | Ficha técnica | |
| producto_peso_fisico · _largo · _ancho · _alto | Ficha técnica | **Útil para logística** en Compras |
| producto_unidad_medida · producto_unidad_medida_compra · producto_unidad_medida_factor_conversion | Verificación V2 (unidad y contenido del empaque) | Ej.: se vende caja de 10 → factor 10 |
| producto_exento_iva | Normalmente 0 | |
| rel_proveedor_id | ID OBUMA del proveedor | Se resuelve **después** de crear el proveedor: primero proveedor, luego producto |
| Resto (web, SEO, stock, comisiones, cuentas contables, etc.) | No las llena el AUDITOR | Valores por defecto de OBUMA |

### 12.4 Observaciones técnicas sobre los archivos de ejemplo

- **lista-productos** tiene extensión `.xls` pero es una **tabla HTML**, con **coma decimal**
  (`336,00`, `1,00`). Si se lee sin indicar `decimal=','`, los valores quedan multiplicados por 100.
  Confirmar si el archivo de **carga** es igual a este de **exportación** (P-7).
- Comuna, región, forma de pago y banco van como **ID interno de OBUMA**, no como texto. El programador
  necesita las tablas de catálogo de OBUMA (vía API o exportación) para convertir el texto extraído al
  ID. Si el texto no calza con ningún ID, se marca para revisión del encargado de compras; no se
  adivina.
- La relación producto ↔ proveedor usa `rel_proveedor_id` (ID de OBUMA), por eso el proveedor se crea
  antes que el producto.

### 12.5 Completitud

El AUDITOR muestra por opción un indicador de datos de proveedor completos (ej.: "8 de 12 datos para
crear el proveedor"). **Solo alerta, no bloquea** (misma regla que V11 del PROMPT_5). Los faltantes
entran al mensaje unificado al proveedor.

---

## 13. AJUSTES AL PROMPT_4 (Auditor Técnico → Verificador técnico del AUDITOR)

> **Incorporados en `PROMPT_4_Verificador_Tecnico_v2_0.md`.** Esta tabla queda como resumen.

| # | Parte del PROMPT_4 v1.1 | Ajuste |
|---|---|---|
| T1 | Activación | Ya no en ANEXOS. Corre **por opción**, desde el tanteo, en EN PROCESO |
| T2 | Entradas (Parte II, letra C) | Recibe la **extracción del Lector**, no los documentos crudos. Vuelve al documento solo para verificar citas y en la segunda pasada |
| T3 | Parte III (inventario de fichas masivo) | Lo absorbe el Lector. Se mantiene la detección de ficha ajena ("NO CORRESPONDE") y de catálogo de familia |
| T4 | Parte IV (asignación ficha ↔ línea) | Se simplifica: la opción ya define la línea. El verificador solo confirma que el documento corresponde a la línea y al producto de la opción |
| T5 | Origen del dato | Se agrega **FICHA_WEB** (sección 7). 🔴 con FICHA_WEB como único sustento → EM |
| T6 | Parte VIII (bloque técnico-administrativo) | En el AUDITOR **solo se detectan los compromisos con costo** y se emite `compromiso_con_costo`. La confirmación ítem por ítem pasa a **PRE-POSTULACIÓN** |
| T7 | Parte IX (segunda pasada y certificado) | La segunda pasada corre en la **pasada final** al solicitar la aprobación. El **certificado de admisibilidad** pasa a PRE-POSTULACIÓN, donde consume esa segunda pasada |
| T8 | Varias opciones por línea | Una matriz por opción. El cuadro comparativo se arma con todas |
| T9 | Mensajes al proveedor | Las preguntas técnicas ya no se envían solas: van a la cola del mensaje unificado (sección 10) |
| T10 | CUMPLE CON COMPLEMENTO | Emite `complemento_requerido` para que el verificador de costo exija el costo del accesorio o documento |
| T11 | INSALVABLE | Emite `ruta_insalvable` y la opción queda DESCARTADA |
| T12 | Motores | Kimi y z.ai |

**Se mantiene todo lo demás de la v1.1:** tipos PRESENCIA e INCLUYE, barrido completo, emparejamiento
en tres niveles, deducción documentada, RIESGO y POR AFINAR, criticidad sospechosa, alerta letra vs
mérito técnico con pregunta al foro, aviso de bases redactadas sobre el producto, sin score de
confianza.

---

## 14. AJUSTES AL PROMPT_5 (Auditor de Compras → Verificador de costo del AUDITOR)

> **Incorporados en `PROMPT_5_Verificador_Costo_v2_0.md`.** Esta tabla queda como resumen.

| # | Parte del PROMPT_5 v1.2 | Ajuste |
|---|---|---|
| C1 | Disparo | Continuo por opción dentro del AUDITOR, desde EN PROCESO |
| C2 | Pasada final | Ya no "al pedir ANEXOS OK": corre **al solicitar la aprobación** |
| C3 | Entradas D, E, I | Se reemplazan por la **extracción del Lector** (respaldos, capturas y datos del proveedor) |
| C4 | V1 identidad | Compara el producto del respaldo de costo contra el producto de la opción. Si difieren, emite `producto_cambiado`. PENDIENTE_CRUCE_TECNICO queda solo si el verificador técnico aún no corrió |
| C5 | V5 costos ocultos | Recibe `complemento_requerido` del técnico: accesorio exigido no costeado = costo oculto (ya estaba; ahora llega como evento) |
| C6 | Costos asociados | Las líneas de COSTO ASOCIADO **no se verifican** (son estimación sin respaldo), pero **sí entran** al margen de R1/R2 |
| C7 | V10 referencias y V10-b triangulación | Solo en vía completa |
| C8 | V10-c comparador | Su costo neto por opción alimenta la fila de costo del cuadro comparativo |
| C9 | V11 datos para OC | Se amplía a los campos del formato OBUMA (sección 12). Sigue siendo solo alerta |
| C10 | Precio de venta | Se fija en el AUDITOR. R1/R2 se aplican desde que existe |
| C11 | Motores | Kimi y z.ai (el v1.2 decía Gemini y DeepSeek) |

**Se mantiene todo lo demás de la v1.2:** tipos de respaldo, verificaciones V1 a V11, regla de margen
R1/R2, stock y vigencia solo informativos, histórico interno sin fecha tope, Ruta B con dólar
observado + $10, posición de precio, hard block de la tabla de costeo hacia el portal.

---

## 15. HISTÓRICO Y REPETIDOS

- **Todo queda en el histórico:** opciones descartadas, respaldos, capturas, cuadros comparativos,
  líneas no ofertadas y licitaciones perdidas. Nada se borra.
- **Aviso de repetido:** si el producto de una opción (marca + modelo) ya se trabajó en otra
  licitación, el sistema avisa y muestra en qué licitación, con qué proveedor, a qué costo y con qué
  resultado técnico. Misma regla de identidad que Precompra: si falta marca o modelo, "sin
  identificación suficiente"; si es parecido, "posible coincidencia".
- Cada licitación parte de cero (regla del PROMPT_4): el aviso informa, no reutiliza veredictos.
- El proveedor ya conocido se reconoce por RUT: sus datos se precargan.

---

## 16. HARD BLOCKS HEREDADOS

- El costeo, el cuadro comparativo y toda la salida del AUDITOR **nunca llegan al portal de
  MercadoPúblico**.
- Cantidad y unidad de medida del costeo no se alteran nunca.
- Ninguna opción queda DEFINITIVA con bloqueos abiertos.
- Todo bloqueo se muestra con su ruta de salida.

---

## 17. PENDIENTES

| # | Pendiente |
|---|---|
| P-1 | Estados intermedios: ¿qué pasa con ANEXOS OK y VISADO? ¿La aprobación es un estado propio entre EN PROCESO y PRE-POSTULACIÓN? |
| P-2 | Especificación de PRE-POSTULACIÓN: anexos, bloque técnico-administrativo, certificado de admisibilidad |
| P-3 | Lista completa de restricciones de llenado del costeo digital (programador) |
| P-4 | FICHA_WEB en ítems que no son 🔴: ¿habilitación automática? (propuesta: sí) |
| P-5 | Regla de redondeo del precio unitario sin decimales y su efecto en el margen |
| P-6 | Formato de `producto_nombre` y uso de `producto_codigo_comercial` en OBUMA |
| P-7 | Confirmar que el archivo de carga de productos tiene las mismas columnas que el de exportación |
| P-8 | Tablas de catálogo de OBUMA (comuna, región, forma de pago, banco): obtenerlas por API o exportación |
| P-9 | Dependencia de Fase 2: las filas del cuadro comparativo salen de los requisitos heredados. Si Fase 2 los extrae mal (caso Valdivia), el cuadro hereda el error. Ver hallazgos de la auditoría de viabilidad |
| P-10 | Máximo de opciones por línea y mínimo obligatorio para equipos (hoy: mínimo 1, sin máximo) |

---

## 18. DECISIONES DE ESTA SESIÓN (28–29 septiembre 2026)

| # | Decisión |
|---|---|
| 1 | Un solo módulo, llamado **AUDITOR**, donde se hace todo el trabajo de cotización. Contiene el costeo digital nativo |
| 2 | Dos prompts separados (técnico y costo), coordinados por código mediante eventos |
| 3 | Motores: Kimi y z.ai |
| 4 | Se elimina el estado ANEXOS. El AUDITOR se activa en **EN PROCESO** |
| 5 | Generación de anexos e inadmisibilidad documental pasan al estado nuevo **PRE-POSTULACIÓN** |
| 6 | Llamada **Lector** que lee cada documento una sola vez y extrae a campos |
| 7 | El **cuadro comparativo lo arma el código**, con transcripción literal del requerimiento |
| 8 | Unidad de trabajo: la **opción** (línea + producto + proveedor). Mínimo 1 por línea |
| 9 | El origen del costo evoluciona (web → formal) y queda el historial |
| 10 | Vía liviana o completa: la **elige el asistente por línea**; pueden coexistir |
| 11 | Línea con exigencias 🔴 → **vía completa obligatoria** |
| 12 | El verificador técnico corre desde el tanteo, con la web (origen **FICHA_WEB**) |
| 13 | 🔴 respaldado solo por la web → requiere **aprobación del EM** |
| 14 | Una opción puede quedar **DEFINITIVA sin cotización formal** |
| 15 | Cuadro comparativo: solo **costo unitario neto** como dato económico, por ahora |
| 16 | El asistente firma; el **EM aprueba**, por línea o por licitación |
| 17 | El **precio de venta** se fija en el AUDITOR y lo aprueba **CA o el EM** |
| 18 | Cambio de producto o precio después de firmar → **se repite la aprobación** |
| 19 | Un solo **mensaje por proveedor** (técnico + comercial); lo genera el sistema y lo envía el asistente |
| 20 | Los datos del proveedor, incluida la cuenta bancaria, **no son restringidos** y se exportan al crear el proveedor |
| 21 | El AUDITOR entrega los datos en **formato de carga OBUMA**; el **encargado de compras** crea el proveedor y gestiona pagos |
| 22 | Compromisos de las bases con costo → **línea de costo asociado automática**, sin margen, que solo sube el costo |
| 23 | El costo asociado lo **estima el asistente**, sin respaldo |
| 24 | **Pasada final automática** al solicitar la aprobación |
| 25 | En EN PROCESO solo se costean los compromisos; su confirmación y el certificado de admisibilidad van en PRE-POSTULACIÓN |
| 26 | La **posición de precio** se muestra al fijar el precio de venta |
| 27 | Se puede pasar a PRE-POSTULACIÓN con **solo algunas líneas**, salvo licitación GLOBAL o bases que exijan todas |
| 28 | **Todo queda en el histórico**; si un producto se repite, el sistema avisa |
| 29 | El Lector es el **Prompt 6 — Lector de Respaldos**, con modos completo, comercial y dirigido |
| 30 | **Veredicto de la línea, bloqueos y habilitaciones por código** en los dos verificadores |
| 31 | **V8** (plazo del proveedor que no cabe en el ofertado) se mantiene como **alerta fuerte**, no bloquea |
| 32 | Prompts 4 y 5 pasan a **v2.0** como documentos completos; las v1.x quedan como historial |
| 33 | El bloque técnico-administrativo y el certificado de admisibilidad de la v1.1 se **guardan aparte** para PRE-POSTULACIÓN |

---

# ANEXO A — PROMPT DEL LECTOR

El borrador que estaba aquí en la v1.0 se convirtió en el documento
**`PROMPT_6_Lector_Respaldos_v1_0.md`**, ampliado con reglas para páginas web, variantes de precio y el modo
DIRIGIDO.

---

## CONTROL DE VERSIONES

| Versión | Fecha | Cambios |
|---|---|---|
| v1.0 | 29-09-2026 | Documento inicial. Unificación del Auditor Técnico y el Auditor de Compras en el módulo AUDITOR |
| v1.1 | 29-09-2026 | Prompts escritos (4 v2.0, 5 v2.0, 6 v1.0). El Anexo A pasa a ser el Prompt 6. Decisiones 29 a 33 |
