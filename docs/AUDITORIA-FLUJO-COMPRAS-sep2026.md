# Auditoría del flujo del Módulo de Compras — 17-sep-2026

Pedido explícito del usuario: revisar todo el flujo de Compras como tester/analista, detectar qué
falta, arreglar lo evidente y dejar todo documentado. Esto es la primera pasada — el usuario avisó
que se va a ir ajustando por partes.

## 0. Prueba real en el navegador (negocio #1054) — 17-sep-2026

El usuario inició sesión en `localhost:3000` y se probó el flujo en vivo, no solo por código:

1. Se abrió `/compras/1054` — Encargado chico, Gantt primero, Resumen y OC arriba, tal como se
   había rediseñado. El stepper mostraba "Compra, Importación y Logística" en ámbar con badge "1".
2. Se entró a esa pestaña y se marcó el hito "Anticipo pagado" como **no aplica** (con nota).
3. El toast confirmó "Marcado como no aplica", pero **el badge del stepper se quedó en "1"** en vez
   de bajar a 0 — el refresco automático corrió bien, pero el dato de origen seguía mal.
4. Se encontró la causa en la base de datos: `marcarHitoNoAplica()` (app/lib/compras-reparto.ts)
   solo escribe en `compras_reparto_respaldo` (estado `NO_APLICA`) — nunca toca la columna
   `anticipo_pagado_at` de `compras_reparto_administrativo`, que es la que cuenta
   `contarHitosAdminPendientes()` para el badge. Un hito "no aplica" quedaba pendiente para
   siempre, sin importar cuántas veces se recargara la pantalla.
5. **Corregido**: `contarHitosAdminPendientes()` ahora resta los hitos con respaldo `NO_APLICA` del
   conteo de pendientes.
6. De paso se encontró y corrigió un segundo detalle cosmético: con 0 pendientes, el badge mostraba
   una burbuja con el número **"0"** en vez de no mostrar burbuja (las demás pestañas sí ocultan el
   badge en 0). Ahora "Compra..." se comporta igual que el resto.
7. Se recargó la página y se confirmó: el círculo de "Compra, Importación y Logística" pasó a verde
   esmeralda sin badge, y **ese color se mantuvo al cambiar entre pestañas** (Tareas → Costeo →
   Entrega → Documentos) — confirmando que ya no depende de "por dónde ibas navegando", sino del
   estado real, que era justo el bug original reportado.
8. Se revisó también la pestaña nueva "Documentos" (antes tarjeta fija arriba de todo): renderiza
   correctamente "Documentación del proyecto" y "Auditar este negocio completo con IA" adentro del
   stepper, como se rediseñó.

**Conclusión de la prueba real:** el arreglo del stepper y de la reactividad entre módulos
funciona de punta a punta — pero la prueba también demostró por qué hacía falta probarlo en vivo:
el bug de "no aplica" nunca se iba a encontrar solo con lectura de código o con `tsc`, porque
`tsc` no valida que una consulta SQL cuente lo que se necesita contar.

## 1. Lo que se encontró y se corrigió en esta pasada

### 1.1 El color del stepper no reflejaba avance real (CORREGIDO)
**Síntoma reportado:** "el menú de tareas y otros deben ir cambiando de color según sus avances,
no me sirve que queden en verde al avanzar al otro".

**Causa real:** en [ComprasChrome.tsx](../app/compras/[negocioId]/ComprasChrome.tsx), la variable
`pasada` que pintaba cada pestaña de verde/teal se calculaba así:

```ts
const pasada = !esLente && idxActiva < totalEtapas && i < idxActiva;
```

Es decir: una pestaña se pintaba de "completa" únicamente porque su posición en el menú era
**anterior a la que tenías abierta ahora mismo** — sin mirar ni una sola vez si esa fase realmente
tenía pendientes. Bastaba con hacer clic hacia adelante para que quedara verde para siempre, aunque
tuviera tareas vencidas, cotizaciones sin cargar o compuertas sin aprobar.

**Arreglo:** cada pestaña ahora calcula su propio estado (`alerta` / `pendiente` / `ok` / `neutral`)
a partir de datos reales — `resumenFases` (vencidas, cotizaciones sin cargar, compuertas
pendientes, hitos administrativos, incidencias/reloj vencido) y el array de `tareas` ya cargado —
sin importar cuál pestaña esté abierta. Rojo = alerta real, ámbar = pendiente, verde = sin
pendientes, gris = sin datos todavía (p. ej. "Compra" antes de aprobar la Compuerta 1).

