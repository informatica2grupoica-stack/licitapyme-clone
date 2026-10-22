# Diseño Fase 1 — Multi-cliente (Radar + Negocios, 2 usuarios por cliente)

Estado: **PROPUESTA, nada aplicado**. Fecha: 22-oct-2026.
Alcance de venta: Radar + Negocios (asignar proyectos entre 2 usuarios). Compras, Auditor, Anexos, Costeo,
Viabilidad IA y chats **no se venden** en esta fase.

## 0. Lo que ya existe (punto de partida)

- `clientes` (migration-60): `id`, `nombre`, `rut`, `activo`. El cliente **1 = Grupo ICA**.
- `empresas.cliente_id` y `experiencia_*.cliente_id` ya existen (DEFAULT 1).
- Todo lo demás **no** tiene cliente: `usuarios`, `negocios`, `palabras_clave`, `alertas_licitaciones`,
  `favoritos`, `etiquetas`, `licitaciones_descartadas`, `puente_*`, `comentarios_*`, `historial_eventos`…
- Sesión: el JWT lleva `userId, email, nombre, empresa, rol` (`app/lib/auth-edge.ts`). `proxy.ts` inyecta
  `x-user-id/x-user-rol`. No hay `clienteId` en ningún lado.
- Roles: `admin | usuario | externo`. `admin` hoy = "dueño de todo" (entra a `/admin/*`, gasto IA, reportes, usuarios).
- Tamaño del trabajo: `negocios` aparece en 77 archivos, `usuarios` en 58, `alertas_licitaciones` en 22,
  296 rutas API. **El riesgo no es el esquema, es no olvidar un filtro en alguna consulta.**

## 1. Principio: filtrar por cliente en UN solo lugar y fallar cerrado

1. `usuarios.cliente_id` es la fuente de verdad. El JWT trae `clienteId` solo como ayuda; `estadoVigente()`
   (ya se llama en cada request) lo relee de la BD junto con el rol y el `activo`, así que no se puede
   falsificar y una suspensión corta el acceso al tiro.
2. `proxy.ts` inyecta `x-cliente-id` (siempre pisado desde la sesión, igual que `x-user-id`).
3. Helper único `app/lib/cliente.ts`: `getClienteId(req)` (falla con 401 si no hay) y `whereCliente(alias)`.
   Ninguna ruta lee el cliente de un parámetro, body o header del navegador.
4. Los endpoints que hoy buscan por `licitacion_codigo` solo (p. ej. `puedeVerLicitacion`:
   `SELECT asignado_a FROM negocios WHERE licitacion_codigo = ? LIMIT 1`) pasan a
   `... AND cliente_id = ?`. Sin eso, el negocio de un cliente cambia el resultado para otro.

## 2. Clasificación de tablas

**A. Compartidas (datos públicos de Mercado Público; NO llevan cliente_id).** Se descargan una vez.
`licitaciones_cache`, `adjudicacion_cache`, `licitacion_apertura`, `oferta_competencia*`,
`preguntas_respuestas_cache`, `mp_api_uso_diario`. (Por confirmar en la implementación: `prefiltro_licitacion`
y `ordenes_compra`, si dependen del perfil de ICA no se comparten.)

**B. Privadas de la Fase 1 (llevan `cliente_id NOT NULL DEFAULT 1`, con índice):**
`usuarios`, `negocios`, `negocios_etiquetas` (vía negocio), `etiquetas`, `palabras_clave`,
`alertas_licitaciones`, `favoritos`, `licitaciones_descartadas`, `comentarios_negocio`,
`comentarios_licitacion`, `historial_eventos`, `actividad_usuario`, `puente_radar`, `puente_repartos`,
`reportes_error`, `password_resets` (vía usuario).
Cambios de llaves únicas (hoy globales, deben ser por cliente):
- `etiquetas UNIQUE(nombre)` → `(cliente_id, nombre)`
- `licitaciones_descartadas PK(licitacion_codigo)` → `(cliente_id, licitacion_codigo)`
- `puente_radar UNIQUE(licitacion_codigo)` → `(cliente_id, licitacion_codigo)`
- `negocios UNIQUE(asignado_a, licitacion_codigo)` ya es por usuario; se agrega el cliente como índice.
- `usuarios.email UNIQUE` **se queda global** (el login no pide "empresa"). Un mismo correo no puede estar en 2 clientes.

