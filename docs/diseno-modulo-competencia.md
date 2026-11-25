# Módulo «Competencia y mercado» — diseño (2026-11-23)

Pedido del dueño: un módulo en el menú izquierdo (grupo ANÁLISIS) con todo lo de competencia: con quién perdimos más,
cuál es nuestra competencia, qué productos se adjudican más, y base para análisis de mercado. Sin Compra Ágil y sin la
importación de OCDS por ahora (ver `investigacion-competencia.md`). **Solo diseño: nada programado.**

## Pestañas y de dónde sale cada cifra HOY

| Pestaña | Qué responde | Fuente actual | Falta |
|---|---|---|---|
| Resumen | Efectividad, competidores distintos, cuánto más bajo ofertaron, oferentes por licitación | `adjudicacion_cache` (numero_oferentes, lineas), `oferta_competencia` | Cifra «ganaron por X % de precio» (calcular nuestra oferta vs ganador por línea) |
| Competidores | Quién nos ganó más, en qué rubros y organismos, a qué precio vs el nuestro | Ya existe en `/adjudicadas` («Competidores que nos ganaron») | Perfil por competidor (rubros, organismos, empresas nuestras a las que ganó), también los que NO nos ganan pero aparecen seguido |
| Productos | Qué se adjudica más y a qué precio (mediana, rango, n) | `adjudicacion_cache.lineas`, `ordenes_compra.items_json`, `linea_producto_ofertado` | Normalizar nombre de producto (hoy solo tokens con LIKE); índice propio |
| Organismos | Quién compra, cuántos oferentes, reclamos, desiertas | API (`CantidadReclamos`, `NumeroOferentes`), `adjudicacion_cache` | Tabla agregada por organismo |
| Precios | Nuestra oferta vs ganador por línea, percentil | `oferta_competencia` (monto por línea), `adjudicacion_cache` | Cruce con costeo (margen) |

## Reglas de diseño (licitank-ui)

Bento + `Indicador`, `Dona`, `Pestanas`, `Tarjeta`, `Estado` con punto, sin pastillas ni índigo; cada gráfico dice qué
mide y de cuántos casos sale; todo clicable (cross-filter, enlace a licitación); cifras cruzadas con la BD antes de
darlas por buenas; ver en navegador a 1366 y 800 px, claro y oscuro.

## Multiempresa

Mercado y competidores son públicos y se comparten; lo propio (nuestras ofertas, efectividad, empresa con que se postuló)
va filtrado por empresa-cliente. Módulo activable por plan (`app/lib/modulos.ts`).

## Estado (2026-11-23)

Fase 1 (Resumen + Competidores) PROGRAMADA en `app/competencia/page.tsx` y `app/lib/competencia-core.ts`; sin ver en
navegador ni cruzar con la BD. Ver `docs/memoria/ui.md`.

## Actualización 2026-11-25 — Global / por empresa y 3 pestañas (tsc y tests OK; cifras cruzadas con la BD real; SIN ver en navegador ni desplegar)
**Pedido del dueño:** dividir la competencia por empresa y global, con 3 pestañas y «todo de la competencia».
**Cómo quedó:** selector «Ver: Global | <cada empresa con que postulamos>» (solo si hay más de una) y pestañas **Resumen · Competidores · Mercado**. «Mercado» = organismos donde postulamos (ganadas/perdidas/efectividad, plata que se llevaron otros, oferentes) y productos que se llevaron otros (líneas, monto, precio unitario mediano y rango, quién los ganó). Cálculo en `calcularMercado` (`competencia-core.ts`), todo del acta de MP de nuestras licitaciones resueltas; nada inventado.
**Cruce con la BD (solo lectura):** Global 283 resueltas, 75 ganadas / 208 perdidas (26,5 %), 215 competidores, $7.867 MM a terceros; Claro 203 (23,6 %), Comercial MP 78 (34,6 %). Top competidor global: Fernando Alberto Veloso Oliva (11 licitaciones).
**Límites:** 52 de 335 negocios resueltos no tienen organismo guardado (15 %; solo 9 se rescatan del caché), salen como «Sin organismo». El mercado completo (lo que NO postulamos) sigue pendiente de la importación OCDS; Precios (nuestra oferta vs ganador) sigue sin hacer.

## Para seguir desde otra cuenta (traspaso 2026-11-23)

Archivos de esta tarea (sin commit; el dueño sube a git): `app/competencia/page.tsx`, `app/lib/competencia-core.ts`,
`app/lib/__tests__/competencia-core.test.mts`, `app/components/ui/ReclamosOrganismo.tsx`, cambios en
`app/components/AppLayout.tsx` (ítem «Competencia»), `app/lib/modulos.ts` (ruta `/competencia` → `negocios`),
`app/licitacion/[codigo]/page.tsx` y `app/negocios/[id]/page.tsx` (aviso de reclamos). Informe de mercado:
`docs/investigacion-competencia.md`. Hay otros cambios sin commit de otras tareas en el árbol; no mezclarlos.

Pendiente, en orden:
1. Ver `/competencia` y el aviso de reclamos en el navegador (1366 y 800 px, claro y oscuro); entra el dueño (login).
2. Cruzar cifras con la BD: encender la BD dev Docker :3308 (`docker-compose.dev-db.yml`) y correr
   `node scripts/scratch/_adjudicadas_competidores.mjs <email> dev` (esperado 20-nov: 192 perdidas, 206 competidores, $7.119 MM).
3. El dueño decide: umbrales de reclamos (propuestos 1–4 ámbar, 5+ rojo), nombre del menú, si «Competidores que nos ganaron»
   sale de `/adjudicadas`.
4. Fase 2: Productos y Organismos. Fase 3: Precios (nuestra oferta vs ganador) y KPI «ganaron por X %».
5. Decididos: sin Compra Ágil por ahora; importar OCDS (datos abiertos ChileCompra) queda «al terminar» lo en curso.

## Fases

1. Resumen + Competidores (reusar lo de `/adjudicadas`, mover a un solo lugar).
2. Productos y Organismos sobre lo que ya hay (con «n casos» siempre visible).
3. Precios (oferta propia vs ganador) y vínculo con costeo.
4. Importar OCDS filtrado por rubro «al terminar» lo en curso (decisión del dueño): agranda 2–4 a todo el mercado.

## Preguntas abiertas

- ¿Se mueve «Competidores que nos ganaron» de `/adjudicadas` al módulo nuevo o se deja en ambos?
- Nombre del menú: «Competencia» o «Competencia y mercado».
- Umbrales de reclamos (1–4 ámbar, 5+ rojo) propuestos por mí, sin confirmar.
