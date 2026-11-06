---
name: multiempresa-escalable
description: Reglas para que todo lo que se construya en LICITANK sirva después para OTRAS empresas que compren el sistema (multi-cliente / SaaS), no solo para Grupo ICA. Usar SIEMPRE al crear o cambiar una tabla, una ruta API, una integración externa (correo, Obuma, WhatsApp, IA, R2), un PDF o documento con datos de empresa, un cron, un permiso o una pantalla nueva; y cuando el dueño diga «escalable», «para vender», «para otras empresas» o «multi-cliente».
---

# LICITANK multiempresa: construir pensando en vender

El dueño va a vender LICITANK a otras empresas. Cada cosa nueva tiene que funcionar igual para
Grupo ICA y para una empresa que entre mañana, **sin tocar código para darla de alta**. Si algo
solo sirve para ICA, se dice y se deja anotado en la memoria; no se esconde.

## Dos niveles que no se confunden

| Nivel | Qué es | Dónde vive | Ejemplo |
|---|---|---|---|
| **Cliente** (tenant) | La empresa que paga LICITANK | `clientes`, `usuarios.cliente_id`, `negocios.cliente_id` | Grupo ICA = `CLIENTE_ICA` (1) |
| **Empresa / razón social** | Cada RUT con el que ese cliente postula, compra o factura | `empresas`, `negocios.empresa_id` | Inversiones Claro, Comercial MP (las dos son del cliente 1) |

Un cliente tiene una o varias razones sociales. Los datos se separan por **cliente**. Los datos
que salen hacia afuera (emisor de una OC, remitente de un correo, logo, firma, credenciales de
Obuma) se toman de la **empresa** del negocio.

## Antes de escribir código

1. Lee `app/lib/tenant.ts`, `app/lib/modulos.ts` y la sección «Multi-cliente» de `docs/memoria/infra.md`.
2. Pregúntate cada una de estas cosas. Si alguna respuesta es «solo ICA», arréglala o anótala:
   - ¿Qué pasa si esto lo usa el cliente 2? ¿Ve datos del cliente 1?
   - ¿Hay un RUT, razón social, dirección, correo, teléfono, logo, id de Obuma o nombre de persona escrito en el código?
   - ¿La credencial o cuenta externa es una sola en `.env` para todos?
   - ¿Sirve si la empresa tiene 1 razón social o tiene 5? ¿Si tiene 3 usuarios o 300?

## Reglas

### 1. Datos: siempre separados por cliente
- Tabla nueva con datos de negocio → columna `cliente_id INT NOT NULL` + índice que empiece por `cliente_id`. Si cuelga de `negocios`, puede heredar el cliente por el JOIN (`COALESCE(n.cliente_id, 1) = ?`), pero entonces **toda** consulta pasa por ese JOIN.
- El cliente **nunca** sale del navegador (ni del body, ni de query, ni de un header que mande el cliente). Sale de la sesión: `clienteDeHeader(req)` (header que `proxy.ts` pisa en cada petición) o `getClienteId(req)` en `app/lib/api-auth.ts` para rutas sensibles.
- Anti-IDOR: toda ruta que recibe un id (`negocioId`, `ocId`, `documentoId`…) comprueba que sea del cliente **antes** de leer o escribir (`negocioEsDeMiEmpresa`, `negocioEsDeCliente`). Un id de otra empresa responde «no encontrado», igual que uno que no existe.
- Las listas, los conteos, los KPI y las búsquedas filtran por cliente **en el SQL**, no después en JS.
- Migración: archivo en `docs/migration-<n>-<tema>.sql` + `scripts/aplicar-migration-<n>.mjs`; las filas viejas quedan con `cliente_id = 1`. Revisar que el número esté libre: `node scripts/scratch/chequear-migraciones.mjs`.

### 2. Nada de datos de empresa escritos en el código
- RUT, razón social, giro, dirección, correo, teléfono, logo y firma de quien emite → tabla `empresas` (o una tabla de configuración por empresa), nunca una constante.
- Si hoy existe una constante (ej. `EMISORES['1005']` en `compras-oc-documento.ts`, `EMISORES_PROPIOS` en `compras-oc-propia.ts`), no copies el patrón: lee de la base y deja la constante solo como respaldo de ICA, con un comentario que lo diga.
- Textos visibles con el nombre de la empresa («Inversiones Claro», «Grupo ICA», «Comercial MP») salen del dato, no del texto fijo.
- Archivos por empresa (logos, firmas, plantillas) → R2 bajo `clientes/<cliente_id>/…`, no en `public/` con el nombre de la empresa.

