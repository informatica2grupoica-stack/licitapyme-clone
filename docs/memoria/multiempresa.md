# Multiempresa: informe vivo para vender LICITANK a otras empresas

Documento de trabajo **compartido entre sesiones**. Cada sesión que avance en multiempresa:
1. lee este archivo entero antes de empezar,
2. marca lo que terminó en el **Plan por etapas** (`[x]` + fecha) y corrige las cifras del **Inventario** si cambiaron,
3. agrega una entrada en la **Bitácora** (arriba de todo, formato de la skill `memoria-proyecto`),
4. si deja algo para que lo haga el dueño (desplegar, migración en el VPS), lo pone en **Lo que tiene que hacer el dueño**.

Reglas técnicas: skill `multiempresa-escalable` (`.claude/skills/multiempresa-escalable/SKILL.md`). Historia anterior
(rama `multicliente-mismo-sistema`, plan comercial, Ley 21.719): sección «Multi-cliente» de [infra.md](infra.md).

---

## ▶ Próxima sesión: empieza aquí (dejado el 2026-11-10)

**Estado:** Etapas 0, 1 y 2 en producción. Etapa 4 (baja de empresa: exportar + borrar datos + archivos R2) hecha en código, **sin desplegar**. Etapa 3 sin empezar.
1. **Revisar si el dueño ya desplegó la baja de empresa** (paso D de abajo): en el VPS, `grep -rl borrado_archivos .next/server` dentro del contenedor `licitapyme`. Si está, marcar D.
2. **Prueba real de la Etapa 2** con Comercial MP (cliente 4, es del dueño): que su admin ponga ticket de MP y casilla en Mi empresa → Integraciones; confirmar en `mp_api_uso_cliente` que sus consultas no suman en `mp_api_uso_diario`. Necesita al dueño (credenciales reales).
3. **Etapa 3: abrir Costeo** a otras empresas (el más chico). Ver el detalle en «Etapa 3».
4. **Decisiones del dueño abiertas:** ¿exigir ticket propio a clientes nuevos? · casilla propia de LICITANK (avisos@licitank.cl con SPF/DKIM/DMARC) · topes por defecto (10 USD / 500 consultas).
5. **Legal (abogado):** contrato, política de privacidad, registro de tratamiento. Ley 21.719 rige el 2026-12-01.
6. Menores: exportación pedida por la propia empresa desde Mi empresa; OCR fuera del tope de IA; crons anotados a ICA.

Notas para quien siga: escribir en la BD del VPS a veces lo bloquea el clasificador → dejar el comando al dueño. Los túneles SSH abiertos en segundo plano pueden sobrevivir a TaskStop: revisar el puerto 3307 al terminar. Docker Desktop del PC a veces no arranca solo. `tsc` muestra un error viejo de `app/api/negocios/[id]/comercial/route.ts` (`export { bitacora }`) que no es de multiempresa.

---

## Lo que tiene que hacer el dueño (pendiente)

**En este orden** (el clasificador de Claude bloquea las migraciones en producción; a veces deja pasar una con OK explícito):
- [x] 2026-11-09 (dueño) **1. migration-185 en el VPS, ANTES de desplegar** (agrega columnas/tabla, no borra nada): `node scripts/aplicar-migration-185.mjs --produccion`.
  Si se despliega sin ella, el gasto de IA se sigue guardando (sin la empresa) pero **/admin/clientes da error** (lee los topes).
