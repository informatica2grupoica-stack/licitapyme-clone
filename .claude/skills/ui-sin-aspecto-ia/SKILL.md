---
name: ui-sin-aspecto-ia
description: OBSOLETA desde 2026-10-28 — usar la skill licitank-ui (sistema de diseño completo, con estas mismas reglas). Se deja como antecedente de la prueba aprobada en /negocios.
---

> **Reemplazada por `licitank-ui`** (`.claude/skills/licitank-ui/SKILL.md`). No usar esta.

# UI sin aspecto IA — LICITANK

Aprobado por el dueño sobre `app/negocios/page.tsx` (calendario semanal). Es el estándar para
el resto de las pantallas. Se hace con **Tailwind v4** (ya está en el proyecto). No usar
Mantine: no hay `MantineProvider` y agregarlo puede romper estilos globales.

## Reglas

1. **Una tarjeta = un objeto que se abre.** Borde gris fino, sombra suave, esquinas
   `rounded-xl`, espacio entre tarjetas. Sin barra de color lateral (`border-left` de color).
   Sin cajas dentro de cajas.
2. **Nada de pastillas para estados.** Etapa, viabilidad, urgencia, docs y tipo (LE/LP) van como
   texto, con un punto de color (`w-1.5 h-1.5 rounded-full`) solo si el color significa algo. Sin
   MAYÚSCULAS, sin borde, sin fondo teñido en el texto.
3. **Cada dato dice qué es.** Rótulo pequeño arriba (Etapa, Viabilidad, Monto, Documentos, En
   Mercado Público) y el valor abajo, en una `<dl>`. Un valor suelto ("Asignado · Media-alta ·
   Docs") no se entiende. Si el dato no existe, no se muestra la fila.
4. **El color comunica, no decora.**
   - Rojo solo para urgente (hoy y mañana). Ámbar para 2 y 3 días. Gris para lo normal.
   - Verde solo para éxito (Postulada, Ganada).
   - La tarjeta toma un tinte suave del color de su **etapa** (ver fragmento). Nunca un fondo
     fuerte: el texto tiene que leerse sin esfuerzo.
   - El único color de identidad de una persona es su avatar con iniciales, y junto al avatar
     va el **nombre completo** (puede haber dos personas con el mismo nombre).
5. **Paleta sin "colores de IA".** Evitar índigo, violeta, morado y azul eléctrico como color de
   interfaz (botones, enlaces, vista activa, gráficos). Usar teal (`teal-700` en texto y botones
   sólidos para contraste), gris pizarra, ámbar, verde y rojo. Series de gráficos: teal, pizarra,
   ámbar, cian, verde, naranja, rosa, piedra.
6. **Tipografía sobria.** Títulos en `font-medium`, números en `font-bold` con `tabular-nums`.
   Nunca `font-black`. Etiquetas de sección en minúscula normal, sin `uppercase tracking-wider`.
   Mínimo `text-xs` (12 px) para datos; `text-[11px]` solo para rótulos. Los nombres de
   licitación vienen en MAYÚSCULAS desde Mercado Público: no transformarlos, es dato oficial.
7. **Sin ruido animado.** Nada de puntos pulsantes (`animate-pulse`) ni carruseles que se muevan
   solos. Hover: sombra + `-translate-y-px`, 150 ms.
8. **Contador sin círculo.** Un número suelto (`text-xs font-semibold tabular-nums`), no un
   badge redondo gris.
9. **Urgencia en días de calendario**, no en milisegundos: "cierra hoy 15:00" es "Hoy", no "1d".

## Fragmentos Tailwind

Tarjeta teñida por etapa (el color sale de `getEstadoPipeline(id).color`, una vez por tarjeta):

```tsx
<button
  style={{ '--etapa': colorEtapa } as React.CSSProperties}
  className="group w-full text-left rounded-xl border px-3.5 py-3 shadow-sm transition-all duration-150
    hover:shadow-md hover:-translate-y-px
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500
    bg-[color-mix(in_srgb,var(--etapa)_8%,white)]
    border-[color-mix(in_srgb,var(--etapa)_28%,white)]
    hover:bg-[color-mix(in_srgb,var(--etapa)_12%,white)]
    hover:border-[color-mix(in_srgb,var(--etapa)_45%,white)]"
>
```

Datos rotulados dentro de la tarjeta (separador con el mismo tinte):

```tsx
<dl className="mt-3 pt-3 border-t border-[color-mix(in_srgb,var(--etapa)_22%,white)] grid grid-cols-2 gap-x-3 gap-y-2">
  <div>
    <dt className="text-[11px] text-slate-500">Etapa</dt>
    <dd className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span aria-hidden style={{ background: color }} className="w-1.5 h-1.5 rounded-full" />Asignado
    </dd>
  </div>
  {/* Viabilidad, Monto, Documentos: solo si existen */}
</dl>
```

Estado como texto con punto (reemplaza cualquier pastilla):

```tsx
<span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap">
  <span aria-hidden style={{ backgroundColor: color }} className="w-1.5 h-1.5 rounded-full flex-shrink-0" />
  {label}
</span>
```

Urgencia: `text-red-600` (hoy y mañana) · `text-amber-600` (2 y 3 días) · `text-slate-500` (resto) ·
`text-slate-400` (cerrada). Siempre con texto, el color nunca es la única señal.

Columna que contiene tarjetas: `p-2 space-y-2.5 bg-slate-50/70`.

## Cómo trabajar

1. **Inspeccionar** el archivo y buscar todos los usos de un componente compartido antes de
   tocarlo. Cambiar de forma local (en la pantalla) antes que en un componente de `app/components/ui/`.
2. **Auditar** contra las reglas de arriba: pastillas, barras de color, valores sin rótulo, morados
   y azules, mayúsculas, datos repetidos.
3. **Aplicar** en una sección por vez y mostrar al dueño antes de seguir.
4. **Verificar**: `npx tsc --noEmit`, `npx eslint` del archivo y ver la pantalla en `localhost:3000`
   con la sesión del usuario (Chrome). Si sale un aviso que pide confirmar ("Acuso recibo"),
   no pulsarlo: es una confirmación real del usuario.
5. Hooks de React antes de cualquier `return` temprano. No commitear: el dueño sube a GitHub.

## Pendiente conocido

- Los colores de etapa (`app/lib/pipeline.ts`: Asignado azul, En proceso morado, Posible adj.
  índigo) todavía son tonos "de IA". Se usan en toda la app: cambiarlos es una decisión aparte.
- Componentes compartidos con índigo: `Badge`, `MetricInfo`, `MultiSelect`, menú lateral.
- Faltan por aplicar: vistas Lista y Mes de Negocios, y el Dashboard.