### 1.2 Los apartados no se actualizaban entre sí (CORREGIDO — las 14 tarjetas)
**Síntoma reportado:** "si cambio algo en un apartado se actualice en otro si tiene datos de eso".

**Causa real, más grave que el punto anterior:** el módulo tiene un contexto compartido
([ComprasContext.tsx](../app/compras/[negocioId]/ComprasContext.tsx)) que trae `tareas`,
`resumenFases`, `asignacion`, etc. de una sola vez y expone una función `recargar()` para
refrescarlo. **El problema es que casi ninguna tarjeta la llamaba.** Cada tarjeta (Productos,
Auditor de Compras, Aprobaciones, Reparto Administrativo, Reloj de Entrega, Incidencias, Entrega,
Postventa, Fracaso, Documentos, Auditoría del Agente...) vive aislada: pide sus propios datos,
guarda sus propios cambios, y nunca le avisa al resto de la pantalla que algo cambió. El resultado:
el stepper y el Gantt quedaban con datos viejos hasta recargar el navegador entero — exactamente lo
que describiste.

**Arreglo aplicado en esta pasada** — se conectó `recargar()` del contexto compartido después de
cada mutación real en las tarjetas con más impacto sobre el stepper y el Gantt:

| Tarjeta | Acción que ahora refresca el resto | Qué mueve |
|---|---|---|
| [ProductosCompraCard](../app/negocios/[id]/ProductosCompraCard.tsx) | Cambiar subestado, sincronizar con costeo | cobertura, futuros indicadores |
| [AuditorComprasCard](../app/negocios/[id]/AuditorComprasCard.tsx) | Crear/editar/eliminar/homologar cotización, guardar asignación | badge "Costeo y Auditoría" |
| [AprobacionesCompraCard](../app/negocios/[id]/AprobacionesCompraCard.tsx) | Proponer o resolver una compuerta | badge "Aprobación y SKU" **y** desbloquea el badge de "Compra" |
| [RepartoAdminCard](../app/negocios/[id]/RepartoAdminCard.tsx) | Marcar/desmarcar un hito administrativo | badge "Compra, Importación y Logística" |
| [RelojEntregaCard](../app/negocios/[id]/RelojEntregaCard.tsx) | Fijar reloj, prórroga, multa, cancelar prórroga, marcar entregado | badge "Entrega y Cierre" **y** cierra sola la tarea "reloj_entrega" (se ve en Tareas y en el Gantt) |
| [IncidenciasCard](../app/negocios/[id]/IncidenciasCard.tsx) | Abrir/cerrar incidencia, Oportunidad de Mejora | badge "Entrega y Cierre" |

