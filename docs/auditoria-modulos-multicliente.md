# Auditoría de módulos para multi-cliente (mismo sistema, módulos activables)

Fecha: 23-oct-2026. Rama: `multicliente-mismo-sistema`. Complementa `diseno-multitenant-fase1.md`.
Dirección acordada: **un solo LICITANK** (mismo landing, mismo login, mismas pantallas). Cada empresa-cliente tiene
su perfil admin y solo ve lo suyo. Lo que no contrató aparece bloqueado; solo el superusuario lo activa.

## 1. Hallazgos que simplifican el trabajo

1. **Ya existe un sistema de permisos finos** (`usuarios.permisos`, `Permiso` en `api-auth.ts`, `usuario.permisos` en la UI).
   La ficha del negocio ya esconde Costeo, Auditor, Compras, etc. según esos permisos
   (`app/negocios/[id]/page.tsx` ~l.645-753). Un usuario de cliente con `rol='usuario'` y solo `acceso_radar` + `exportar`
   ya NO ve esas pestañas. No hay que reescribir las pantallas: se enmascara el permiso.
2. **Permiso efectivo = permiso del usuario ∩ módulos del cliente.** Un único punto (`permisosDeUsuario`) aplica la máscara;
   el cliente 1 (ICA, `modulos NULL`) queda sin máscara → su comportamiento no cambia.
3. **El cliente nunca es `rol='admin'` del sistema.** `admin` abre `/admin/*`, `/api/usuarios` global, gasto IA, etc.
   El "admin del cliente" es `rol='usuario'` + bandera propia (`clientes.admin_usuario_id` o permiso de equipo).
4. **Aislamiento con lista blanca de APIs**: un cliente solo puede llamar a las rutas de módulos que tiene activos
   (proxy, falla cerrado). Solo hay que poner `cliente_id` a las rutas alcanzables, no a las ~237 rutas.
5. Las tablas hijas por `negocio_id` (auditor_*, compras_*, checklist_*…) **no necesitan `cliente_id`**: heredan por el
   negocio, y están detrás de módulos bloqueados. Se les agrega `cliente_id` recién al vender ese módulo.

## 2. Clasificación de módulos

| Módulo | Qué incluye | Fase 1 | Para activarlo a un cliente |
|---|---|---|---|
| **radar** | /radar, alertas, palabras clave, descarte, prefiltro, enriquecer, puente | SÍ | — |
| **negocios** | /negocios, ficha, comentarios, etiquetas, documentos, empresas (RUT postulante), postuladas, adjudicadas, dashboard, favoritos, descartadas | SÍ | — |
| **viabilidad** | licitacion-viabilidad*, viabilidad*, reglas-ia, análisis IA | bloqueado | separar lectura (compartida) de evaluación (por cliente) |
| **ia_chat** | licitacion-ia, licitacion-preguntas, chat-*, analizar-documento | bloqueado | cupo de IA por cliente |
| **auditor** | auditor técnico/compra/unificado, prepostulación | bloqueado | `cliente_id` en `auditor_*`, `checklist_*` |
| **costeo** | costeo editor, plantilla, exportar | bloqueado | `cliente_id` en `negocio_costeo_*`, `negocio_lineas_oferta` |
| **anexos** | generar/separar/rellenar | bloqueado | `cliente_id` en `empresa_*`, `anexos_*` |
| **compras** | 82 rutas /api/compras, logística, entregas, órdenes de compra, Obuma | bloqueado | `cliente_id` en ~60 tablas `compras_*` |
| **admin** | /admin/*, gasto IA, reportes, usuarios globales | solo ICA | panel de superusuario (nuevo) |
| **cron/sistema** | /api/cron, debug | solo sistema | — |

## 3. Tablas

**Compartidas (públicas, sin `cliente_id`)**: `licitaciones_cache`, `adjudicacion_cache`, `licitacion_apertura`,
`documentos_licitacion`, `documentos_cache`(*), `doc_*`, `oferta_competencia*`, `preguntas_respuestas_cache`, `mp_api_uso_diario`.
(*) `documentos_cache` y `analisis_cache` llevan `usuario_id`: revisar al activar IA.

**Privadas Fase 1 (llevan `cliente_id NOT NULL DEFAULT 1`)**: `usuarios`, `negocios`, `etiquetas`, `palabras_clave`,
`alertas_licitaciones`, `favoritos`, `licitaciones_descartadas`, `comentarios_negocio`, `comentarios_licitacion`,
`historial_eventos`, `actividad_usuario`, `puente_radar`, `puente_cola`, `puente_repartos`, `reportes_error`,
`search_history`, `prefiltro_licitacion`(por confirmar: depende de las palabras clave del cliente).
Ya tienen `cliente_id`: `empresas`, `experiencia_*`. `negocios_etiquetas` hereda por negocio.

Llaves únicas globales a convertir en por-cliente: `etiquetas(nombre)`, `licitaciones_descartadas(licitacion_codigo)`,
`puente_radar(licitacion_codigo)`. `usuarios.email` queda global (el login no pide empresa).

## 4. Tamaño del trabajo (archivos que consultan cada tabla raíz)

negocios 82, usuarios 62, alertas_licitaciones 28, empresas 21, prefiltro_licitacion 16, etiquetas 11, palabras_clave 7,
historial_eventos 7, comentarios_negocio 6, puente_radar 5. Solo se tocan los alcanzables desde las rutas de Radar y
Negocios; el resto queda detrás del bloqueo por módulo. El riesgo es olvidar un filtro: se cubre con (a) helper único,
(b) test de dos empresas sobre cada ruta permitida, (c) revisor estático que falla si una consulta a tabla privada no
filtra por `cliente_id`.

## 5. Orden de implementación

1. Migración 167 (espejo): `cliente_id` en tablas privadas Fase 1 + llaves únicas por cliente + `clientes.admin_usuario_id`.
2. Sesión: `clienteId` en JWT + relectura en `estadoVigente` (cache 30 s) + `x-cliente-id` desde `proxy.ts`.
3. Helper `app/lib/cliente.ts` y máscara de módulos en `permisosDeUsuario`.
4. Lista blanca de páginas/APIs por módulo en `proxy.ts` (fail-closed).
5. Filtros por cliente en las rutas de Radar y Negocios (+ `puedeVerLicitacion`).
6. Tope de usuarios (1 ahora, 2 después) y panel de superusuario (módulos, vencimiento, bitácora).
7. Pruebas de dos empresas + revisor estático. Solo con OK del dueño: migración en producción y luego código.
