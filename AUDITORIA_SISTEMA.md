# Auditoría de sistema — LICITAPYME

**Fecha:** 21 de octubre de 2026  
**Commit auditado:** `839917c` (`mejoras del costeo`)  
**Rama:** `master`  
**Alcance:** aplicación Next.js, API routes, autenticación, documentos/R2, módulo de compras, IA/OCR, scheduler/worker, migraciones, dependencias y postura de cumplimiento.  
**Naturaleza:** auditoría estática de código y configuración, con revisión de dependencias. No es un pentest dinámico ni una auditoría de infraestructura en producción.

> Este documento reconstruye el baseline de auditoría de código, que no existía en el repositorio. No reemplaza `docs/AUDITORIA_SISTEMA_AUDITOR_2026-10-01.md`, que audita documentación funcional del módulo Auditor.

---

## 1. Resumen ejecutivo

Se identificaron **35 hallazgos**: **3 críticos**, **7 altos**, **14 medios** y **11 bajos**.

| Severidad | Cantidad |
|---|---:|
| Crítica | 3 |
| Alta | 7 |
| Media | 14 |
| Baja | 11 |
| **Total** | **35** |

Los riesgos más relevantes son:

1. **Documentos en R2 sin control de acceso efectivo.** El código genera y entrega URLs públicas y no usa descarga firmada; si el bucket está público, cualquier persona con una URL accede al documento.
2. **Borrado/alteración cross-tenant de objetos R2.** La URL del documento llega desde el cliente y se usa después para borrar el objeto en R2, sin validar que pertenezca a la licitación o al usuario.
3. **Dependencia crítica de Next.js 16.2.6.** `npm audit --omit=dev` reporta 1 vulnerabilidad crítica en `next` (bypass de middleware/proxy, RCE, SSRF y otras) y la aplicación confía en `proxy.ts` para inyectar identidad y rol.
4. **Exposición de datos de empresas.** Cualquier usuario autenticado puede leer empresas, datos bancarios, RUT y firmas por API.
5. **Usuarios eliminados conservan sesión.** Si no existe fila en `usuarios`, `estadoVigente()` mantiene `activo: true`; el JWT dura 7 días.
6. **SSRF en la captura de links del Auditor de Compras.** `visitarLinks()` abre URLs arbitrarias con Puppeteer o `fetch`, sin `urlPublicaSegura()`.
7. **Encolado de descargas sin autorización por licitación.** `/api/documentos/solicitar` no comprueba `puedeVerLicitacion()` y el worker navega a la URL recibida.

La aplicación tiene controles positivos que deben conservarse: JWT con `jose`, cookie `httpOnly`/`SameSite=Lax`, bcrypt costo 12, rate-limit de login, defensa en profundidad en varias rutas administrativas, validación de códigos de licitación, allowlist anti-SSRF en `/api/proxy`, tokens de recuperación aleatorios hasheados y SSE con eventos mínimos.

---

## 2. Metodología y limitaciones

### 2.1 Revisión realizada

- Lectura estática de rutas API, librerías de autenticación, documentos, R2, IA, scheduler y worker.
- Conteo de superficie: 235 `route.ts`; 41 páginas/layouts; 380 archivos en `app/lib`; 55 componentes; 3 servicios.
- Revisión de `proxy.ts`, `auth.ts`, `auth-edge.ts`, `api-auth.ts`, `rol-vigente.ts`, `db.ts`, `r2.ts`, `next.config.ts`.
- Revisión de `package.json` y ejecución de `npm audit --omit=dev --json`.
- Revisión de migraciones: 154 archivos `docs/migration-*.sql`; 114 scripts `scripts/aplicar-migration-*.mjs`.
- Revisión de scheduler, worker y compose.
- Comprobación del árbol de trabajo con `git status`, `git log` y `git diff`.

### 2.2 Limitaciones

- No hubo acceso a producción, MySQL, R2, Cloudflare, Vercel ni al VPS.
- No se verificó la ACL real del bucket R2; C-02 se clasifica como crítica **si el bucket es público**, que es lo que asume el código.
- No se verificó si el worker legacy está desplegado; `docker-compose.yml` no lo incluye.
- No se ejecutó un pentest, fuzzing, análisis dinámico ni pruebas de carga.
- Las cifras de ESLint y TypeScript provienen de la última verificación registrada; no se repitieron en esta pasada.
- Los hallazgos condicionales se indican expresamente.

### 2.3 Estado del árbol de trabajo

- `HEAD`: `839917c`.
- El árbol cambió durante la auditoría. Al cierre de este informe hay **8 archivos modificados** (137 inserciones, 24 eliminaciones) y **2 archivos no trackeados**:
  - Modificados: `app/api/compras/[negocioId]/route.ts`, `app/components/DocumentViewerModal.tsx`, `app/compras/[negocioId]/ComprasChrome.tsx`, `app/compras/[negocioId]/ComprasContext.tsx`, `app/lib/__tests__/planilla-costeo-parser.test.mts`, `app/lib/acta-adjudicacion.ts`, `app/lib/congelamiento.ts`, `app/lib/planilla-costeo-parser.ts`.
  - No trackeados: `AUDITORIA_SISTEMA.md` (este informe) y `scripts/aplicar-migration-156.mjs`.
- El cambio en `DocumentViewerModal.tsx` hace que los Excel públicos se abran con el visor de Microsoft y deja el visor propio (`VisorExcel`) solo para URLs no públicas. Esto reduce la exposición del sink HTML, pero no elimina el código vulnerable (M-01).
- Los demás cambios sin commit son funcionales (facturación desde el acta, migration 156 y ajustes de compras/costeo); no corrigen ni agravan directamente los hallazgos de seguridad, pero deben revisarse, probarse y commitearse por separado.
- No existía `AUDITORIA_SISTEMA.md` ni el directorio `AUDITORIA/` antes de este informe.

