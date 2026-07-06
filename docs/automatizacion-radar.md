# Automatización del radar: prefiltro + descarga de documentos

Objetivo: que cuando caen licitaciones nuevas al radar (cron de keywords, cada ~4h),
**se prefiltren solas** y luego **se descarguen los documentos SOLO de las que pasan**
(decisión `PASA` o `REVISION_HUMANA`). Las `EXCLUIDO` nunca descargan.

El flujo se divide en dos porque tienen requisitos distintos:

| Paso | Dónde corre | Por qué |
|------|-------------|---------|
| **1. Prefiltro** (Fase 0) | Vercel (nube) | Usa DeepSeek. No necesita IP chilena. |
| **2. Descarga de las PASA** | **PC/notebook con IP chilena** | El portal de Mercado Público solo deja descargar desde IP chilena. |

> ⚠️ Reemplaza en todo este documento:
> - `TU-APP.vercel.app` → el dominio real de tu app en Vercel.
> - `<CRON_SECRET>` → el valor de `CRON_SECRET` de tu `.env.local` / variables de Vercel.

---

## PASO 1 — Prefiltro automático (en la nube, Vercel)

Ya está en el código: endpoint `app/api/cron/prefiltro/route.ts`. Solo falta activarlo.

### 1.1 Desplegar
Sube los cambios a Vercel (git push a la rama que Vercel despliega). Nada más que hacer en el código.

### 1.2 Programar el disparo cada 4 horas (cron-job.org)
Igual que ya tienes el intake de keywords, agrega **un segundo job**:

- **URL:** `https://TU-APP.vercel.app/api/cron/prefiltro`
- **Método:** `POST`
- **Header:** `x-cron-secret: <CRON_SECRET>`
- **Horario:** cada 4 horas, **~30 min después** del job de intake (para que las
  licitaciones ya estén dentro cuando corra el prefiltro).

> Alternativa: Vercel ya tiene un cron diario de respaldo configurado en `vercel.json`
> (`/api/cron/prefiltro` a las 09:30). El de cron-job.org es el que da la cadencia de 4h.

### 1.3 Probar a mano (opcional)
```bash
curl -X POST "https://TU-APP.vercel.app/api/cron/prefiltro" -H "x-cron-secret: <CRON_SECRET>"
```
Respuesta esperada (ejemplo):
```json
{"success":true,"procesadas":12,"pasa":4,"excluido":7,"revision":1,"pendientes":0,"completado":true}
```

---

## PASO 2 — Descarga automática de las PASA (en el PC con IP chilena)

Este PASO corre en el **notebook chileno**, donde está la app (Docker/local). Descarga los
documentos de las licitaciones `PASA`/`REVISION_HUMANA` que aún no tienen documentos y dispara
el pipeline de IA. Es reanudable e idempotente (salta lo ya descargado).

### 2.1 Encender el scheduler
Desde la carpeta del proyecto en el notebook:
```bash
npm run scheduler:radar
```
Esto queda en bucle: cada pocos minutos revisa y descarga las PASA pendientes.

Opciones útiles:
```bash
# intervalo entre corridas y tamaño de lote
node scripts/scheduler-procesar-radar.mjs --intervalo=120 --loteDescarga=3

# si la app del notebook no está en localhost:3000
node scripts/scheduler-procesar-radar.mjs --base=http://localhost:PUERTO

# una sola corrida (para el Programador de tareas de Windows)
node scripts/scheduler-procesar-radar.mjs --once
```
> Lee `CRON_SECRET` del `.env.local` del notebook automáticamente.

### 2.2 Dejarlo corriendo 24/7
Elige UNA opción:

**A) pm2 (recomendado, sobrevive reinicios):**
```bash
npm install -g pm2
pm2 start "npm run scheduler:radar" --name radar-scheduler
pm2 save
pm2 startup   # sigue las instrucciones que imprime, para que arranque solo al prender el PC
```

**B) Programador de tareas de Windows** (si el notebook es Windows):
- Acción: `node`
- Argumentos: `scripts/scheduler-procesar-radar.mjs --once`
- Iniciar en: la carpeta del proyecto
- Desencadenador: repetir cada 10 minutos.

**C) Docker (si la app ya corre en Docker):** agrega un segundo servicio en tu
`docker-compose` que ejecute `npm run scheduler:radar` en el mismo contenedor/red.

> ℹ️ Hay un backlog inicial de ~2.600 licitaciones PASA sin documentos. Descargar es lento
> (~1–2 min cada una, límite seguro del portal), así que drenarlo tomará **varios días** de
> scheduler encendido. Lo nuevo (lo que cae cada 4h) se procesa al día sin problema.

---

## Cómo verificar que ya es automático

Desde el proyecto (en cualquier PC con acceso a la BD):
```bash
npm run verif:automatizacion
```
Fíjate en dos números:
- **"SIN prefiltro" (nuevas 24h):** debe quedar en **~0** → el prefiltro automático anda.
- **"PASA/REVISION SIN documentos":** debe ir **bajando hacia 0** con cada ciclo → la descarga anda.

Cuando ambos se mantengan cerca de 0 por un par de ciclos, la automatización está completa y
**recién ahí conviene quitar los botones manuales del radar** (Prefiltro, Procesar PASA,
Descargar, Enriquecer), porque ya no hacen falta.

---

## Resumen rápido (checklist)

- [ ] Desplegar a Vercel (git push).
- [ ] cron-job.org: nuevo job `POST /api/cron/prefiltro` con header `x-cron-secret`, cada 4h.
- [ ] Notebook: `npm run scheduler:radar` corriendo 24/7 (pm2 / Tarea programada / Docker).
- [ ] Verificar con `npm run verif:automatizacion` hasta que los dos números queden en ~0.
- [ ] Recién entonces: limpiar los botones manuales del radar.
