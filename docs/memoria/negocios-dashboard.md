# Negocios, radar, dashboard y gestión

Traspasado desde la memoria personal el 2026-10-27; las fechas son de cuando se decidió.

## 2026-11-25 — Usuarios desactivados: NO borrarlos (tsc ok; sin ver en navegador; sin desplegar)
**Pregunta del dueño:** hay muchas cuentas que ya no están (desactivadas, no borradas); ¿borrarlas mancha el análisis?
**Hallazgo (BD real, solo lectura):** 14 desactivadas tienen 778 de los 1.649 negocios activos. `negocios.asignado_a` es `ON DELETE CASCADE` (migration-3; también favoritos, alertas, análisis y comentarios): **borrar un usuario borra sus negocios** y el dashboard perdería casi la mitad del historial. Regla: desactivar sí, borrar no.
**Cómo quedó:** el dashboard sigue contando su historial (es real); en «Seguimiento por perfil» llevan la etiqueta «Desactivado» y la tarjeta de usuarios dice «N desactivados (su historial se conserva)».
**Regla del dueño (misma tarde): el dashboard solo muestra datos reales, NUNCA inventados.** Antes, si una consulta fallaba, `q()` devolvía `[]` y la pantalla mostraba un 0 que parecía verdad; ahora el error sube y sale «no se pudo cargar» (`api/dashboard` y `api/dashboard/analitica`). «Últimos accesos» lista solo cuentas activas. Las consultas se corrieron contra la BD real (solo lectura) y todas funcionan: radar 710 activas, 109 sin asignar, 57 con viabilidad, prefiltro 272/63/375, 1.624 negocios activos. La pantalla no tiene cifras fijas ni de ejemplo.
**Decisión:** las cuentas desactivadas NO se borran.
**Pendiente:** si se quiere borrar de verdad, primero reasignar sus negocios a un usuario «Histórico» o cambiar la FK a SET NULL (migración, con OK del dueño).

## 2026-11-25 — Radar y Puente muestran comuna, organismo y presupuesto (tsc ok; SIN probar con datos ni en navegador; migration-206 APLICADA en producción el 2026-11-25; sin desplegar)
**Pedido del dueño:** que cada licitación diga de dónde es (si es de Angol, «Angol») y muestre el presupuesto; el asesor mandó una captura del radar donde casi ninguna fila traía comprador ni monto.
**Causa:** las alertas nacen del listado de Mercado Público, que no trae organismo/región/monto (solo el detalle); `corregirCamposDesdeDetalle` solo corrige la fecha. La comuna (`ComunaUnidad`) no se guardaba en ninguna tabla.
**Cómo quedó:** `app/lib/licitacion-ubicacion.ts` completa organismo, región, monto y comuna desde `licitaciones_cache` en `/api/alertas` y `/api/puente` (solo rellena lo vacío); el caché guarda la comuna aparte y sin romper si falta la columna (`migration-206-licitaciones-comuna.sql`); fila del radar: «Organismo · Comuna» + «Sin presupuesto» si no hay monto; Puente: comuna, región bajo el nombre.
**Ajuste (misma tarde):** en el Puente 4 de 6 códigos NO estaban en el caché (sin organismo ni monto): ahora el GET del puente trae hasta 12 faltantes del detalle de MP y los guarda; sin monto publicado usa el presupuesto neto de las bases (`viabilidad_licitacion.nivel_presupuesto_neto`).
**Pendiente:** desplegar; la comuna solo llega a licitaciones que se vuelvan a enriquecer (las ya cacheadas la traen vacía hasta entonces); las que no están en el caché siguen sin esos datos.

