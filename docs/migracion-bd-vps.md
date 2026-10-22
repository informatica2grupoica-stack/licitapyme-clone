# Mover la base de datos de Bluehost al VPS

**Objetivo:** que la base viva en el mismo VPS que la app, que responde en licitank.cl. Hoy cada
consulta va y vuelve a Bluehost en EE.UU. (~155 ms); en el VPS tarda menos de 1 ms y además se acaba
el tope de 25 conexiones. Bluehost queda como **respaldo**: cada noche recibe una copia completa.

Piezas que ya están en el repo:
- `docker-compose.yml` → servicio `db` (MySQL 8.0, perfil `db`, solo escucha en 127.0.0.1).
- `scripts/bd-migrar-desde-bluehost.sh` → copia Bluehost → VPS y compara filas tabla por tabla.
- `scripts/bd-respaldo-nocturno.sh` → copia VPS → archivo `.sql.gz` (7 días) → Bluehost.

Datos de Bluehost (leídos el 22-oct-2026): MySQL 5.7.44, 625 MB (601 de datos + 24 de índices),
136 tablas InnoDB, sin vistas, triggers ni procedimientos, zona horaria MDT, sql_mode
`NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`. El servicio `db` copia esos ajustes (ver los
comentarios en el compose).

---

## 0. Antes de empezar

1. **Desconectar Vercel.** Nadie entra por ahí, pero sigue desplegándose en cada push y conectado a
   Bluehost. Después del cambio vería datos de ayer y lo que alguien guarde ahí se perdería cada noche.
   En vercel.com, en cada proyecto (`licitapyme-clone` y `licitapyme-clone-1erz`):
   Settings → Git → **Disconnect**, o bien Settings → **Delete Project**.
2. **Revisar que el VPS tenga espacio:**
   ```bash
   free -h; df -h /; docker stats --no-stream
   ```
   MySQL va a usar ~1 GB de RAM y ~2 GB de disco (más 7 respaldos de ~150 MB c/u).
   Necesitas **al menos 1,5 GB de RAM disponible** («available») y **5 GB de disco libre**.
   Si no alcanza, sube el plan del VPS antes de seguir.

## 1. Preparar (de día, sin cortar nada)

En el VPS:

```bash
cd ~/licitapyme-clone && git pull
nano .env
```

Agrega al `.env` (sin tocar todavía `DB_HOST`):

```
COMPOSE_PROFILES=db
MYSQL_ROOT_PASSWORD=<una clave larga nueva>
BLUEHOST_DB_HOST=<el mismo valor que tiene hoy DB_HOST>
BLUEHOST_DB_USER=<igual que DB_USER>
BLUEHOST_DB_PASSWORD=<igual que DB_PASSWORD>
BLUEHOST_DB_NAME=<igual que DB_NAME>
```

La base nueva se crea con el **mismo nombre, usuario y clave** que la de Bluehost (`DB_NAME`,
`DB_USER`, `DB_PASSWORD`). Por eso en el corte solo cambia `DB_HOST`.

Levanta solo MySQL y espera a que diga que está lista:

```bash
docker compose up -d db
docker compose logs -f db      # esperar «ready for connections» (dos veces), luego Ctrl+C
docker exec -it licitapyme-db mysql -uroot -p -e "SELECT @@version, @@system_time_zone, NOW(), @@sql_mode"
```

Debe mostrar 8.0.x, `MDT` (o `MST` desde noviembre) y `NO_ENGINE_SUBSTITUTION`.

## 2. Ensayo (la app sigue usando Bluehost)

```bash
bash scripts/bd-migrar-desde-bluehost.sh
```

Sirve para medir cuánto tarda y para ver si hay errores de importación. Como el scheduler sigue
escribiendo en Bluehost, puede que al final reclame que alguna tabla no cuadra por pocas filas: en el
ensayo eso es normal. Si falla **antes** de comparar, por ejemplo con un error de SQL, avísame con
el mensaje.

## 3. Corte (a una hora sin usuarios)

El tiempo sin servicio es lo que tardó la copia en el ensayo más ~30 s de reinicio. Sin servicio
continuo no hay forma de evitarlo: Bluehost compartido no permite replicar la base en vivo.

```bash
cd ~/licitapyme-clone
docker compose stop scheduler app             # nadie escribe en Bluehost mientras se copia
bash scripts/bd-migrar-desde-bluehost.sh      # tiene que terminar en «las 136 tablas tienen las mismas filas»
nano .env                                     # DB_HOST=db   (DB_PORT=3306)
docker compose up -d --force-recreate app scheduler
docker compose logs app --tail=50
```

Entra a licitank.cl y revisa Negocios, Compras y el radar. Si algo se ve raro: **volver atrás**
(paso 6).

## 4. Respaldo nocturno hacia Bluehost

Pruébalo una vez a mano. Tarda varios minutos porque sube todo a EE.UU.:

```bash
mkdir -p ~/respaldos-bd
bash scripts/bd-respaldo-nocturno.sh
```

Si termina en «respaldo OK», prográmalo todos los días a las 3 AM de Chile (el VPS está en hora UTC: 06:00 UTC):

```bash
crontab -e
```

y agrega esta línea:

```
0 6 * * * bash /home/ubuntu/licitapyme-clone/scripts/bd-respaldo-nocturno.sh >> /home/ubuntu/respaldos-bd/respaldo.log 2>&1
```

Para revisar cómo van los respaldos: `tail ~/respaldos-bd/respaldo.log` y `ls -lh ~/respaldos-bd`.

> Desde el corte, **nadie debe escribir en Bluehost**: cada noche se sobreescribe completa.

## 5. Desarrollo desde el PC

Tu `.env.local` hoy apunta a Bluehost. Después del corte esos datos son los de anoche, y lo que
guardes ahí se pierde. Para trabajar contra la base real, abre un túnel SSH en una terminal
(déjala abierta):

```bash
ssh -N -L 3307:127.0.0.1:3306 ubuntu@216.185.51.104
```

y en `.env.local`: `DB_HOST=127.0.0.1` y `DB_PORT=3307`. El usuario y la clave no cambian.

## 6. Volver atrás

Después del corte se subió `DB_POOL_LIMIT=30` en el `.env` del VPS. Con 8 conexiones, al abrir un negocio
de Compras salía «Queue limit reached» porque llegan más de 32 consultas juntas; la MySQL del VPS admite 100.
**Si vuelves a Bluehost, borra esa línea:** el tope allá es de 25 conexiones en total.

Si algo falla después del corte:

```bash
nano .env                                     # DB_HOST=<el de Bluehost otra vez>
docker compose up -d --force-recreate app scheduler
```

Ojo: lo que se haya guardado en el VPS después del corte **no está en Bluehost** hasta que corra el
respaldo nocturno. Si vuelves atrás, primero corre `bash scripts/bd-respaldo-nocturno.sh` para
llevarte esos datos.
