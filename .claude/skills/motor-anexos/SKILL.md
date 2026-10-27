---
name: motor-anexos
description: Cómo trabajar en el motor que rellena los anexos de una licitación (Word, PDF y Excel; administrativos, técnicos y económicos). Usar antes de tocar cualquier archivo app/lib/anexos-*.ts o app/api/anexos/*, o cuando el usuario reporte un anexo mal llenado (casilla vacía, dato en el lugar equivocado, totales, fecha, firma, SÍ/NO).
---

# Motor de anexos

Antes de cambiar nada:
1. Leer `docs/memoria/anexos.md` (decisiones recientes y pendientes — skill `memoria-proyecto`).
2. Leer la sección que toca de `docs/anexos-motor-reglas.md` (referencia completa del flujo y las
   reglas). Si cambias una regla, actualiza ese documento.

## Reglas que no se discuten

- **Mejor una casilla pendiente que un dato equivocado.** Un blanco lo llena una persona en
  segundos; un RUT ajeno en una declaración jurada es un problema legal.
- **Nunca inventar.** Si el dato no está en la ficha de la empresa, el costeo, el Auditor o las
  bases, la casilla queda pendiente con un motivo legible.
- **Arreglos generales, nunca para una licitación.** El caso real sirve para encontrar el patrón;
  el arreglo tiene que servir para todos los organismos que escriben parecido.
- **Lo que decide el oferente no se autocompleta:** SÍ/NO de programa de integridad, «cumple / no
  cumple», alternativas excluyentes, checkboxes, IVA condicional («si aplicará»).
- **Hay dos motores con las mismas reglas:** el determinista (`anexos-determinista.ts`, el
  principal) y el de IA de respaldo (`anexos-ia-motor.ts`, prompt `SYS_CAMPOS`). Una regla
  corregida en uno no pasa sola al otro.

## Mapa rápido

| Paso | Archivo |
|---|---|
| Separar varios anexos pegados | `anexos-dividir.ts` |
| Detectar dónde se escribe (5 patrones) | `anexos-detectar.ts` |
| Qué dato va en cada casilla | `anexos-determinista.ts` (respaldo IA: `anexos-ia-motor.ts`) |
| Precios desde el costeo | `anexos-precios-ia.ts`, `anexos-precios-columnas.ts` |
| Totales por línea, pie (neto / IVA / bruto), resumen por sección | `anexos-totales-seccion.ts` |
| Monto único sin tabla de ítems | `anexos-monto-oferta.ts` |
| Datos del Auditor (plazo, cantidades, cumple) | `anexos-auditor-fuente.ts` |
| Orquesta análisis (pantalla) y generación (.docx) | `anexos-rellenar.ts` (`analizarAnexoParaUI`, `generarAnexoFinal`) |
| Escribir el XML del Word | `anexos-docx.ts` |
| Económico en Excel (motor aparte) | `anexos-excel-precios.ts` |
| PDF | `anexos-pdf-*.ts` |
| Carga de documento, empresa, costeo, bases, Auditor | `anexos-datos.ts` |
| Pantalla | `app/components/AnexoRellenoModal.tsx` |

`analizarAnexoParaUI` y `generarAnexoFinal` arman cada uno su propio análisis: un cambio que
afecta qué se escribe hay que aplicarlo en los dos.

## Cómo verificar (siempre contra el documento real)

1. Reproducir con el `.docx` real: el que el usuario adjunta (suele estar en `Downloads`) o el de
   la BD (`documentos_cache` por `licitacion_codigo`, cargado con `cargarDocumentoYEmpresa`).
2. Script temporal en `scripts/scratch/` (nunca en `scripts/` raíz: rompe el deploy) que llame a
   `analizarAnexoParaUI` (lo que ve la pantalla) y a `generarAnexoFinal` (lo que queda en el
   Word). Leer `.env.local` ignorando los comentarios `# …` al final de cada línea. La BD del VPS
   se alcanza por túnel SSH al puerto 3307; si está cerrado, probar con una empresa armada a mano
   (incluye `fecha_hoy`, que en producción agrega la carga de la empresa) y decirlo.
3. Agregar un test de regresión con la forma real del documento en
   `app/lib/__tests__/anexos-deteccion.test.mts` (detección, tablas, totales) o
   `anexos-determinista.test.mts` (qué campo va en cada casilla).
4. `npx tsx --test app/lib/__tests__/*.test.mts` y `npx tsc --noEmit -p .` limpios.
5. Borrar el script temporal y anotar el caso en `docs/memoria/anexos.md`.

Herramientas existentes: `scripts/doctor-anexos.mts` (lista documentos que el motor no entendió),
`scripts/anexos-banco.mts` (mide automáticos/pendientes antes y después de un cambio, con
`--out` / `--comparar`), `scripts/ver-anexo-economico.mts`.
