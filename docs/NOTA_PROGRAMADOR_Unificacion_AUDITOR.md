# NOTA AL PROGRAMADOR — Unificación de los auditores en el módulo AUDITOR
## Licitank · 29-09-2026 · Documento de entrada: leer primero

> Este documento explica **qué hicimos, por qué y cómo encaja todo**. Es la puerta de entrada al paquete.
> El detalle está en los documentos que se listan en la sección 4.

---

## 1. RESUMEN

1. El **Auditor Técnico** (Prompt 4) y el **Auditor de Compras** (Prompt 5) dejan de ser dos módulos
   separados. Se unen en un solo módulo llamado **AUDITOR**, que además **contiene el costeo digital**.
2. Dentro del AUDITOR siguen existiendo **dos prompts separados**, ahora llamados **verificador técnico**
   (Prompt 4 v2.0) y **verificador de costo** (Prompt 5 v2.0). Se agrega un tercero, el **Lector de
   Respaldos** (Prompt 6), que lee cada documento una sola vez para los dos.
3. La unidad de trabajo es la **opción**: línea + producto + proveedor. Todos los documentos de una
   opción (links, cotizaciones, fichas, WhatsApp) se cargan dentro de ella.
4. **El código coordina** a los verificadores con eventos, calcula todos los veredictos y bloqueos, y
   arma el cuadro comparativo y el mensaje al proveedor. Los modelos leen, comparan y explican.
5. El AUDITOR se activa en **EN PROCESO**. Se elimina el estado ANEXOS. Anexos, bloque
   técnico-administrativo y certificado de admisibilidad pasan al estado nuevo **PRE-POSTULACIÓN**.

---

## 2. EL PROBLEMA QUE RESUELVE

Antes, el asistente cargaba la ficha técnica en el Auditor Técnico (que se activaba en ANEXOS) y la
cotización en el costeo, donde la revisaba el Auditor de Compras. Eso producía tres problemas:

- **Enlace manual.** Alguien tenía que amarrar "esta ficha" con "esta cotización". Ese enlace es
  exactamente donde nace el error más caro del proceso: **aprobar técnicamente un modelo y costear otro**.
  La verificación V1 del Prompt 5 existía solo para detectar ese descalce.
- **Trabajo duplicado.** Muchas cotizaciones traen la ficha adjunta: el mismo PDF se subía dos veces y lo
  leían dos modelos distintos, que podían leerlo distinto.
- **Resultados que no se coordinaban.** Un accesorio exigido por el técnico no le llegaba al de costo;
  una respuesta del proveedor que cambiaba el modelo no hacía reauditar al otro; el proveedor recibía dos
  correos distintos; había dos semáforos finales.
- **Momento tardío.** El técnico corría en ANEXOS, cuando el costeo ya estaba hecho. Un producto que no
  cumplía se descubría tarde.

---

## 3. QUÉ HICIMOS

### 3.1 Un lugar de trabajo, dos verificadores

Se discutió fundir los dos prompts en uno. **Se decidió no hacerlo**, por tres razones:
- **Precisión.** Un prompt con el doble de contexto rinde peor, sobre todo en motores de costo bajo.
- **Control cruzado.** Dos miradas independientes sobre el mismo producto: si una se equivoca en la
  identidad, la otra lo detecta.
- **Mantención.** Ajustar el técnico (como en la revisión LS-150) no debe arriesgar el de costo, mientras
  no exista suite de regresión (hallazgo H-19 de la auditoría de Viabilidad).

Lo que se unificó es **el lugar de trabajo y los datos**: una sola opción, un solo expediente, un solo
cuadro comparativo, un solo mensaje por proveedor, una sola aprobación.

### 3.2 El Lector (Prompt 6)

Llamada de IA que corre antes de los verificadores. Recibe **un** documento o link y lo convierte en
campos con cita: documento, proveedor, condiciones comerciales, producto y características técnicas.
**No evalúa nada.** Ventajas: se lee una sola vez (menos costo), los dos verificadores ven el mismo dato,
los prompts 4 y 5 pierden sus etapas de inventario y se acortan, los faltantes los detecta el código, y los
datos del proveedor quedan listos para OBUMA.

Riesgo: un error del Lector contamina lo que sigue. Resguardos: cita obligatoria, prohibición de suponer,
**búsqueda dirigida** (el Lector vuelve al documento original a buscar lo que el técnico no encontró) y
**segunda pasada** del técnico sobre los documentos originales en los ítems 🔴.

### 3.3 Veredicto por código (decisión CA)

