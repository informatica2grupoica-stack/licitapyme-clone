# Auditor de la licitación (técnico + costo + pre-postulación)

Pantalla: ítem «Auditor» del negocio, `AuditorOpcionesPanel.tsx`. Traspasado desde la memoria
personal el 2026-10-27; las fechas son de cuando se decidió.

## 2026-10-27 — El Checklist ya no lleva las líneas técnicas (solo Comercial y alertas)
**Decisión del dueño:** lo técnico por línea ya está en el Auditor (compra y técnico, con su firma y aprobación), así que sale
del Checklist del negocio. Quedan el bloque **Comercial** y las **Alertas de cumplimiento**. Se saca TODO lo de las filas
`linea_tecnica`: la pantalla (filas, «Limpiar todas», «PDF de todos los ítems», «Generar nuestra ficha»), el avance, el
estado del bloque, el semáforo (ya no hay causales «bloque técnico sin aprobar» ni «NO CUMPLE sin resolver» salidos de esas
líneas), la bandeja `/aprobaciones` (ya no cuenta ni muestra cumple/no cumple de líneas) y la decisión de generar el anexo
técnico. Regla única: `esLineaTecnica` en `checklist-comercial.ts`, usada por `resumirChecklist` y `estadoDeBloque`.
**Lo que NO se tocó:** las filas siguen en `checklist_comercial` (no se borró nada); el bloque Técnico sigue apareciendo,
con su aprobación, solo si el negocio tiene ítems técnicos que no son líneas (documentos de criterios; hay ~500 en la BD).
`FilaLineaTecnica.tsx` y la ruta `comercial/ficha-tecnica` quedaron sin uso desde la pantalla (la ficha se genera desde el
Auditor). `anexos-datos.ts` lee líneas técnicas APROBADAS del checklist: como ya no se aprueban ahí, no le llegan más.
**Verificado:** negocio 1454 con datos reales (15 líneas técnicas: ya no cuentan; bloque técnico = SIN_ITEMS; Comercial sigue
por aprobar; 17 alertas intactas); 1572 tests; tsc. **Pendiente:** verlo en el navegador (pestaña Checklist y /aprobaciones).

## 2026-10-27 — Nuestra ficha técnica sale en WORD (.docx); los anexos, en PDF
**Corrección del dueño (mismo día):** SOLO nuestra ficha técnica va en Word (es lo nuestro que se sube a Mercado
Público); los ANEXOS quedan en PDF, incluida la oferta técnica de un anexo en blanco (`armarFichaPropia(…, 'pdf')`).
Los dos botones de nuestra ficha dan Word: «Generar nuestra ficha técnica» (Auditor) y «Generar nuestra ficha»
(Información Comercial, ruta `comercial/ficha-tecnica`). El dueño desplegó y apretó este último, que seguía en PDF.
**Regla (dueño):** nuestra ficha es Word, no PDF, para que el equipo la edite antes de presentarla. Lo arma
`ficha-tecnica-docx.ts` con la librería `docx` (9.11.0, nueva dependencia: el Docker la instala con `npm ci`), con el
mismo contenido y orden que la versión HTML: tablas de ancho fijo, fotos en fila, encabezado azul de la tabla que se
repite en cada hoja, casilla sin dato en amarillo, un salto de página por ficha, sin marca/modelo ni pie. Nombres
`FICHA_TECNICA_<código>_L<n>.docx` y `ANEXO_<anexo>.docx` en Documentos › Anexos Técnicos. Word no muestra WEBP: la
«Foto para la ficha» acepta solo PNG/JPG y una WEBP del costeo se pasa a PNG con `sharp` (si falla, va sin esa foto).
La ficha antigua del costeo (`comercial/ficha-tecnica`) también sale en Word.
**Verificado:** Word real del horno (1414396 L7) y de la oferta técnica de 4022-19-LE26 armados sin subir; tamaños de
imagen, saltos y textos revisados en el XML; 1567 tests; tsc. **Pendiente:** que el dueño lo abra en Word y lo vea.
Los PDF ya subidos siguen en Documentos: al regenerar queda el .docx al lado.