## 2026-11-25 — Buscador sin límites, como Mercado Público (tsc ok; SIN probar en navegador ni con datos; sin desplegar)
**Decisión del dueño:** el buscador tiene que ser igual al de Mercado Público, sin limitaciones; sale del menú lateral (queda la caja «Buscar licitaciones ⌘K» de arriba, que lleva a `/`); todos los filtros deben funcionar. Caso: 2495-17-B226 llegaba por la API y el buscador no la encontraba.
**Causa:** (1) el detector de código exigía letras+2 dígitos y «B226» (privada B2 + año 26) no calzaba; (2) el universo era solo `estado=activas` y los filtros de región, organismo y monto se aplicaban sobre el listado crudo de la API, que no trae esos campos (daban 0 resultados); Cerradas/Adjudicadas no existían.
**Cómo quedó:** `app/lib/busqueda-sin-limites.ts` busca en TODO `licitaciones_cache` con los filtros en SQL (estado, tipo, región, organismo, monto, fecha de cierre y de publicación — inclusive el día final); la API en vivo solo dice qué sigue Publicada (si no responde, se busca solo en el caché). Código completo → API y, si falla, caché; código parcial («2495-17») → LIKE. Por defecto el estado es Publicada (como MP); desmarcarlo busca en todos.
**Pendiente:** probar con datos reales (túnel SSH 3307 cerrado en esta sesión); las abiertas recién publicadas que el caché no tiene solo se encuentran por título y sin filtros de región/organismo/monto; el caché de una licitación cerrada hace días puede traer estado atrasado.

## 2026-11-24 — «Entregas» sale del menú; el acuse de proyecto ganado se queda (tsc ok; visto en navegador; SIN desplegar)
**Decisión del dueño:** el menú «Entregas» (acuse de recibo de proyectos ganados, F.1: tablas `entrega_proyecto`/`entrega_acuse`) casi no se usaba (55 acuses pendientes, más de la mitad de cuentas de prueba) y su resumen ya está en la ficha de Compras. NO es la entrega física al cliente (eso es «Entrega y cierre» en Compras, `compras_entrega`).
**Cómo quedó:** sin ítem ni badge en `AppLayout`; el acuse sigue llegando solo por `EntregaPendienteModal` (bloqueante, ya existía; no hizo falta franja en el Dashboard ni chip en la ficha). La página `/entregas` se conserva porque el modal manda a «Ver el detalle»: ahora se llama «Acuses de recibo de proyectos ganados» y se entra desde el modal o desde el botón «Acuses de recibo» de Ganadas/Perdidas (solo admin) para ver quién falta.
**Pendiente:** limpiar los acuses de cuentas de prueba (Perfil Compras (prueba) 28, Usuario de Prueba 5): escribe en producción, solo con OK del dueño viendo las filas.

## 2026-10-27 — «¿A qué líneas vamos?» salía en licitaciones globales
Caso real: 3712-74-LP26 (negocio 1511). Banner «Esta licitación es por línea (1): falta elegir a cuáles
vamos» en una licitación de adjudicación GLOBAL con una sola línea. El selector miraba solo
`modalidad.tipo` (cómo se COTIZA), que quedó `por_linea`; elegir líneas depende de cómo se ADJUDICA.
Ahora sale solo con `hayLineasQueElegir` (`checklist-comercial.ts`): cotización por línea, 2 o más líneas
ofertables y adjudicación que no sea GLOBAL; o si ya hay una decisión guardada (para no esconder líneas
dejadas fuera). Ruta `api/negocios/[id]/lineas-oferta`.
**Verificado:** test `selector-lineas-oferta.test.mts`; barrido en la BD (solo lectura): el selector sale en
438 negocios y deja de salir en 44 (GLOBAL o una línea), 3712 incluido. Sin ver en navegador.
4697-25-LP26 (GLOBAL con la línea 1 dejada fuera) estaba mal leída: es por línea y la decisión del equipo
es válida (ver viabilidad.md, «Completar cada línea»).

## Decisiones vigentes del dueño

- **`estado_pipeline` usa ids limpios UPPER_SNAKE**; `pipeline.ts` es la fuente de verdad. Nunca
  comparar ni guardar por la etiqueta. Un estado nuevo va SOLO en `ESTADOS_PIPELINE`; los ids
  viejos viven solo en `ALIAS_LEGADO`.
- Admin = superusuario: el radar muestra todo lo de la empresa, no solo sus palabras clave.
- La tarjeta «Licitaciones en radar» del dashboard da el MISMO número que el radar (la cola
  pendiente, no el volumen ya repartido).