**C. Módulos internos NO vendidos (no se les agrega cliente_id).** `compras_*`, `auditor_*`,
`checklist_comercial*`, `viabilidad_*`, `analisis_ia_licitacion`, `chat_*`, `anexos`, costeo, `obuma_*`,
`empresa_*`, `entrega_*`, `ia_uso`, etc.
Se bloquean con una **bandera por cliente** (`clientes.modulos`, JSON): `proxy.ts` responde 403 en esas
páginas/APIs si el cliente no tiene el módulo. Esto evita tocar ~100 tablas y deja la puerta abierta para
venderlos como extra después (ahí sí se les agregaría `cliente_id`, módulo por módulo).
Ojo: `licitacion-completa`, `licitacion-detalle`, `documentos/*` y `viabilidad*` los usa la pantalla del
negocio; hay que decidir qué pestañas del detalle ve el cliente (ver §8).

## 3. Tabla `clientes` (ampliada)

Columnas nuevas: `plan` (varchar), `max_usuarios` (int, default 2), `estado`
(`ACTIVO | SUSPENDIDO | BAJA`), `vence_at` (date), `modulos` (JSON, default solo radar+negocios),
`cupo_ia_mensual` (int, default 0), `contacto_nombre/email`, `notas`.
ICA (id 1): `max_usuarios` NULL (sin límite), todos los módulos.

## 4. Roles y administración

- Nuevo rol `superadmin` (solo ICA): lo que hoy es `/admin/*` global (todos los clientes, gasto IA, reportes,
  crear clientes, suspender, "entrar como" cliente para soporte). Hoy `admin` = esto; los admin actuales de
  ICA se mantienen `admin` dentro del cliente 1 y 1–2 personas pasan a `superadmin`.
- `admin` de un cliente = administra **solo su cliente**: sus 2 usuarios, sus palabras clave, etiquetas y
  asignaciones. Todas las rutas `/api/admin/*` se parten en "de cliente" (filtran por su `cliente_id`) y
  "solo superadmin".
- Catálogo de permisos del cliente: solo los de Radar/Negocios (`ver_otros_negocios`, `acceso_radar`,
  `repartir_puente`, `exportar`). Los demás se ignoran para clientes ≠ 1.
- El rol `externo` no se ofrece en el plan base (los 2 usuarios son `admin` + `usuario`).

## 5. Límite de 2 usuarios

- Al crear o reactivar un usuario (`POST/PATCH /api/admin/usuarios`): dentro de una transacción, con
  `SELECT ... FOR UPDATE` sobre la fila del cliente,
  `COUNT(*) WHERE cliente_id=? AND activo=1 < max_usuarios`; si no, error 409 con mensaje comercial.
- Desactivar libera el cupo. La UI muestra "2 de 2 usuarios".

## 6. Radar compartido y crons

Hoy el intake (`/api/cron/alertas`) recorre `palabras_clave` por usuario y consulta MP. Con 100 clientes eso
multiplica las llamadas y MP bloquea (429 ya les ha pasado).
- El intake pasa a: tomar el **conjunto único** de palabras clave activas de todos los clientes →
  consultar MP **una vez por palabra** → repartir (`INSERT IGNORE` en `alertas_licitaciones`) con el
  `cliente_id`/`usuario_id` de cada dueño de esa palabra.
- `enriquecer`, `aperturas`, `procesar-postuladas`, etc. trabajan sobre la caché compartida (A) y no cambian.
- `prefiltro`/`viabilidad`/`viabilidad-perfil`: **solo cliente 1** en esta fase (sin IA para los demás).
- Los crons corren como sistema (CRON_SECRET) y **deben escribir siempre el `cliente_id`** que corresponde;
  un cron nunca infiere cliente de una licitación.