## 2026-10-27 — Firma en un clic; fotos de la ficha en fila y «Foto para la ficha»
**Firma (decisión de QA delegada por el dueño):** antes eran tres clics (Firmar → Solicitar aprobación → Aprobar) y en
1414396 L7 el mismo EM se pidió aprobación a sí mismo. Ahora un botón: «Firmar y enviar al EM» (asistente) o «Firmar y
aprobar» (EM), acción `firmar_y_enviar` en la ruta del Auditor. La pasada final SE MANTIENE: relee con IA solo los
requisitos INADMISIBLES que quedaron «cumple», una sola vez por comparación (`rojosPendientesDeSegundaPasada` ya salta
los releídos y los confirmados a mano); un «cumple» falso ahí nos deja fuera. Medido: 44,5 s y US$0,054 en el horno.
Mientras corre, la pantalla lo dice. Si la pasada final encuentra algo, la opción queda firmada y se muestra qué falta.
**Fotos:** todas en una fila, una al lado de la otra (máx. 4). Si la ficha del proveedor es solo texto, «Foto para la
ficha…» (columna Respaldo) sube una foto por opción, que va primero (eventos `foto_ficha`, sin migración); al generar,
se avisa si un producto salió sin foto.
**Verificado:** ficha real del horno con 2 fotos en fila; 1560 tests; tsc. **Pendiente:** ver en el navegador el botón
nuevo de firma, el aviso de la pasada final y «Foto para la ficha».

## 2026-10-27 — Nuestra ficha: sin marca ni modelo, y una por LÍNEA
**Reglas (dueño):** (1) nuestra ficha técnica NO nombra marca ni modelo: nos amarra a entregar ese equipo. El producto
va con el nombre genérico de la línea; la marca y el modelo se quitan también de las especificaciones y de «Incluye»
(`sinMarcaNiModelo`, `ficha-tecnica.ts`; vale también para la ficha antigua del costeo). Lo que no se puede quitar: las
fotos pueden mostrar el logo, y submarcas que no son la marca registrada («Bandeja Bake 60x40») quedan.
(2) La ficha se arma por LÍNEA: el botón de una opción genera un PDF con todos los ítems de su línea, cada uno en su
página («Línea 1 · Ítem 2 · Ficha técnica 02»). Por ítem va la opción pulsada / la firmada / la única lista; los que no
están listos se avisan y hay que regenerar (`opcionesDeLaLinea`, `generarFichaPropiaDeLinea`). Antes cada ítem
generaba `…_L1.pdf` y el segundo reemplazaba al primero en Documentos (2446-240-LE26 L1 tiene 3 ítems). Una global con
todos los ítems en la misma línea sale completa; la oferta técnica del anexo en blanco junta todas las líneas.
**Verificado:** horno real 1414396 L7 sin «Unox» ni «Bakerlux»; 1555 tests; tsc. **Pendiente:** probar una línea
real de varios ítems con opciones listas (2446-240-LE26 aún no tiene opciones) y ver el botón en el navegador.

## 2026-10-27 — IVA: regla 3b «Subtotal + IVA 19% = Total» → precios NETOS
La cotización del horno (1414396-26-LP26 L7) no decía «neto» con palabras y quedaba «IVA sin definir» →
«Falta confirmar el precio», y el equipo no encontraba dónde resolverlo. **Regla (dueño):** si el pie de una
cotización (no página web) trae subtotal/neto, IVA y total, el IVA es el 19% del subtotal y subtotal + IVA =
total (±$2), los precios son netos (`ivaPorTotalesDelDocumento`, `auditor-opciones-core.ts`; se calcula al
armar el panel con el texto ya guardado, sin releer con IA). Sin las tres cifras o si no cuadran, sigue la
regla 3 (no se supone). Además «Qué falta» dice que se corrige en «Corregir precio o IVA…» (columna Respaldo).
**Verificado:** opción 602 real → neto, costo neto $3.624.195, sin bloqueos; 1551 tests; tsc. El aviso nuevo
de «Qué falta» no se miró en el navegador.

## 2026-10-27 — Anexo técnico EN BLANCO → oferta técnica desde el Auditor
El anexo técnico que solo trae su título («ANEXO TÉCNICO 3 · OFERTA TÉCNICA», 4022-19-LE26) se completa
con nuestra ficha armada desde el Auditor, con el título de ESE anexo (`encabezadoDeAnexoEnBlanco`,
`armarOfertaTecnicaDeAnexoPdf` en `auditor-ficha-propia.ts`; ruta `app/api/anexos/oferta-tecnica`; aviso con
botón en `AnexoRellenoModal.tsx` cuando el anexo no tiene nada que llenar). Un anexo con tablas o texto largo
se rechaza: va por «Rellenar anexo». **Regla:** por línea va la opción firmada (definitiva); si no hay, la
única con lo técnico cumplido; con varias listas sin firmar no se elige: la línea sale en «faltan».
**Verificado:** PDF con el anexo real de 4022-19-LE26 (negocio 1568) sin subir: 4 líneas, 3 en «faltan»; tsc.
**Pendiente:** ver el botón del modal en el navegador.