El modelo emite el estado de **cada ítem** y la explicación. El **código** calcula el veredicto de la
fila, el estado de la opción, los bloqueos y las habilitaciones.

| | Código | Modelo |
|---|---|---|
| Mismo dato → mismo resultado | Siempre | No garantizado (varía entre corridas y motores) |
| Resumen coherente con el detalle | Por construcción | Puede contradecirse (pasó en Viabilidad: GLOBAL vs POR LÍNEAS, caso Arica) |
| Auditable (qué regla bloqueó) | Sí | Difícil |
| Testeable con suite de regresión | Sí | No de la misma forma |
| Umbrales ajustables sin tocar prompts | Sí (configuración) | No |
| Puede "ablandar" un bloqueo | No | Sí |
| Casos raros no previstos | Caen en la regla general; los resuelve el EM o CA | Los razona, pero sin garantía |

Límite a tener presente: el código es tan bueno como los estados por ítem que recibe. Por eso se mantienen
la segunda pasada de rojos y la búsqueda dirigida.

---

## 4. MAPA DE DOCUMENTOS

| Documento | Qué es | Estado |
|---|---|---|
| `NOTA_PROGRAMADOR_Unificacion_AUDITOR.md` | Este documento | **Vigente** — leer primero |
| `ESPECIFICACION_AUDITOR_v1.md` (v1.1) | Especificación funcional del módulo: opción, vías, costeo, cuadro comparativo, aprobación, salida a OBUMA | **Vigente** |
| `PROMPT_6_Lector_Respaldos_v1_0.md` | Prompt del Lector (modos completo, comercial y dirigido) | **Vigente** — nuevo |
| `PROMPT_4_Verificador_Tecnico_v2_0.md` | Verificador técnico del AUDITOR | **Vigente** — reemplaza a la v1.1 |
| `PROMPT_5_Verificador_Costo_v2_0.md` | Verificador de costo del AUDITOR | **Vigente** — reemplaza a la v1.2 |
| `RESERVA_PREPOSTULACION_Bloque_TecAdm_y_Certificado.md` | Texto de la v1.1 guardado para PRE-POSTULACIÓN | **Reserva** — no implementar aún |
| `PROMPT_4_Auditor_Tecnico_Comparador_v1_1.md` · `PROMPT_4_Auditor_Tecnico_Comparador.md` | Versiones anteriores del Prompt 4 | Historial |
| `PROMPT_5_Auditor_Compras_Cotizaciones.md` (v1.2) | Versión anterior del Prompt 5 | Historial |
| `ESPECIFICACION_Precompra_v1.md` | Precompra | Vigente, con los ajustes de la sección 11 |
| `ESPECIFICACION_Modulo_Compras_v2.md` | Módulo de Compras | Vigente, con los ajustes de la sección 11 |

**Orden de lectura recomendado:** esta nota → especificación del AUDITOR → Prompt 6 → Prompt 5 → Prompt 4.

---

## 5. ARQUITECTURA

### 5.1 Flujo de estados de la licitación

```
ASIGNADOS → EN PROCESO (AUDITOR) → PRE-POSTULACIÓN → POSTULADO
```

- **EN PROCESO:** el asistente cotiza dentro del AUDITOR. Costeo digital + verificación técnica y de
  costo + cuadro comparativo + firma + aprobación.
- **PRE-POSTULACIÓN:** anexos, bloque técnico-administrativo, certificado de admisibilidad. Se puede
  avanzar con solo algunas líneas, salvo licitación GLOBAL o bases que exijan todas.
- Los estados ANEXOS, ANEXOS OK y VISADO quedan por redefinir (pendiente).

### 5.2 Ciclo de vida de la opción

```
TANTEO → FORMALIZADA → VERIFICADA → DEFINITIVA → EN APROBACIÓN → APROBADA
   └──→ DESCARTADA (desde cualquier estado)
```

- Mínimo 1 opción por línea; sin máximo por ahora. Una sola DEFINITIVA por línea.
- Puede quedar DEFINITIVA solo con link.
- El costo no se sobrescribe: cada respaldo queda en el historial.
- Cambio de producto o precio después de firmar → vuelve a VERIFICADA y se repite la aprobación.

### 5.3 Dos vías, elegidas por el asistente por línea

| Vía | Qué corre |
|---|---|
| **Liviana** (ferretería, commodities) | Lector en modo COMERCIAL + contraste por **código** (link activo, precio con regla V4, unidad V2, IVA V3). Ni el Prompt 4 ni el 5 corren |
| **Completa** (equipos) | Lector COMPLETO + Prompt 4 + Prompt 5 |

