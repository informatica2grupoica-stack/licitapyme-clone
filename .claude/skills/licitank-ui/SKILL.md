---
name: licitank-ui
description: Sistema de diseño de LICITANK (SaaS) — tokens, tipografía, componentes con animación y reglas para que todas las pantallas se vean profesionales, modernas y sin aspecto «hecho por IA». Usar al crear o modificar cualquier frontend, tarjeta, KPI, tabla, pestañas, botones, estados, colores o animaciones. Referencia viva en /ui-kit.
---

# LICITANK UI — sistema de diseño

Reemplaza a `ui-sin-aspecto-ia` (sus reglas siguen vigentes y están aquí). Se trabaja con
**Tailwind v4 + framer-motion**. No usar Mantine (no hay `MantineProvider`).

**Referencia viva:** `/ui-kit` (`app/ui-kit/page.tsx`). Antes de inventar un estilo, mirar si ya
existe ahí. Si una pantalla necesita una pieza nueva que se repetirá, se agrega al kit y a `/ui-kit`.

## Piezas

| Archivo (`app/components/ui/kit/`) | Qué es |
|---|---|
| `movimiento.ts` | `EASE_LK`, `RAPIDA` (0,15 s), `NORMAL` (0,25 s), variantes `lista` / `item` |
| `Aparecer.tsx` → `Lista` | Contenedor que hace entrar a sus hijos escalonados; respeta «reducir movimiento» |
| `Tarjeta.tsx` → `Tarjeta`, `Datos`, `Dato`, `Estado` | Tarjeta (neutra o teñida con `tinte`), datos rotulados, estado con punto |
| `Indicador.tsx` | KPI: rótulo, número que sube, variación con flecha y texto, línea de tendencia |
| `Pestanas.tsx` | Segmentos con indicador que se desliza (`layoutId`) |
| `Boton.tsx` | `primario` (teal) · `secundario` · `fantasma` · `peligro`; tamaños `sm` / `md` |
| `Estructura.tsx` | `Encabezado`, `Seccion`, `Esqueleto`, `TarjetaCargando`, `Vacio` |

## Tokens (`app/globals.css`, bloque «Sistema de diseño LICITANK»)

Clases: `bg-marca`, `text-marca`, `hover:bg-marca-fuerte`, `bg-marca-suave`, `text-tinta`,
`text-tinta-2`, `text-tinta-3`, `border-linea`, `text-exito`, `text-alerta`, `text-urgente`,
`shadow-tarjeta`, `shadow-tarjeta-hover`, `shadow-flotante`, `ease-lk`.
Superficie de tarjeta: `bg-white border border-linea rounded-xl shadow-tarjeta` + `dark:bg-slate-900 dark:border-slate-800`.
Siempre poner la variante `dark:` (la app tiene modo oscuro por clase).

## Reglas

1. **Una tarjeta = un objeto que se abre.** Borde fino, sombra suave, `rounded-xl`. Sin barra de
   color lateral, sin cajas dentro de cajas (dentro de una tarjeta se separa con `border-t`).
2. **Nada de pastillas para estados.** Texto con punto de color (`Estado`). Sin MAYÚSCULAS, sin
   borde ni fondo teñido. Tampoco bloques sólidos de color con texto blanco para un nivel o puntaje:
   el color va en el texto y el punto.
3. **Cada dato dice qué es** (`Dato`: rótulo arriba, valor abajo). Si no existe, no se muestra.
4. **El color comunica, no decora.** Rojo = urgente (hoy/mañana) o error. Ámbar = 2–3 días o
   advertencia. Verde = éxito. Gris = normal. Teal = marca e interacción. Íconos en gris
   (`text-slate-400`), no en burbujas de color.
5. **Paleta sin «colores de IA»:** nada de índigo, violeta, morado ni azul eléctrico en botones,
   enlaces, vistas activas o gráficos. Series: teal, pizarra, ámbar, cian, verde, naranja, rosa, piedra.
   Nada de íconos de chispas (✨ `IconSparkles`) para señalar IA.
6. **Tipografía:** títulos `font-semibold tracking-tight` (pantalla 22 px, sección 15 px), números
   `font-semibold tabular-nums`. Nunca `font-black` ni `font-bold` en rótulos. Rótulos `text-[11px]`
   en minúscula normal, sin `uppercase tracking-wider`. Mínimo `text-xs` para datos. Los nombres de
   licitación vienen en MAYÚSCULAS desde Mercado Público: no transformarlos.
