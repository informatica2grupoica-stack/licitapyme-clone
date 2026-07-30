# Qué No Funciona — LicitaPyme

> **Última revisión: 2026-07-30.** Este documento describía la época en que la app corría solo
> en Vercel y la descarga de documentos era imposible. **Eso ya está resuelto** (VPS chileno).
> Se conserva el historial porque explica POR QUÉ la arquitectura es como es — pero lo que
> sigue vigente está marcado como tal.

---

## ✅ RESUELTO — Descarga automática de documentos de Mercado Público

### El problema (histórico)

Los documentos adjuntos de las licitaciones están alojados en servidores de Mercado Público
bajo URLs del tipo:

```
https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?enc=...
```

MP tiene un **WAF** que bloquea toda solicitud que no venga de una IP de ISP chileno. Vercel
despliega en AWS (Estados Unidos), así que todas sus solicitudes salientes eran bloqueadas con
una página HTML que contenía `robot.png` en lugar del archivo.

### Lo que se intentó desde Vercel (y no funcionó)

| Estrategia | Por qué falló |
|---|---|
| Fetch directo desde Vercel | IP de AWS bloqueada por WAF de MP |
| ScrapingAnt con `browser=true` | Las IPs del proxy no son de ISP chileno |
| Scraping del HTML de la ficha | `ViewAttachment.aspx` activa reCAPTCHA Enterprise desde IPs no-CL |
| Extraer la URL desde el JS embebido | El token `enc` tiene TTL corto y solo sirve desde la IP que lo generó |
| API oficial `licitaciones.json` | No expone `Documentos.Listado` (limitación permanente de la API) |

### Cómo se resolvió

**Servidor propio en Chile.** Primero un notebook con Docker + Cloudflare Tunnel, hoy un VPS
chileno (V2Networks). Desde una IP chilena el fetch directo funciona sin proxy ni CAPTCHA.
Por eso **toda la automatización que toca el portal de MP vive en el VPS, no en Vercel**:

- Descarga de documentos (`mp-descarga-*`, `/api/cron/descargar-docs-negocios`)
- Detección de aperturas (`detectar-aperturas.ts`, `/api/cron/aperturas`)
- Foro de preguntas y respuestas (`/api/cron/preguntas`)

Lo que usa la **API oficial** (`api.mercadopublico.cl`) sí corre en cualquier parte, porque
esa API no exige IP chilena: adjudicaciones, estados, detalle de licitación.

La carga manual (arrastrar los adjuntos descargados a mano) sigue existiendo como respaldo y
como vía para los documentos propios de la empresa.

---

## ✅ CORREGIDO — `/api/documentos/auto-descargar`

Este documento decía que el endpoint era "un stub que devuelve `success: false`". **Ya no lo
es.** Hoy descarga los documentos vía `descargarDocumentosLicitacion()` y dispara el pipeline
IA completo (clasificar → análisis exhaustivo → viabilidad) en background.

## ✅ CORREGIDO — `/api/documentos/[codigo]`

Sigue siendo un lector de `documentos_cache` (no hace scraping), pero eso ya no es una
degradación: la descarga la hace el orquestador desde el VPS y esta ruta solo expone el
resultado.

---

## ⚠️ VIGENTE — Lo que sigue sin funcionar

### La API oficial no trae los adjuntos

`api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` devuelve todos los campos de la
licitación **excepto** los documentos adjuntos. Es una limitación permanente y documentada. Por
eso la descarga depende del portal (y por lo tanto de la IP chilena) y no de la API.

### Compra Ágil es invisible para el radar

El radar solo consume `licitaciones.json`. Las Compra Ágil viven en otra API y hoy **no entran
al sistema**. Es la mayor brecha de cobertura conocida frente a la competencia.

### El portal de MP se cae seguido

Los 503 intermitentes del portal rompen descargas. Está mitigado con `fetchMPConReintentos`,
pero cuando MP está caído de verdad no hay nada que hacer salvo reintentar en la próxima
corrida del scheduler.