---

## 3. Hallazgos críticos

### C-01 — Borrado y alteración cross-tenant de objetos R2 mediante URL controlada por el cliente

**Severidad:** Crítica  
**Archivos:** `app/api/documentos/guardar/route.ts`, `app/api/documentos/[codigo]/route.ts`, `app/lib/r2.ts`

**Descripción**

`POST /api/documentos/guardar` recibe `url` desde el cuerpo de la petición y la persiste en `documentos_cache.documento_url_local` sin comprobar que sea una URL del bucket propio ni que corresponda a un objeto subido por el usuario.

Después, `DELETE /api/documentos/[codigo]` recibe una URL o un nombre, localiza la fila y ejecuta `borrarDocumentoR2(doc.documento_url_local)`. `borrarDocumentoR2()` obtiene la key directamente del pathname de esa URL y llama a `DeleteObjectCommand` sobre el bucket configurado.

El control `puedeVerLicitacion()` limita el acceso a la **licitación**, no la propiedad del objeto R2. Un usuario con acceso a su propia licitación puede:

1. Registrar una fila con la URL de un documento de otra licitación.
2. Pedir el borrado de esa fila.
3. Provocar el borrado del objeto R2 ajeno, porque el DELETE usa la URL almacenada.

El mismo patrón permite que `fijarNombreDescarga()` ejecute un `CopyObject` sobre la key derivada de una URL arbitraria y altere metadatos de un objeto ajeno.

**Impacto**

Pérdida de integridad y disponibilidad de documentos de otros clientes; borrado de evidencia contractual; alteración de metadatos de descarga. Es una vulnerabilidad de autorización a nivel de objeto (IDOR) con efecto destructivo.

**Recomendación**

- Guardar en la base solo la key R2, no una URL completa.
- Validar host, bucket y prefijo de key contra el bucket y la licitación.
- En `guardar`, aceptar únicamente keys generadas por `/api/documentos/presign` y asociadas al usuario/licitación.
- En `DELETE`, borrar por `id` de la fila y verificar que la key empiece por el prefijo permitido.
- No derivar keys desde URLs de entrada sin una función central `keyDesdeUrlPropia()`.
- Añadir una prueba de regresión con dos licitaciones y dos usuarios.

### C-02 — Bucket R2 público como mecanismo de acceso a documentos

**Severidad:** Crítica (condicionada a la configuración del bucket)  
**Archivos:** `app/lib/r2.ts`, `app/api/documentos/presign/route.ts`, `app/api/documentos/subir/route.ts`

**Descripción**

La subida construye una URL pública:

```text
${R2_PUBLIC_URL || https://pub-${R2_ACCOUNT_ID}.r2.dev}/${key}
```

`presign` devuelve `publicUrl` al navegador y `subirDocumentoR2()` devuelve la misma URL. La aplicación no tiene una ruta de descarga autenticada que genere URLs firmadas de corta duración. El visor y las descargas usan esa URL pública directamente.

Si el bucket tiene acceso público, cualquier persona que obtenga una URL puede leer el documento sin sesión. Las URLs no son un control de acceso: pueden filtrarse por historial, logs, correo, capturas, referrers, enlaces compartidos o por la propia API.

**Impacto**

Exposición de bases de licitación, anexos, documentos tributarios, firmas, datos bancarios y documentos de terceros. La confidencialidad depende de que la URL no se conozca, no de autenticación.

**Recomendación**

- Verificar la ACL real del bucket y de `pub-*.r2.dev`.
- Pasar a bucket privado y descarga mediante URL firmada (`GetObjectCommand` + `getSignedUrl`) de 60–300 segundos.
- Validar `puedeVerLicitacion()` antes de firmar.
- Mantener un endpoint de descarga autenticado y registrar el acceso.
- No usar `R2_PUBLIC_URL` para documentos con PII.

### C-03 — Next.js 16.2.6 con vulnerabilidad crítica y dependencia del proxy para autenticar

**Severidad:** Crítica  
**Archivos:** `package.json`, `package-lock.json`, `proxy.ts`

**Descripción**

`npm audit --omit=dev` reporta **1 crítica, 13 altas, 8 moderadas y 22 totales**. La crítica está en `next@16.2.6` e incluye, entre otras:

- bypass de middleware/proxy en App Router con Turbopack;
- RCE no autenticado en servidores Windows;
- RCE en la API de optimización de imágenes con AVIF;
- SSRF en Server Actions y en rewrites;
- divulgación de endpoints internos;
- DoS y cache poisoning.

La aplicación usa Turbopack (`next.config.ts`), no tiene CSP y confía en `proxy.ts` para inyectar `x-user-id`, `x-user-rol` y `x-user-nombre`. Varias rutas leen esos headers sin volver a verificar el JWT.

**Impacto**

Si la vulnerabilidad de bypass de proxy es aplicable a la configuración desplegada, un atacante podría alcanzar rutas protegidas y, en los peores casos, ejecutar código o falsificar identidad. Incluso sin explotación directa, la combinación con H-07 convierte un fallo de plataforma en un bypass de autorización.

**Recomendación**

- Actualizar Next.js a una versión parcheada compatible y ejecutar build, lint, tests y smoke tests de autenticación.
- Revisar la configuración de Turbopack, locales y rewrites.
- No confiar en headers para decisiones de autorización en rutas sensibles.
- Añadir una prueba que intente acceder a `/api/admin/usuarios` y a una licitación ajena sin cookie y con headers falsos.
- Mantener `npm audit` en CI con bloqueo de críticas/altas.

---

## 4. Hallazgos altos