7. **Movimiento con propósito:** entrar escalonado (`Lista`), reacomodar al filtrar
   (`Tarjeta layout` + `AnimatePresence`), indicador de pestaña que se desliza, número que sube,
   hover = `shadow-tarjeta-hover` + `-translate-y-px` en 150 ms (solo si se puede hacer clic).
   Prohibido: `animate-pulse` decorativo, carruseles solos, rebotes, giros, fondos animados,
   glassmorphism, degradados. Carga = `Esqueleto` con la forma del contenido, no girador.
8. **Contador sin círculo:** número suelto `text-xs font-semibold tabular-nums`.
9. **Urgencia en días de calendario** («Hoy», «Mañana», «Jueves 30»), no «1d».
10. **Citas a documentos** se muestran como «Cita · numeral · pág. N», nunca con el nombre del archivo (va
    en el tooltip) y la cita ES el ojo: un solo botón que abre el visor y resalta la frase. Lo clave de una explicación (p. ej. «Gana quien oferte el valor más bajo») en negrita y
    en recuadro; «Ley del mínimo / máximo» marcada en verde (excepción pedida por el dueño a «sin pastillas»).
11. **Listas de detalle interactivas**: lo que se puede abrir (criterios, jugadas) se abre con clic, la
    barra o leyenda resumen resalta y lleva al detalle, y hay «Contraer/Expandir todos».
12. **Estado vacío** dice qué pasa y qué hacer, con una acción (`Vacio`).

## Gusto del dueño: moderno, no austero

La primera versión «sobria» (todo gris, texto con puntos, sin jerarquía) fue rechazada. Lo aprobado
es el **bento** del Resumen (`app/negocios/[id]/ResumenNegocio.tsx`):
- Bloques `rounded-2xl p-5` de distinto tamaño en grilla (`lg:grid-cols-[1.25fr_1fr_1fr]`, el
  principal con `row-span-2`); el dato más importante es el bloque más grande.
- Rótulo con ícono en cuadro suave (`w-7 h-7 rounded-lg bg-slate-100`), que toma el tinte del
  estado cuando significa algo (rojo urgente, ámbar próximo).
- Números grandes (24–30 px `font-semibold tracking-tight`), con contexto debajo en `text-xs`.
- Visualizar en vez de enumerar: medidor por tramos para niveles, barra que se llena para
  monto vs. tope, con el % y lo que queda.
- Nunca repetir el mismo texto en dos lugares del bloque.
- Antes de programar una pantalla nueva, mostrar una maqueta (widget) para que el dueño elija.

## Cómo trabajar (una sección por vez)

1. Leer `docs/memoria/ui.md` y el archivo de la pantalla. Buscar los usos antes de tocar un
   componente compartido; preferir cambiar en la pantalla.
2. Auditar contra las reglas: `grep -n "violet\|indigo\|purple\|font-black\|uppercase\|<Badge\|Sparkles"`.
3. Aplicar **solo lo visual**: no cambiar datos, cálculos, textos de negocio ni umbrales sin preguntar.
4. Verificar: `npx tsc --noEmit`, `npx eslint <archivo>`, y ver la pantalla en `localhost:3000`
   (con modo claro y oscuro). Mostrarla al dueño antes de seguir con la siguiente sección.
5. Hooks de React antes de cualquier `return` temprano. No commitear: el dueño sube a GitHub.
6. Anotar en `docs/memoria/ui.md` qué pantalla quedó aplicada.

## Estado (ver `docs/memoria/ui.md`)

- Aplicado: kit + `/ui-kit` (2026-10-28); Resumen del negocio (`app/negocios/[id]/ResumenNegocio.tsx`).
- Tipografía: Roboto sigue en toda la app; en `/ui-kit` se comparan Inter Tight y Manrope. Cambiarla
  es una línea en `app/layout.tsx` cuando el dueño elija.
- Colores de etapa (`app/lib/pipeline.ts`): propuesta en `/ui-kit` (Asignado pizarra, En proceso cian,
  Posible adj. verde oliva), sin aplicar.