- [x] 2026-11-09 (dueño, commit 69897c0 «empresas», contenedores arriba 20:43) **2. Commit + `deploy.sh`.** Lleva: pool 8→20 / cola 24→200 y caché del dashboard (ya en `master`), refresco por empresa (Etapa 0) y el medidor (Etapa 1).
- [x] 2026-11-09 migration-183 aplicada en el VPS (Claude, con OK del dueño; 2 índices creados).
- [x] 2026-11-09 módulos del cliente 2 limpiados en el VPS → `["radar","negocios","viabilidad"]`. Valor anterior, por si se quiere volver: `["radar","negocios","ia_chat","anexos","competencia","auditor","compras","costeo","viabilidad"]`.
**Etapa 2 (2026-11-10), en este orden:**
- [x] 2026-11-10 (dueño; revisado por Claude: 1 línea, 32 bytes) **A. Clave de cifrado** en el `.env` del VPS (y en `.env.local` del PC si se prueba ahí). Se genera una vez y **no se cambia** (si se pierde o cambia, las cuentas guardadas no se pueden leer y cada empresa las tiene que volver a escribir):
  `INTEGRACIONES_CLAVE=<salida de: openssl rand -base64 32>`. Sin ella todo sigue funcionando como hoy, pero nadie puede guardar cuentas propias.
- [x] 2026-11-10 (Claude, a pedido del dueño; tabla verificada, 0 filas) **B. migration-186 en el VPS** (tabla nueva `cliente_integracion`): `node scripts/aplicar-migration-186.mjs --produccion`.
- [x] 2026-11-10 (dueño, commit d5af273; revisado: clave en el contenedor y build con integraciones) **C. Commit + `deploy.sh`.**
- [ ] **D. Deploy de la baja de empresa (Etapa 4)**: commit + `deploy.sh` (sin migración).
- [ ] Revisar los topes por defecto que dejó la migration-185 a los clientes que no son ICA: **10 USD de IA al mes y 500 consultas a MP al día**. Se cambian en /admin/clientes (vacío = sin tope). Es decisión comercial del dueño.

---

## Inventario (foto del 2026-11-09, BD del VPS, solo lectura)

**Clientes en producción:** 1 LICITANK/Grupo ICA (INTERNO, 21 usuarios, todos los módulos) · 2 Suministros Agri SPA (BASE, 2 usuarios) ·
4 Comercial MP SpA (BASE, 1 usuario). El 3 ya no existe. `cliente_evaluacion` tiene 2 filas: la evaluación por RUT ya corre en producción.

**Lo que ya funciona (no tocar sin motivo):**
- `proxy.ts`: el cliente sale de la sesión (`x-cliente-id` pisado en cada petición); una empresa vencida o suspendida queda bloqueada.
- `app/lib/modulos.ts`: lista blanca. Una ruta sin clasificar queda negada para los clientes. `MODULOS_ACTIVABLES` = radar, negocios, viabilidad.
- `app/lib/tenant.ts` (`fichaCliente`): aunque la BD diga otra cosa, un cliente solo usa los `MODULOS_ACTIVABLES`. `/api/admin/clientes` tampoco deja guardar otros.
- Defensa extra en el proxy para `/compras/<id>` y `/api/compras/<id>/…` (`negocioEsDeCliente`).
- Avisos (campana, correo, WhatsApp) cortados por cliente en `registrarEvento` y `refrescar-estados.ts`.
- Evaluación por RUT (`app/lib/evaluar-empresa-rut.ts`): OC + actas de MP → palabras clave y perfil sugeridos en `/mi-empresa`.

**Tablas (BD del VPS):**
- Con `cliente_id` propio: ~37 (negocios, alertas, palabras_clave, etiquetas, historial, actividad, puente_*, cliente_*, empresas, usuarios…).
- Cuelgan de `negocio_id` (heredan el cliente solo si la consulta pasa por `negocios`): ~75. Son todo Auditor, Costeo (`checklist_comercial*`) y Compras.
- Sin dueño y con datos **privados de ICA** (hay que darles dueño antes de abrir su módulo): `compras_proveedor` (523), `compras_historial_oc` (4.125) + `_item` (12.873),
  `ordenes_compra` (320, tiene `empresa_id`), `obuma_*`, `precios_mercado` (1.185), `compras_cotizacion_item`, `compras_veredicto`, `chat_licitacion`,
  `viabilidad_licitacion` / `analisis_ia_licitacion` (viabilidad de ICA; los clientes usan `cliente_viabilidad*`), `whatsapp_aviso_pref`, `avisos_correo_enviados`.