Una línea con exigencias 🔴 de Fase 2 **no puede** ir por vía liviana.

### 5.4 Llamadas de IA

| Llamada | Prompt | Cuándo |
|---|---|---|
| L0 — Lectura | 6 (completo o comercial) | Cada documento o link que entra a una opción; cada referencia de mercado; cada link en la pasada final |
| L1-T — Comparación técnica | 4 | Tras cada L0 de la opción |
| L0-D — Búsqueda dirigida | 6 (dirigido) | Si L1-T dejó ítems `no_encontrado_en_extraccion` |
| L1-C — Verificación de costo | 5 | Tras cada L0 de la opción |
| L2-C — Triangulación | 5 | Solo si hay precios discordantes |
| L2-T — Segunda pasada de rojos | 4 (con documentos originales) | En la pasada final, al solicitar la aprobación |
| L3 — Lectura de la posición de precio | 5 | Al fijar el precio de venta y en la pasada final |

Motores en uso: **Kimi y z.ai** (ambos leen imágenes). Todos los prompts son portables.

### 5.5 Flujo de una opción (ejemplo)

1. El asistente pega un link de tanteo en la línea 1 → se crea la opción A (TANTEO).
2. El sistema visita el link y guarda la captura. **L0** extrae precio, IVA, marca, modelo y las
   especificaciones de la página.
3. **L1-C** revisa el costo contra la captura. **L1-T** compara las especificaciones con los requisitos
   (origen FICHA_WEB). Si algo no se encontró → **L0-D** → **L1-T** otra vez.
4. El código calcula veredictos, crea las líneas de COSTO ASOCIADO por los compromisos detectados y arma
   el mensaje al proveedor con lo que falta.
5. Llega la cotización formal con la ficha → L0 sobre cada documento → L1-C y L1-T otra vez → la opción
   pasa a FORMALIZADA y los ítems FICHA_WEB se reemplazan por FICHA.
6. El asistente compara opciones en el **cuadro comparativo** y firma una como DEFINITIVA.
7. Solicita aprobación → **pasada final** (links revisitados, L2-T sobre originales, R1/R2 de margen,
   posición de precio). Sin bloqueos → EN APROBACIÓN.
8. El EM aprueba la opción; CA o el EM aprueban el precio de venta. La opción queda APROBADA.

### 5.6 Eventos entre verificadores (los enruta el código)

| Evento | Emite | Efecto |
|---|---|---|
| `documento_nuevo` | Sistema (tras L0) | Corre L1-T y L1-C sobre la opción |
| `producto_cambiado` | Prompt 4 (correspondencia) o Prompt 5 (V1) | Alerta al asistente: corregir la opción o crear una nueva. El documento no se usa contra la opción hasta resolver |
| `complemento_requerido` | Prompt 4 | Prompt 5 exige el costo del accesorio o documento; si falta, costo oculto (V5) |
| `compromiso_con_costo` | Prompt 4 (Parte VIII) | Se crea una línea de COSTO ASOCIADO en el costeo (sin duplicar entre opciones de la misma línea) |
| `ruta_insalvable` | Prompt 4 | La opción queda DESCARTADA; su costo deja de sumar; el Prompt 5 deja de correr sobre ella |
| `sobredimensionamiento` | Prompt 4 | Aviso al asistente: buscar la versión base, puede ser más barata |
| `respuesta_proveedor` | Asistente (carga) | Pasa por L0 y dispara `documento_nuevo` |

### 5.7 Qué hace el código

- Visitar links, guardar capturas, dólar BCCh + $10, historial MercadoPúblico, búsqueda de referencias.
- Todos los cálculos: neto/IVA, costo unitario, margen (con costos asociados), R1/R2, fórmula Ruta B,
  plazos, mediana y dispersión.
- Todos los veredictos, bloqueos y habilitaciones (matrices de las Partes VIII del Prompt 5 y X del
  Prompt 4).
- Enrutar eventos y disparar las llamadas.
- **Cuadro comparativo** de la línea: filas = requisitos heredados con texto literal; columnas = opciones;
  celda = veredicto + valor + marca de origen; fila final = costo unitario neto.
- **Mensaje al proveedor**: uno por proveedor, con plantilla fija. Orden: preguntas que bloquean
  (técnicas y comerciales), luego alertas, al final los datos que faltan para crear al proveedor.
- Mapeo de datos del proveedor y del producto al formato de carga de OBUMA; validación de RUT; IDs de
  catálogo.