### H-01 — IDOR en empresas: datos bancarios, RUT y firmas accesibles a cualquier usuario

**Severidad:** Alta  
**Archivos:** `app/api/empresas/route.ts`, `app/api/empresas/[id]/route.ts`, `app/api/empresas/[id]/firmas/route.ts`

**Descripción**

Los GET solo comprueban que exista `x-user-id`; no verifican rol ni pertenencia:

- `GET /api/empresas` devuelve todas las empresas activas con `SELECT *` (incluye banco, cuenta, titular, RUT, dirección, representante).
- `GET /api/empresas/[id]` devuelve `SELECT *` de cualquier empresa por id.
- `GET /api/empresas/[id]/firmas` devuelve las firmas escaneadas de cualquier empresa.

El proxy autentica, pero no autoriza por empresa. Un usuario normal o externo puede enumerar IDs y extraer información sensible.

**Impacto**

Exposición de datos personales y financieros; suplantación documental si se obtienen firmas; riesgo directo bajo Ley 21.719.

**Recomendación**

- Limitar el detalle y las firmas a administradores o a usuarios con permiso explícito.
- Devolver un DTO sin campos bancarios para selectores y listados.
- Verificar que la empresa esté asociada al negocio o al usuario cuando corresponda.
- Añadir pruebas de acceso con rol `usuario` y `externo`.

### H-02 — Usuarios eliminados siguen autenticados hasta 7 días

**Severidad:** Alta  
**Archivos:** `app/lib/rol-vigente.ts`, `app/lib/api-auth.ts`, `app/lib/auth.ts`, `proxy.ts`

**Descripción**

`estadoVigente()` consulta `usuarios` y hace:

```text
const activo = fila ? !!fila.activo : true; // sin fila: se mantiene el comportamiento previo
```

Si el usuario fue eliminado físicamente, no hay fila y se devuelve `activo: true`. `getAuthedUser()` acepta el JWT y `proxy.ts` permite el acceso. El token dura 7 días. La caché de 30 segundos no cambia el problema.

**Impacto**

Un exempleado o una cuenta eliminada conserva acceso completo hasta que expire el JWT, incluyendo datos y acciones según su rol.

**Recomendación**

- Cambiar el comportamiento a `activo: false` cuando no exista fila.
- Añadir una versión de sesión o `token_version` y revocarla al desactivar/eliminar/cambiar contraseña.
- Reducir la vida del JWT o usar refresh tokens rotativos.
- Probar el flujo de eliminación con un token ya emitido.

### H-03 — Conexión MySQL remota sin TLS

**Severidad:** Alta  
**Archivo:** `app/lib/db.ts`

**Descripción**

`mysql.createPool()` configura host, usuario, contraseña, base, puerto, timezone, pool y compresión, pero no configura `ssl`. La base está en Bluehost y la aplicación corre en Vercel/notebook/VPS. La conexión transporta credenciales, datos de clientes, documentos y resultados de IA.

**Impacto**

Interceptación o manipulación del tráfico si el trayecto no está protegido por una red confiable; incumplimiento de controles de seguridad de datos.

**Recomendación**

- Habilitar TLS en MySQL (`ssl: { rejectUnauthorized: true }` o CA configurada) y verificar el certificado.
- Validar que Bluehost permita TLS y documentar el modo.
- Probar conexión con TLS obligatorio en todos los entornos.

### H-04 — Envío de documentos y datos de terceros a proveedores de IA externos

**Severidad:** Alta  
**Archivos:** `app/lib/viabilidad-ia.ts`, `app/lib/gemini.ts`

**Descripción**

`viabilidad-ia.ts` procesa hasta 400.000 caracteres de documentos y hasta 350.000 caracteres para el análisis; los prompts incluyen bases, anexos, datos de la empresa y del organismo. El proveedor por defecto es Z.AI (`glm-4.7-flashx`), con respaldos DeepSeek y Kimi; Gemini queda como código dormido.

No se observa una capa de redacción, minimización, seudonimización ni un registro de consentimiento/DPA por proveedor. Los documentos pueden contener RUT, nombres, correos, teléfonos, datos bancarios y cláusulas contractuales.

**Impacto**

Transferencia de datos personales y comerciales a terceros; riesgo de retención, entrenamiento o acceso no autorizado; obligaciones de información y base de licitud bajo Ley 21.719.

**Recomendación**

- Inventariar proveedores, finalidades, países y retención.
- Firmar/verificar DPA y condiciones de no entrenamiento.
- Redactar o minimizar PII antes del envío.
- Permitir desactivar el envío por licitación.
- Registrar qué se envió, a quién, cuándo y con qué base legal.

### H-05 — SSRF en la captura de links del Auditor de Compras

**Severidad:** Alta  
**Archivo:** `app/lib/auditor-compras-captura.ts`

**Descripción**

`capturarLinks()` y `visitarLinks()` reciben URLs de links de cotización y ejecutan `page.goto(url)` con Puppeteer o `fetch(url)`, sin validar el destino. `normalizarUrl()` solo agrega `https://` si falta el esquema. La función `urlPublicaSegura()` existe más abajo, pero no se usa en estos flujos; se usa para fichas técnicas en `auditor-opciones.ts`.

Un usuario con acceso al Auditor puede introducir URLs hacia `localhost`, `127.0.0.1`, `169.254.169.254`, servicios internos de Docker (`app`, `scheduler`, `conversor-doc`), Redis/Upstash o metadatos del cloud. El worker también puede seguir redirecciones.

**Impacto**

Lectura de servicios internos, scraping de metadatos, interacción con paneles internos y posible exfiltración por redirecciones o DNS rebinding. La captura queda guardada como evidencia, lo que facilita persistir el contenido obtenido.

**Recomendación**