- Sin dueño y **para medir costo** (Etapa 1): `ia_uso` (12.287), `mp_api_uso_diario`.
- Públicas por naturaleza (se comparten bien): `licitaciones_cache`, `documentos_cache`, `oferta_competencia*`, `licitacion_apertura`, `adjudicacion_cache`.

**Rutas API (258 en total; las que nombran al cliente o usan `negocioEsDe…`):** compras 1/90 (las de `/api/compras/<id>` las cubre el proxy, las listas globales no),
anexos 0/10, aprobaciones 0/3, ordenes-compra 0/5, logistica 0/3, entregas 0/2; negocios 11/32 (las 20 sin chequeo son de Auditor/Costeo, módulos cerrados).

**Datos de ICA escritos en el código:** 82 archivos (`rg -l "76\.902|78\.388|Inversiones Claro|Comercial MP|Grupo ICA|grupoica|sociedadcomercialmp" app`).
Los que más tienen: `compras-oc-propia.ts`, `compras/oc-comercial-mp/page.tsx`, `obuma.ts`, `anexos-docx.ts`, `AppLayout.tsx`.

**Cuentas externas, una sola para todos en `.env`:** SMTP (además comprometido y sin entrega a Gmail, ver infra.md 2026-11-06), Obuma,
`MERCADO_PUBLICO_TICKET` (10.000 consultas/día para todos; cada alta por RUT gasta ~200), llaves de IA (Z.AI, Kimi).
El cupo de IA por cliente (`clientes.cupo_ia_mensual`) solo se aplica en Viabilidad (`cliente-viabilidad.ts`).

**Carga:** 100 usuarios bien con el pool nuevo + migration-183 (ver infra.md 2026-11-09). Falta paginar `/api/alertas` (800 KB) y `/api/negocios` (1,4 MB).

---

## Plan por etapas

### Etapa 0 — Ordenar la casa (que lo vendido aguante)
- [x] 2026-11-09 — «Actualizar estados» de Negocios refresca solo la empresa de quien lo aprieta (antes, un usuario del cliente 2 sondeaba los 141 códigos de todos; ahora 14).
- [x] 2026-11-09 — Desplegado por el dueño (commit 69897c0).
- [x] 2026-11-09 — migration-183 aplicada en el VPS.
- [x] 2026-11-09 — `clientes.modulos` del cliente 2 limpiado (antes tenía Costeo, Auditor, Compras… marcados; el día que se activaran le quedaban encendidos sin que nadie lo decidiera).
- [x] 2026-11-09 — Rutas públicas (login, cron) ya no dejan pasar headers de identidad (`x-user-*`, `x-cliente-id`) mandados por el navegador (`proxy.ts`).

### Etapa 1 — El medidor (cuánto cuesta cada cliente)
- [x] 2026-11-09 — `ia_uso.cliente_id` (migration-185; `ia-uso.ts` lo toma de `medidor-cliente.ts`). Sin petición (cron, scheduler) = 1.
- [x] 2026-11-09 — `mp_api_uso_cliente` (consultas por día y empresa) + tope diario por empresa (`clientes.tope_mp_diario`), cortado en `mercado-publico.ts` antes de salir a internet.
- [x] 2026-11-09 — Tope de IA mensual en USD por empresa (`clientes.tope_ia_usd_mes`) en `crearChatIA`, para todo (no solo Viabilidad). Consumo y topes editables en `/admin/clientes`.
- [ ] El OCR (visión/PDF) y `analizarLicitacionConGemini` no pasan por `crearChatIA`: se anotan, pero el tope no los corta.
- [ ] Lo que corre en crons para todas las empresas (intake del Radar, estados) queda anotado a 1 (ICA). Repartirlo si se cobra por consumo.
- [ ] Ver /admin/clientes en el navegador con la sesión del superusuario (la migración ya está en el VPS; falta mirarlo).
- [ ] Ver el medidor anotando a una empresa que no sea ICA (al 2026-11-09 los clientes 2 y 4 no habían usado nada después del deploy).

