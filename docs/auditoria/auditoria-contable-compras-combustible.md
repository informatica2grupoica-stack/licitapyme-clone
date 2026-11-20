# Auditoría contable de Compras + diseño del gasto extra «Combustible» (2026-11-20)

Alcance: lectura de código (`compras-gastos.ts`, `compras-gastos-oc.ts`, `costo-real-consolidado.ts`, `obuma-compras.ts`, `compras-oc-obuma.ts`, `GastoExtraModal.tsx`) y consulta **solo lectura** a la BD (OC de combustible ya sincronizadas desde Obuma). No se cambió código ni datos.
Lo que NO se verificó: pantalla en navegador, ni las boletas/facturas originales (salvo la factura 186536). Los puntos tributarios van marcados «confirmar con el contador».

## 1. Cómo viene el combustible en Obuma (datos reales)

| OC | Negocio | Forma en Obuma | Neto | IVA | Total |
|---|---|---|---|---|---|
| 4058 (FACTURADA, JP Ltda) | 387-55 | línea «COMBUSTIBLE INTERNO» **afecta** $35.810 + línea «impuesto especifico» **exenta** $7.537 | 35.810 | 6.803,90 | 50.150,90 |
| 4057 (ANULADA) | 387-55 | solo combustible $35.810, sin impuesto | 35.810 | 6.804 | 42.614 |
| 4076–4080 | 2446-240 | **una sola línea** «COMBUSTIBLE INTERNO» marcada **exenta** (`producto_exento=1`) | 0 | 0 | 30.700 a 63.836 |

- La factura 33 N° 186536 (OC 4058) vino por $50.151 = total de la OC: Obuma modela bien una factura de combustible: **IVA solo sobre el neto, el impuesto específico va aparte y exento**.
- En las OC 4076–4080 se registró **todo el monto como exento** (sin separar IVA ni impuesto específico). Contablemente significa que **el IVA entra como costo** y que no se ve el impuesto. Confirmar con el contador si eran boletas (IVA no recuperable) o facturas (ahí se está perdiendo crédito fiscal).

## 2. Hallazgos de la auditoría

**A. Alto — posible doble conteo de la factura 186536 en el negocio 1191 (387-55-LE26, ya CERRADO al 41,6 %).**
Existe un gasto extra «Factura 186536 Comercial y Servicios JP Ltda (… sin OC)» por **$50.151** sin enlace a OC, y existe la OC 4058 por la MISMA factura, cruzada a la misma licitación. Dos problemas: (1) el gasto se anotó con el **bruto** (IVA incluido) en un campo que dice «Monto neto»; (2) si el costo real sale de las OC (`ocCubreTodo`), `consolidarCostoReal` solo resta de los gastos los que tienen `oc_obuma_folio`, así que este se suma **encima** de la OC. Hay que revisar si el cierre del 1191 quedó inflado (~$43 mil de costo, ~$50 mil con el IVA).

**Revisión del 1191 (2026-11-20, solo lectura):** el cierre del 12-nov (41,58 %) **no está inflado**: su base son las OC (`fuente: oc`, $10.614.392) y esa suma NO incluía la OC 4058; hoy las OC vigentes suman $10.657.738 (diferencia $43.346 = neto de la 4058). Es decir, al cerrar, el combustible aparecía solo en el gasto de $50.151. Efectos: (1) el cierre guardado queda como está, con $6.804 de IVA de más como costo (~0,04 pts de margen: 41,58 % vs 41,62 % correcto); (2) **si el costo real se recalcula en vivo hoy, se cuenta doble** ($43.347 de la OC + $50.151 del gasto): margen en vivo ≈ 41,35 %. Arreglo mínimo: borrar el gasto de $50.151 (la OC 4058 ya lo trae bien, neto + impuesto), sin tocar el cierre. Sin ejecutar: es un cambio en producción sobre un negocio cerrado y espera OK del dueño.

**B. Alto — el gasto extra no distingue neto / IVA / impuesto específico.**
`compras_gasto` tiene un solo `monto` (DECIMAL 14,2) sin IVA, sin impuesto, sin documento (factura/boleta) y sin cantidad. El modal dice «Monto neto» pero acepta cualquier cosa. Para combustible es justo lo que importa.

**C. Alto — el enlace gasto ↔ OC no reconoce combustible.**
`ES_LINEA_DE_GASTO` es `/transporte|flete|despacho|armado|palletiz|instalación/`: «COMBUSTIBLE INTERNO» e «impuesto especifico» **no se ofrecen** para enlazar. Además `registrarGasto` exige `monto === subtotal de UNA línea`; el combustible de la 4058 son **dos líneas** (neto + impuesto) y el costo real es la suma ($43.347).

**D. Medio — categoría.** No existe «Combustible»; hoy se anota como «Producto o insumo extra» (ej. gasto «bencina» $40.000 sin litros ni OC). Se pierde el reporte por categoría y la conciliación.

**E. Medio — `netoDeCompra` = total − IVA** (`obuma-compras.ts:268`). Con el impuesto específico da el número correcto **como costo** ($43.347 en la 4058) y con la OC exenta también (todo el total). Está bien, pero hoy **nadie lo muestra desglosado**: el equipo ve $43.347 «neto» sin saber que $7.537 es impuesto no recuperable. Y `descontarUnidadesAjenas` asume IVA 19 % proporcional: con OC mixta (afecta + exenta) descontaría mal.

**F. Medio — OC anulada y reemplazada** (4057 → 4058): está bien excluida (`/anulad/`), pero se detecta solo por el texto del estado. Mantener la prueba.