- Aplicar una allowlist de dominios de tiendas permitidas.
- Rechazar esquemas distintos de `http`/`https`, IP privadas, loopback, link-local, metadata y nombres internos.
- Resolver DNS y validar todas las IPs; repetir la validación tras cada redirección.
- Bloquear `file:`, `data:` y credenciales embebidas.
- Usar un proxy de salida con allowlist y sin acceso a la red interna.
- Aplicar `urlPublicaSegura()` antes de Puppeteer y antes de `fetch`.

### H-06 — Encolado de descargas sin autorización por licitación y worker que navega URLs arbitrarias

**Severidad:** Alta  
**Archivos:** `app/api/documentos/solicitar/route.ts`, `worker/index.js`, `app/lib/redis.ts`

**Descripción**

`POST /api/documentos/solicitar` recibe `licitacionCodigo`, `documentoUrl` y `documentoNombre` y crea un job en Redis. No llama a `puedeVerLicitacion()` ni valida que la URL sea de Mercado Público. Cualquier usuario autenticado puede encolar una URL para una licitación a la que no tiene acceso.

El worker legacy toma el job y ejecuta `page.goto(job.documentoUrl)` con Chrome/Puppeteer, sin allowlist. Después intenta guardar en `/api/documentos/guardar` sin cookie ni header de autenticación, por lo que esa llamada recibe 401; el job igual se marca como completado.

**Impacto**

SSRF desde la red del worker, consumo de recursos, descarga de contenido arbitrario y inconsistencia de estado. Si el worker se despliega y se le añade autenticación sin corregir la autorización, se convierte en una vía para incorporar documentos a licitaciones ajenas.

**Recomendación**

- Exigir `puedeVerLicitacion()` en `/solicitar`.
- Validar que `documentoUrl` pertenezca a Mercado Público o al bucket propio.
- Añadir autenticación interna al worker (secreto de servicio, mTLS o red privada) y corregir el guardado.
- No marcar `completed` si falla la persistencia.
- Retirar el worker legacy si ya no se usa.

### H-07 — Autorización basada en headers inyectados por el proxy

**Severidad:** Alta  
**Archivos:** `proxy.ts`, `app/api/**/route.ts`

**Descripción**

135 rutas leen `x-user-id`, `x-user-rol` o `x-user-nombre`; 77 usan `getAuthedUser`, `puedeVerLicitacion`, `esAdmin` u otro helper. Las restantes confían en que el proxy ya verificó el JWT y que nadie puede enviar esos headers directamente.

En condiciones normales, el proxy elimina/sustituye los headers. Pero si el proxy se bypassa (C-03), se invoca una ruta internamente sin pasar por él, o se despliega una ruta fuera de su matcher, el cliente puede enviar `x-user-rol: admin` y `x-user-id: 1`.

**Impacto**

Escalada de privilegios y acceso a datos de otros usuarios. La defensa en profundidad es inconsistente: las rutas administrativas usan `esAdmin`, pero muchas rutas de compras, documentos, empresas y aprobaciones confían en el header.

**Recomendación**

- En rutas sensibles, usar siempre `getAuthedUser()` o `esAdmin()`, nunca el rol del header.
- Validar que el `x-user-id` corresponda a un usuario existente y activo.
- Añadir un test que invoque rutas con headers falsos sin cookie.
- Documentar el proxy como control de borde, no como única autorización.

---

## 5. Hallazgos medios

### M-01 — XSS almacenado latente en el visor de Excel

**Severidad:** Media  
**Archivo:** `app/components/DocumentViewerModal.tsx`

**Descripción**

`VisorExcel` convierte el archivo con `XLSX.utils.sheet_to_html()` y lo inserta con `dangerouslySetInnerHTML`. La librería `xlsx` no escapa todos los valores: los hipervínculos y partes de `cell.h` pueden contener HTML controlado por el archivo.

El cambio sin commit hace que los Excel con URL `https://...` se muestren con el visor de Microsoft y reserva `VisorExcel` para URLs no públicas. Eso reduce la explotabilidad actual, pero el sink sigue presente y puede reactivarse con una URL `localhost`, relativa o un cambio futuro.

**Impacto**

Ejecución de JavaScript en el origen de la aplicación si un atacante logra que el visor propio procese un XLSX malicioso; robo de sesión, acciones en nombre del usuario o exfiltración.

**Recomendación**

- No usar `dangerouslySetInnerHTML` con salida de una librería que no garantiza sanitización.
- Sanitizar con DOMPurify o renderizar tablas propias desde celdas.
- Bloquear/neutralizar hipervínculos `javascript:` y `data:`.
- Añadir CSP y una prueba con un XLSX malicioso.

### M-02 — Operaciones R2 + MySQL sin transacción ni compensación

**Severidad:** Media  
**Archivos:** `app/api/documentos/guardar/route.ts`, `app/api/documentos/subir/route.ts`, `app/api/documentos/[codigo]/route.ts`, `app/api/empresas/[id]/firmas/route.ts`

**Descripción**

La subida escribe primero en R2 y después en MySQL; el borrado elimina R2 y luego la fila; la firma sube a R2 y luego inserta en `empresa_firmas`. Si falla la segunda operación, quedan objetos huérfanos o filas que apuntan a archivos inexistentes. No hay transacción, outbox ni compensación.

**Impacto**

Documentos huérfanos, enlaces roto, pérdida de evidencia y espacio consumido. En el borrado, una fila puede quedar apuntando a un objeto ya eliminado.

**Recomendación**

- Guardar primero el registro con estado `pendiente` y confirmar después de subir.
- En borrado, marcar `deleted_at` y borrar el objeto en un job idempotente.
- Agregar reconciliación periódica R2 ↔ MySQL.

### M-03 — Errores internos devueltos al cliente