### Etapa 2 — Cuentas propias por cliente
- [x] 2026-11-10 — Ticket de Mercado Público por cliente, cifrado (`cliente_integracion`, migration-186). Con ticket propio: sus consultas van con SU ticket, sin tope de LICITANK y sin gastar la cuota compartida (sí se anotan a la empresa). Sin ticket: el compartido con el tope diario del plan. ICA: siempre el de `.env`.
- [x] 2026-11-10 — Correo de envío por cliente (cualquier SMTP: Google Workspace, Microsoft 365, Brevo, Resend, SES, hosting). Conectado en «Enviar al proveedor» (OC): con cuenta propia sale desde ella; sin cuenta, otra empresa recibe «Configúralo en Mi empresa → Integraciones»; ICA sigue con `.env`.
- [x] 2026-11-10 — Pantalla «Integraciones» en `/mi-empresa` (solo el admin de una empresa-cliente): agregar / cambiar / quitar; se prueba antes de guardar (ticket contra la API de MP; correo con `verify()` del SMTP). Las claves no vuelven al navegador.
- [ ] Decisión del dueño: ¿obligar ticket propio a los clientes nuevos (sin ticket → sin consultas en vivo a MP)? Hoy se dejó «compartido con tope» para no cortar a los clientes 2 y 4.
- [ ] Los avisos de la plataforma (alertas, recuperar clave, resultados) siguen saliendo por la cuenta de `.env`, que es una casilla de ICA (y está comprometida, ver infra.md 2026-11-06). Para vender: casilla propia de LICITANK con dominio verificado (SPF/DKIM/DMARC), p. ej. avisos@licitank.cl en Brevo o Resend.
- [ ] Obuma opcional: lo que dependa de Obuma tiene camino propio o se oculta para el cliente que no lo usa.

### Etapa 3 — Abrir módulos, uno por uno (orden propuesto)
Para cada módulo: tablas con dueño → todas sus rutas con chequeo de cliente → datos de ICA fuera del código → prueba de aislamiento en la BD local (3308) con un usuario del cliente 2 → recién ahí se suma a `MODULOS_ACTIVABLES`.
- [~] Costeo — rutas con dueño + lee viabilidad del cliente (2026-11-10); falta prueba visual y activar (`checklist_comercial*`, `negocio_costeo_editor`, `negocio_lineas_oferta`; 10 rutas `/api/negocios/[id]/comercial/*`).
- [ ] Auditor (`auditor_*`; rutas `/api/negocios/[id]/auditor*` y `prepostulacion`).
- [ ] Anexos (`empresa_documentos`, `empresa_firmas`, motor `anexos-*.ts` con datos de ICA escritos).
- [ ] Compras (el más grande: 90 rutas, proveedores, historial OC, Obuma, OC propia de Comercial MP).

### Etapa 4 — Legal y alta sin intervención (en paralelo)
- [x] 2026-11-10 — Baja de una empresa (`app/lib/borrar-cliente.ts`): vista previa, exportar todo en JSON (sin claves ni credenciales) y borrar en una transacción. En `/admin/clientes`, solo con la empresa SUSPENDIDA y escribiendo su nombre exacto. Tablas descubiertas solas (cliente_id / negocio_id / empresa_id / usuario_id); `ia_uso` se anonimiza, `mp_api_uso_cliente` se conserva, la ficha queda «BAJA» sin RUT ni contacto, bitácora con una línea del borrado.
- [x] 2026-11-10 — Archivos en R2 de la empresa: se juntan las URLs de R2 de todas sus filas (también dentro de JSON) y, después de borrar los datos, se borra solo lo que ya no aparece en ninguna columna de archivos (`%url%`, `%archivo%`, `%adjunto%`, `%link%`) de la BD. Las keys van por código de licitación, no por empresa: un archivo que usa otra fila (p. ej. ICA) se deja. Resultado en la bitácora (`borrado_archivos`). Límite conocido: una URL que otra empresa guardó solo dentro de un JSON de una columna con otro nombre no se detecta (poco probable: cada subida lleva un timestamp único).
- [ ] Que la propia empresa pueda pedir su exportación desde «Mi empresa» (hoy la hace el superusuario).
- [ ] Contrato, política de privacidad y registro de tratamiento: los redacta un abogado.
- [ ] Alta sola: formulario → cliente + admin + evaluación por RUT en cola (hoy corre dentro del proceso de la app; si se reinicia, se corta).

