# Costeo

Costeo digital del negocio (editor + burbuja flotante) y Excel de costeo (plantilla V3).
Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## 2026-10-27 — Re-viabilidad no cambia el costeo digital (regla) + «Actualizar» duplicaba por coma decimal
Caso real: 3712-74-LP26, negocio 1511. La viabilidad re-analizada dejó 39 productos; el costeo digital
guardado sigue con 77 filas: 29 fichas técnicas sin número, «120 días corridos», X1…X6 de la pauta y la lista
numerada (versión 1, 22-oct, armada con el parser viejo), más 2 duplicados que agregó «Actualizar» el 27-oct.
Por qué: el costeo digital es una FOTO editable (`negocio_costeo_editor`). Correr la viabilidad nunca la toca;
solo el botón «Actualizar» la cruza con la viabilidad (`fusionarConViabilidad`; copia `fusionarLocal` en
`CosteoEditorCard.tsx`), y eso a propósito solo AGREGA lo nuevo y reubica líneas: nunca borra filas que la
viabilidad ya no trae ni cambia cantidades, porque una fila no dice si la escribió una persona.
Bug arreglado: `normDesc` (en ambos archivos) iguala coma/punto entre dígitos y `&quot;`; «1,5 hp» y
«20,000(Lt)» ya no se agregan otra vez al lado de «1.5 hp» y «20.000(Lt)».
**Verificado:** test `costeo-editor-fusion-viabilidad.test.mts`; con los datos reales de 3712 (solo lectura),
desde la versión 1 «Actualizar» agrega 0 filas (antes 2). Sin ver en navegador; sin escribir en producción.
**Regla / decisión (dueño, 2026-10-27):** «Actualizar» avisa las filas que la viabilidad ya no trae y deja
quitarlas con confirmación, SOLO las que no tienen precio, link, SKU ni costo real (`filasQueViabilidadYaNoTrae`,
copia en `CosteoEditorCard.tsx`; lista en el diálogo vía `lista` de `useConfirm`). Cuenta como «no trae»
también la copia de más: cada producto de la viabilidad cubre una sola fila y la trabajada elige primero.
Nunca toca costos adicionales, filas de Compras ni filas en blanco. Se quitan en pantalla; quedan al guardar.
**Verificado:** con los datos reales de 3712 (solo lectura) propone quitar 38 de 77 filas y quedan 39, una
por producto. NO visto en navegador (el dev server apunta a la BD de producción y el editor autoguarda).
**Pendiente:** limpiar 3712 en producción con el botón (lo hace el equipo y luego guarda).

## 2026-10-27 — Primera columna del editor = «Ítem» numerado, no «Línea»
Caso real: 3712-74-LP26 mostraba «1» en todas las filas (era `lineaReal`, y la licitación tiene una sola
línea). **Decisión (dueño):** la columna es el número de ítem dentro de la hoja (1, 2, 3…, solo lectura, se
renumera sola); las líneas de la licitación se ven en las hojas de abajo. `lineaReal` sigue guardada (cruza
con el Auditor y reparte hojas) y sale en el tooltip del número; ya no se edita a mano desde la grilla.
`CosteoEditorCard.tsx`. **Verificado:** `tsc` limpio; sin ver en navegador.

## Decisiones vigentes del dueño

- **Se leen TODAS las fuentes y se elige por AUTORIDAD del documento, nunca por cantidad de
  filas** (2026-08-24). El anexo económico manda sobre el listado. Si dos documentos no coinciden
  en el conteo, el informe pasa a REVISION_HUMANA (regla V-15): cuando los papeles se contradicen
  no hay arreglo honesto por código. Nunca inventar productos.
- **Tres ejes separados** (hallazgo de CA, 2026-07-21): a quién se adjudica (global / por línea),
  cómo se cotiza (suma alzada / precios unitarios) y cómo se evalúa. No mezclarlos.
- **Link del producto obligatorio** para guardar un ítem que ya tiene precio (2026-09-04); no se
  exige al esqueleto sin precio.
- El costeo se abre como **burbuja flotante** que sobrevive a toda la app.
- **Margen en cascada** fila → hoja → global (el Excel del asistente lleva margen por fila).
- El precio del checklist comercial se resincroniza con el costeo en cada guardado: el costeo
  manda; aprobar el punto es el único freno.
- **El presupuesto de las licitaciones viene POR LÍNEA y CON IVA**: compararlo contra el costeo
  neto sin dividir por 1,19 regala un 19% de tope.
- `estructura_costeo = 'por_categoria'` solo cuando el parser determinista detectó rubros reales
  en la planilla, nunca por categorías que inventa la IA.
- El cuadro comparativo de totales que el comercial armaba a mano al pie del Excel vive en el
  editor, uno por línea.
- «Regenerar costeo» reusa el informe guardado y no gasta IA; con el filtro de criterios ya no hace
  falta re-analizar para limpiar filas de criterios de evaluación.
- El parser lee cualquier planilla (no solo la V3 propia); antes daba $0 en silencio.
- Exportar Excel usa la misma plantilla V3 que el automático.

## Reglas para trabajar aquí

- Si dicen «el costeo no se guarda», mirar primero la BD (`scripts/scratch/_costeo-guardado.mts`)
  y el GET antes de tocar el PUT: en oct-2026 era la pestaña mostrando una copia vieja (el estado
  vive duplicado en pestaña y burbuja; escuchar el evento `costeo-guardado`).
- Antes de concluir que un arreglo «no funcionó», comparar `viabilidad_licitacion.updated_at` con
  la hora del deploy: hacer commit y push no despliega, falta `deploy.sh` en el VPS.
- El `gold.json` puede traer correcciones viejas que confundían «se evaluará por línea» con
  adjudicación por línea: releerlas con ojo crítico.

## Pendientes conocidos

- Extraer especificaciones desde el link del costeo: bloqueado por decisión del dueño (la ficha
  está en el PDF que linkea la tienda, no en el HTML; haría falta un 4º origen + migración).
- `tipoCosteo` se deriva todavía de `como_se_adjudica`; reconectarlo de forma independiente.
- Negocio 427 (1173418-1-LE26, otro responsable) sin costeo ni decisión de líneas; la línea 3
  (perdida) no tiene hoja — si «Actualizar» trae filas de L3 hay que apagarla.
- Botón «Generar costeo» visible aunque no exista uno previo (sugerido).