- Vía liviana completa.

---

## 6. ENTIDADES DE DATOS SUGERIDAS

| Entidad | Contenido mínimo |
|---|---|
| **Opción** | id · licitación · línea · marca · modelo · versión · proveedor · vía · estado · firmada por / fecha · aprobaciones |
| **Respaldo** | id · opción · tipo · archivo o URL · captura · fecha de carga · vigente (sí/no) · sostiene el costo (sí/no) |
| **Extracción** | id · respaldo · modo · JSON del Lector · motor usado · fecha |
| **Verificación técnica** | id · opción · JSON del Prompt 4 · veredictos calculados · fecha · versión del prompt |
| **Verificación de costo** | id · opción · JSON del Prompt 5 · veredicto calculado · fecha · versión del prompt |
| **Costo asociado** | id · licitación · línea (o general) · compromiso de origen · texto de la base · cuantificación · monto estimado · anulado (con comentario) |
| **Evento** | tipo · emisor · opción · detalle · resuelto (sí/no) |
| **Pregunta al proveedor** | proveedor · opción · ítem · origen (técnico, costo, lector) · texto · bloquea (sí/no) · respondida |
| **Proveedor** | campos del formato OBUMA · RUT como llave · origen de cada dato (extracción y cita) |

Todo con historial: nada se borra (opciones descartadas, líneas no ofertadas y licitaciones perdidas
quedan en el histórico). Aviso de repetido por marca + modelo y por RUT.

---

## 7. CORRESPONDENCIA v1.x → v2.0

| Antes | Ahora |
|---|---|
| Auditor Técnico, módulo activado en ANEXOS | Verificador técnico del AUDITOR, en EN PROCESO, por opción |
| Auditor de Compras, módulo paralelo sobre la TABLA_DE_COSTEO | Verificador de costo del AUDITOR, por opción, dentro del costeo digital |
| Prompt 4, Parte III (inventario masivo de fichas) | Prompt 6 (Lector) + Prompt 4 Parte III (correspondencia) |
| Prompt 4, Parte IV (asignación ficha ↔ línea) | La define la opción; el Prompt 4 solo confirma correspondencia |
| Prompt 5, Parte III (inventario del respaldo, lectura) | Lectura en Prompt 6; el Prompt 5 solo clasifica el respaldo y ve su evolución |
| Hoja AUDITORÍA del Excel (datos para OC) | Datos del proveedor en la opción, en formato OBUMA (V11 ampliada) |
| Prompt 4, Parte VIII (bloque técnico-administrativo completo) | Prompt 4 v2.0 Parte VIII: solo compromisos con costo. El resto → reserva PRE-POSTULACIÓN |
| Prompt 4, Parte IX (segunda pasada + certificado) | Segunda pasada: en la pasada final del AUDITOR. Certificado → reserva PRE-POSTULACIÓN |
| Mensajes al proveedor: uno técnico (P4) y uno comercial (P5) | Un solo mensaje por proveedor, armado por el código |
| Pasada final del P5 "al pedir ANEXOS OK" | Pasada final al solicitar la aprobación de la opción |
| Veredicto de la línea del P4: pendiente (punto 20) | Por código (decisión CA 29-09-2026) |
| V8 plazo: "alerta fuerte, por confirmar" | Alerta fuerte, no bloquea (decisión CA 29-09-2026) |
| Orígenes del dato técnico: 6 | 7: se agrega FICHA_WEB |
| Bandejas dedicadas del Auditor Técnico | Los documentos viven en la opción. El hard block se mantiene: nada del AUDITOR llega al portal |
| Motores: Gemini / DeepSeek en el P5 | Kimi y z.ai |

---

## 8. REGLAS QUE NO CAMBIAN

- **Hard block:** el costeo, el cuadro comparativo y toda la salida del AUDITOR nunca llegan al portal de
  MercadoPúblico.
- Cantidad y unidad de medida de la licitación no se alteran nunca en el costeo.
- Sin score de confianza en ningún prompt.
- Habilitaciones: el EM, con potestad total de CA.
- Criterio técnico completo de la v1.1 del Prompt 4 y criterio de costo completo de la v1.2 del Prompt 5.
- Margen mínimo 20% (regla dura) y caída de 2 puntos (R1).
- Todo bloqueo con su ruta de salida.

---

## 9. APROBACIONES

