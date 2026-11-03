---
name: rediseno-compras
description: Rediseño visual de la ficha de un negocio en Compras (/compras/<id>) pensado para notebook (~1366 px). Usar para seguir mejorando esa pantalla — cabecera, franja de siguiente paso, Gantt, Resumen ejecutivo, Orden de compra, stepper y pestañas — o cuando el dueño mande una captura de ella diciendo que se ve larga, apretada o que no dice nada.
---

# Rediseño de la ficha de Compras (`/compras/<id>`)

Se trabaja pantalla por pantalla, con el sistema `licitank-ui` (leerlo antes) y capturas del
dueño en un notebook. Archivo principal: `app/compras/[negocioId]/ComprasChrome.tsx`. Solo visual:
no tocar datos, cálculos, textos de negocio ni umbrales sin preguntar.

## Por qué hace falta
En un notebook, dentro del negocio hay dos menús laterales: al contenido le quedan ~1100 px (o ~830
en 1366). Lo de arriba apilaba cabecera, encargado, banner, chips, Gantt, Resumen y OC, y el flujo
(stepper) quedaba fuera de la primera pantalla. El dueño rechaza lo largo, lo repetido y el texto
que «no dice nada».

## Reglas que salieron del dueño
1. **Una sola franja para «qué hago ahora»**: siguiente paso + reloj de entrega + incidencias en una
   fila blanca de ~56 px. La frase larga va en el tooltip. Si el paso ya habla de incidencias, no se
   repite el chip (`ocultarIncidencias`). Color solo en ícono, reloj y botón.
2. **El Gantt se abre en un modal casi a pantalla completa** (`GanttComprasCard`, prop `plegable`);
   en la tarjeta queda la barra resumen «7/16 hechas · 5 vencidas · Próxima…». En `/compras`
   (`plegable={false}`) sigue en línea.
3. **Cero cajas dentro de cajas**: dentro de una tarjeta se separa con `border-t`. Cabecera y
   encargado son UNA tarjeta; en la OC, «Datos para facturar» es una sección, no un recuadro.
4. **Rótulo arriba, valor abajo** (`dt` 11 px zinc-500 / `dd` 13 px `font-semibold`), no «etiqueta
   | valor» en dos columnas angostas (se partía en 3-4 líneas).
5. **Sin pastillas** para condiciones o estados: texto con punto (ámbar solo cuando exigen algo).
   Sin `font-bold`/`extrabold`, sin violeta/índigo.
6. **Grillas por ancho del panel**: `@container` en la raíz y `@xl:` / `@2xl:` / `@4xl:`, nunca
   `sm:` / `lg:` en esta pantalla (ya está envuelta en `@container`).
7. Enlaces de acción con `whitespace-nowrap` y 13 px de ícono; si no caben, la fila envuelve entera.

## Estado
- Hecho (3-nov-2026): cabecera+encargado, franja siguiente paso, Gantt en modal, Resumen
  (KPIs y datos del proyecto por ancho del panel), condiciones de las bases, contactos del cliente,
  Orden de compra y datos para facturar. `tsc` limpio; **no se vio en navegador** (pide login).
- Falta: el stepper y las pestañas del flujo (Tareas, Costeo, Aprobación, Compra, Entrega, Obuma,
  Documentos, Actividad), que están más abajo en el mismo archivo (~línea 800 en adelante), y las
  tarjetas de `app/negocios/[id]/*Card.tsx` que se muestran dentro.
- Idea abierta: «Contactos del cliente» y «Datos para facturar» repiten razón social, RUT, unidad,
  dirección y contacto; unirlos en un solo bloque (preguntar al dueño antes).

## Cómo seguir
1. Pedir o mirar la captura; localizar el bloque en `ComprasChrome.tsx`.
2. Proponer una maqueta breve si el cambio es grande; si es de orden/tamaño, aplicarlo directo.
3. `npx tsc --noEmit` (y eslint del archivo). Ver en `localhost:3000/compras/<id>` solo si hay sesión.
4. Anotar aquí lo hecho y en `docs/memoria/ui.md`. No commitear: el dueño sube a git.
5. Referencias externas que el dueño nombró (Emil Kowalski, impeccable, taste skill) no están
   instaladas; si las trae, aplicarlas encima de `licitank-ui`.

## Actualización (3-nov-2026, 2.ª ronda)
- Tutorial «¿Cómo se hace este paso?» eliminado (`TutorialPaso.tsx` borrado).
- Condiciones críticas de las bases (boleta, firma, plazo para aceptar la OC): FRANJA delgada de tres celdas con punto (ámbar si exige) y valor en negrita. Las tarjetas grandes con ícono y fondo de color se rechazaron («muy grande y parece IA»): nada de cajitas de ícono ni fondos teñidos para esto. Solo «Sí/No» y el texto de las bases: no inventar notas.
- «Datos para facturar» en tres grupos con título (Cliente · Contacto · Dirección y pago): antes la
  dirección quedaba entre el giro y el correo.
- Gantt: el reloj fijado a mano (`compras_reloj.fecha_inicio`) manda sobre lo que digan las bases
  (`relojInicioAt` en `EntradaAnclas`). Antes, si las bases no decían desde cuándo corre el plazo,
  seguía «inicio por validar» aunque ya estuviera fijado. Test en `compras-plan.test.mts`.
- Stepper del flujo (3-nov-2026, 3.ª ronda): «dónde estoy» y «cómo va» ya no comparten canal. El círculo
  dice el estado (✓ listo, ! alerta, número pendiente); el paso actual va con fondo teal suave en todo el
  botón (sin halo, sin escala, sin subrayado). La línea entre pasos es verde solo si el paso anterior
  está listo. La franja gris de descripción pasó a «título del paso + descripción» en una línea. Las
  sub-pestañas perdieron el «1 · 2 · 3 ·» (chocaba con los números del stepper). Al pie de cada paso:
  «← anterior» y «Siguiente: … →».
- Cotizaciones → «Hay proveedores con compras anteriores parecidas» (3-nov-2026): cada proveedor es un
  botón que abre `ProveedorFichaModal` (`app/negocios/[id]/`): datos de contacto (RUT, giro, contacto,
  teléfono, correo, dirección; sin datos bancarios), productos que le hemos comprado (agrupados, último
  precio y fecha; los parecidos van marcados) y sus órdenes de compra desplegables con ítems. Datos por
  `GET /api/compras/proveedores/ficha` (`?id=` local y/o `?obumaId=`, `?folio=` para ítems). Los
  productos solo cuentan órdenes con ítems ya sincronizados. Si el proveedor no tiene ficha local, el
  modal lo dice y muestra solo lo de Obuma. Reutilizable desde otros lugares con `ProveedorRef`.
- Lista de cotizaciones recibidas (ListaCotizaciones): DENSA, pensada para 100 filas. Una fila de ~44 px (proveedor + RUT, qué cubre resumido «1.er producto $ +N más», total, vigencia, avisos, acciones como íconos); el detalle (documento, subida por, plazo, chips completos, líneas sin asignar) se abre con la flecha; buscador si hay más de 6; scroll propio con encabezado fijo. Tarjetas grandes y tabla de 900 px se rechazaron («maximiza espacios, todo grande»). Regla general: listas largas = filas densas + detalle plegable.
- Ver TODAS las cotizaciones juntas (3-nov-2026): botón «Ver todas las cotizaciones (N)» sobre la lista y «Ver cotización» por fila abren el visor con lista lateral (tira arriba en pantalla chica), ‹ › y flechas del teclado. `DocumentViewerModal` ganó `lista` + `onElegir` opcionales (los demás usos no cambian).
