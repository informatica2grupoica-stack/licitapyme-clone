# Bitácora de cambios — motor de viabilidad (Frente A.1)

Registro vivo de cambios candidatos al motor de viabilidad (`app/lib/viabilidad-ia.ts`,
`app/lib/planilla-costeo-parser.ts`, `app/lib/validador-viabilidad.ts`). Exigido por el circuito
de calidad de Frente A.1 del plan estratégico: **ningún cambio se agrega sin su caso real de
origen, y ninguna versión entra a producción sin pasar el Golden Set** (`scripts/regresion/`).

Cada entrada: fecha · caso real que lo originó · si es regla de validador o ajuste de prompt ·
qué se cambió y dónde · si pasó el Golden Set. Las entradas más nuevas van arriba.

---

## 2026-07-28 (quater) — Frente A.3: automatización de la regla de promoción del Golden Set

**Caso real que lo originó:** auditoría contra los 5 requisitos de A.3 encontró 3 huecos: cero
casos con adjudicación POR_LOTES (de las 3 modalidades declaradas, solo 2 representadas), líneas de
negocio y nativo/escaneado no documentados en el gold set, y — el más importante — la "regla de
promoción" (mejora sin empeorar ningún módulo) seguía siendo 100% manual, solo escrita en el
README, sin nada que la hiciera cumplir.

**Decisión:** de los 4 huecos posibles a cerrar, se priorizó automatizar la regla de promoción por
ser la de mayor apalancamiento — protege TODOS los cambios futuros del proyecto, no solo cierra un
ítem puntual del checklist.

**Cambio:** nuevo script `scripts/regresion/comparar-corridas.mts`. Toma dos reportes de
`run.ts --run` (uno de antes de un cambio, uno de después) y compara **caso por caso y métrica por
métrica** (no un solo pass/fail global, tal como exige el plan: "métrica por módulo, no global").
Da un veredicto automático:
- **PROMUEVE** — al menos una mejora, cero regresiones.
- **NO PROMUEVE** — al menos una regresión, aunque haya mejoras en paralelo (regla estricta, tal
  como está escrita en el plan).
- **SIN CAMBIO NETO** — nada medible cambió.

**Validación:** probado con reportes sintéticos (una mejora real + una regresión real inyectadas a
propósito) — detectó ambas correctamente y dio NO PROMUEVE, tal como debía. Documentado en
`scripts/regresion/README.md`.

**Pendiente (huecos NO cerrados esta ronda, quedan para la próxima):**
- Línea de negocio y nativo/escaneado sin documentar como metadata en `gold.json` (en la práctica
  ya hay balance de nativo/escaneado — 20/31 con OCR, 11/31 sin — pero no queda registrado). Se
  investigó cerrarlo el 28-jul (quinquies) y se descartó por ahora: "línea de negocio" no es un
  campo limpio en la base de datos (se deriva de qué `palabra_clave` hizo match, no queda guardado
  por licitación) — documentarlo bien exige plumbing nuevo, no una anotación rápida.
- Las "tres salidas" (participar/excluir/revisión) desbalanceadas: GANABLE=12 casos, pero excluido
  solo 1 y revisión humana solo 3; 11 de 31 casos ni siquiera declaran un veredicto esperado. No se
  cierra sin criterio de un experto (CA) porque el gold set es la fuente de verdad — inventar un
  veredicto esperado sin que alguien lo haya resuelto a mano contaminaría el propio golden set.

---

## 2026-07-28 (quinquies) — Frente A.3: cierre del hueco POR_LOTES en el Golden Set

**Caso real que lo originó:** de los 3 huecos detectados en la auditoría anterior (quater), este
era el único 100% objetivo y cerrable sin criterio humano nuevo: `POR_LOTES` es un valor real y
vivo de `adjudicacion.como_se_adjudica` (ver `app/lib/viabilidad-ia.ts`, tercer valor junto a
GLOBAL/POR_LINEAS), pero el gold set tenía CERO casos con esa modalidad pese a que el plan exige
explícitamente cobertura de "las tres modalidades".

**Cambio:** se verificaron contra la BD los 2 candidatos ya identificados y se agregaron a
`gold.json` (31 → 33 casos, supera levemente el rango 20-30 del plan; se prefirió no truncar una
cobertura de modalidad real por respetar un techo blando):
- `1037-7-LE26` — Anexo 3 de valorización estructurado en Lotes N°1/2/3, confianza 0.98,
  DETERMINADA/DEFINITIVO.
- `1271359-92-LE26` — mismo eje pero con `heterogeneidad=alta` y `cotizar_100_obligatorio=true`
  (variante distinta del mismo eje), confianza 1.0, DETERMINADA/DEFINITIVO.

Ambos con evidencia textual directa en bases (no ambigua) y verificados contra el informe v3
real guardado en BD — no corrigen ningún error histórico, solo cierran cobertura.

**Validación:** `npx tsx scripts/regresion/run.ts` (dry) — ambos casos nuevos 8/8 ok. Resumen
global del set completo: 23/33 casos perfectos, ninguna métrica bajo 80%.

