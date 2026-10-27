---
name: viabilidad-interrumpida
description: Diagnosticar y resolver cuando el (re)análisis de viabilidad IA de una licitación falla con «El análisis se interrumpió…», «superó el tope de N minutos», queda pegado en «procesando» o se corta siempre en el mismo paso. Usar apenas el dueño o el equipo reporten que la viabilidad de un código no termina.
---

# Viabilidad que se interrumpe

El análisis corre en segundo plano dentro del contenedor `licitapyme`
(`app/api/licitacion-viabilidad-ia/[codigo]/route.ts`). Su estado vive en la tabla
`viabilidad_jobs`: `procesando` mientras corre (con un latido cada 20 s en `actualizado_at`),
`error` si falla, y la fila se borra cuando termina bien. Las fases, en orden:
`leyendo_documentos` → `analizando_ia` → `verificando` → `guardando`.

## Los mensajes y qué significan

| Mensaje en pantalla | Qué pasó de verdad |
|---|---|
| «El análisis se interrumpió en la fase «X»: el servidor se reinició o se cayó…» (antes: «probablemente el servidor se reinició…») | El job dejó de dar latido por más de 150 s y no corre en el proceso actual: el contenedor se reinició (despliegue) o murió (falta de memoria). |
| «superó el tope de 20 minutos» | Tope duro del job. Casi siempre la cadena de modelos (GLM y respaldos) agotando timeouts. El trabajo de fondo puede terminar igual unos minutos después. |
| «No hay documentos legibles para analizar» | `cargarDocumentos` no sacó texto de ningún documento. |
| «No se pudo completar el análisis… (detalle)» | Error real de la IA; el detalle por eslabón está entre paréntesis. El último eslabón no es el diagnóstico. |

## Paso 1 — diagnóstico (solo lectura, desde el PC)

Con el túnel a la BD del VPS abierto (puerto 3307, ver `docs/memoria/infra.md`):

```bash
npx tsx .claude/skills/viabilidad-interrumpida/diagnosticar.mjs <codigo>
```

Muestra el job (estado, fase, cuánto corrió, último latido), los últimos intentos y, por cada
documento EN EL ORDEN EN QUE SE LEE, si se reusa el caché o se vuelve a leer y por qué.

## Paso 2 — logs del contenedor (en el VPS)

El PC no entra por SSH sin permiso del dueño. Pedirle que corra en el VPS:

```bash
docker logs --since 60m licitapyme 2>&1 | grep -E "<codigo>|huérfano|TOPE DURO|heap|Killed|Ready in|SIGTERM"
docker inspect -f '{{.State.StartedAt}} OOMKilled={{.State.OOMKilled}} Restarts={{.RestartCount}}' licitapyme
```

- `StartedAt` dentro de la ventana del análisis → el contenedor arrancó a mitad de camino:
  despliegue (`deploy.sh`) o caída. `OOMKilled=true` o «heap out of memory» → falta de memoria.
- La última línea `[viabilidad-ia] <codigo>: [n/N] leyendo "<doc>"` sin su «leído en …s» dice qué
  documento se estaba leyendo cuando se cortó.

## Paso 3 — causas conocidas y su arreglo

1. **Bucle de re-lectura de un PDF grande** (3712-74-LP26, 27-oct-2026). Un documento ya leído
   se marca «sospechoso» y se vuelve a OCR-ear EN CADA análisis; con un PDF de 45 págs / 10 MB
   la fase `leyendo_documentos` se alarga hasta que el job se corta. Señal: el diagnóstico
   muestra «SE VUELVE A LEER» en un PDF que ya tiene texto y método `pdf-glm-ocr`, y el corte se
   repite en cada intento en la misma fase. Arreglo: corregir la REGLA que lo marca
   (`numeracionTablaIncompleta`, `esTextoBasuraOCR`, `ocrTieneHuecos` en `app/lib/zai-ocr.ts`, o
   la condición `sospechoso` en `cargarDocumentos` de `app/lib/viabilidad-ia.ts` y su copia en
   `app/lib/cv/viabilidad-ia.ts`), con barrido sobre `documentos_cache` antes/después. Nunca
   «arreglarlo» borrando el texto de ese documento.
2. **Despliegue a mitad de análisis.** `StartedAt` del contenedor cae dentro del análisis. No hay
   bug: reintentar. Evitar desplegar mientras alguien analiza.
3. **Falta de memoria con OCR pesado** (PDF > 100 págs troceado con pdf-lib, relleno con Tesseract).
   `OOMKilled=true`. Ver el límite de memoria del servicio `app` en `docker-compose.yml`.
4. **Cadena de modelos lenta** (tope duro). Ver timeouts por modelo en la cadena; esperar unos
   minutos antes de reintentar, el informe suele aparecer solo.
5. **Huérfano falso por latido atrasado** (corregido 27-oct-2026): un job vivo cuyo latido se
   atrasaba (proceso ocupado con OCR) se declaraba huérfano. Ahora el GET no lo declara si el
   `run_id` sigue en `JOBS_EN_ESTE_PROCESO`; si vuelve a pasar, revisar que ese Set se mantenga.

## Paso 4 — cerrar el caso

- Re-analizar gasta IA y toca checklist/costeo: pedir el OK del dueño antes de lanzarlo.
- Un arreglo en el código solo corre en producción cuando el dueño despliega (`deploy.sh`).
- Anotar la causa nueva en el Paso 3 de esta skill y la entrada en `docs/memoria/viabilidad.md`
  (skill `memoria-proyecto`). Así la próxima vez el diagnóstico la reconoce.