| Qué | Quién |
|---|---|
| Firma de la opción DEFINITIVA | Asistente |
| Opción definitiva (producto + costo) | EM, por línea o por licitación completa |
| Precio de venta y margen | CA o el EM |
| Excepciones de origen (informal, declarado, FICHA_WEB en 🔴, traducción corregida en 🔴) | EM |
| Cualquier cosa | CA (potestad total) |

Acciones: APROBAR · APROBAR CON MODIFICACIÓN · RECHAZAR CON COMENTARIO.

---

## 10. SALIDA HACIA PRECOMPRA Y COMPRAS

Por cada opción aprobada: proveedor y producto en formato de carga OBUMA, costo verificado e historial de
respaldos, matriz técnica, respaldos y capturas. El AUDITOR **no crea** el proveedor en OBUMA: lo crea el
**encargado de compras** en Compras, donde también se gestionan los pagos. Detalle del mapeo de columnas
en la especificación, sección 12. Los datos bancarios del proveedor no son dato restringido.

---

## 11. IMPACTO EN OTROS MÓDULOS

| Módulo | Cambio |
|---|---|
| **Fase 2 (Viabilidad)** | Lo CONDICIONANTE debe llegar como INADMISIBLE · entregar criterios de evaluación con su forma de aplicación y fecha de cierre del foro · el tipo GLOBAL / POR LÍNEA lo usa el AUDITOR para permitir o bloquear el avance parcial · las filas del cuadro comparativo salen de sus requisitos heredados: si los extrae mal, el cuadro hereda el error |
| **Costeo digital** | Vive dentro del AUDITOR · cada línea muestra el costo de la opción definitiva (o la provisoria) · líneas de COSTO ASOCIADO sin precio de venta · la hoja AUDITORÍA desaparece · restricciones de llenado |
| **Precompra** | Agregar FICHA_WEB al grupo "Verificar primero" (6.4) · su fuente pasa a ser la opción aprobada del AUDITOR · donde dice "Auditor Técnico" / "Auditor de Compras", leer verificador técnico / verificador de costo |
| **Módulo de Compras v2.0** | Recibe el paquete de la opción aprobada con los datos en formato OBUMA · el encargado de compras crea el proveedor y el producto |
| **PRE-POSTULACIÓN** | Estado nuevo, por especificar. Punto de partida: `RESERVA_PREPOSTULACION_Bloque_TecAdm_y_Certificado.md` |

---

## 12. ORDEN DE IMPLEMENTACIÓN SUGERIDO

1. **Modelo de datos** de la opción, respaldos con historial, extracciones y eventos (sección 6).
2. **Capturas de links + Lector** (Prompt 6, modos completo y comercial).
3. **Vía liviana** por código. Es la mejora más rápida y cubre gran parte del volumen (ferretería).
4. **Verificador de costo** (Prompt 5 v2.0) y su matriz de bloqueo.
5. **Verificador técnico** (Prompt 4 v2.0), búsqueda dirigida (Prompt 6 modo dirigido) y su matriz.
6. **Cuadro comparativo** por código.
7. **Mensaje unificado** al proveedor.
8. **Firma, pasada final y aprobación.**
9. **Exportación** de proveedor y producto al formato OBUMA.

**Pruebas:** antes de dar por buena cada pieza, correrla sobre casos reales fijos y guardar la salida
esperada (suite de regresión, H-19). Casos de partida: luminancímetro LS-150 (técnico) e hidrolavadora
Karcher HDS 8/18-4 C (costo). Probar cada prompt en Kimi y en z.ai.

---

## 13. PENDIENTES

| # | Pendiente |
|---|---|
| 1 | Qué pasa con los estados ANEXOS OK y VISADO; si la aprobación es un estado propio |
| 2 | Especificación completa de PRE-POSTULACIÓN |
| 3 | FICHA_WEB en ítems no 🔴: ¿habilitación automática? (propuesta: sí) |
| 4 | Lista completa de restricciones de llenado del costeo digital |
| 5 | Formato de `producto_nombre` y uso de `producto_codigo_comercial` en OBUMA |
| 6 | Confirmar que el archivo de carga de productos de OBUMA tiene las mismas columnas que el de exportación |
| 7 | Tablas de catálogo de OBUMA (comuna, región, forma de pago, banco) |
| 8 | Criticidad 🟢 sobre característica física: ¿también sospechosa? |
| 9 | Máximo de opciones por línea y mínimo obligatorio para equipos |
| 10 | Código de licitación del caso LS-150 para anclar reglas |
| 11 | Candidatos de mejora del Prompt 4 no tratados (regla de corte técnico-administrativo, SIN_CLASIFICAR, vigencia del foro, JSON largo, set de pruebas) |
