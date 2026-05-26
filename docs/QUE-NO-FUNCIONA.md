# Qué No Funciona — LicitaPyme

## Descarga automática de documentos de Mercado Público

### El problema

Los documentos adjuntos de las licitaciones (bases, términos de referencia, especificaciones técnicas, etc.) están alojados en servidores de Mercado Público bajo URLs del tipo:

```
https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?enc=...
https://www.mercadopublico.cl/Procurement/Modules/Attachment/Download.aspx?enc=...
```

Mercado Público tiene un **WAF (Web Application Firewall)** configurado para bloquear todas las solicitudes que no provienen de IPs de ISPs chilenos (Movistar Chile, VTR, Entel, etc.).

Vercel despliega en servidores cloud de AWS en Estados Unidos. Todas las solicitudes salientes de Vercel tienen IPs de data centers extranjeros, y el WAF de MP las bloquea con una respuesta HTML que contiene `robot.png` en lugar del archivo.

### Por qué no se puede resolver fácilmente desde Vercel

1. **La API oficial de MP no incluye los adjuntos**: `api.mercadopublico.cl/servicios/v1/publico/licitaciones.json` devuelve todos los campos de la licitación excepto los documentos adjuntos. Es una limitación permanente y documentada de la API.

2. **Proxies residenciales no funcionan**: Se probaron ScrapingAnt (con `browser=true` y Chromium headless) y proxies similares. MP detecta y bloquea estas IPs porque no son de ISPs chilenos reconocidos.

3. **ScrapingAnt fallback rechazado también**: Aunque ScrapingAnt usa IPs de distintas ubicaciones geográficas, el WAF de MP identifica el tráfico como no-chileno y devuelve la página de bloqueo.

4. **Scraping del HTML de la ficha bloqueado**: La página `DetailsAcquisition.aspx` se puede cargar (no está bloqueada), pero los links a `ViewAttachmentLC.aspx` requieren el parámetro `enc` que es un token encriptado interno, y la página que lo genera (`ViewAttachment.aspx`) activa el reCAPTCHA Enterprise de Google al accederse desde IPs no chilenas.

### Lo que se intentó (y no funcionó)

| Estrategia | Por qué falló |
|---|---|
| Fetch directo desde Vercel | IP de AWS bloqueada por WAF de MP |
| ScrapingAnt con `browser=true` | IPs del proxy no son de ISP chileno |
| Scraping de HTML de la ficha | ViewAttachment.aspx activa reCAPTCHA Enterprise desde IPs no-CL |
| Extraer URL de ViewAttachmentLC desde JS embebido | El token `enc` tiene TTL corto y solo funciona desde la IP que lo generó |
| API oficial `licitaciones.json` | No expone `Documentos.Listado` en su respuesta (limitación de la API) |

### Solución actual (funciona)

El flujo manual es 100% funcional:
1. El usuario abre Mercado Público desde su browser (IP chilena de su ISP).
2. Descarga los adjuntos de la pestaña "Adjuntos" de la licitación.
3. Arrastra los archivos al área de carga de LicitaPyme.
4. Los archivos se suben a R2 y quedan disponibles permanentemente para todos.

### Opciones para automatización futura

Ver `docs/RESUMEN-JEFATURA.md` para opciones con costo.

En términos técnicos, las opciones son:
- **Servidor en Chile** (VPS en NIC Chile, GTD, Entel Empresas): desde una IP chilena, el fetch directo funciona sin proxy.
- **Extensión de Chrome**: el usuario instala una extensión que intercepta su sesión en mercadopublico.cl y sube los adjuntos automáticamente.
- **Integración con ChileCompra**: si MP habilita OAuth o un endpoint autenticado con token de usuario, se podría descargar en nombre del usuario.

---

## Endpoint `/api/documentos/auto-descargar`

Este endpoint fue reemplazado por un stub que devuelve `success: false` con la URL de la ficha. Ya no intenta descargar nada. Se conserva el endpoint para no romper referencias existentes.

## Endpoint `/api/documentos/[codigo]`

Antes intentaba scraping de MP. Ahora es un alias simplificado que solo lee `documentos_cache` de la DB. El scraping fue eliminado porque nunca funcionó desde Vercel de forma confiable.
