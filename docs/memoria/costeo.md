# Costeo

Costeo digital del negocio (editor + burbuja flotante) y Excel de costeo (plantilla V3).
Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

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
- `docs/migration-39-precios-mercado.sql` figuraba sin aplicar (verificar).