## 2026-10-27 — La ficha no ponía lo complementado («Control de Humedad», 1414396-26-LP26 L7)
Si la ficha del proveedor no traía el dato y el asistente cerró el requisito con una NOTA de complemento,
la casilla salía vacía en amarillo: la ficha solo miraba el dato del comparador. Decisión del dueño: va el
valor de la nota, lo que sigue al «:» (la nota más reciente manda); sin «algo: valor», queda vacía como antes
(`datoDeComplemento`, `auditor-ficha-propia-core.ts`). **Verificado:** opción 602 real → «0 - 20 – 40 - 60 -
80 - 100%»; tests. **Pendiente:** el PDF ya subido (`FICHA_TECNICA_1414396-26-LP26_L7.pdf`) es el viejo:
volver a generarlo desde el Auditor.
Mismo día, pedido del dueño: la ficha (`ficha-tecnica.ts`) ya no lleva pie («Documento generado por
LICITANK… · usuario», «fotografías referenciales…», «casillas en blanco deben completarse…»). Los avisos de
casillas vacías y foto sin confirmar viven solo en la pantalla.
**Regla (dueño, mismo día):** la ficha declara SOLO lo que ofertamos: columna izquierda = nombre corto de la
característica, nunca el texto de las bases. Sale de lo que el requisito trae antes de «:» (≤ 50 letras,
`nombreDeCaracteristica`); si no lo trae, una llamada a Kimi por ficha pone los rótulos
(`nombrarCaracteristicasConIA`); si falla, el dato va a todo el ancho sin rótulo. Formato: tabla con encabezado
«Característica | Especificación ofertada», marca/modelo/cantidad en una tabla corta con la foto principal al lado.
**Verificado:** PDF real del horno (1414396 L7) y del GETAC (2427-98-LE26 L2), mirados en el navegador; 1550 tests.

## 2026-10-27 — Ficha técnica PROPIA desde el Auditor
Decisión del dueño: nuestra ficha técnica se arma desde la comparación de fichas del Auditor (comparador
v3), NO desde el checklist técnico antiguo, que se va a retirar. Botón «Generar nuestra ficha técnica» en
cada opción, visible solo con lo técnico TODO cumplido (sin ❌ ni ❓ abiertos; lo confirmado a mano cuenta).
Una ficha por producto con el formato de `ficha-tecnica.ts` (requisito de las bases | lo que ofrecemos,
foto, logo, firma y timbre). Foto: la de la fila del costeo; si no hay, la extraída de la ficha del
proveedor (se avisa para revisarla). Queda en Documentos › «Anexos Técnicos» (nunca en
«fichas_tecnicas», que es de los proveedores). Archivos: `auditor-ficha-propia-core.ts` (puro, tests) y
`auditor-ficha-propia.ts`.
**Regla:** las notas internas del comparador pegadas al dato ofertado («ningún documento acredita…») no
se imprimen (`datoParaPresentar`); sin dato, la casilla queda vacía en amarillo.
Ajustes pedidos el mismo día al ver la ficha del horno (1414396-26-LP26 L7): sección «Incluye» con los
complementos de producto e instalación (el envío y los cargos manuales no van); hasta 4 fotos, todas con
pie «Foto referencial» (la del costeo primero; después las de la ficha o, si no hay, de la cotización,
fotos antes que planos — `extraerImagenesProducto`); color azul marino #1f3864 en vez del verde; la
ficha puede seguir en la hoja siguiente (antes saltaba entera a la página 2); los tramos del dato
ofertado que hablan de la cotización o del proveedor no se imprimen.
**Verificado:** PDF armado con datos reales (4022-19-LE26 L2, 2427-98-LE26 L2 GETAC, 1414396 L7) sin subir; tests.
**Pendiente:** ver el botón en el navegador; siguiente paso pedido: llenar el anexo técnico con estos
mismos datos.

## 2026-10-27 — Al eliminar la ficha técnica seguían «cumplen» y «por resolver»
Al quitar una ficha («Dejar de usar») o borrarla desde Documentos, la comparación técnica de la
opción quedaba guardada tal cual (era así a propósito: «vuelve a comparar»). Ahora se retiran las
comparaciones hechas desde que la ficha se cargó (`retirarComparacionesConFicha`,
`app/lib/auditor-opciones.ts`); las anteriores no la vieron y se conservan. Si no queda ninguna,
la opción vuelve a «sin comparar». No se re-compara sola (gasta IA).
**Verificado:** `tsc`, tests y el caso real en la BD: negocio 1454, ficha `XEFR_04EU…pdf`; las
comparaciones #797 (opción 593) y #804 (opción 602) se hicieron con la ficha; #796 y #803 son
anteriores. **Pendiente:** retirar #797 y #804 a mano (la ficha se borró antes del arreglo; escribir
en producción requiere el OK del dueño) y desplegar el arreglo.

