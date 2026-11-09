# Multiempresa: informe vivo para vender LICITANK a otras empresas

Documento de trabajo **compartido entre sesiones**. Cada sesión que avance en multiempresa:
1. lee este archivo entero antes de empezar,
2. marca lo que terminó en el **Plan por etapas** (`[x]` + fecha) y corrige las cifras del **Inventario** si cambiaron,
3. agrega una entrada en la **Bitácora** (arriba de todo, formato de la skill `memoria-proyecto`),
4. si deja algo para que lo haga el dueño (desplegar, migración en el VPS), lo pone en **Lo que tiene que hacer el dueño**.

Reglas técnicas: skill `multiempresa-escalable` (`.claude/skills/multiempresa-escalable/SKILL.md`). Historia anterior
(rama `multicliente-mismo-sistema`, plan comercial, Ley 21.719): sección «Multi-cliente» de [infra.md](infra.md).

---

## Lo que tiene que hacer el dueño (pendiente)

**En este orden** (el clasificador de Claude bloquea las migraciones en producción; a veces deja pasar una con OK explícito):
- [ ] **1. migration-185 en el VPS, ANTES de desplegar** (agrega columnas/tabla, no borra nada): `node scripts/aplicar-migration-185.mjs --produccion`.
  Si se despliega sin ella, el gasto de IA se sigue guardando (sin la empresa) pero **/admin/clientes da error** (lee los topes).
- [ ] **2. Commit + `deploy.sh`.** Lleva: pool 8→20 / cola 24→200 y caché del dashboard (ya en `master`), refresco por empresa (Etapa 0) y el medidor (Etapa 1).
- [x] 2026-11-09 migration-183 aplicada en el VPS (Claude, con OK del dueño; 2 índices creados).
- [x] 2026-11-09 módulos del cliente 2 limpiados en el VPS → `["radar","negocios","viabilidad"]`. Valor anterior, por si se quiere volver: `["radar","negocios","ia_chat","anexos","competencia","auditor","compras","costeo","viabilidad"]`.
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
- [ ] Desplegar pool + caché del dashboard → dueño (`deploy.sh`).
- [x] 2026-11-09 — migration-183 aplicada en el VPS.
- [x] 2026-11-09 — `clientes.modulos` del cliente 2 limpiado (antes tenía Costeo, Auditor, Compras… marcados; el día que se activaran le quedaban encendidos sin que nadie lo decidiera).
- [x] 2026-11-09 — Rutas públicas (login, cron) ya no dejan pasar headers de identidad (`x-user-*`, `x-cliente-id`) mandados por el navegador (`proxy.ts`).

### Etapa 1 — El medidor (cuánto cuesta cada cliente)
- [x] 2026-11-09 — `ia_uso.cliente_id` (migration-185; `ia-uso.ts` lo toma de `medidor-cliente.ts`). Sin petición (cron, scheduler) = 1.
- [x] 2026-11-09 — `mp_api_uso_cliente` (consultas por día y empresa) + tope diario por empresa (`clientes.tope_mp_diario`), cortado en `mercado-publico.ts` antes de salir a internet.
- [x] 2026-11-09 — Tope de IA mensual en USD por empresa (`clientes.tope_ia_usd_mes`) en `crearChatIA`, para todo (no solo Viabilidad). Consumo y topes editables en `/admin/clientes`.
- [ ] El OCR (visión/PDF) y `analizarLicitacionConGemini` no pasan por `crearChatIA`: se anotan, pero el tope no los corta.
- [ ] Lo que corre en crons para todas las empresas (intake del Radar, estados) queda anotado a 1 (ICA). Repartirlo si se cobra por consumo.
- [ ] Ver /admin/clientes en el navegador (no se hizo: el dev server local apunta a la BD de producción, que aún no tiene la migration-185).

### Etapa 2 — Cuentas propias por cliente
- [ ] Ticket de Mercado Público por cliente (la regla de MP es 1 ticket por persona): guardado cifrado, con el de ICA como respaldo **solo** para el cliente 1.
- [ ] Correo: una función `enviarCorreo({clienteId|empresaId, …})` + proveedor con dominio verificado (Brevo / Resend / SES).
- [ ] Obuma opcional: lo que dependa de Obuma tiene camino propio o se oculta para el cliente que no lo usa.

### Etapa 3 — Abrir módulos, uno por uno (orden propuesto)
Para cada módulo: tablas con dueño → todas sus rutas con chequeo de cliente → datos de ICA fuera del código → prueba de aislamiento en la BD local (3308) con un usuario del cliente 2 → recién ahí se suma a `MODULOS_ACTIVABLES`.
- [ ] Costeo (`checklist_comercial*`, `negocio_costeo_editor`, `negocio_lineas_oferta`; 10 rutas `/api/negocios/[id]/comercial/*`).
- [ ] Auditor (`auditor_*`; rutas `/api/negocios/[id]/auditor*` y `prepostulacion`).
- [ ] Anexos (`empresa_documentos`, `empresa_firmas`, motor `anexos-*.ts` con datos de ICA escritos).
- [ ] Compras (el más grande: 90 rutas, proveedores, historial OC, Obuma, OC propia de Comercial MP).

### Etapa 4 — Legal y alta sin intervención (en paralelo)
- [ ] Ley 21.719 (rige desde el 2026-12-01): borrar todo lo de un cliente cuando se va, contrato, política de datos. Lo valida un abogado.
- [ ] Alta sola: formulario → cliente + admin + evaluación por RUT en cola (hoy corre dentro del proceso de la app; si se reinicia, se corta).

---

## Bitácora

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