- `/analisis-licitacion` cuenta adjudicadas por el acta de MP, no por `estado_pipeline`.
- Aviso de cierre al 65% del plazo (piso 72 h); botón «En proceso» bloqueado sin viabilidad IA:
  nadie trabaja una licitación sin análisis.
- Descarte con motivo obligatorio y apartado Descartadas.
- **Bitácora total**: todo endpoint que modifica algo llama a `registrarActividad` (sin bloquear la
  respuesta). El historial por licitación hace dedupe diario de las acciones de «mirar» y usa hora
  chilena real.
- Varias firmas escaneadas por empresa; `empresas.firma_url` es espejo de la principal.
- Entrega de Proyectos (F.1): el modal de entrega pendiente es bloqueante (la salida es «Acuso
  recibo»). Facturación queda fuera: se hace en Obuma.
- Para agregar una licitación puntual al radar que no calzó ninguna palabra clave hay un script;
  se corre solo si ya se confirmó que falta.
- Entrevistas técnicas para contratar: el dominio del negocio no entra en la evaluación.

## Pendientes conocidos

- PATCH/DELETE de `/api/alertas` solo operan sobre filas propias: un admin no puede marcar/borrar
  una alerta ajena.
- Entrega de Proyectos: destinatario de logística y export a PDF/Word sin decidir.
- Batch de re-análisis del golden set con la función que GUARDA nunca se completó (jul-2026).
- Dashboard: descarte antes de asignar (nivel 0) no se representa; «Posible adjudicado»
  automático fuera de alcance.
- Refresco garantizado de «Destacadas» cada 2 h necesitaría un cron dedicado (decisión del dueño).

## Días al cierre = días de CALENDARIO en hora Chile (29-oct-2026)
- Bug: «Cierra mañana» con fecha impresa «jueves 29» (= hoy). Causa: `Math.ceil`/`Math.round` de ms/24 h (cierre hoy 20:00 visto a las 08:00 → 0,5 → «mañana»).
- Regla: contar SIEMPRE con `diasCalendarioChile()` de `app/lib/tz.ts` (0 = hoy, 1 = mañana); nunca dividir ms por 86400000. Aplicado en getDiasRestantes (licitación/Resumen), ResumenNegocio, FechasNegocio, search-engine, api/search, negocios/page. Sin verificar en navegador.
- Pendiente: fechas de otros módulos (reloj de entrega de Compras ya usa YMD; postuladas usa dayjs del navegador).

## Puente: «Repartir a» solo muestra perfiles que trabajan licitaciones (02-nov-2026)
- Bug: el Puente listaba TODOS los usuarios activos (compras, bodega, etc.). Decisión del dueño: criterio **automático por exclusión**.
- Regla: `recibeLicitaciones()` en `app/lib/puente.ts` deja fuera a rol `externo` y a quien tenga `solo_compras` o `compras_auditor`. Se aplica en `GET /api/puente` (chips) y en `contextoReparto` (simular/repartir), así un id colado no recibe nada.
- Actualización (mismo día): una admin SÍ hace licitaciones → se agregó el permiso explícito `recibe_licitaciones` (selector en /admin/usuarios, también para admins). Si está fijado manda (sí/no); si nunca se tocó vale la exclusión de arriba. Sin verificar en navegador.

## 2026-11-19 — Reasignar responsable no se aplicaba (GestionAside.tsx; tsc sin errores propios, sin ver en navegador)
Causa: el menú `Desplegable` se cerraba con el mousedown sobre una opción del `<Select>` (su lista va en un portal fuera del menú), así que el clic nunca llegaba y no salía ni error. Arreglo: `Desplegable` ignora mousedown dentro de `[role="listbox"]`. Los permisos (solo admin) no cambiaron. Pendiente: probar con un negocio real y desplegar.

## 2026-11-25 — Fila de lista del Radar ordenada (visto en navegador a 1568 px, modo claro; sin ver oscuro ni 800 px)
Las columnas se movían fila a fila (la zona de estados tenía ancho variable) y salía un «0» suelto (`tiene_documentos && …` con 0). Ahora: código | título + «Organismo · Comuna/Región» | monto (w-32) | estados en columna fija de 250 px (viabilidad/prefiltro arriba; Docs/Asignada/Puente abajo) | botones. Sin desplegar.