## Decisiones vigentes del dueño

- **UNA sola pantalla** (2026-09-30), sin pestañas Técnico/Compra. Pestañas finales: Auditor ·
  Costeo · Checklist · Pre-postulación · Postulación (solo los PDF a subir a MP) · Resumen del
  Auditor.
- **Comparador técnico = Prompt 4 v3.0** (reemplaza al verificador v2): 4 estados por requisito
  (✅ CUMPLE · 🟩 SOBRECUMPLE · ❌ NO CUMPLE · ❓ FALTA DATO), máx. 3 preguntas técnicas por
  proveedor. Firmar/aprobar se bloquea con ❌ o con ❓ sin confirmar.
- Los prompts del comparador se generan desde el `.md` (`scripts/generar-prompts-comparador.mjs`
  → `auditor-comparador-prompts.ts`); NO editarlos a mano, un test los compara.
- Lo que el `.md` deja al modelo pero conviene hacer por código (sobrecumple, veredicto global,
  certificado de admisibilidad, bloqueos) vive en `auditor-comparador-core.ts`.
- **Todo el Auditor con Kimi** (2026-10-26), con respaldo a glm-4.7. Kimi + `response_format:
  json_object` rompe las claves del JSON: no volver a ponerlo. `auditor_extraccion.motor` dice
  quién leyó.
- Precio manual sin documento: se acepta con precio + IVA + motivo; la opción queda en TANTEO y no
  se firma sin cotización.
- Complementos de una opción (accesorios, instalación y envío de la MISMA cotización) se suman al
  costo por unidad; proveedor = la propia empresa se deja vacío (2026-10-26).
- El Auditor respeta el selector «¿A qué líneas vamos?» (`negocio_lineas_oferta`).
- El comparador filtra los requisitos por producto siempre (2026-10-09, caso 387-55-LE26: mezclaba
  84 requisitos de 21 muebles).
- Revocada/Desierta son estados de pipeline propios (REVOCADA, DESIERTA): salen de Postuladas,
  KPIs y lista de Negocios. Toda lista nueva de «estados resueltos» debe incluirlos.
- Cálculo dice CUMPLE y la IA NO_CUMPLE → queda PENDIENTE con nota, nunca aprobado solo.

## Reglas para trabajar aquí

- **Las confirmaciones las hace el equipo, nunca la IA**: precio dudoso, «Lo confirmo», «Sí
  cumple», firmar, aprobar. Quedan con nombre en la BD de producción. Al probar, solo mirar,
  abrir/plegar y filtrar.
- **Hooks de React antes de cualquier `return` temprano** en `AuditorOpcionesPanel.tsx`: uno
  después rompe producción (React #310) y `tsc` no lo ve. Correr
  `npx eslint <archivo> | grep rules-of-hooks`.
- El error más caro es aprobar un modelo y costear otro.
- Ante un Auditor «con requisitos de más», mirar primero cuántos requisitos rotulados tiene la
  línea del informe frente al producto.
- `leerSinGuardar` (`auditor-lector.ts`) diagnostica una lectura sin escribir en la BD.

## Pendientes conocidos

- IVA: la v3 dice «cotización sin IVA → precio tal cual + marca»; hoy rige «cotización sin
  declarar IVA bloquea». Decisión pendiente del dueño.
- 10 decisiones del asesor (CA) en `docs/AUDITORIA_SISTEMA_AUDITOR_2026-10-01.md`, sección 11.
- PRE-POSTULACIÓN: `docs/migration-135-prepostulacion.sql` sin aplicar a esa fecha; regla de corte
  técnico vs técnico-administrativo por confirmar con CA. No reabrir el diseño.
- Retiro del checklist viejo pendiente de 3 decisiones del dueño (doble firma, anexos hasta
  pre-postulación…).
- Aviso de producto repetido (marca+modelo / RUT); V8 contra plazo ofertado.
- Auditor Técnico viejo: 3 grupos de checklist en conflicto con evidencia real en más de una fila
  (requieren decisión humana); 27 negocios con datos fragmentados sin reconciliar por decisión del
  dueño; Fase 5 (agente administrativo-documental) en pausa — no necesita Google Docs API, edita el
  `.docx` del organismo.
- Plan estratégico (jul-2026), 4 decisiones de CA sin zanjar: motor de búsqueda Ruta B y su costo,
  automatización vs confirmación del homólogo, contenido del resumen de entrega, alcance del
  histórico a cargar.
- El recorrido «Siguiente paso» del Auditor no se ha visto con clics reales en todos los botones.