---

## Bitácora

## 2026-11-10 (noche) — Etapa 3 (Costeo): prueba en local con la app levantada
App en :3000 contra la BD local (3308) con `.env.development.local` (ignorado por git) y `'costeo'` sumado a `MODULOS_ACTIVABLES` **solo para probar (sin commitear)**. Usuario: admin del cliente 2 (id 23, `pruebas@admin.cl`; en local se le puso contraseña de prueba y se marcó su onboarding como hecho).
**Resultado (HTTP, sesión real del cliente 2):** negocio 1578 con informe propio → checklist de 21 ítems armado desde SU `cliente_viabilidad_v4`; negocio 1589 sin informe → `sinViabilidad: true`; negocios de ICA (id 1) y un id inexistente → 404 en comercial, costeo y lineas-oferta; `generar-costeo` → 403; `/api/compras/…` → 403 (módulo no incluido). En el navegador (por JS, el panel estaba oculto): aparecen las pestañas Auditor y Costeo y el editor de Costeo carga con el ítem del manifiesto del cliente. **Guardar** (PUT costeo-editor): quedó solo en el negocio 1578 (negocio_costeo_editor y checklist_comercial_costeo +1), evento `COSTEO_GUARDADO` con cliente_id 2, checklist de ICA intacto (21.573); totales correctos.
**Hallazgos:** (1) El tope «$58.614.285.714» de 1057472-143-LE26 viene del propio informe del cliente 2 (la IA lo leyó mal: `presupuesto.neto`), no del código de Costeo. (2) En local las tablas creadas con la collation por defecto de MySQL 8 (`utf8mb4_0900_ai_ci`, p. ej. `cliente_viabilidad_v4`) no se pueden comparar con `negocios.licitacion_codigo` (`utf8mb4_general_ci`) en un JOIN; en producción está unificado (migración utf8mb4). (3) La pestaña «Auditor» se ve aunque el módulo auditor no esté contratado: sus rutas darán 403 → falta ocultarla o decidir si el Auditor se abre también.
**Pendiente:** ocultar/gestionar la pestaña Auditor para clientes sin ese módulo; revisar R2 por código de licitación; ver la pantalla con el panel del navegador visible; decidir si `costeo` entra a `MODULOS_ACTIVABLES` (hoy solo en local, sin commit).

