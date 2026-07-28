# Bitácora de cambios — motor de viabilidad (Frente A.1)

Registro vivo de cambios candidatos al motor de viabilidad (`app/lib/viabilidad-ia.ts`,
`app/lib/planilla-costeo-parser.ts`, `app/lib/validador-viabilidad.ts`). Exigido por el circuito
de calidad de Frente A.1 del plan estratégico: **ningún cambio se agrega sin su caso real de
origen, y ninguna versión entra a producción sin pasar el Golden Set** (`scripts/regresion/`).

Cada entrada: fecha · caso real que lo originó · si es regla de validador o ajuste de prompt ·
qué se cambió y dónde · si pasó el Golden Set. Las entradas más nuevas van arriba.

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