### 3. Integraciones externas: una cuenta por cliente (o empresa), con respaldo
Hoy el correo (SMTP), Obuma, WhatsApp (Evolution) y las llaves de IA son **una sola cuenta en `.env`**. Al construir algo que las usa:
- Escribe la llamada detrás de una función que reciba **de quién** es el envío (cliente / empresa), aunque hoy siempre devuelva la cuenta de `.env`. Así, dar cuentas por cliente después es cambiar una función y no 20 rutas.
- Credenciales por cliente → tabla de configuración cifrada (nunca en texto plano en la base ni en git). Si no hay configuración para ese cliente, se usa la de `.env` **solo si el cliente es ICA**; para otro cliente, la función se niega con un mensaje claro («Configura tu correo de envío en Mi empresa»).
- **Correo**: el remitente visible es la persona o la empresa que envía, y las respuestas van a ella (`replyTo`). Para vender se necesita un proveedor de envío con dominio verificado por cliente (Brevo / Resend / SES), porque el SMTP compartido de Bluehost **no entrega en Gmail** (probado el 05/06-nov-2026, ver `docs/memoria/compras.md`).
- **Obuma** existe solo para Inversiones Claro. Un cliente sin Obuma no puede quedar bloqueado: toda función que dependa de Obuma tiene un camino propio de LICITANK (como la OC propia de Comercial MP) o se oculta para ese cliente.
- Límites externos (API de Mercado Público: 1 ticket por persona, 10.000 consultas/día; cuotas de Obuma; tasa de correo) se cuentan **por cliente**, para que uno no agote al resto.

### 4. Módulos y permisos
- Pantalla o ruta nueva → clasificarla en `app/lib/modulos.ts` (a qué módulo pertenece). Un módulo solo entra en `MODULOS_ACTIVABLES` cuando **todas** sus tablas están separadas por cliente y probadas. Hoy: radar, negocios, viabilidad. Compras, Auditor, Costeo y Anexos todavía leen tablas de ICA.
- Los permisos se revisan dentro del cliente: un admin del cliente 2 no administra al cliente 1. El superusuario del dueño (`es_superadmin`) es el único que cruza clientes.
- El perfil `externo` solo ve lo suyo.

### 5. Escala (muchos clientes, muchos usuarios)
- Consultas con índice por `cliente_id` + el filtro principal; nada de traer una tabla entera para filtrar en JS.
- Las cosas que hacen muchas peticiones van en serie con tope, o en cola (el pool de MySQL es chico, ver la memoria «velocidad de Compras»).
- Los crons recorren **por cliente** y un error de un cliente no corta a los demás (try/catch por cliente, y queda anotado).
- Cachés en memoria con clave que incluya el `cliente_id`.
- Los avisos (campana, correo, WhatsApp) nunca cruzan clientes: `registrarEvento` ya corta si actor y destinatario son de clientes distintos; los «a todos los admin» se filtran por cliente.

### 6. Datos personales y legal (Ley 21.719, rige desde el 2026-12-01)
- Guardar solo lo necesario de proveedores y contactos; cada dato personal pertenece a un cliente y se borra con él.
- Nada de datos de un cliente en logs que vea otro, ni en mensajes de error (`mensajeSeguro`).
- Lo legal lo valida un abogado: no lo inventes, déjalo anotado.

## Cómo probarlo
- Con la BD local Docker (puerto 3308, ver `docs/memoria/infra.md`) y un usuario del cliente 2: la pantalla nueva no muestra nada de ICA, un id de ICA en la URL responde 404 y la acción no escribe en filas de ICA.
- Busca en tu cambio: `rg -n "76\.902|78\.388|Inversiones Claro|Comercial MP|Grupo ICA|grupoica|sociedadcomercialmp" <archivos>`. Cada resultado tiene que estar justificado (respaldo de ICA comentado) o salir de la base.

## Al terminar
En la entrada de memoria del módulo (skill `memoria-proyecto`), agrega una línea **«Multiempresa:»** que diga si lo nuevo ya sirve para otro cliente o qué le falta (ej. «remitente y PDF salen de `empresas`; la cuenta de correo sigue siendo la de `.env`, falta proveedor por cliente»).