## 2026-11-10 (noche) — Etapa 3 (Costeo): ahora lee la viabilidad de CADA empresa
Decisión del dueño: Costeo lee la viabilidad del cliente (no se junta con el Auditor). Nuevo `app/lib/informe-viabilidad.ts` (`leerInformeViabilidad(codigo, clienteId)`, `fechaInformeViabilidad`): ICA → `viabilidad_licitacion` (v3/v2); otra empresa → `cliente_viabilidad_v4.informe` (mismo esquema, sin envoltorio). `leerInforme(codigo, clienteId)` de `comercial/route.ts` ahora **exige** el cliente (así `tsc` marcó los ~20 sitios); `cargarNegocio` trae `cliente_id`; `leerItems`, `sanarChecklistDeLicitacion`, `productosDeItem`, `viabilidadMasNuevaQueChecklist`, costeo, costeo-editor, ficha-tecnica, documento-todas, comparador, lineas-oferta, clasificar y anexos/separar lo propagan.
Dos fugas cerradas de paso: (1) `asesores()` tenía el cliente 1 por defecto y el control del foro le pasaba esa función: un aviso de una empresa habría llegado a admins de ICA; (2) `/api/documentos/generar-costeo/[codigo]` guarda su Excel en `documentos_cache` por código (compartido entre empresas) → solo ICA (403 al resto).
**Verificado:** `tsc` limpio; 1.806 tests ok; `scripts/scratch/_probar_informe_viabilidad_cliente.mts` contra la BD local (3308) 8/8 (ICA lee su v3; la empresa no lee el de ICA aunque el código sea el mismo; cada una el suyo; sin informe → null). No visto en el navegador.
**Pendiente antes de sumar `costeo` a `MODULOS_ACTIVABLES`:** prueba con la app levantada y un usuario del cliente 2 (la pantalla de Costeo vive dentro del Auditor); revisar datos de ICA en la UI de Costeo y subida de archivos a R2 (rutas por código, no por empresa). Nada se activó.
**Multiempresa:** el código de Costeo ya no depende de datos de ICA; el módulo sigue cerrado a clientes hasta la prueba visual.

## 2026-11-10 — Etapa 3 (Costeo): aislamiento de rutas hecho; falta decidir de dónde sale la viabilidad
`proxy.ts`: el chequeo «el negocio es de tu empresa» (`negocioEsDeCliente`) ahora también cubre `/api/negocios/<id>/(comercial|lineas-oferta)/…` (las 16 rutas de Costeo; el `itemId` ya se valida contra el negocio en `cargarItemLineaTecnica`). Un id de otra empresa responde 404.
**Verificado:** `scripts/scratch/_probar_costeo_aislamiento.mts` contra la BD local (3308) con 2 empresas desechables, 8/8 (patrón cubre las 16 rutas; negocio de A ≠ B; id inexistente igual de 404; negocio de ICA no es de A; no queda nada). No se probó con la app levantada ni en el navegador.
**Bloqueo para sumar `costeo` a `MODULOS_ACTIVABLES`:** el checklist de Costeo se arma desde `viabilidad_licitacion` (viabilidad de ICA, motor v4) en `comercial/route.ts` (`leerInforme`, `viabilidadMasNuevaQueChecklist`) y `generar-costeo/[codigo]`. Una empresa-cliente guarda su viabilidad en `cliente_viabilidad*` (otro formato). Además en la UI el Costeo vive dentro del Auditor (`?seccion=costeo` abre el Auditor), y `asesores(clienteId = 1)` tiene el cliente 1 por defecto.
**Pendiente / decisión del dueño:** (a) adaptar Costeo para leer la viabilidad del cliente, o (b) abrir Costeo + Auditor juntos como un solo módulo. Nada se activó para clientes.
**Multiempresa:** las rutas de Costeo ya no se pueden abrir con un id de otra empresa; el módulo sigue cerrado a clientes.

## 2026-11-10 — Etapa 4: baja de empresa (exportar + borrar) y revisión del deploy de la Etapa 2
Etapa 2 revisada en el VPS: commit d5af273, contenedores reiniciados, `INTEGRACIONES_CLAVE` dentro del contenedor, build con `cliente_integracion`; un análisis de viabilidad (3909-17-LE26) quedó «huérfano» por el reinicio (normal en un deploy).
Nuevo `app/lib/borrar-cliente.ts` (`planBorrado`, `exportarCliente`, `borrarCliente`) + `/api/admin/clientes` (`GET ?borrado=id`, `GET ?exportar=id`, `POST accion=borrar` con el nombre exacto) + bloque «Baja de la empresa» en `/admin/clientes` (aparece si la empresa no está ACTIVA).
**Regla / decisión:** el dueño delegó en Claude («tú eres el ingeniero»). Primero suspender, después borrar; ICA nunca. Se conservan el costo de IA (sin nombres) y los conteos de MP para la contabilidad.
**Verificado:** vista previa contra el VPS en solo lectura (cliente 2: 3.483 filas en 15 tablas; cliente 4: 17; ICA bloqueado). `scripts/scratch/_probar_borrado.mts` en la BD local con una empresa desechable, 11/11: exportar sin `password_hash` ni `datos_cifrados`, no borra si está ACTIVA, no queda nada de la empresa, IA anonimizada, MP conservado, ficha de BAJA, bitácora sin el correo del admin, y la foto de ICA y del cliente 2 idéntica antes y después. `tsc`: solo el error viejo de `comercial/route.ts` (`export { bitacora }`, de hace 6 días, aparece por los tipos de `next dev`). No visto en el navegador; nada borrado en producción.
**Pendiente:** archivos en R2, exportación desde Mi empresa, lo legal (abogado).