**Pendiente:** los otros 2 huecos (línea de negocio/nativo-escaneado sin metadata, y balance de
veredictos) quedan documentados arriba, en la entrada (quater).

---

## 2026-07-28 (ter) — Frente A.2: circuito FAIL → acción para las 13 reglas del validador

**Caso real que lo originó:** auditoría del plan mostró que, desde el 21-jul, SOLO la regla V-12
disparaba alguna acción (re-análisis); las otras 13 reglas (V-01 a V-11, V-13, V-14) solo se
guardaban en `_validador` para la pantalla, sin bloquear ni escalar nada — incumpliendo el punto
del plan "un FAIL re-corre en el modelo grande o manda a revisión humana citando la regla".

**Decisión:** código puro, sin IA. Se clasificaron las 13 reglas en 3 mecanismos distintos según
si el dato correcto se puede derivar solo, necesita releer, o necesita juicio humano:

1. **Auto-corrección** (`autocorregirHallazgos`, `validador-viabilidad.ts`) — el dato correcto YA
   existe en otra parte del mismo informe (una fórmula fija o evidencia ya citada por el modelo).
   Corrige el campo directo, instantáneo, SIN volver a llamar a la IA: **V-02** (veredicto↔score),
   **V-05** (cadena larga si exige fiel cumplimiento), **V-06** (gate duro sin GANABLE), **V-07**
   (presupuesto neto = bruto/1.19), **V-13** (usa la evidencia "Múltiple (Por líneas)" ya citada
   para corregir `como_se_adjudica`), **V-14** (normaliza enums mal formados, espacio→guion bajo).
2. **Re-análisis** (generalización de la lógica de V-12 en `_orquestarAnalisisV3`,
   `viabilidad-ia.ts`) — el dato falta por completo y bloquea el Frente D (costeo). Se agregó
   **V-09** (manifiesto vacío) al mismo mecanismo de "reintentar una vez, quedarse con el menos
   degradado, forzar REVISION_HUMANA si el 2º intento también falla" que ya usaba V-12.
3. **Revisión humana** (`escalarARevisionHumana`) — no hay forma honesta de adivinar el dato:
   **V-01** (ponderaciones mal, no se sabe cuál criterio corregir sin releer), **V-03** (colchón
   posiblemente subestimado), **V-08** (por línea sin evidencia — la incertidumbre ES la
   respuesta), **V-10** (criterio sin fuente citada), **V-11** (estrategia de negocio incoherente
   con la adjudicación). Dispara sin importar severidad (`error` o `aviso` — V-08 y V-10 son
   siempre `aviso` y aun así ameritan revisión). Marca `veredicto.estado_veredicto =
   'REVISION_HUMANA'` y cita cada regla en `veredicto.motivos_revision`.

**Orden de ejecución** (en `_analizarViabilidadIAV3Intento`, `viabilidad-ia.ts`): valida → auto-
corrige → **re-valida sobre el informe ya corregido** (para que `_validador` refleje la realidad
post-fix, no la de antes) → recién ahí decide si algo sigue necesitando revisión humana.

**Validación:** `tsc` limpio · `npm run test:viabilidad`: **72/72** (9 tests nuevos: 6 de
auto-corrección + 3 de escalada). Bug propio detectado y corregido en el camino: los tests nuevos
mutan el informe (a diferencia de los anteriores, que solo lo leen) — reusar objetos anidados de
`base` los contaminaba entre tests por referencia compartida; se armó `infFresco()` para dar
objetos frescos a cada test. **Golden Set completo (`--run`): no se corrió para esta ronda.**

---

## 2026-07-28 (bis) — Auditoría masiva de sinónimos de adjudicación (892 licitaciones)

**Caso real que lo originó:** tras cerrar el caso 1057536-83-LE26 (ver entrada de abajo), CA pidió
minar TODA la base de datos para encontrar sinónimos de "adjudicación por línea/global" que hoy no
reconocemos, en vez de esperar caso por caso.

**Decisión:** regla de código (nuevos patrones deterministas en `detectarTipoAdjudicacionMultiple`),
no ajuste de prompt.

**Método:** script de auditoría de solo lectura (`scripts/auditar-sinonimos-adjudicacion.mts`) que
corre los 5 detectores reales de adjudicación contra el texto cacheado de las 892 licitaciones con
documentos, y lista los fragmentos "adjudicación + línea/lote/ítem" que ningún detector reconoce.
Primera corrida: 280 fragmentos sin reconocer. Se agruparon por patrón real (no caso por caso) y se
codificaron los de mayor confianza:

1. **"a un [solo] oferente/proveedor por/en línea"** generalizado — el "solo/único" era opcional en
   la práctica, y faltaba la forma pasiva ("ser adjudicada a un solo oferente por línea").
2. **Orden invertido singular**: "resultar adjudicado **a un proveedor distinto**" (antes solo se
   cubría el plural "distintos oferentes", adjetivo ANTES del sustantivo).
