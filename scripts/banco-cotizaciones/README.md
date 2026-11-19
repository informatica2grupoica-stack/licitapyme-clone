# Banco de cotizaciones reales

Mide qué tan bien el sistema pone cada línea de una cotización en el producto que corresponde, con **cotizaciones reales** que ya están en el
sistema. Corre el MISMO código que producción (`app/lib/compras-cotizacion-resolver.ts`) y no escribe nada en la BD.

Los datos y las respuestas guardadas de la IA quedan **fuera de git** (`datos/`, `cache-ia*/`): traen proveedores, RUT y precios reales.

## Uso

```
npx tsx scripts/banco-cotizaciones/construir.mts          # (re)arma el banco desde la BD (solo lectura; túnel a la BD del VPS)
npx tsx scripts/banco-cotizaciones/evaluar.mts --det      # capa sin IA, segundos: ¿el producto correcto llega a la IA? ¿algún freno excluye mal?
npx tsx scripts/banco-cotizaciones/evaluar.mts --ia       # capa completa: usa las respuestas guardadas; llama a la IA solo si cambió el prompt
npx tsx scripts/banco-cotizaciones/depurar.mts 125        # una cotización: qué dijo la IA y qué hizo cada freno
```

Opciones de `evaluar.mts`: `--negocio=1191,1356` · `--cot=342,351` · `--sin1356` · `--detalle` · `--refrescar` (vuelve a preguntar todo a la IA) ·
`--cache=cache-ia-corrida1` (evalúa el código actual sobre otra corrida guardada) · `--concurrencia=2` (no subir: la cuenta de IA es la de producción).

## Cómo leer el resultado

- **AUTOMÁTICAS BIEN**: asignaciones esperadas que el sistema reproduce con el mismo precio (±1 %).
- **ORO** = producto aprobado por una persona y esta cotización es la elegida: la única respuesta 100 % confiable.
- **PLATA** = lo que hay asignado hoy en la BD: puede tener errores viejos. Un «precio mal» o un «extra» puede ser el código nuevo corrigiendo
  algo que estaba mal (ej.: cot 111, la línea «CN-45 (CARRO TECNOLOGICO)» estaba asignada a «Lockers»).
- **líneas sin asignar** = trabajo a mano que queda.

Regla: antes de desplegar un cambio en la lectura de cotizaciones, correr `--det` y `--ia` y comparar con el último resultado anotado en
`docs/memoria/compras.md`. Cambiar el prompt obliga a volver a preguntarle a la IA (~155 llamadas, ~US$0,50, ~25 min).