**2026-11-10 (tarde) — archivos en R2 agregados al borrado.** `archivosDelCliente()` + `urlsEnUso()` + `borrarArchivos()` en `borrar-cliente.ts`; vista previa muestra «y sus N archivos». Verificado: prueba local 14/14 con R2 simulado (borra el logo exclusivo y una captura dentro de un JSON, deja un documento que también usa una fila de ICA, bitácora `borrado` + `borrado_archivos`). En producción (solo lectura) los clientes 2 y 4 no tienen archivos en R2 hoy. No se borró nada real en R2.

## 2026-11-10 — Etapa 2: ticket de MP y correo propios por cliente
Nuevo `app/lib/integraciones-cliente.ts` (cifrado AES-256-GCM con `INTEGRACIONES_CLAVE`, leer/guardar/borrar con caché de 60 s, `ticketMpPropio`, `probarTicketMp`, `correoDeCliente`) + tabla `cliente_integracion` (migration-186).
`mercado-publico.ts`: `prepararTicket()` en los 3 puntos que llaman a la API (ticket propio → sin tope y sin gastar la cuota compartida; el ticket propio no rota a los de respaldo). `email.ts` → `enviarOcAlProveedor` usa la cuenta de la empresa. API `/api/mi-empresa/integraciones` (GET/PUT/DELETE, solo el admin de una empresa-cliente) y sección `IntegracionesEmpresa` en `/mi-empresa`.
**Regla / decisión:** Claude dejó «sin ticket propio = compartido con tope» para no cortar a los clientes 2 y 4; si se exige ticket propio, lo decide el dueño. Avisos de la plataforma siguen por `.env`.
**Verificado:** `tsc` ok; 1.804 tests ok; `scripts/scratch/_probar_integraciones_mem.mts` 15/15 con la BD simulada en memoria y la API de MP simulada (cifrado, pista sin secretos, qué ticket sale en cada caso, que no cuenta en el total compartido, corte por tope sin salir a internet, correo propio / sin correo). La API real de MP responde `{"Codigo":203,"Mensaje":"Ticket no válido."}` a un ticket inventado → se rechaza. **No** se probó contra la BD local (Docker Desktop no arrancó el 2026-11-10; migration-186 sin aplicar ni en local ni en el VPS), ni la pantalla en el navegador, ni un envío SMTP real.
**Pendiente:** dueño: INTEGRACIONES_CLAVE en el .env del VPS → migration-186 → deploy. Luego probar con un ticket real de una empresa-cliente y una casilla real.
**Multiempresa:** cada empresa puede traer su cuota de MP y su casilla; ICA queda igual que antes.

