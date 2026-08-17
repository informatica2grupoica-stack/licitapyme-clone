# Plan: motor de anexos determinista (IA solo como respaldo)

Escrito 17-ago-2026. **EJECUTADO el mismo día** (ver "Estado del repo" al final) — el usuario pidió
sacar la IA al 100% del tramo administrativo, no solo dejar el plan escrito. Objetivo: que el
relleno de anexos **administrativos** (Documentos) no dependa de la IA para lo que es una tabla de
equivalencias, y que nunca más una caída del proveedor se vea como "el motor no supo".

El anexo **económico** y el **técnico** NO entran acá: se hacen desde el Auditor (decisión del
usuario, 17-ago-2026). Este plan es solo el administrativo.

---

## Por qué (evidencia medida hoy, no opinión)

1. **Z.AI devolvió `429 Insufficient balance`** y el relleno completo se cayó. En la UI eso se ve
   como "0/8 respondidos (opcional)" — indistinguible de "la IA analizó y no pudo". Fallo
   silencioso.
2. Sobre el banco de 3 documentos reales: **111 casillas automáticas**, y al revisarlas una por
   una son casi todas mapeo directo etiqueta→campo ("NOMBRE REPRESENTANTE LEGAL" →
   `representante_nombre`). Eso no necesita un LLM.
3. De 859 "pendientes", **818 (95%) son celdas de tabla vacías sin etiqueta ni contexto** — que el
   motor deja pendientes a propósito y seguirá dejando, con IA o sin ella.
4. Dos intentos de mejorar el prompt en un día produjeron una regresión verificada (el "NOMBRE"
   pelado del Anexo N°5 pasó de la persona a la razón social). **El prompt es frágil a la
   edición**: tocar una regla mueve otras que no se querían tocar.

## Lo que YA es determinista (reusar, no reescribir)

`app/lib/anexos-detectar.ts` — cero IA, y hace lo estructuralmente difícil:

| Función | Qué resuelve |
|---|---|
| `detectarCandidatosCelda` / `detectarCandidatosTabla` | dónde hay una casilla que llenar |
| `detectarBlancosInline` | blancos a mitad de párrafo |
| `detectarSecciones` | PERSONA_NATURAL / PERSONA_JURIDICA / UTP + RELLENAR u OMITIR |
| `detectarLineasFirma` / `asignarCamposDeBloqueFirma` | pie de firma, si pide timbre |
| `detectarTripletesFecha` | `__ / __ / __` y `___ de ______ de ___` |
| `detectarAlternativasExcluyentes` | marcar una de dos opciones |
| `esEtiquetaDeCampo`, `detectarCamposConDosPuntos` | qué texto es etiqueta |
| `detectarAvisoNoAplica` | el anexo declara que no corresponde |

En `anexos-ia-motor.ts` ya hay dos ayudas deterministas: `valorExisteEnFicha` (236) y
`campoCalzaConLaEtiqueta` (282).

**Conclusión: la IA hoy solo hace el último tramo — etiqueta → nombre de campo.** Ese tramo es
una tabla.

## Punto de partida regalado

El diccionario determinista original existe en el historial:

```bash
git show 43c1898^:app/lib/anexos-diccionario.ts > app/lib/anexos-diccionario.ts
```

425 líneas. Su doctrina, escrita en su propio encabezado, es la correcta y hay que conservarla:

> A propósito es CONSERVADOR: [...] las etiquetas ambiguas NO están en este diccionario (ni
> "Nombre" ni "Correo electrónico" a secas): solo entran las que, tal cual vienen escritas, ya
> dicen a QUIÉN describen — nunca se inventan, quedan siempre en categoría B (humano completa) o
> van al respaldo IA.

No fue reemplazado por malo, sino por incompleto. La estrategia acá no es volver atrás: es
**diccionario primero, IA como respaldo de lo que el diccionario no cubre**.

---

## Arquitectura propuesta

Insertar un resolvedor determinista ENTRE la detección y la IA, en
`analizarAnexoParaUI` (`app/lib/anexos-rellenar.ts`, ~línea 177 donde hoy entra `resolverAnexoConIA`):

```
detectar (0 IA)
   ↓
[NUEVO] resolverDeterminista()   ← resuelve el 70-85%
   ↓  (solo lo no resuelto)
resolverAnexoConIA()             ← respaldo, y si falla NO borra lo determinista
   ↓
pendientes al humano
```

Regla dura: **la IA nunca puede pisar lo que el diccionario ya resolvió.** Solo agrega.

### Capa 1 — Diccionario de etiquetas inequívocas

Etiqueta normalizada (sin tildes, minúscula, sin puntuación) → campo. Solo las que ya dicen a
quién describen:

- `nombre|razon social del (oferente|proponente|participante)`, `nombre o razon social` → `razon_social`
- `rut de la empresa`, `rut del oferente`, `r.u.t. del proponente` → `rut`
- `nombre (del )?representante legal`, `nombre del apoderado` → `representante_nombre`
- `rut|cedula (de identidad )?del representante` → `representante_rut`
- `cargo`, `cargo o funcion` (dentro de bloque de representante) → `representante_cargo`
- `direccion|domicilio (comercial)?` → `direccion`; `comuna` → `comuna`; `ciudad` → `ciudad`
- `telefono|fono|celular` → `telefono1`; `correo|email|e-mail` → `email1`
- `giro` → `giro`

**Nunca** meter `nombre`, `rut`, `cargo` a secas: se resuelven en la capa 2.

### Capa 2 — Desambiguación por bloque (determinista, sin IA)

Para una etiqueta pelada (`NOMBRE`, `RUT`), decidir mirando las OTRAS casillas del mismo bloque.
Esta es exactamente la regresión que se produjo hoy y la regla que la evita:

- Si el bloque ya tiene una casilla propia de empresa (`NOMBRE DE LA EMPRESA`, `Razón social`)
  → el `NOMBRE` pelado es **la persona**.
  *Caso real 1058086-43-LP26 Anexo N°5:* `NOMBRE: ___ / RUT: ___ / NOMBRE DE LA EMPRESA (si
  correspondiere): ___`. Poner la razón social en la primera la duplica y borra al firmante.
- Si el bloque ya tiene casilla propia de la persona (`Nombre del representante legal`)
  → el pelado es **la empresa**.
- Si no tiene ninguna y es pie de firma → **la persona**.
- El `RUT` pelado sigue SIEMPRE al nombre de su propio bloque. Nunca mezclar nombre de uno con
  RUT del otro.

"Bloque" = celdas contiguas de la misma tabla, o párrafos entre dos líneas de firma. Ya se puede
delimitar con `detectarLineasFirma` + `TablaCruda`.

### Capa 3 — Declaración jurada corrida (100% determinista, hoy es lo que más falla)

El texto da la respuesta en la palabra **inmediatamente anterior** al blanco. Es una tabla de
regex sobre el token previo, no un juicio:

| Texto antes del blanco | Campo |
|---|---|
| `Yo,` / `don` / `doña` | `representante_nombre` |
| `cédula de identidad N°` / `C.I. N°` / `RUN` | `representante_rut` |
| `con domicilio en` | `direccion` |
| `en representación de` | `razon_social` |
| `Rut N°` (2ª aparición de RUT en la oración) | `rut` |

