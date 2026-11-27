# Correo de LICITANK bajo su propio dominio — guía para el dueño

> **Decisión del dueño (2026-11-27): por ahora se sigue usando el correo de notificaciones actual** (`notificaciones@sociedadcomercialmp.cl`, SMTP de Bluehost de ICA, no el de la empresa cliente Comercial MP). Esta guía queda como opcional para cuando se quiera pasar a `licitank.cl` (más marca y reputación propia). El código ya está listo para ese cambio.

**Para qué:** hoy los correos de la plataforma (recuperar clave, avisos, órdenes de compra) salen por el SMTP de Bluehost de Comercial MP, como
`notificaciones@sociedadcomercialmp.cl`. **Funciona y llega a Gmail** (se arregló el 06-nov con el saludo SMTP). Pero para vender LICITANK a otras empresas conviene
que salga desde **`licitank.cl`**:

1. Una empresa cliente ve un correo «de Comercial MP», no de LICITANK.
2. Reputación y límite de envío compartidos con el correo del día a día de ICA: si un cliente dispara muchos correos, puede afectar a ICA.
3. El SMTP de Bluehost va a 1 correo por segundo por una sola conexión: no escala con muchas empresas.

`licitank.cl` está en Cloudflare y **hoy no tiene ningún registro de correo** (ni SPF, ni DKIM, ni DMARC, ni MX).

## Qué hace falta (lo haces tú: cuentas y DNS)

1. **Elegir un proveedor de envío** (cualquiera con SMTP): Resend, Brevo, Amazon SES, Postmark… Crear la cuenta con tu correo.
2. **Agregar el dominio `licitank.cl`** en el proveedor. Te muestra 3–4 registros DNS (SPF, DKIM y a veces un registro de retorno).
3. **Pegarlos en Cloudflare** (DNS del dominio `licitank.cl`). Cloudflare: los de correo deben ir en **«Solo DNS» (nube gris)**, no con proxy.
4. **Agregar DMARC** en Cloudflare, un TXT en `_dmarc` con valor mínimo: `v=DMARC1; p=none; rua=mailto:tu@correo`.
5. En el proveedor, **verificar el dominio** (botón «Verify»; tarda minutos).
6. Pedir al proveedor las **credenciales SMTP** y poner estas variables en el `.env` del **VPS** (y en `.env.local` si quieres probar desde el PC):

```
SMTP_HOST=<el servidor SMTP que te dé el proveedor>
SMTP_PORT=465            (o 587 con SMTP_SECURE=false, según el proveedor)
SMTP_SECURE=true
SMTP_USER=<usuario SMTP del proveedor>
SMTP_PASS=<clave o API key SMTP del proveedor>
SMTP_FROM="LICITANK <avisos@licitank.cl>"
```

7. Reiniciar la app y el scheduler (`deploy.sh` lo hace).

El código **no cambia**: la app ya usa SMTP genérico. El remitente (`SMTP_FROM`) debe ser una dirección de `licitank.cl`.

## Cómo comprobar que quedó bien (sin enviar nada)

```powershell
node scripts/verificar-correo.mjs
```

Revisa SPF, DKIM y DMARC del dominio del remitente y prueba la conexión y el login al SMTP. No envía correos. Si lees un `✘`, dice qué falta.

Para mandar **un** correo de prueba a una dirección tuya (solo si lo pides con la opción):

```powershell
node scripts/verificar-correo.mjs --enviar-a tu@correo.cl
```

En Gmail: ⋮ → «Mostrar original». Deben decir **SPF: PASS · DKIM: PASS · DMARC: PASS**.

## Notas

- **Las respuestas:** `avisos@licitank.cl` no tiene buzón. Si quieres recibir respuestas, crea un reenvío en Cloudflare Email Routing (gratis) hacia tu correo, o usa «Responder a» en la plantilla.
- **Correos por empresa:** cada empresa-cliente puede conectar **su propio** SMTP en *Mi empresa → Integraciones* para las órdenes de compra. Eso es aparte y ya funciona.
- **Casilla `licitaciones@` comprometida (04-nov):** sigue pendiente cambiar su clave en cPanel (ver `docs/memoria/infra.md`, 2026-11-06). No afecta a este cambio.
- No pegues claves en el chat ni en el repositorio: van solo en los `.env`.