## 2026-11-09 — Revisión en el VPS tras el deploy del dueño
Revisado en lectura (BD + `docker` + registros), sin cambiar nada: VPS en el commit 69897c0; el build trae `medidor-cliente`; migration-183 y 185 aplicadas (columnas, índices, tabla `mp_api_uso_cliente`); clientes 2 y 4 con topes 10 USD / 500 consultas e ICA sin tope; cliente 2 solo con radar/negocios/viabilidad. Desde las 20:43 `ia_uso` guarda `cliente_id` (86 filas de hoy, todas de ICA, 1,2 USD) y `mp_api_uso_cliente` cuenta (ICA). `licitank.cl/login` 200 en 0,11 s; `/api/negocios/refrescar-estados` sin sesión → 401. Registros de la app sin errores.
Scheduler: 4 «fetch failed» a las 20:43:22.74, 0,12 s antes de que la app dijera «Ready» (carrera normal del arranque del deploy); las corridas siguientes, ok.
**Pendiente:** ver /admin/clientes en el navegador y el primer gasto anotado a un cliente que no sea ICA.

## 2026-11-09 — Etapa 1: medidor por cliente (IA y Mercado Público) con topes
Nuevo `app/lib/medidor-cliente.ts`: de qué empresa es el trabajo (`conCliente()` → header `x-cliente-id` → cliente del usuario → 1), contadores y topes con caché de 30 s.
Conectado en `ia-uso.ts` (guarda `cliente_id`; si falta la columna, guarda sin ella), `gemini.ts` (`crearChatIA` → `verificarTopeIA`), `mercado-publico.ts` (cuenta por empresa; con tope, `fetch` lanza `TopeClienteError` y los métodos que nunca lanzan responden como rate-limit) y `evaluar-empresa-rut.ts` (todo a nombre de la empresa evaluada aunque la lance el superusuario; el barrido de días se corta al llegar al tope). `/admin/clientes`: «Tope IA USD/mes (usado X)» y «Tope consultas MP/día (hoy X)». `proxy.ts`: rutas públicas borran los headers de identidad.
Dato real (VPS, 2026-11-03 a 09): MP gasta 5.200–8.700 consultas/día de las ~9.200 permitidas (10.000 × 92 %); IA de octubre 179 USD. Queda poco margen de MP para clientes nuevos: la Etapa 2 (ticket propio por cliente) es la salida.
**Regla / decisión:** el dueño pidió hacer la Etapa 1. Topes por defecto propuestos por Claude (10 USD/mes, 500 consultas/día; ICA sin tope): el dueño los ajusta.
**Verificado:** `tsc` ok; 1.804 tests ok; `scripts/scratch/_probar_medidor.mts` contra la BD local (3308), 10/10: contador MP por empresa, corte por tope MP sin salir a internet, ICA sin tope, `ia_uso.cliente_id` guardado, corte por tope IA. migration-185 aplicada en local (2 veces, idempotente). **No** aplicada en el VPS (bloqueado) ni visto en el navegador.
**Pendiente:** dueño: migration-185 en el VPS → commit → deploy. Después: OCR sin tope, crons anotados a ICA.
**Multiempresa:** ya se sabe cuánto gasta cada empresa en IA y en MP, y ninguna puede agotar la cuota o el presupuesto de las demás.

## 2026-11-09 — Diagnóstico completo + Etapa 0 (parte de código)
Se revisaron el código y la BD del VPS (solo lectura) para medir qué tan listo está LICITANK para otras empresas; las cifras están en el Inventario.
Cambio: `refrescarEstadosAsignadas` acepta `clienteId` (`app/lib/refrescar-estados.ts`) y `/api/negocios/refrescar-estados` le pasa el de la sesión. El cron `/api/cron/estados-asignadas` sigue sin filtro (sondea todos).
**Regla / decisión:** el dueño pidió un informe vivo que otras sesiones completen (este archivo) y partir por la Etapa 0.
**Verificado:** `tsc` sin errores; la consulta nueva corrida en lectura contra el VPS: todos 141 códigos, cliente 1 = 128, cliente 2 = 14, cliente 4 = 0. No probado en el navegador.
**Pendiente:** desplegar, migration-183 en el VPS y limpiar los módulos del cliente 2. Claude no tiene permiso para escribir en producción, así que lo hace el dueño (ver arriba).
**Multiempresa:** el refresco manual ya no cruza clientes ni gasta cuota de MP en otras empresas.