**Severidad:** Media  
**Archivos:** múltiples rutas API (47 coincidencias de `error: String(error)`)

**Descripción**

Varias rutas devuelven `String(error)` o `error.message` al cliente. Eso puede exponer nombres de tablas, columnas, SQL, rutas internas, mensajes de MySQL y detalles de implementación.

**Impacto**

Facilita enumeración y explotación; filtra información de infraestructura.

**Recomendación**

- Registrar el error completo solo en servidor con un `requestId`.
- Devolver un mensaje genérico y el `requestId`.
- No devolver errores de MySQL, rutas ni stack traces.

### M-04 — Rate-limit de login evadible o fail-open

**Severidad:** Media  
**Archivo:** `app/lib/login-rate-limit.ts`, `app/api/auth/login/route.ts`

**Descripción**

El límite por email es 5 fallos/15 minutos y el de IP es 30. La IP se toma de `cf-connecting-ip`, `x-real-ip` o `x-forwarded-for`; si la aplicación es accesible sin un proxy que sobrescriba esos headers, el cliente puede rotarlos y evadir el límite por IP. Además, cualquier error de MySQL devuelve `bloqueado: false` (fail-open).

**Impacto**

Fuerza bruta o password spraying más lento pero persistente; el bloqueo por email sigue activo, pero no protege cuentas distribuidas.

**Recomendación**

- Confiar solo en headers establecidos por el proxy de borde y eliminar los que llegan del cliente.
- Añadir límites por cuenta y por combinación cuenta/IP.
- Considerar fail-closed para login cuando el almacén de intentos no esté disponible.
- Alertar sobre picos de 401/429.

### M-05 — CRON_SECRET aceptado por query string y comparación no constante

**Severidad:** Media  
**Archivos:** `app/api/admin/prefiltro/route.ts`, `app/api/cron/*/route.ts`, `scheduler/scheduler.mjs`

**Descripción**

Varias rutas aceptan `?secret=...` además del header. El secreto puede quedar en logs de acceso, historial, proxies, referrers o capturas. La comparación se hace con `===`, no en tiempo constante.

**Impacto**

Exposición del secreto que permite disparar jobs, consumir cuota, modificar datos o ejecutar procesos costosos.

**Recomendación**

- Aceptar solo header `Authorization`/`x-cron-secret`.
- Comparar con `crypto.timingSafeEqual`.
- Rotar el secreto y revisar logs.
- Restringir los endpoints cron a la red interna o a IPs conocidas.

### M-06 — El cambio de contraseña no revoca sesiones existentes

**Severidad:** Media  
**Archivos:** `app/api/auth/restablecer/route.ts`, `app/lib/auth.ts`

**Descripción**

El restablecimiento actualiza `password_hash` y marca los tokens de recuperación como usados, pero no invalida los JWT ya emitidos. Un atacante con una cookie robada conserva acceso hasta 7 días, aunque la víctima cambie la contraseña.

**Impacto**

Persistencia de sesión tras una recuperación de cuenta; el cambio de contraseña no expulsa al intruso.

**Recomendación**

- Añadir `token_version` o `password_changed_at` y verificar en `getAuthedUser`/proxy.
- Incrementar la versión al cambiar contraseña, desactivar usuario o cambiar rol.
- Reemitir la cookie después del cambio.

### M-07 — Worker legacy no puede autenticarse contra `/api/documentos/guardar`

**Severidad:** Media  
**Archivos:** `worker/index.js`, `app/api/documentos/guardar/route.ts`

**Descripción**

El worker descarga el archivo, lo sube a R2 y luego hace `fetch` a `/api/documentos/guardar` sin cookie ni `Authorization`. La ruta exige `puedeVerLicitacion()`, por lo que la llamada devuelve 401. El worker igual marca el job como `completed`.

**Impacto**

Documentos descargados que nunca se registran en la base; jobs falsamente completados; pérdida de trabajo y confusión operativa. Si se corrige solo la autenticación, se habilita el riesgo de H-06.

**Recomendación**

- Autenticar el worker con un secreto de servicio y limitar la operación a la licitación del job.
- Verificar la respuesta HTTP antes de marcar `completed`.
- Si el worker no se usa, eliminarlo y documentar el reemplazo.

### M-08 — Allowlist SSRF débil en `/api/pdf-pagina`

**Severidad:** Media  
**Archivo:** `app/api/pdf-pagina/route.ts`

**Descripción**

`hostPermitido()` usa `h.includes(r2AccountId)` para aceptar hosts. Un dominio que contenga el account ID en cualquier posición puede pasar la validación. Además, la ruta no verifica que el usuario tenga acceso a la licitación del PDF.

**Impacto**

SSRF limitado a hosts que incluyan el identificador de cuenta; acceso a PDFs de terceros si se conoce la URL; consumo de CPU/memoria con PDFs grandes.

**Recomendación**

- Reutilizar `esUrlR2Propia()` o comparar el hostname exacto/terminado en `.r2.dev`.
- Validar la licitación y el documento.
- Limitar tamaño, páginas y tiempo de descarga.

### M-09 — URLs de documentos de Office enviadas a Microsoft

**Severidad:** Media  
**Archivo:** `app/components/DocumentViewerModal.tsx`

**Descripción**

Para PDF/Word/Excel/PPT, el visor usa `https://view.officeapps.live.com/op/embed.aspx?src=<URL>`. Microsoft descarga el documento desde R2. El usuario no ve un aviso de que el archivo se comparte con un tercero.

**Impacto**

Transferencia de documentos comerciales y datos personales a un proveedor externo; posible retención y registro de la URL. Es especialmente relevante si el bucket es público.

**Recomendación**

