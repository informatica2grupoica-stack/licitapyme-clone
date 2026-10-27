---
name: memoria-proyecto
description: Memoria compartida del proyecto LICITANK guardada en el repo (docs/memoria/). Usar al EMPEZAR cualquier tarea (leer qué se decidió y qué quedó pendiente en ese módulo) y al TERMINAR cualquier tarea que cambie comportamiento, una regla de negocio o deje algo pendiente (anotarlo). Vale para cualquier sesión, cualquier PC y cualquier persona del equipo.
---

# Memoria del proyecto

La memoria vive en `docs/memoria/`, dentro del repo, y se sube con el código. Así la lee
cualquier sesión (este PC, otro PC, la nube) y cualquier persona del equipo, no solo quien la
escribió.

- `docs/memoria/INDICE.md` — una línea por módulo, con lo más reciente arriba.
- `docs/memoria/<modulo>.md` — las entradas de ese módulo (anexos, compras, costeo, auditor,
  viabilidad, postuladas, infra…). Un archivo por módulo, no uno por arreglo.

## Al empezar una tarea

1. Leer `docs/memoria/INDICE.md`.
2. Leer el archivo del módulo que se va a tocar. Ahí están las decisiones del dueño que no se
   deducen del código (p. ej. "el SÍ/NO de integridad nunca se autocompleta") y lo que quedó a
   medias.
3. Una entrada describe lo que era cierto cuando se escribió. Si nombra un archivo o una función,
   comprobar que siga existiendo antes de apoyarse en ella.

## Al terminar una tarea

Agregar una entrada al archivo del módulo (arriba de todo) cuando la tarea:
- cambió cómo se comporta algo para el usuario,
- fijó una regla o decisión del dueño,
- dejó algo sin terminar o sin verificar.

No se anota lo que ya dicen el código, los tests o `git log`, ni lo que solo importó en esa
conversación.

Formato de cada entrada:

```markdown
## AAAA-MM-DD — Título corto
Caso real: licitación / documento / negocio donde apareció (si hay).
Qué pasaba y qué se cambió, en 2-4 líneas, con los archivos tocados.
**Regla / decisión:** lo que manda de aquí en adelante y quién lo decidió.
**Verificado:** cómo (documento real, tests, navegador) y qué NO se verificó.
**Pendiente:** lo que quedó abierto (omitir si no hay).
```

Si se crea un archivo de módulo nuevo, sumar su línea en `INDICE.md`. Si una entrada vieja
quedó mal, corregirla o borrarla en vez de agregar otra que la contradiga.

## Reglas

- Fechas absolutas (`2026-10-27`), nunca "ayer" o "la semana pasada".
- Solo datos reales. Nunca inventar un caso, un número o un resultado de prueba.
- Nada secreto: sin claves, tokens, contraseñas, IPs de servidores ni datos personales de
  clientes. Un RUT de empresa o un código de licitación sí se pueden anotar.
- En español, corto y directo.
