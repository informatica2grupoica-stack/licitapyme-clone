---
name: separar-anexos
description: Diagnosticar y arreglar cuando «Separar anexos» (o la generación de un documento con varios anexos pegados) corta mal — anexos partidos en dos o fusionados, el título de un anexo al final del anterior, archivos con nombre genérico como «LICITACIÓN_PÚBLICA_2», hojas en blanco al principio o al final, o «no trae más de un anexo pegado» cuando sí trae. Usar apenas alguien reporte que los anexos de una licitación «se recortan mal» y antes de tocar la detección de encabezados en app/lib/anexos-dividir.ts.
---

# Separar anexos sin cortar mal

Un documento de Mercado Público suele traer varios anexos pegados en un `.docx`. `anexos-dividir.ts`
(`detectarFormularios` → `dividirPorFormularios`) busca el título de cada uno y corta un `.docx` por
anexo. La misma función la usan `POST /api/anexos/separar` y `/api/anexos/generar`: si corta mal,
el anexo separado sale mal **y** el relleno trabaja sobre un fragmento roto.

Leer antes: `docs/memoria/anexos.md` y la sección «1. SEPARAR» de `docs/anexos-motor-reglas.md`.
Las reglas generales de la skill `motor-anexos` también valen acá (arreglo general, nunca para una
licitación).

## Cómo se ve el problema y qué suele ser

| Síntoma | Causa típica |
|---|---|
| Archivos «LICITACIÓN_PÚBLICA», «PROPUESTA_PÚBLICA», «ID_…» | El título real no se reconoció; un respaldo cortó en un **membrete repetido** |
| El título de un anexo queda al final del anterior | Corte en una línea de **más abajo** del bloque de título |
| Más trozos que anexos (un anexo partido en 2) | Un subtítulo o membrete tomado como título nuevo |
| Menos trozos que anexos | Una forma de título que ninguna regla reconoce (ver la lista de formas en el código) |
| Hoja en blanco al principio/final | Salto de página o relleno de párrafos vacíos entre anexos quedó dentro del fragmento |
| «No trae más de un anexo pegado» | 0 o 1 encabezados detectados |

## Pasos

1. **Ubicar el documento original** (no los ya separados): `documentos_cache` por
   `licitacion_codigo`; el original suele estar en `ANEXOS_OFERENTE`. Los separados quedan en
   `ANEXOS_ADMINISTRATIVOS/TECNICOS/ECONOMICOS` con `categoria_manual = 1`.
2. **Ver dónde corta hoy**, en un script en `scripts/scratch/` (nunca en `scripts/` raíz: rompe el
   deploy): `cargarDocumentoParaSeparar` → `abrirDocx` → `normalizarParaIds` → imprimir los
   párrafos numerados y `detectarFormularios(xml)` (título + `indiceInicio`). Comparar a ojo:
   cada anexo debe empezar en su título y terminar en su firma/fecha.
3. **Encontrar qué regla cortó**. Las formas de título están numeradas en comentarios de
   `anexos-dividir.ts` (primera a décima). Las que más fallan son los respaldos sin palabra clave:
   séptima (título sobre el nombre de la licitación repetido entre comillas) y octava (título justo
   después de «FIRMA…/FECHA…»).
4. **Arreglar por patrón**, no por licitación. Regla de oro del módulo: **lo repetido es dato, no
   título** (membrete, nombre de la licitación, «ID xxxx»). Una forma nueva de título va anclada a
   línea completa (`^…$`) para no comerse prosa, y si puede aparecer en tablas de «documentos
   requeridos» («Anexo 1», «Anexo 2»), se acepta solo en párrafos sueltos.
5. **Regresión con la forma real** en `app/lib/__tests__/anexos-dividir.test.mts`: armar el XML con
   la misma estructura del Word real (si la firma va en una celda de tabla, ponerla en una tabla;
   texto con `<` va escapado `&lt;` como lo guarda Word).
6. **Banco de separación** — obligatorio, un arreglo para un organismo suele mover cortes en otros:

   ```bash
   npx tsx scripts/anexos-banco-division.mts
   ```

   Compara el corte de HEAD contra el del disco en 400 `.docx` reales e imprime solo los que
   cambian. Mirar **cada** diferencia: anexo nuevo bien separado o corte falso que desaparece =
   mejora; anexo real perdido, título pegado al anterior, corte en una línea de firma («LEGAL»)
   o en un membrete = retroceso. Para saber si un corte raro es nuevo, buscarlo también en ANTES.
7. **Mirar el papel**: generar cada fragmento con `generarAnexoFinal`, abrirlo en Word (en
   Windows, `Word.Application` por COM exporta a PDF y `ComputeStatistics(2)` cuenta hojas) y
   confirmar 1) empieza en su título, 2) termina en su firma/fecha, 3) sin hojas en blanco, 4) la
   fecha y los datos siguen llenándose (comparar `completados` antes/después).
8. `npx tsx --test app/lib/__tests__/*.test.mts` y `npx tsc --noEmit -p .` limpios. Borrar los
   scripts temporales y anotar el caso en `docs/memoria/anexos.md`.
9. Los archivos ya separados mal **quedan en la BD**: avisar al dueño que hay que volver a separar
   (y qué archivos viejos sobran). No borrarlos sin que lo pida.

## Trampas conocidas

- Quitar los párrafos vacíos del final de un fragmento borra el hueco donde el motor escribe la
  fecha: se dejan 2 (`PARRAFOS_VACIOS_QUE_SE_DEJAN`).
- Un título puede ocupar varias líneas en mayúsculas; el corte va en la de **más arriba**, y si ese
  bloque llega a un encabezado ya detectado es el mismo título (no cortar).
- La firma puede ir partida en dos líneas («FIRMA DEL OFERENTE O REPRESENTANTE» / «LEGAL»): lo pegado
  bajo una línea de firma es firma, no título.
- No usar `git stash` para comparar con la versión anterior: puede haber otra sesión editando la
  misma carpeta. El banco ya compara contra HEAD sin tocar el árbol de trabajo.