- Avisar al usuario y requerir consentimiento cuando corresponda.
- Preferir un visor propio o un servicio con DPA.
- Para documentos sensibles, usar visor local y no enviar la URL a Microsoft.

### M-10 — Validación de subida basada en extensión y content-type del cliente

**Severidad:** Media  
**Archivos:** `app/api/documentos/presign/route.ts`, `app/api/documentos/subir/route.ts`, `app/lib/r2.ts`

**Descripción**

`presign` acepta `filename` y `contentType` del cliente; el tamaño es opcional. `subir` usa la extensión del nombre y `file.type`, sin verificar magic bytes. El tope es 250 MB. `subirDocumentoR2()` prioriza el MIME por extensión, pero conserva content-types arbitrarios para extensiones desconocidas.

**Impacto**

Subida de HTML/SVG/archivos ejecutables o contenido inesperado a un bucket público; consumo de almacenamiento; phishing alojado en el dominio de R2; análisis posterior de archivos maliciosos.

**Recomendación**

- Validar magic bytes y permitir una lista cerrada de tipos.
- Exigir tamaño y tipo en la firma; no confiar en `file.type`.
- Servir siempre con `Content-Disposition: attachment` y `X-Content-Type-Options: nosniff`.
- Escanear malware y limitar tamaño por tipo.

### M-11 — Metadatos de documentos controlados por el cliente

**Severidad:** Media  
**Archivo:** `app/api/documentos/guardar/route.ts`

**Descripción**

El cliente envía `size`, `categoria`, `subcategoria` y `origenManual`. `origenManual` marca la fila como borrable/renombrable aunque esté en una caja oficial; `categoria` afecta la clasificación y los permisos de borrado. No hay validación contra el objeto real de R2.

**Impacto**

Integridad de la clasificación, borrado de documentos que deberían ser oficiales, tamaños falsos y confusión en auditorías.

**Recomendación**

- Calcular tamaño y MIME desde R2/objeto, no desde el cliente.
- Derivar `origenManual` de una acción explícita y firmada por el servidor.
- Validar categorías contra un catálogo cerrado.
- Auditar cambios de categoría.

### M-12 — Cabeceras de seguridad incompletas

**Severidad:** Media  
**Archivo:** `next.config.ts`

**Descripción**

La aplicación envía `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy`, pero no HSTS, `Permissions-Policy` ni CSP. La ausencia de CSP aumenta el impacto de cualquier XSS y de inyecciones en el visor de documentos.

**Impacto**

Mayor superficie para XSS, clickjacking en navegadores que no respetan `X-Frame-Options`, y falta de defensa en profundidad.

**Recomendación**

- Añadir HSTS en producción.
- Añadir `Permissions-Policy` restrictiva.
- Implementar CSP con nonce/hash compatible con Mantine; empezar en `Content-Security-Policy-Report-Only`.
- Revisar `frame-ancestors` y `connect-src`.

### M-13 — Oráculo de validez de tokens de recuperación

**Severidad:** Media  
**Archivo:** `app/api/auth/restablecer/route.ts`

**Descripción**

`GET /api/auth/restablecer?token=...` devuelve `{ valido: true/false }` sin rate-limit específico. Aunque el token es de 32 bytes y no se puede adivinar, el endpoint confirma si un enlace es válido y puede usarse para monitorear tokens filtrados o automatizar intentos.

**Impacto**

Bajo, pero facilita verificación de tokens y no sigue el principio de respuesta genérica usado en `recuperar`.

**Recomendación**

- Aplicar rate-limit por IP y por token.
- Devolver la misma respuesta para token inválido y inexistente.
- Registrar intentos anómalos.

### M-14 — Descarga sin límite de tamaño en el render de PDFs

**Severidad:** Media  
**Archivo:** `app/api/pdf-pagina/route.ts`

**Descripción**

La ruta descarga el PDF completo con `fetch`, sin `Content-Length` máximo, y luego lo procesa con mupdf. Un usuario autenticado puede solicitar repetidamente URLs permitidas de archivos grandes o páginas costosas, consumiendo CPU y memoria.

**Impacto**

Agotamiento de recursos y degradación del servicio; costo de renderizado y almacenamiento de previews.

**Recomendación**

- Limitar tamaño de descarga y páginas.
- Aplicar timeout y cuota por usuario/IP.
- Cachear con control de versiones y evitar renders repetidos.
- Validar autorización de la licitación.

---

## 6. Hallazgos bajos

### L-01 — Deuda de lint

**Severidad:** Baja  
**Evidencia:** última corrida registrada: 3.680 problemas (3.481 errores, 199 warnings).

**Impacto:** ruido, errores latentes y dificultad para detectar regresiones reales.

**Recomendación:** congelar el conteo, corregir por carpetas y hacer fallar CI solo para archivos nuevos.

### L-02 — No hay script `typecheck`

**Severidad:** Baja  
**Evidencia:** `package.json` solo tiene `lint`, `test:viabilidad` y `test:viabilidad:golden`.

**Impacto:** el chequeo de tipos depende de un comando manual y puede omitirse en CI.

**Recomendación:** agregar `"typecheck": "tsc --noEmit"` y ejecutarlo en CI.

### L-03 — No existe `global-error.tsx`

**Severidad:** Baja  
**Evidencia:** no se encontró un error boundary global.

**Impacto:** errores no controlados pueden mostrar una pantalla genérica o filtrar detalles según el entorno.

**Recomendación:** agregar `app/global-error.tsx` y `app/error.tsx` con mensaje genérico y logging.

### L-04 — Import sin uso en `r2.ts`

**Severidad:** Baja  
**Evidencia:** `GetObjectCommand` se importa pero no se usa.

**Impacto:** ruido y confusión sobre la estrategia de descarga.

**Recomendación:** eliminarlo o usarlo para implementar descargas firmadas.