Caso real verificado sin llenar: ANEXO N°4 "FORMULARIO DECLARACIÓN JURADA SIMPLE DE PRÁCTICAS
ANTISINDICALES" (`Yo ___, Cédula de identidad N.º ___, con domicilio en la ciudad de ___, en
representación de ___, Rut Nº ___`). 5 casillas, 5 reglas, cero ambigüedad.

### Capa 4 — Datos de la licitación

`Nombre Licitación Pública`, `ID licitación Pública` → vienen de la API de MP, no de la IA.
Mapear a `licitacion_nombre` / `licitacion_codigo` (ya existen en `anexos-datos.ts`).

### Capa 5 — Localidad y fecha de firma (punto 7 del instructivo, hueco abierto)

- Fecha: ya resuelto, `fecha_hoy` = fecha de cierre (`anexos-ia-motor.ts:326`).
- **Localidad: NO resuelto.** `En ______ a ___ de ___` cae en `firma_fecha` → null.
  El dato ya existe sin usar: `licitacion_comuna` = `ComunaUnidad` (`anexos-datos.ts:215`).
  Caso real visto: `Nueva Imperial, ______`.
  **Ojo:** hay una regla que manda `"[ciudad/país]" → perfil_empresa/region` — esa es la región
  de la empresa, y el instructivo pide la del **organismo licitante**. Corregir.

### Capa 6 — Reglas fijas de política

- Programa de Integridad → siempre "SÍ" (ya está, `anexos-ia-motor.ts:437`; pasarlo a determinista).
- Bloques de Persona Natural / UTP → omitir (ya lo hace `detectarSecciones`).

---

## Lo que NO se puede hacer sin IA (dejar como respaldo)

Ser honesto acá evita prometer un 100% que no existe:

- Etiquetas redactadas de forma no anticipada ("Individualización del compareciente").
- Anexos escaneados (imagen) → `identificarCamposDeSeccionEscaneada` necesita OCR/IA.
- Cruce de experiencia contra órdenes de compra por descripción semántica.
- `especifico_licitacion` (plazos, especificaciones técnicas) — sale de las bases, no de la ficha.

Meta realista: **70-85% determinista** en anexos administrativos, IA para la cola. Y sobre todo:
lo determinista **nunca falla por 429 ni varía entre corridas**.

---

## Arreglos de robustez que van junto (independientes del motor)

1. **Distinguir "IA falló" de "no se pudo resolver".** Hoy son lo mismo en la UI y en el banco.
   Propagar un estado `error_servicio` y mostrarlo: "el servicio de IA no está disponible —
   estas casillas quedaron sin analizar", nunca "0/8 respondidos".
2. **El banco debe abortar si hubo 429.** Hoy imprime un total que parece válido. Las corridas de
   hoy (91, 7) fueron basura por esto y casi llevan a conclusiones falsas.
3. **`scripts/anexos-banco.mts:105` mide mal**: llama `analizarAnexoParaUI(buffer, empresa)` con 2
   de 6 argumentos. Producción pasa `itemsCosteo`, `basesTexto`, `experienciaOcTexto`
   (`app/api/anexos/analizar/route.ts:42`). Todo baseline previo fue ciego a esas tres vías.
4. **Guardarraíl de empresa fail-open** (`anexos-datos.ts:134`): solo valida si YA hay
   `empresa_id`. Sin empresa asignada acepta cualquier `empresaId` del cliente — justo el caso
   que el instructivo prohíbe ("primero se define la empresa oferente").

## Cómo verificar (obligatorio, no opcional)

El estándar del proyecto: suite completa + **regenerar el documento real** antes de dar por
terminado. Nunca un parche por licitación.

```bash
npx tsx --test app/lib/__tests__/*.test.mts          # 227 tests, deben seguir en verde
npx tsx scripts/anexos-banco.mts --out base.json
npx tsx scripts/anexos-banco.mts --comparar base.json --generar salida/
```

Y validar el .docx generado con python-docx (no a ojo):

```bash
python -c "import docx,glob; [docx.Document(f) for f in glob.glob('salida/*.docx')]"
```

Ventaja grande del enfoque determinista: **se puede testear con unit tests de verdad**. Hoy el
prompt no tiene un solo test que lo ejercite — por eso las dos regresiones de hoy pasaron los 227
tests sin despeinarse.

## Estado del repo al escribir esto (antes de ejecutar el plan)

- `194ce35` ("mejora de licitank") **contiene una regresión verificada** en la regla
  "UNA SOLA PERSONA" de `anexos-ia-motor.ts`. El árbol de trabajo ya está revertido a la versión
  de `c666865`; falta subir ese revert (el usuario sube a GitHub siempre, no yo).
- Sano y medido hoy: 227/227 tests · costeo 38/38 Excel correctos · 22/22 .docx válidos.

## Ejecución (17-ago-2026, misma sesión)

Implementado tal cual el diseño de arriba, con dos diferencias respecto al plan original:

1. **No se recuperó el diccionario viejo (`43c1898^:app/lib/anexos-diccionario.ts`) tal cual.**
   Se escribió de nuevo en `app/lib/anexos-determinista.ts`, conservando su doctrina (conservador,
   solo etiquetas inequívocas) pero con los patrones re-derivados y probados contra los 3
   documentos reales del banco — el original tenía 425 líneas sin tests; este tiene test por regla.
2. **Capa 2 (bloque) se generalizó a un guardarraíl de "bloque de TERCERO"**, no previsto en el
   plan original: el banco encontró un caso real (1058086-43-LP26) donde "Nombre / Cargo /
   Institución" es la firma de un CLIENTE que certifica algo del oferente, no la del oferente
   mismo — "Cargo" solo es inequívoco por diccionario, pero ahí describe a otra persona. Ver
   `RE_BLOQUE_TERCERO` / `esBloqueDeTercero` en `anexos-determinista.ts`.

Arquitectura final en `anexos-ia-motor.ts` (`resolverAnexoConIA`, ~línea 900): `resolverDeterminista()`
corre SIEMPRE primero; lo que resuelve nunca se le pregunta a nadie. El respaldo IA (el prompt
`SYS_CAMPOS` completo, sin tocar) queda detrás de `ANEXOS_IA_RESPALDO=1` — **apagado por defecto**.
Con el flag apagado (el caso de hoy), lo que el diccionario no cubre queda `pendiente` con un
motivo legible (`clasificarPendiente`), nunca se llama a Z.AI. Cero riesgo de 429, cero variación
entre corridas, cero regresión de prompt posible en ese tramo.

Medido contra el banco de 3 documentos reales (`npx tsx scripts/anexos-banco.mts`), **100% código,
sin IA**: 89 casillas automáticas (vs. 74 antes de ajustar el diccionario a estos 3 documentos, 0
llamadas a Z.AI en ambos casos — la comparación real es contra la rama de la IA, no medida hoy).
258/258 tests (32 nuevos en `anexos-determinista.test.mts`, uno por regla, incluida la regresión
verificada del Anexo N°5 y el guardarraíl de tercero). 22/22 `.docx` generados válidos con
python-docx.

**Pendiente, fuera de este cambio** (no se tocó, es lo que el plan original marcaba como
"arreglos de robustez independientes"): banco debe abortar en 429 (ya no aplica igual con el flag
apagado, pero sigue valiendo si se enciende `ANEXOS_IA_RESPALDO`), guardarraíl de empresa fail-open
en `anexos-datos.ts:134`, y las capas de anexo económico/técnico (decisión del usuario: esos NO
entran acá, se hacen desde el Auditor).