- Cuota de MP: un único ticket compartido; se monitorea `mp_api_uso_diario` y se pone un tope por palabra/día.
  Pendiente de definir: ¿cada cliente trae su propio ticket de MP? (más escalable, pero más onboarding).

## 7. Orden de migración (cada paso se despliega solo; ICA sigue funcionando entre pasos)

Convención del repo: `docs/migration-N.sql` + `scripts/aplicar-migration-N.mjs` (MySQL sin `ADD COLUMN IF NOT EXISTS`:
el script comprueba antes). Todas las columnas nuevas `cliente_id INT NOT NULL DEFAULT 1` → ICA queda en 1 sin backfill.

1. **M-A: `clientes` ampliada + `usuarios.cliente_id` + rol `superadmin`.** Código: JWT/`estadoVigente`/`proxy`
   con `clienteId`, helper `cliente.ts`. Sin cambio visible.
2. **M-B: `cliente_id` en tablas B** (todas juntas, son aditivas) + cambio de llaves únicas.
   Código: se agrega el filtro a **todas** las consultas de esas tablas (el grueso del trabajo).
   Ayuda un script `scripts/scratch/auditar-filtro-cliente.mjs` que lista cada SQL que toca una tabla B sin
   mencionar `cliente_id` (revisión manual de la lista hasta dejarla en cero).
3. **M-C: bloqueo de módulos** (`clientes.modulos`) en `proxy.ts` + ocultar menús en `AppLayout`.
4. **M-D: partir `/api/admin/*`**, límite de 2 usuarios, panel superadmin (`/superadmin/clientes`: crear cliente,
   su admin, suspender, vencimiento, "entrar como").
5. **M-E: intake deduplicado** (§6).
6. **Piloto con un cliente de prueba (cliente 2 ficticio) antes de cualquier real.**

Después de M-B cada tabla B nueva que se cree debe nacer con `cliente_id` (regla en AGENTS.md).

## 8. Cómo se prueba el aislamiento (obligatorio antes del piloto)

1. **Datos canario:** script que crea los clientes 2 y 3 (con su admin y usuario) y siembra en cada uno
   registros con un marcador reconocible (`CANARIO-C2-…`): negocios, palabras clave, etiquetas, comentarios,
   favoritos, descartadas.
2. **Recorrido automático:** iniciar sesión como cliente 2 y llamar **todas** las rutas GET (y los POST/PATCH
   de Radar/Negocios con ids de otro cliente). Se exige: cero apariciones de datos o marcadores del cliente 1
   y 3, y 403/404 en cualquier id ajeno (IDOR) y en módulos no contratados.
3. **Auditoría estática** (script del paso M-B) en cero y corrida en CI/`tsc` junto con las pruebas.
4. **Casos específicos:** mismo `licitacion_codigo` en 2 clientes; mismo nombre de etiqueta; cuenta del cliente
   suspendido; tercer usuario rechazado; admin de cliente intentando `/api/admin/usuarios` de otro cliente;
   token viejo tras cambiar de cliente/suspender.
5. Revisión final solo lectura con un segundo agente sobre el diff completo.

## 9. Fuera de alcance de la Fase 1 (queda para fases siguientes)

Cobro automático, tickets de soporte, cupo de IA, correos transaccionales nuevos, página de ventas, venta de
módulos extra, respaldo/restauración por cliente, almacenamiento (R2) con prefijo por cliente (se hace en M-B
para lo que ya se sube: documentos de negocios).

## 10. Decisiones abiertas

1. Email global único (propuesto) vs. email por cliente.
2. ¿El detalle de la licitación del cliente muestra documentos MP + notas, y oculta viabilidad/auditor/compras?
3. ¿Ticket de MP compartido o uno por cliente?
4. ¿Cuántas personas de ICA quedan como `superadmin`?
5. `prefiltro_licitacion`: ¿es genérico (compartido) o depende del perfil de ICA?