### L-05 — Worker legacy fuera de `docker-compose.yml`

**Severidad:** Baja  
**Evidencia:** el compose define `app`, `scheduler` y `conversor-doc`; no define `worker`.

**Impacto:** el worker puede estar obsoleto, sin healthcheck ni despliegue reproducible.

**Recomendación:** documentar su estado, retirarlo o incorporarlo con configuración y secretos.

### L-06 — `schema.sql` no representa el esquema real

**Severidad:** Baja  
**Evidencia:** `app/lib/schema.sql` define 4 tablas; existen 154 migraciones en `docs/`.

**Impacto:** un entorno nuevo creado desde `schema.sql` queda incompleto; confusión para nuevos desarrolladores.

**Recomendación:** generar un dump actualizado o un `schema.sql` derivado de migraciones y documentar el orden.

### L-07 — Repositorio con 785 scripts y 573 en `scripts/scratch`

**Severidad:** Baja  
**Evidencia:** conteo de `scripts/`: 785 archivos; 573 en `scratch`.

**Impacto:** difícil distinguir herramientas operativas de experimentos; riesgo de ejecutar un script obsoleto.

**Recomendación:** mover scratch fuera del repo o a un directorio ignorado; documentar los scripts activos.

### L-08 — Código y proveedores de IA duplicados o dormidos

**Severidad:** Baja  
**Evidencia:** `gemini.ts` contiene caminos Gemini retirados; conviven Z.AI, DeepSeek, Kimi y OpenAI; hay claves/entornos sin uso aparente.

**Impacto:** complejidad, superficie de configuración y riesgo de usar un proveedor no previsto.

**Recomendación:** consolidar en un registry de proveedores y eliminar/aislar el código dormido.

### L-09 — `xlsx` se carga en el cliente para renderizar documentos

**Severidad:** Baja  
**Evidencia:** `DocumentViewerModal.tsx` importa dinámicamente `xlsx` y procesa el archivo en el navegador.

**Impacto:** peso del bundle, exposición a vulnerabilidades de la librería (incluida ReDoS/prototype pollution reportada por `npm audit`) y ejecución de parser en el cliente.

**Recomendación:** mover la conversión a un servicio con sandbox y salida sanitizada; actualizar `xlsx`.

### L-10 — Cobertura de tests limitada a viabilidad

**Severidad:** Baja  
**Evidencia:** 114 tests en `app/lib/__tests__`, enfocados en viabilidad/parser; no hay suite de API, autenticación ni documentos.

**Impacto:** regresiones de autorización y documentos pueden pasar inadvertidas.

**Recomendación:** agregar tests de integración para autenticación, IDOR, uploads, borrado y cron.

### L-11 — Superusuario hardcodeado por email

**Severidad:** Baja  
**Evidencia:** `app/api/admin/usuarios/route.ts` usa `EMAIL_SUPER_USUARIO = 'tobaralexis.89@gmail.com'`.

**Impacto:** reglas de negocio frágiles si cambia el email; además, el identificador queda en el código.

**Recomendación:** moverlo a configuración/BD y agregar pruebas de protección.

---

## 7. Ley 21.719 y tratamiento de datos

La aplicación trata datos personales y comerciales de alto valor:

- RUT, nombres, dirección, email, teléfono y cargo de representantes.
- Datos bancarios de empresas.
- Firmas escaneadas.
- Documentos de licitación, anexos, cotizaciones y órdenes de compra.
- Conversaciones con IA y prompts que incluyen documentos.

Riesgos principales:

1. **Confidencialidad:** URLs públicas de R2 y bucket potencialmente público (C-02).
2. **Acceso no autorizado:** IDOR de empresas (H-01), headers confiados (H-07), usuarios eliminados (H-02).
3. **Transferencia internacional:** documentos enviados a Z.AI/DeepSeek/Kimi/Microsoft (H-04, M-09).
4. **Seguridad:** dependencia crítica de Next.js (C-03), ausencia de TLS a MySQL (H-03), SSRF (H-05/H-06).
5. **Trazabilidad:** no hay auditoría completa de accesos a documentos; los logs no son un registro de consentimiento.
6. **Retención:** no se identificó una política de borrado de documentos, capturas, prompts o logs.

Recomendaciones transversales:

- Designar responsabilidades y base de licitud por tratamiento.
- Mantener un registro de actividades de tratamiento.
- Implementar minimización y redacción antes de IA.
- Definir plazos de retención y borrado seguro de R2, MySQL y proveedores.
- Documentar transferencias internacionales y DPA.
- Implementar procedimiento de brechas y notificación.
- Asegurar derechos de acceso, rectificación, cancelación y oposición.

> Este análisis es técnico y no constituye asesoría legal.

---

## 8. Dependencias y cadena de suministro

Resultado de `npm audit --omit=dev`:

| Severidad | Cantidad |
|---|---:|
| Crítica | 1 |
| Alta | 13 |
| Moderada | 8 |
| Baja | 0 |
| **Total** | **22** |

Hallazgos relevantes:

- `next@16.2.6`: crítica; bypass de middleware/proxy, RCE, SSRF, cache poisoning, DoS.
- `xlsx@0.18.5`: alta; prototype pollution y ReDoS.
- `axios@1.16.1`: alta; múltiples advisories de prototype pollution, header injection y DoS.
- `nodemailer`: alta; múltiples advisories de parsing y DoS.
- `sharp`, `postcss`, `undici`, `exceljs`, `mammoth`, `mysql2`, `nanoid`, `xmldom`, `grpc-js`: advisories altas/moderadas.

Recomendaciones:

