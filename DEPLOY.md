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

## 2. Crear el túnel en Cloudflare (una sola vez)

> Requiere una cuenta de Cloudflare (gratis) y un dominio agregado a Cloudflare.
> Si no tienes dominio, puedes usar el modo "quick tunnel" (URL aleatoria) — ver nota al final.

1. Entra a **Cloudflare Zero Trust** → https://one.dash.cloudflare.com
2. Menú **Networks → Tunnels → Create a tunnel** → tipo **Cloudflared**.
3. Ponle un nombre (ej. `licitapyme`) y **copia el token** que te muestra
   (es la cadena larga del comando `cloudflared ... run <TOKEN>`). Ese valor va en
   `CLOUDFLARE_TUNNEL_TOKEN` del `.env`.
4. En **Public Hostnames → Add a public hostname**:
   - **Subdomain:** `app-licita` (o el que quieras)
   - **Domain:** tu dominio
   - **Type:** `HTTP`
   - **URL:** `app:3000`  ← (nombre del servicio Docker + puerto interno; NO localhost)
5. Guarda. Tu link público será `https://app-licita.tudominio.com`.

---

## 3. Configurar variables y levantar (en el notebook)

```bash
cp .env.example .env
# edita .env con los valores reales (DB, R2, tickets, keys, y CLOUDFLARE_TUNNEL_TOKEN)

docker compose up -d --build
```

- Comprueba que ambos contenedores estén "Up":  `docker compose ps`
- Logs en vivo:  `docker compose logs -f`
- La app responde en el link público y también en `http://localhost:3003` del propio notebook.

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
2. **URL:** `https://app-licita.tudominio.com/api/cron/alertas`
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
