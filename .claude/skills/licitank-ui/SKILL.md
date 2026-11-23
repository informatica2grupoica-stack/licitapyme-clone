---
name: licitank-ui
description: Sistema de diseño de LICITANK (SaaS) — colores, letras, componentes, formularios, tablas, avisos, textos y animación para que todas las pantallas se vean profesionales, modernas y sin aspecto «hecho por IA». Usar al crear, arreglar o rediseñar cualquier pantalla o pieza visual (tarjeta, KPI, tabla, formulario, modal, pestañas, botones, estados, colores), o cuando el dueño diga que algo «se ve feo», «apretado», «largo» o «no dice nada». Referencia viva en /ui-kit y en Figma.
---

# LICITANK UI — sistema de diseño

Reemplaza a `ui-sin-aspecto-ia`. Se trabaja con **Tailwind v4 + framer-motion** e íconos **Tabler**
(`@tabler/icons-react`). No hay Mantine.

**Fuentes de verdad, en este orden:**
1. El código: `app/globals.css` (tokens) y `app/components/ui/kit/` (piezas). Vista viva en `/ui-kit`.
2. Figma «LICITANK — Sistema de diseño» (https://www.figma.com/design/2cFgWOJU5Ww4j9bnvFbngd): copia de los
   tokens y piezas, con una pantalla de muestra. Si se cambia un token o pieza en el código, avisar al dueño
   que el Figma quedó desactualizado (o actualizarlo con el conector de Figma).

Antes de inventar un estilo, mirar si ya existe. Una pieza nueva que se repetirá se agrega al kit y a `/ui-kit`.

## Piezas

| Archivo (`app/components/ui/kit/`) | Qué es |
|---|---|
| `movimiento.ts` | `EASE_LK`, `RAPIDA` (0,15 s), `NORMAL` (0,25 s), variantes `lista` / `item` |
| `Aparecer.tsx` → `Lista` | Hace entrar a sus hijos escalonados; respeta «reducir movimiento» |
| `Tarjeta.tsx` → `Tarjeta`, `Datos`, `Dato`, `Estado` | Tarjeta (neutra o teñida con `tinte`), datos rotulados, estado con punto |
| `Indicador.tsx` | KPI: rótulo, número que sube, variación con flecha y texto, línea de tendencia |
| `Pestanas.tsx` | Segmentos con indicador que se desliza (`layoutId`) |
| `Boton.tsx` | `primario` (teal) · `secundario` · `fantasma` · `peligro`; tamaños `sm` / `md` |
| `Estructura.tsx` | `Encabezado`, `Seccion`, `Esqueleto`, `TarjetaCargando`, `Vacio` |
| `LineaTiempo.tsx` | Línea de tiempo / historial |

Piezas generales en `app/components/ui/` (usarlas antes de crear otra): `Modal`, `confirm`, `toast`, `Tooltip`,
`Select`, `MultiSelect`, `Switch`, `MenuAcciones`, `Banner`. **`Badge.tsx` y `DocCategoriaBadge.tsx` son
antiguas** (pastillas): en pantallas que se rediseñan se reemplazan por `Estado`.

## Tokens (`app/globals.css`, bloque «Sistema de diseño LICITANK»)

Clases: `bg-marca`, `text-marca`, `hover:bg-marca-fuerte`, `bg-marca-suave`, `text-tinta`, `text-tinta-2`,
`text-tinta-3`, `border-linea`, `text-exito`, `text-alerta`, `text-urgente`, `shadow-tarjeta`,
`shadow-tarjeta-hover`, `shadow-flotante`, `ease-lk`.
Superficie de tarjeta: `bg-white border border-linea rounded-xl shadow-tarjeta dark:bg-slate-900 dark:border-slate-800`.
Siempre poner la variante `dark:` (modo oscuro por clase). El bloque antiguo `:root { --color-primary… }` quedó
en teal y no se usa: no crear usos nuevos de él.

**Escalas fijas** (no inventar valores intermedios):
- Espacios: `gap-1.5` · `gap-2` · `gap-3` · `gap-4` · `gap-6`; padding de tarjeta `px-4 py-3.5`; de bloque bento `p-5`;
  entre secciones `mt-8`.
- Esquinas: controles `rounded-lg` · tarjetas de lista, KPI y modales `rounded-xl` · bloques del bento `rounded-2xl` ·
  pestaña interna `rounded-md`.
- Íconos Tabler: 16 px en botones y filas, 18 px en rótulos de bloque, `stroke={1.75}`, color `text-slate-400`.
  Botón solo-ícono: `h-8 w-8`, con `aria-label` y `Tooltip`.

## Reglas

1. **Una tarjeta = un objeto que se abre.** Borde fino, sombra suave. Sin barra de color lateral, sin cajas dentro
   de cajas (dentro se separa con `border-t`). Única excepción: el cuadrito del ícono del rótulo (ver bento).
2. **Nada de pastillas para estados.** Texto con punto de color (`Estado`). Sin MAYÚSCULAS, sin borde ni fondo
   teñido. Tampoco bloques sólidos de color con texto blanco para un nivel o puntaje: el color va en el texto y el punto.
3. **Cada dato dice qué es** (`Dato`: rótulo arriba, valor abajo). En tarjetas, si no existe no se muestra;
   en tablas, la celda vacía lleva «—» en `text-tinta-3` para no correr la columna.
4. **El color comunica, no decora.** Rojo = urgente (hoy/mañana) o error. Ámbar = 2–3 días o advertencia.
   Verde = éxito. Gris = normal. Teal = marca e interacción. Íconos en gris, no en burbujas de color.
   Nunca solo color: siempre acompañado de texto o flecha.
5. **Paleta sin «colores de IA»:** nada de índigo, violeta, morado ni azul eléctrico en botones, enlaces, vistas
   activas o gráficos. Series: teal, pizarra, ámbar, cian, verde, naranja, rosa, piedra. Nada de íconos de chispas
   (`IconSparkles`) para señalar IA.
6. **Tipografía (Roboto 400/500/600/700):** títulos `font-semibold tracking-tight` (pantalla 22 px, sección 15 px),
   números `font-semibold tabular-nums`. Nunca `font-black` ni `font-bold` en rótulos. Rótulos `text-[11px]` en
   minúscula normal, sin `uppercase tracking-wider`. Mínimo `text-xs` para datos. Los nombres de licitación vienen
   en MAYÚSCULAS desde Mercado Público: no transformarlos.
7. **Movimiento con propósito:** entrar escalonado (`Lista`), reacomodar al filtrar (`Tarjeta layout` +
   `AnimatePresence`), indicador de pestaña que se desliza, número que sube, hover = `shadow-tarjeta-hover` +
   `-translate-y-px` en 150 ms (solo si se puede hacer clic). Prohibido: `animate-pulse` decorativo, carruseles
   solos, rebotes, giros, fondos animados, glassmorphism, degradados. Carga = `Esqueleto` con la forma del
   contenido, no girador (el girador solo dentro de un botón que está guardando).
8. **Contador sin círculo:** número suelto `text-xs font-semibold tabular-nums`.
9. **Urgencia en días de calendario** («Hoy», «Mañana», «Jueves 30»), no «1d».
10. **Citas a documentos** se muestran como «Cita · numeral · pág. N», nunca con el nombre del archivo (va en el
    tooltip) y la cita ES el ojo: un solo botón que abre el visor y resalta la frase. Lo clave de una explicación
    (p. ej. «Gana quien oferte el valor más bajo») en negrita y en recuadro; «Ley del mínimo / máximo» marcada en
    verde (excepción pedida por el dueño a «sin pastillas»).
11. **Listas de detalle interactivas**: lo que se puede abrir (criterios, jugadas) se abre con clic, la barra o
    leyenda resumen resalta y lleva al detalle, y hay «Contraer/Expandir todos».
12. **Estado vacío** dice qué pasa y qué hacer, con una acción (`Vacio`).
13. **Grillas por ancho del panel, no de la pantalla**: dentro del negocio hay dos menús laterales y en un notebook
    (1366 px) al contenido le quedan ~830 px. Envolver la pantalla en `@container` y usar `@xl:` / `@2xl:` /
    `@4xl:` / `@6xl:` en vez de `sm:` / `md:` / `lg:` / `xl:` (ejemplo: viabilidad v4). Vale también para el bento.

## Dashboards y gráficos: interactivos y exactos (regla del dueño, 2026-11-20)

- **Todo lo que se ve se puede tocar.** Un gráfico o KPI inerte no vale. Mínimo: pasar el mouse resalta la tajada o fila
  y atenúa el resto (el centro de la torta muestra ese valor); el clic hace algo real: **filtra otro bloque**
  (cross-filter, p. ej. elegir una etapa filtra «quién la tiene»), **abre el detalle** (persona, tramo) o **lleva a la
  pantalla** (`href`). Piezas: `Dona` (hover + `onElegir`), `Indicador` (`href`), `BarrasLista` en `/dashboard`.
- Un filtro activo siempre se ve: botón/chip con el nombre y una X para quitarlo, y la descripción del bloque cambia
  («Quién tiene negocios en «Perdida»»). Un filtro que deja 0 resultados dice por qué y ofrece «Ver todo».
- **Cada gráfico dice QUÉ mide**: título, una línea de descripción visible, total al centro, leyenda con cantidad y %,
  y la ficha «cómo se calcula» (`MetricInfo`). Si no se entiende a qué se refiere, no se pone.
- **Cifras exactas, nunca inventadas ni escritas a mano.** Antes de dar un dashboard por listo: cruzar cada número con
  la BD (SQL de solo lectura, `scripts/scratch/_dashboard_*.mjs`; siempre la BD del VPS por el túnel 3307; el Docker :3308 ya no se usa) y con
  la otra pantalla que muestra lo mismo (p. ej. Postuladas y Dashboard deben dar igual efectividad y monto ganado).
  Los títulos no pueden prometer más que la consulta («en trabajo» ≠ todos los activos). Las listas recortadas (top 6)
  muestran el total real («6 de 13»). Series por día incluyen los días en 0. Montos grandes «$3.011 MM», nunca «B».
- Nada de relleno por defecto que oculte datos: una selección inicial vacía se explica (ver arriba).

## Formularios

- Rótulo arriba del campo (`text-[13px] font-medium text-tinta`), nunca solo el texto de ayuda dentro del campo.
- Campo: `h-9 rounded-lg border border-linea bg-white px-3 text-sm`, foco `ring-2 ring-marca/60`, con `dark:`.
- Obligatorio: «(opcional)» en gris en los que NO lo son, en vez de asteriscos rojos.
- Error: borde y texto `text-urgente` bajo el campo, diciendo qué corregir («Ingresa un RUT válido, ej. 76.123.456-7»).
- Botones al final, alineados a la derecha: secundario «Cancelar» + primario con verbo («Guardar cambios», «Enviar a
  aprobación»). Un solo primario por vista. Mientras guarda: botón deshabilitado con girador y texto «Guardando…».
- Usar `Select`, `MultiSelect` y `Switch` del proyecto, no los nativos sin estilo.

## Tablas

- Encabezado `text-[11px] text-tinta-2` en minúscula normal, fondo blanco, `sticky top-0` si la tabla hace scroll.
- Filas `h-11`, separadas con `border-b border-linea`; sin cebra. Hover de fila `bg-slate-50` solo si se abre.
- Números, montos y porcentajes alineados a la derecha con `tabular-nums`; textos a la izquierda.
- Acciones de fila al final, en `MenuAcciones` (⋯), no una fila de botones.
- Ordenar con clic en el encabezado (flecha chica gris). Filtros arriba de la tabla, con `Pestanas` o `Select`.
- Sin datos → `Vacio`; cargando → filas de `Esqueleto`.

## Avisos, ventanas y ayudas

- `toast` para confirmar algo que ya pasó («Cambios guardados»), abajo a la derecha, se va solo en 4 s.
  Errores: toast que no se va solo y dice qué hacer.
- `confirm` antes de borrar, anular o enviar algo irreversible: título con la acción («¿Eliminar la cotización?»),
  una línea de consecuencia y botón `peligro` con el verbo («Eliminar»), nunca «Aceptar».
- `Modal` para tareas cortas (`rounded-xl shadow-flotante`, máx. ~560 px); lo largo va en página o panel lateral.
- `Tooltip` para explicar íconos o cortes de texto; nunca para información imprescindible.
- `Banner` para avisos de la pantalla completa (ámbar advertencia, rojo error), con acción si la hay.

## Textos y formatos (Chile)

- Se trata de **tú** («Revisa», «Ingresa»), en frases cortas. Botones con verbo, nunca «OK» / «Aceptar».
- Montos: `$12.450.000` (`Intl.NumberFormat('es-CL')`); grandes en bloques: `$184,3 MM`. Decimales con coma: `12,5 %`.
- Fechas: «jue 30 oct», con hora «jue 30 oct · 15:00»; cercanas en palabras («Hoy», «Mañana», «Jueves 30»).
- RUT con puntos y guion. Códigos de licitación en `font-mono` si van solos.
- No cambiar textos de negocio, cálculos ni umbrales sin preguntar.

## Accesibilidad mínima

- Contraste: texto normal nunca más claro que `text-tinta-2` sobre blanco (`tinta-3` solo para rótulos tenues y deshabilitado).
- Todo lo que se puede clicar se alcanza con teclado y muestra `focus-visible:ring-2 ring-marca/60`.
- Botones solo-ícono con `aria-label`. Respetar «reducir movimiento» (`motion-reduce:`).

## Gusto del dueño: moderno, no austero

La primera versión «sobria» (todo gris, texto con puntos, sin jerarquía) fue rechazada. Lo aprobado es el **bento**
del Resumen (`app/negocios/[id]/ResumenNegocio.tsx`):
- Bloques `rounded-2xl p-5` de distinto tamaño en grilla (`@4xl:grid-cols-[1.25fr_1fr_1fr]`, el principal con
  `row-span-2`); el dato más importante es el bloque más grande.
- Rótulo con ícono en cuadro suave (`w-7 h-7 rounded-lg bg-slate-100`), que toma el tinte del estado cuando
  significa algo (rojo urgente, ámbar próximo). Es la única «caja dentro de caja» permitida.
- Números grandes (24–30 px `font-semibold tracking-tight`), con contexto debajo en `text-xs`.
- Visualizar en vez de enumerar: medidor por tramos para niveles, barra que se llena para monto vs. tope, con el %
  y lo que queda.
- Nunca repetir el mismo texto en dos lugares del bloque.

**Maqueta antes de programar:** solo para pantallas NUEVAS o cambios de estructura (mover secciones, cambiar qué
datos se muestran). Para aplicar el sistema a una pantalla existente sin cambiar su estructura, no hace falta: se
aplica y se muestra el resultado.

## Ver lo que se hace (Playwright / navegador) — obligatorio al aplicar el front

Aplicar estilos «a ciegas» ya dejó pantallas sin ver (Auditor, Viabilidad, Compras, Postuladas). Desde 2026-11-20
**toda pantalla que se toque se mira en un navegador real antes de darla por hecha**:

1. **Herramienta:** el plugin **Playwright** (MCP de Microsoft) si está activado; si no, el navegador del panel
   (`mcp__Claude_Browser__*`) o Chrome. Nunca decir «listo» solo con `tsc` + `eslint`.
2. **Servidor local:** `preview_start` con `dev` (puerto 3000, BD del VPS por el túnel SSH 3307 (el Docker ya no se usa, ver `docs/memoria/infra.md`; solo mirar, no guardar)).
3. **Sesión:** las pantallas piden login y la contraseña la escribe SOLO el dueño. Que entre una vez en el
   navegador que usa Playwright (o guarde `storageState`); después se reutiliza la sesión. Si sale la pantalla de
   login, parar y avisar, no inventar que se vio.
4. **Qué mirar, siempre:** 1366 px y ~800 px (`resize_window`), modo claro y oscuro, estado con datos, vacío, cargando
   y error; consola sin errores (`read_console_messages`); hover/foco de lo clicable. Sacar captura y mostrarla.
5. **No pulsar** aprobar / rechazar / confirmar / enviar / guardar: son acciones reales del equipo. Mirar, no operar.
6. En `docs/memoria/ui.md` anotar si se vio en navegador («visto a 1366 y 800, claro y oscuro») o «sin ver».

## Ejemplo: antes y después

```tsx
// ANTES — pastilla, mayúsculas, índigo, dato sin rótulo
<div className="border-l-4 border-indigo-500 bg-white p-4 rounded">
  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold uppercase">Urgente</span>
  <p className="font-bold">{nombre}</p>
  <p>{formatCLP(monto)}</p>
</div>

// DESPUÉS
<Tarjeta onClick={abrir}>
  <h3 className="text-[15px] font-semibold text-tinta dark:text-slate-50">{nombre}</h3>
  <Datos>
    <Dato rotulo="Cierre"><Estado color="#dc2626">Mañana 15:00</Estado></Dato>
    <Dato rotulo="Monto estimado">{formatCLP(monto)}</Dato>
  </Datos>
</Tarjeta>
```

## Cómo trabajar (una pantalla por vez, idealmente una por conversación)

1. Leer `docs/memoria/ui.md` (qué pantallas ya están y cuáles faltan) y el archivo de la pantalla. Buscar los usos
   antes de tocar un componente compartido; preferir cambiar en la pantalla.
2. Auditar contra las reglas:
   `grep -nE "violet|indigo|purple|font-black|font-bold|uppercase|rounded-full.*bg-|Badge|Sparkles|animate-pulse|animate-spin|gradient|(sm|md|lg|xl):grid" <archivo>`
   (ojo: `IconBadge` de Tabler y `IABadge` no son pastillas de estado; revisar cada caso).
3. Aplicar **solo lo visual**: no cambiar datos, cálculos, textos de negocio ni umbrales sin preguntar.
4. Verificar (ver «Ver lo que se hace» arriba, con Playwright): `npx tsc --noEmit`, `npx eslint <archivo>`, y ver la pantalla en `localhost:3000` a 1366 px y a
   ~800 px, en modo claro y oscuro. Mostrarla al dueño antes de seguir con la siguiente.
5. Hooks de React antes de cualquier `return` temprano. No commitear: el dueño sube a GitHub.
6. Anotar en `docs/memoria/ui.md` la pantalla aplicada (fecha, qué cambió, si el dueño la aprobó) y actualizar la
   lista de pendientes.

## Estado

- Aplicado: kit + `/ui-kit` (2026-10-28); Resumen del negocio; `/aprobaciones`; Compras → Seguimiento ·
  Comparativo; barra de gestión del negocio. Detalle y lo que falta aprobar en `docs/memoria/ui.md`.
- Al 2026-11-20 quedan ~85 archivos con índigo/violeta/morado y ~25 con `font-black` o `uppercase tracking-wider`:
  esa es la lista de trabajo pendiente.
- 2026-11-20: Roboto carga también 600 (antes `font-semibold` se veía como negrita); el bloque antiguo
  `--color-primary` pasó de índigo a teal (no tenía usos). Figma creado con tokens y piezas (plan Starter: los
  componentes están solo en modo claro; los colores oscuros van en la colección «Color oscuro»).
- Tipografía: Roboto en toda la app; en `/ui-kit` se comparan Inter Tight y Manrope. Cambiarla es una línea en
  `app/layout.tsx` cuando el dueño elija.
- Colores de etapa (`app/lib/pipeline.ts`): propuesta en `/ui-kit` (Asignado pizarra, En proceso cian, Posible adj.
  verde oliva), sin aplicar.