1. Actualizar Next.js primero y validar auth, proxy, build y rutas dinámicas.
2. Actualizar `xlsx` o migrar a una librería mantenida; no procesar archivos no confiables en el cliente.
3. Aplicar `npm audit fix` solo después de revisar breaking changes.
4. Añadir Dependabot/Renovate y un gate de CI para críticas/altas.
5. Generar SBOM y firmar artefactos si el despliegue lo permite.

---

## 9. Calidad, rendimiento y operación

### 9.1 Calidad

- ESLint: 3.680 problemas en la última corrida registrada.
- TypeScript: `tsc --noEmit` pasaba en la última verificación; no hay script de CI.
- Tests: 114, centrados en viabilidad/parser; sin cobertura de API, auth ni documentos.
- 0 Server Actions; la lógica está en API routes.
- `app/lib` concentra 380 archivos y ~93.800 líneas; `app/api` 235 rutas y ~23.257 líneas.

### 9.2 Rendimiento

- MySQL remoto con latencia declarada de ~155 ms; pool 3 en Vercel y 8 en notebook; compresión habilitada.
- `viabilidad-ia.ts` puede enviar 350.000–400.000 caracteres por análisis; el costo y la latencia dependen del proveedor.
- `/api/pdf-pagina` renderiza páginas con mupdf y OCR de respaldo; sin límite de tamaño (M-14).
- El visor de Excel puede cargar `xlsx` en el cliente y procesar archivos completos.
- `worker` legacy mantiene un loop de 1 segundo y Chrome/Puppeteer; no está en compose.

### 9.3 Operación

- Scheduler con 16 rutas cron, 13 schedules activos y `obuma-proyectos` desactivado.
- `CRON_SECRET` debe rotarse y no viajar por query string.
- El worker no está incluido en el compose; verificar si está realmente en uso.
- El árbol de trabajo tiene un cambio sin commit en el visor; no se debe desplegar sin revisar M-01.

---

## 10. Plan de remediación priorizado

### 0–7 días

1. Confirmar y corregir la ACL de R2; pasar a bucket privado o restringir el acceso (C-02).
2. Bloquear borrado/alteración cross-tenant validando keys y pertenencia (C-01).
3. Actualizar Next.js a una versión parcheada y probar auth/proxy (C-03).
4. Restringir `/api/empresas` y firmas a admin/permiso (H-01).
5. Corregir `estadoVigente()` para que un usuario inexistente quede inactivo (H-02).
6. Aplicar TLS a MySQL (H-03).
7. Poner allowlist y validación de IPs en capturas y descargas (H-05/H-06).
8. Exigir `puedeVerLicitacion()` en `/api/documentos/solicitar` (H-06).

### 7–30 días

9. Añadir pruebas de autorización para todas las rutas con `x-user-*`.
10. Implementar URLs firmadas y logging de descargas.
11. Redactar/minimizar PII antes de proveedores IA y documentar DPA.
12. Corregir el worker o retirarlo; autenticación de servicio y verificación de respuesta.
13. Añadir CSP/HSTS/Permissions-Policy.
14. Corregir M-01 (sanitización/salida propia) y M-10 (magic bytes/tipos).
15. Revisar errores devueltos y aplicar `requestId`.

### 30–90 días

16. Revocación de sesiones por versión de token.
17. Transacciones/outbox/reconciliación R2 ↔ MySQL.
18. Rate-limit distribuido y fail-closed para login.
19. Inventario de datos, retención y registro de tratamientos (Ley 21.719).
20. Reducir deuda de lint, agregar `typecheck` y tests de API.
21. Limpiar scripts scratch, worker legacy y código IA dormido.
22. Revisar el esquema real y generar un `schema.sql` actualizado.

---

## 11. Anexos

### A. Evidencia principal

- `app/api/documentos/guardar/route.ts`
- `app/api/documentos/[codigo]/route.ts`
- `app/api/documentos/presign/route.ts`
- `app/api/documentos/subir/route.ts`
- `app/api/documentos/solicitar/route.ts`
- `app/lib/r2.ts`
- `app/components/DocumentViewerModal.tsx`
- `app/api/empresas/route.ts`
- `app/api/empresas/[id]/route.ts`
- `app/api/empresas/[id]/firmas/route.ts`
- `app/lib/rol-vigente.ts`
- `app/lib/api-auth.ts`
- `app/lib/auth.ts`
- `app/lib/auth-edge.ts`
- `app/lib/db.ts`
- `app/lib/viabilidad-ia.ts`
- `app/lib/gemini.ts`
- `app/lib/auditor-compras-captura.ts`
- `app/lib/auditor-opciones.ts`
- `app/api/pdf-pagina/route.ts`
- `app/api/proxy/route.ts`
- `app/api/cron/*/route.ts`
- `worker/index.js`
- `scheduler/scheduler.mjs`
- `proxy.ts`
- `next.config.ts`
- `package.json`

### B. Comandos de verificación

- `git status --short`
- `git log -1 --oneline`
- `npm audit --omit=dev --json`
- `npm run lint`
- `npx --no-install tsc --noEmit`

### C. Conteos de superficie

| Elemento | Cantidad |
|---|---:|
| API routes | 235 |
| Páginas/layouts | 41 |
| Archivos `app/lib` | 380 |
| Líneas `app/lib` | ~93.820 |
| Componentes | 55 |
| Servicios | 3 |
| Scripts | 785 |
| Migraciones SQL | 154 |
| Scripts de migración | 114 |
| Tests | 114 |
| Rutas cron | 16 |
| Schedules activos | 13 |

### D. Nota sobre el baseline

El informe previo `docs/AUDITORIA_SISTEMA_AUDITOR_2026-10-01.md` corresponde a una auditoría documental del módulo Auditor y no contiene este análisis de código. Este documento debe considerarse el baseline técnico a partir del cual se actualizarán las fases 1–10.
