# Regresión de viabilidad-ia

Mide si un cambio en el prompt (o en el código determinista) mejora o empeora, sobre un set fijo
de licitaciones reales con respuesta conocida. Sin esto, "mejorar el prompt" es adivinar.

## Piezas

- `seed.ts` — arma el esqueleto del gold set desde lo que YA tienes guardado.
- `run.ts` — corre la comparación (modo dry = gratis, o `--run` = re-analiza de verdad).
- `_metricas.ts` — qué se mide y cómo se compara (edítalo si quieres nuevas métricas).
- `gold.json` — **tú lo curas**: los casos + valores esperados. Es la fuente de verdad.

## Flujo de una sola vez (armar el gold set)

```bash
npx tsx scripts/regresion/seed.ts        # → gold.seed.json con los 93 casos y sus valores ACTUALES
```

Abre `gold.seed.json` y:
1. Quédate con ~15–30 casos representativos (variedad: suma_alzada / por_linea, con y sin exclusión,
   criterios simples y con subfactores, equipamiento y ferretería).
2. **Corrige** en `esperado` los valores que hoy están MAL (esos son justo los que el harness debe cazar).
   Los que hoy están bien, déjalos como referencia de "no romper".
3. Borra las claves de `esperado` que no quieras fijar en un caso (solo se evalúa lo que declares).
4. Borra los campos `_docs_ok` y `_actual` (son solo referencia).
5. Renómbralo a `gold.json`.

## Uso diario

```bash
# DRY — compara contra el informe guardado en BD (gratis, instantáneo). Sirve para ver el estado actual.
npx tsx scripts/regresion/run.ts

# RUN — re-analiza cada caso con el modelo (cuesta tokens, ~1-2 min por caso). NO pisa la BD.
npx tsx scripts/regresion/run.ts --run
npx tsx scripts/regresion/run.ts --run --only=3507-12-LE26
```

`--run` es **no destructivo**: usa `analizarViabilidadIAV3`, que calcula y devuelve el informe pero
NO lo guarda. Tu gold set (los informes guardados) queda intacto para las comparaciones dry.

## A/B de un cambio de prompt (lo importante)

Para saber si un bloque nuevo del prompt ayuda, córrelo con el flag encendido y apagado y compara:

```bash
VIABILIDAD_BARRIDO_V35=1 npx tsx scripts/regresion/run.ts --run
VIABILIDAD_BARRIDO_V35=0 npx tsx scripts/regresion/run.ts --run
```

Cada corrida deja un reporte JSON en el scratchpad con la etiqueta `barrido=1` / `barrido=0`.
Regla de decisión: el cambio se queda **solo si sube la métrica objetivo SIN bajar otra**.
Si empeora, el flag ya te deja revertir sin tocar código.

## Métricas que mide hoy

modalidad · adjudicacion · n_criterios · suma_valida · n_items(≥/≤) · veredicto · score(≥/≤) ·
revision_humana · excluido. Para agregar una, edita `_metricas.ts` (`Metricas`, `extraerMetricas`,
`Esperado`, `comparar`).