**Segunda pasada (mismo día, confirmado por el usuario: "es ideal que estén conectadas... unir
todo")** — se conectaron las 8 tarjetas restantes con el mismo patrón:

- [ImportacionCard](../app/negocios/[id]/ImportacionCard.tsx) — el costo aterrizado alimenta el margen de la Compuerta 2
- [ModalidadRetiroCard](../app/negocios/[id]/ModalidadRetiroCard.tsx)
- [GastosCard](../app/negocios/[id]/GastosCard.tsx)
- [EntregaCard](../app/negocios/[id]/EntregaCard.tsx) (verificación, acta, firma de guía — un único punto `accion()`)
- [PostventaCard](../app/negocios/[id]/PostventaCard.tsx)
- [FracasoCard](../app/negocios/[id]/FracasoCard.tsx)
- [DocumentosLicitacionCard](../app/negocios/[id]/DocumentosLicitacionCard.tsx)
- [AuditoriaAgenteNegocioCard](../app/negocios/[id]/AuditoriaAgenteNegocioCard.tsx)

**Las 14 tarjetas del módulo quedan conectadas.** Verificado con `tsc --noEmit` (limpio) y probado
en vivo en el negocio #1054 — sin errores en consola, "Gastos del negocio" (recién conectada)
renderiza normal dentro de la pestaña "Compra, Importación y Logística".

Ninguna de estas 8 mueve hoy ningún badge del stepper (el stepper no tiene indicador para
Importación/Logística/Gastos/Entrega física/Postventa/Fracaso todavía), así que conectarlas no
cambió nada visible de inmediato — pero ya no hace falta tocar cada tarjeta de nuevo el día que se
agregue un indicador propio, y
es la misma receta en cada una: importar `useCompras` desde `ComprasContext` y llamar
`recargar()` después de cada guardado exitoso.

## 2. Pros del módulo tal como está

- **Arquitectura de datos sólida y bien documentada.** Casi cada archivo de `app/lib/compras-*.ts`
  cita la sección exacta de la especificación (§7, §14, §15...) en sus comentarios. Es raro
  encontrar un módulo de este tamaño con tanta trazabilidad entre spec y código.
- **Reglas de negocio duras aplicadas en el backend, no solo en la UI** — ej. "cobertura total o
  nada" (§14.2) se valida en `coberturaProyecto()` antes de generar el acta, no solo se sugiere en
  pantalla.
- **Historial de eventos real** (`registrarEvento`) en casi cada mutación — cumple el requisito de
  trazabilidad total (§18) y ya alimenta la pestaña "Actividad".
- **El flujo de una sola pantalla con estado local** (sin navegar entre URLs) es rápido de usar una
  vez cargado, y es justo lo que pediste explícitamente hace unos días.
- **Integraciones reales funcionando**: OBUMA (proveedores, OC, SKU, histórico de compras),
  Mercado Público (OC del cliente automática), fleteros con sugerencia geográfica.
- **Permisos bien acotados** — "ser admin" ya no basta por sí solo en casi ninguna acción sensible
  (se exige `compras_todo` o `aprobar_comercial` de verdad), lo que evita aprobaciones accidentales.

## 3. Contras / riesgos encontrados

- **Reactividad entre módulos incompleta** (ver §1.2) — quedan 8 tarjetas sin conectar al
  refresco compartido. Mientras no se conecten, cualquier indicador nuevo que dependa de esos datos
  va a arrastrar el mismo bug que el stepper.
- **El stepper no tiene indicador para 4 de sus 7 pestañas** (Documentos, Actividad — por diseño,
  son vistas de solo lectura — pero también falta indicador de avance real en la pestaña de
  Documentos: si faltan Bases o Acta no hay ninguna señal en el menú).
- **El resumen ejecutivo no se regenera solo** (pendiente §21.1 de la spec, confirmado también en
  esta auditoría): si cambia algo después de asignar (prórroga, OC por menos líneas, Oportunidad de
  Mejora aprobada), el resumen sigue mostrando la foto del día que se ganó hasta que alguien aprieta
  "Volver a armar" a mano.
- **Sin pruebas automatizadas del flujo completo.** Existen tests unitarios sueltos
  (`app/lib/__tests__/`), pero no hay ningún test de integración que recorra Tareas → Costeo →
  Aprobación → Compra → Entrega de punta a punta. Cualquier regresión como la del stepper puede
  pasar meses sin detectarse porque nadie la ve hasta que alguien completa el flujo real.
- **No pude probarlo en el navegador en esta sesión** — la app pide sesión iniciada y no tengo tus
  credenciales, así que todo lo de arriba es auditoría de código + verificación con `tsc`, no una
  prueba clic a clic. Ver sección 4.

## 4. Sobre "completa una licitación con todos los pasos"

No lo hice todavía porque son dos caminos distintos y hay que elegir uno:

1. **Prueba real en el navegador**, clic a clic, sobre un negocio de verdad (o uno de prueba que
   me indiques) — necesito que inicies sesión tú y me dejes la pestaña abierta, o me pases
   credenciales de una cuenta de prueba.
2. **Trazado por script contra la base de datos**, sin tocar nada (solo lectura) sobre un negocio
   real que me indiques, para verificar que los datos de cada fase efectivamente calzan entre sí
   (ej.: que el resumen ejecutivo coincide con el costeo, que la cobertura coincide con los
   subestados de producto, que el reloj coincide con la fecha de entrega real). Esto es seguro
   porque no modifica nada, pero no prueba la UI, solo los datos.

Dado que ya tocamos negocio 1054 hace poco, podría usar ese mismo como caso de prueba para
cualquiera de los dos caminos — dime cuál prefieres y sigo.