**G. Bajo — redondeos:** el IVA de Obuma viene con decimales (6.803,90) y la factura redondea (50.151). `Math.round` en el enlace puede dar diferencias de $1. Definir tolerancia ±$1 por línea.

## 3. Tributario del combustible (confirmar con el contador)

- El **impuesto específico** (Ley 18.502) se cobra por m³ en UTM (diésel y gasolinas, distinto monto; gasolinas además con MEPCO variable). **No se debe fijar una tasa en el código**: se toma de la factura/OC.
- **IVA del combustible:** crédito fiscal solo con **factura** y según el vehículo (el IVA de combustible de automóviles y station wagon no da crédito salvo giro de transporte/arriendo; camionetas y camiones sí). Con **boleta** no hay crédito: el IVA es costo.
- **Impuesto específico:** no es crédito para ICA (no es transportista de carga); es **costo**. Existe recuperación parcial del diésel solo para transporte de carga/maquinaria con reglas propias.
- Consecuencia para costo real del proyecto: **costo = neto + impuesto específico (+ IVA solo si no es recuperable)**.

## 4. Diseño propuesto: gasto extra «Combustible»

**Datos por carga (migración nueva, columnas NULL, no rompe los gastos existentes; tabla por empresa-cliente según skill `multiempresa-escalable`):**
`categoria_clave='combustible'`, `tipo_combustible` (diésel / gasolina 93-95-97 / parafina), `litros`, `neto_afecto`, `impuesto_especifico`, `iva`, `iva_recuperable` (sí/no, por documento y vehículo), `tipo_documento` (factura/boleta), `folio_documento`, `patente` (opcional), `oc_obuma_folio`. El `monto` actual pasa a ser **costo para el proyecto** = neto + impuesto (+ IVA si no recuperable), calculado, no tecleado.

**Reglas:**
1. Cuadre: `neto + impuesto + IVA = total del documento` (tolerancia ±$1). Si no cuadra, no se guarda.
2. Precio por litro y alerta si se aleja de la mediana de las cargas anteriores (detecta digitación mala).
3. **Enlace a OC por folio, agrupando líneas:** una candidata por OC = suma de las líneas `combustible|diésel|bencina|parafina|impuesto específico`; el monto esperado es esa suma. Reemplaza el cálculo línea-por-línea.
4. Si la OC está **toda exenta** (caso 4076–4080): ofrecer separar IVA/impuesto desde la factura o dejarla marcada «IVA como costo» a propósito.
5. Una carga ya enlazada a OC **no** se suma otra vez al costo real (ya está resuelto por `gastosEnOc`; hay que probarlo con combustible).
6. Reporte: litros y $ por patente, por negocio y por mes; conciliación mensual contra el libro de compras (IVA crédito).

**Cambios de código previstos (para el equipo):** `compras-gastos-oc.ts` (agrupar por OC + palabras de combustible), `compras-gastos.ts` (campos nuevos + validación de cuadre), `GastoExtraModal.tsx` (formulario de combustible), `obuma-compras.ts` (exponer el desglose neto / impuesto / IVA de la OC), pruebas puras con las OC 4058, 4057 y 4076.

## 4b. Respuestas del dueño (2026-11-20)

- **Las cargas SIEMPRE son factura** (no boleta) y se carga el **vehículo de la empresa**. Entonces el IVA es recuperable (si el vehículo no es automóvil/station wagon). Consecuencia: las OC 4076–4080 de 2446-240 ($258.813 en total) están registradas **toda exentas**, o sea con el IVA como costo; si son facturas se está perdiendo crédito fiscal (como tope $41.325 si no tuvieran impuesto específico; menos, porque el impuesto específico va exento). Hay que mirar sus facturas y corregir la OC como la 4058 (neto afecto + impuesto exento).
- **Combustible sin licitación asociada → «RP» como gasto administrativo.** Hoy `compras_gasto.negocio_id` es NOT NULL: el gasto extra solo existe dentro de un negocio. Hace falta un destino «administrativo» (sin negocio) para esas cargas; eso entra en la migración del diseño.
- **Vehículo: camioneta** → el IVA de la factura de combustible SÍ es crédito fiscal (confirmar con el contador que figura como vehículo de carga/camioneta en el padrón).
- **«RP» es de Obuma:** el combustible sin licitación se carga en Obuma contra RP como gasto administrativo. Por eso **no hace falta** un gasto sin negocio en Licitank: la sincronización solo cruza OC que mencionan una licitación o un centro de costo de proyecto, así que esas OC quedan fuera del costo real de los negocios (es lo correcto). No se encontró un proyecto «RP» en los proyectos capturados de Obuma (`obuma_proyectos_reales`); si luego se quiere un reporte de combustible administrativo, hay que ver cómo se llama exactamente.
- **Diseño final:** el gasto de combustible vive solo dentro de un negocio (los $ de las licitaciones). Cargas con licitación = OC en Obuma con neto afecto + impuesto específico exento; cargas administrativas = OC en Obuma contra RP, fuera de Licitank. Sin migración de `negocio_id` nulo.

## 5. Preguntas abiertas para el dueño y el contador

1. ¿Las OC 4076–4080 (979) eran boletas o facturas? ¿El IVA se está perdiendo?
2. ¿Qué vehículos cargan (camioneta, camión, automóvil)? Define si el IVA es recuperable.
3. ¿El combustible se carga siempre a un negocio, o también hay consumo general (sin licitación)?
4. ¿Qué hacemos con el gasto $50.151 del 1191: borrarlo (queda la OC 4058) o enlazarlo? El negocio está cerrado: cualquier cambio reabre el resultado.
5. Una OC exenta de combustible, ¿se separa el impuesto desde la factura o se deja como está?