3. **Orden invertido plural**: "oferentes/proveedores **distintos**" (sustantivo antes del
   adjetivo, faltaba el complemento del patrón anterior).
4. **"ítems" agregado** como alternativa a línea/lote en el cluster de "distintos oferentes".
5. **Encabezado/etiqueta nominal** "ADJUDICACIÓN [simple/múltiple] POR LÍNEA" sin verbo conjugado
   (ningún patrón anterior lo reconocía — todos exigían el verbo "adjudicar"). Ventana corta (20
   caracteres) y restringida a "por" (nunca "en", para no reabrir el falso amigo ya documentado
   "adjudicación... en línea" = por internet).
6. **Confianza media**: "mejor oferta / mayor puntaje por/de cada línea" — el ganador se determina
   línea por línea aunque no diga explícitamente "oferente distinto".

**Resultado de la auditoría tras el fix:** 280 → 186 fragmentos sin reconocer (34% de reducción).
**Cero conflictos con el Golden Set**: de los 9 casos ya curados que ahora disparan el detector,
los 9 ya esperaban `POR_LINEAS` en `gold.json` — ninguna regresión.

**Caveat anotado (no codificado, requiere más contexto):** "Adjudicación simple **o** por línea"
(2981-169-LE26) puede ser un campo de plantilla con checkbox listando AMBAS opciones sin indicar
cuál se marcó — vale revisarlo a mano si aparece como conflicto en el futuro.

**Validación:** `tsc` limpio · `npm run test:viabilidad`: **63/63** (11 tests nuevos, más el que ya
existía). **Golden Set completo (`--run`): no se corrió aparte para esta ronda** — se validó vía el
script de auditoría (dry, sin LLM) contra las 892 licitaciones y contra los 31 casos curados.

---

## 2026-07-28 — Caso 1057536-83-LE26 (CESFAM Frutillar, equipamiento médico)

**Caso real que lo originó:** CA reportó que esta licitación (6 líneas de equipamiento médico
heterogéneo, cada una con presupuesto propio) salía GLOBAL/suma_alzada, y según las bases debía
ser por línea. Se verificó en dos corridas distintas del análisis: la primera vez el LLM dijo
POR_LINEAS y se corrigió a GLOBAL por "falta de evidencia objetiva"; la segunda vez el LLM dijo
GLOBAL directo con confianza 1 — mismo documento, mismo texto, veredictos distintos (el modelo no
es determinista).

**Decisión:** regla de código (determinismo/override), no ajuste de prompt. Tres cambios
separados, dos ejes distintos:

1. **Costeo independiente de la adjudicación** (`viabilidad-ia.ts`, bloque "PUENTE AL COSTEO"):
   se reconectó `veredictoModalidadDeterminista` (existía desde el 21-jul pero estaba desconectado
   a propósito) para que el costeo pueda salir `por_linea` aunque la adjudicación sea GLOBAL, con
   evidencia dura del formato de la oferta económica. Solo PROMUEVE (nunca degrada un `por_linea`
   ya decidido).
2. **Promoción de costeo por heterogeneidad del manifiesto** (mismo bloque): cuando no hay
   evidencia dura de bases pero el manifiesto del LLM trae pocas líneas (≤20), cada una con
   presupuesto propio y `heterogeneidad: "alta"`, el costeo también se promueve a `por_linea`.
   Aplica **solo a costeo**, nunca a adjudicación (un intento anterior de usar esta misma señal
   para forzar la adjudicación a POR_LINEAS se revirtió el mismo día — CA aclaró que a quién se
   adjudica sale SOLO de las bases, nunca de cómo el LLM agrupó los productos).
3. **Nuevo patrón en `detectarTipoAdjudicacionMultiple`** (`planilla-costeo-parser.ts`): las bases
   decían "Se podrá adjudicar **a un solo proveedor** por línea" (Art. 24.2) — ningún patrón
   existente lo reconocía porque "a un solo proveedor" queda entre "adjudicar" y "por línea". Este
   es el fix más fuerte: convierte la adjudicación en 100% determinista (ya no depende de que el
   LLM lea bien las bases ese día).

**Validación:** `tsc` limpio · `npm run test:viabilidad` 52/52 (se agregó 1 test de regresión
nuevo) · verificado con re-análisis real guardado en BD (confianza 1, `estado: DETERMINADA`,
`adjudicacion: POR_LINEAS`, `modalidad: por_linea`) · agregado a `scripts/regresion/gold.json`.
**Golden Set completo (`run.ts --run`): pendiente de correr.**

---

## Plantilla para la próxima entrada

```
## AAAA-MM-DD — Caso <código> (<organismo/rubro, breve>)

**Caso real que lo originó:** <qué reportó CA, con qué evidencia>

**Decisión:** regla de validador (V-XX) | ajuste de código determinista | ajuste de prompt
<si es prompt: "SE CONGELA — no se edita hasta acordar el paquete completo">

**Cambio:** <archivo:función, qué se agregó/modificó>

**Validación:** tsc · test:viabilidad (N/N) · Golden Set (pasa/no pasa, o pendiente)
```
