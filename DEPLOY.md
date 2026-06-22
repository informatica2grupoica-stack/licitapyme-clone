# Despliegue en el notebook chileno (Docker + Cloudflare Tunnel)

La app corre **en el notebook** (siempre encendido, IP chilena). El descargador de
Mercado Público sale por esa IP chilena, así que funciona igual que en tu PC local.
Cloudflare Tunnel publica la app en un link HTTPS al que **cualquiera entra desde
cualquier PC**, sin abrir puertos del router.

```
[Este PC: editas código] --git push--> [GitHub] --git pull--> [NOTEBOOK: Docker + túnel]
                                                                      │
                                              link público HTTPS ◄────┘  (Cloudflare)
```

---

## 1. Preparar el notebook (una sola vez)

1. **Instala Docker Desktop** (Windows/Mac) o Docker Engine (Linux) en el notebook.
   - En Docker Desktop → Settings → General → activa **"Start Docker Desktop when you log in"**
     para que la app vuelva sola si el notebook se reinicia.
2. **Trae el código** al notebook:
   - Opción A (recomendada): `git clone <url-del-repo>` y luego `git pull` para actualizar.
   - Opción B: copia la carpeta del proyecto por USB / red.

---

## 2. El túnel (Quick Tunnel — gratis, SIN dominio)

No hace falta crear nada en el panel de Cloudflare ni token. El `docker-compose` ya
está configurado con **Quick Tunnel**: al levantar, el contenedor `cloudflared` genera
una URL pública aleatoria `https://<algo>.trycloudflare.com`.

- En el `.env` deja `CLOUDFLARE_TUNNEL_TOKEN=` **vacío**.
- La URL pública aparece en los logs (ver PASO 5 más abajo).
- ⚠️ La URL **cambia en cada reinicio** del contenedor. Sirve para pruebas; para un
  link fijo (`app-licita.tudominio.com`) necesitas un dominio propio agregado a
  Cloudflare y migrar al modo "túnel con nombre + token".

---

## 3. Configurar variables y levantar (en el notebook)

```bash
cp .env.example .env
# edita .env con los valores reales (DB, R2, tickets, keys). CLOUDFLARE_TUNNEL_TOKEN va vacío.

docker compose up -d --build
```

- Comprueba que ambos contenedores estén "Up":  `docker compose ps`
- Logs en vivo:  `docker compose logs -f`
- **Obtén el link público (quick tunnel):**
  ```bash
  docker compose logs cloudflared | grep trycloudflare.com
  ```
  Verás `https://<algo>.trycloudflare.com` — ese es tu link público (cambia en cada reinicio).
- También responde en `http://localhost:3003` del propio notebook.

Para actualizar tras cambios de código:
```bash
git pull
docker compose up -d --build
```

Apagar:  `docker compose down`

---

## 4. El cron (reemplaza al Vercel Cron)

En el notebook ya no existe Vercel Cron. Usa **https://cron-job.org** (gratis):

1. Crea un cronjob nuevo.
2. **URL:** `https://<tu-link-trycloudflare>/api/cron/alertas`  (el del quick tunnel; actualízalo si reinicias)
3. **Método:** GET
4. **Headers:** `Authorization: Bearer <el-valor-de-CRON_SECRET>`
5. **Schedule:** el que quieras (ej. cada 4 horas).

Eso dispara la búsqueda+matcheo de alertas (usa la API oficial de MP, no el descargador).

---

## 5. ¿Y Vercel?

Puedes **pausar** el proyecto en Vercel (Settings → pausar) mientras pruebas en el
notebook, y recuperarlo cuando quieras. No hace falta borrarlo.

---

## Notas

- **Quick tunnel sin dominio:** si no tienes dominio, cambia el servicio `cloudflared`
  por `command: tunnel --no-autoupdate --url http://app:3000` (sin token). Cloudflare
  te da una URL `https://<aleatorio>.trycloudflare.com` que **cambia en cada reinicio**
  — sirve para una prueba rápida, no para algo estable.
- **El link solo vive si el notebook está encendido** y los contenedores corriendo.
  Por eso conviene "arrancar Docker al iniciar sesión".
- **El descargador** necesita la IP chilena del notebook: no muevas ese contenedor a un
  datacenter extranjero o el WAF de Mercado Público lo bloqueará.
