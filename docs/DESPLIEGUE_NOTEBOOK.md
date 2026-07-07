# 🚀 Actualizar el notebook (IP chilena) — copiar/pegar

Notebook = Docker + Cloudflare quick tunnel, único con **IP chilena** (obligatoria para descargar
documentos de Mercado Público). Actualizar el código **NO cambia** la URL del túnel si reconstruyes
solo `app` (no toques `cloudflared`).

---

## PASO 1 — Traer el código nuevo

```bash
git pull
```

## PASO 2 — Agregar/verificar variables en el `.env` del notebook

Abre el `.env` que usa docker-compose (`nano .env`) y asegúrate de que estén estas líneas.
**Las 2 primeras son NUEVAS** (el cambio de modelo IA — sin ellas seguiría usando el modelo viejo):

```bash
# ── IA de texto (Z.AI / GLM) — NUEVO ─────────────────────────────
GLM_TEXT_MODEL=glm-4.7-flashx          # rápido, barato y NO se cuelga (glm-4.6 hacía timeout)
GLM_TEXT_MODEL_FALLBACK=glm-4.5-air    # respaldo GLM en la misma cuenta si el principal falla
IA_TEXT_PROVIDER=zai                   # todo el texto por GLM (Z.AI)
IA_OCR_PROVIDER=zai                    # OCR de documentos por GLM-OCR
IA_SIN_RESPALDO=0                      # 0 = respaldo activo (DeepSeek solo como último recurso)
ZAI_API_KEY=<tu key de Z.AI>           # OBLIGATORIA
DEEPSEEK_API_KEY=<tu key DeepSeek>     # respaldo de último recurso

# ── Gemini DESACTIVADO (no se usa ni como respaldo) ──────────────
# Dejar SIN GEMINI_API_KEY y SIN GEMINI_HABILITADO. Si existen, borrarlas/comentarlas.

# ── Base de datos (dejar como están) ─────────────────────────────
# DB_POOL_LIMIT=8   ← opcional. Default 8 en el notebook. Súbelo solo si sabes lo que haces
#                     (tope Bluehost max_user_connections=25, compartido con Vercel).

# ── SMTP (correos de asignación / reseteo de clave) ──────────────
SMTP_HOST=mail.sociedadcomercialmp.cl
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=licitaciones@sociedadcomercialmp.cl
SMTP_PASS=Licitaciones2026!
SMTP_FROM="ICA Licitaciones <licitaciones@sociedadcomercialmp.cl>"

# ── Descarga al asignar (dejar como está / no definir para que esté ON) ──
# DESCARGA_AL_ASIGNAR=false   ← SOLO si quieres apagar la descarga automática. Déjalo fuera.
```

## PASO 3 — Reconstruir SOLO la app (la URL del túnel NO cambia)

```bash
docker compose up -d --build app
docker compose logs -f app        # Ctrl+C cuando veas "Ready"
```

## PASO 4 — NO correr migraciones

La BD es Bluehost (compartida) y ya está al día. No hace falta nada.

## PASO 5 — Confirmar que quedó con el modelo nuevo

Asigna cualquier licitación y mira los logs:

```bash
docker compose logs -f app
```

Debes ver `[ia] 💰 glm-4.7-flashx · ...` en el análisis.
- ✅ Si dice `glm-4.7-flashx` → quedó bien.
- ❌ Si dice `glm-4.6` → faltó agregar las variables del PASO 2 o reconstruir.

---

## Qué incluye esta actualización

- **Modelo IA fiable**: `glm-4.7-flashx` reemplaza a `glm-4.6` (que se colgaba con timeout de 120s
  en las llamadas grandes de análisis). Cadena de respaldo **GLM → GLM → DeepSeek** (nunca sale
  de GLM si puede). Calidad de modelo grande al precio más barato.
- **Pool de BD que aguanta varios usuarios**: notebook usa 8 conexiones (antes 3). Probado:
  20 peticiones simultáneas, 0 fallos.
- **Clasificación + viabilidad automáticas al asignar** incluso si el prefiltro excluyó la
  licitación (la asignación manual del admin manda). Antes esas quedaban a medias.

## Si el link del túnel cambió

Solo pasa si hiciste `docker compose down` o se apagó el notebook. La URL nueva sale en:
```bash
docker compose logs cloudflared
```
Actualízala en cron-job.org (jobs de `/api/cron/alertas` y `/api/cron/prefiltro`).
