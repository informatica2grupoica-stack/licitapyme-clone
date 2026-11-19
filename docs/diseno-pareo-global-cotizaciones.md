# Diseño: pareo GLOBAL de cotizaciones del negocio (lo que hizo Claude con 727202-72-LP26)

Escrito el 2026-11-19 a partir de una prueba: se le pasó a Claude (chat) el costeo de 727202-72-LP26
(negocio 1356, 141 productos) y las 7 cotizaciones (Makita 11457, Improtek PR-SCM-16841, Vorwerk COT64469,
INGAP 176397/176407/176408, Protecnica 12090). Emparejó 43 productos y la suma de lo asignado cuadró con el
neto de cada cotización. Este documento explica QUÉ hizo distinto del motor actual y cómo llevarlo al sistema.
Estado: núcleo implementado en `app/lib/compras-pareo-global-core.ts` (2026-11-19), sin conectar a ruta ni pantalla. HST 300 = electrofusión, confirmado.

## 1. Qué se usó de verdad (sin adornos)

- **Python** (`openpyxl`, `pdfplumber`) solo para LEER el Excel y los PDF y para ESCRIBIR el Excel de salida.
  Eso el sistema ya lo hace (lector de cotizaciones + costeo digital); no hay que copiarlo.
- **El emparejamiento no salió de un algoritmo**: lo hizo el modelo (Claude) razonando con TODO a la vista a la vez
  (141 productos + ~45 líneas de 7 cotizaciones, ~20 mil tokens). El script que escribió el Excel tenía los pares
  escritos a mano por el modelo. Lo que se puede llevar al sistema es el MÉTODO (sección 3), el PROMPT (sección 4) y
  las COMPROBACIONES (sección 5), no un script.

## 2. Diferencias con el resultado del motor actual en el 1356 (según docs/memoria/compras.md, 18-19 nov)

| Caso | Motor actual | Pareo global | Causa de fondo |
|---|---|---|---|
| INGAP: 7 × DPS-22 en UNA línea | asigna 2 (los 2 ítems que dicen «DPS-22»); EURO-JUNIOR toma $1,38 M y el resto queda sin precio | las 7 unidades se reparten entre los 7 ítems de electrofusión (1, 16, 64, 73, 83, 106, 134) | El motor mira **línea → un producto**. No usa la CANTIDAD de la línea como señal ni la reparte entre varios productos |
| Subline F14-17 ×4 | ok | 39 (2) + 70 (2) | igual idea: cantidad 4 = 2 + 2 |
| Franklin SS 642/14 ×2 | 11 bombas (falta una) | 34 y 57 (ambas 30 HP pedidas, aviso de 15 HP cotizado) | cantidad 2 → 2 productos |
| Tubería 63 mm 400 m | solo ítem 45 (100 m) | 45 (100 m) + 23 «Tubería lisa HDPE PN10» sin diámetro (300 m) | 400 = 100 + 300: la cantidad resuelve un producto que por nombre es ambiguo |
| Tubería d20 mm (3 × 100 m) | «avisada», sin asignar | ítem 127 «HDPE de 1/2", unidades de 100 m» | falta equivalencia NOMINAL pulgada ↔ mm de tubería PE (1/2" = d20) |
| Hürner HST 300 Smart (×3) | primero PL160 (termofusión), después «sin asignar» | DPS-22 / Connect160 (electrofusión) | **la memoria la trata como termofusión y es ELECTROFUSIÓN** (catálogos Hürner/AGRU). Revisar el 1356 en producción |
| Varias opciones (Vorwerk, AD21P, L2000) | una se usa, el resto avisado | se elige la que CUMPLE y es más barata; el resto queda como alternativa con su precio | elección entre cotizaciones distintas, no dentro de una sola |

Ninguna de estas diferencias se arregla con más reglas sobre una cotización aislada: el motor procesa **una cotización a la vez**
(`SYS_HOMOLOGACION`: «Te doy la descripción libre de UNA cotización»), con candidatos filtrados (~6 de 141) y en tandas de 15 líneas.
Así pierde las dos señales más fuertes: **la cantidad** (que solo se entiende viendo todos los productos) y **la comparación entre proveedores**.

## 3. Método (el que siguió el modelo, en orden)

1. **Normalizar todas las líneas de todas las cotizaciones** a una tabla única: proveedor, cotización, texto de la línea, código,
   cantidad, unidad, precio unitario NETO en CLP (quitar IVA si viene con IVA → Makita; USD × tipo de cambio → Vorwerk;
   descuento aplicado → Protecnica), y flete/envío aparte. *Esto el sistema ya lo hace por cotización (`factoresPrecioDeCotizacion`).*
2. **Agrupar los productos del costeo por familia** (bombas, máquinas de electrofusión, de termofusión, geófonos, tuberías por diámetro,
   fittings por diámetro, herramientas Makita…). Una línea solo puede ir a productos de su misma familia.
3. **Dentro de cada familia, cuadrar cantidades**: la cantidad de la línea es un «presupuesto» que se reparte entre productos
   (7 DPS-22 ↔ 7 ítems de electrofusión; 40 coplas d110 ↔ 30 + 10; 400 m ↔ 300 + 100). Cuando las cantidades calzan exacto, es la pista más
   fuerte que existe: el comprador cotizó pensando en esos productos.
4. **Modelo exacto primero, equivalente después**: el ítem que nombra el modelo cotizado (16 y 134 «INGAP DPS-22») lo toma sí o sí; los
   genéricos o de otra marca reciben el equivalente con confianza «media» y nota.
5. **Medidas**: igual o MAYOR = sirve (con aviso); MENOR = no sirve (63 ≠ 75 mm; 160 < 180 mm → aviso fuerte). Equivalencias nominales de
   tubería PE: 1/2"=20, 3/4"=25, 1"=32, 1¼"=40, 1½"=50, 2"=63, 2½"=75, 3"=90, 4"=110, 6"=160 mm (confirmar con el equipo).
6. **Entre proveedores**: si dos líneas cumplen para el mismo producto, gana la más barata que cumple; la otra queda como alternativa con precio.
7. **Cuadratura** (sección 5): todo lo asignado + lo sobrante + flete = neto de la cotización. Si no cuadra, algo está mal leído.
8. **Lo dudoso no se esconde**: se asigna con confianza y motivo (Alta / Media / Revisar) para que una persona lo mire en segundos.

## 4. Prompt propuesto (un paso nuevo, DESPUÉS de leer todas las cotizaciones del negocio)

Una sola llamada por negocio (o una por familia si el negocio es enorme). Necesita un modelo fuerte en conocimiento técnico de productos:
la equivalencia HST 300 = electrofusión o «Euro-Junior ≈ DPS-22» depende de lo que el modelo sabe, no del código. Medir en el banco qué
modelo lo resuelve (glm-4.7 / Kimi vs. uno de primera línea) antes de elegir.

```text
Eres el comprador de una empresa que revende productos adjudicados en licitaciones públicas chilenas.
Tienes TODOS los productos que hay que comprar (P1…Pn, con cantidad y unidad) y TODAS las líneas de TODAS las
cotizaciones recibidas para este negocio (L1…Lm, ya en CLP NETO por la unidad indicada, con proveedor y cantidad cotizada).

Tu trabajo es repartir las líneas entre los productos de la forma más correcta y barata posible.

REGLAS
1. Una línea puede cubrir VARIOS productos. Su CANTIDAD es lo que alcanza a cubrir: reparte esa cantidad entre productos de
   la misma familia (ej.: línea de 7 máquinas iguales → hasta 7 productos de 1 unidad; 400 m de tubería → 300 m a un producto y 100 m a otro).
   Que las cantidades calcen exacto es una señal muy fuerte de que esa era la intención del comprador. No asignes más cantidad que la cotizada.
2. Un producto recibe UNA línea principal. Si otras líneas también lo cumplen, ponlas en "alternativas" con su precio.
   Elige como principal la MÁS BARATA QUE CUMPLE.
3. Familia y proceso son identidad: electrofusión ≠ termofusión, bomba sumergible ≠ centrífuga, geófono ≠ medidor. Usa tu conocimiento
   del modelo comercial (ej.: Hürner HST 300 y Foxfitting Connect son de ELECTROFUSIÓN; Tecnodue PL/PT son de TERMOFUSIÓN a tope).
4. Medidas: igual o mayor a lo pedido = cumple (avisa si es mayor); menor = NO cumple. Potencia, tensión, diámetro y PN son identidad.
   Tubería PE: 1/2"=d20, 3/4"=d25, 1"=d32, 2"=d63, 2½"=d75, 3"=d90, 4"=d110.
5. Si el producto nombra un modelo y una línea trae ESE modelo, va a esa línea antes que a cualquier equivalente.
6. Un producto sin diámetro o sin modelo puede inferirse por la cantidad o por el grupo en que aparece, pero con confianza "media"
   y diciendo de qué lo infieres.
7. Si la línea dice una medida distinta de lo pedido (15 HP cotizado vs 30 HP pedido), asígnala igual SOLO si el modelo coincide, con
   confianza "revisar" y la discrepancia en "motivo". Si no coincide el modelo, no la asignes.
8. No inventes precios: precioUnitario sale de la línea (convierte a la unidad del producto si la línea es por metro y el producto por rollo,
   y di la conversión).
9. Flete, despacho e instalación no son productos (salvo que exista un producto de flete): van en "cargosAparte".
10. Toda línea termina en "asignaciones", "alternativas" de algún producto, "sobrantes" (con por qué) o "cargosAparte". Ninguna se pierde.

Responde SOLO JSON con este formato:
{"asignaciones":[{"producto":"P12","linea":"L7","cantidad":1,"precioUnitario":1380000,"conversion":null,
   "confianza":"alta|media|revisar","motivo":"<1 frase>"}],
 "alternativas":[{"producto":"P12","linea":"L31","precioUnitario":1187500,"motivo":"<por qué no es la principal>"}],
 "sobrantes":[{"linea":"L33","cantidadSobrante":1,"motivo":"<1 frase>"}],
 "cargosAparte":[{"linea":"L40","concepto":"despacho","monto":12000}],
 "sinCotizacion":["P8","P9"]}
```

Formato de entrada sugerido (compacto, tabular, para que quepan 141 + 50 filas sin gastar tokens):
```text
PRODUCTOS
P1 | Máquina de electrofusión EURO-JUNIOR. | 1 un.
P10 | Tubería HDPE de 90 mm, PN10, unidades de 50 m. | 17 un.
...
LINEAS (precio = CLP neto por la unidad indicada)
L1 | INGAP 176397 | Máquina electrofusión INGAP DPS-22 (3,5 kW) | 7 un | 1380000
L2 | Vorwerk COT64469 (USD 1000) | Máquina de Electrofusión Connect160 20-160 mm | 1 un | 1187500
...
```

## 5. Comprobaciones en código (lo que hace que sea «sin errores»)

La IA propone, el código decide. Nada de esto depende del modelo. Función pura sugerida
`validarPareoGlobal(productos, lineas, respuesta)` en un `compras-pareo-global-core.ts`, con pruebas en `__tests__`:

1. **Existen**: cada `producto` y `linea` de la respuesta existe; descartar lo inventado.
2. **Cantidad**: Σ cantidad asignada de una línea ≤ cantidad de la línea (después de convertir rollo/metro). Si se pasa, quitar las de
   menor confianza hasta que calce.
3. **Un principal por producto**: si llegan dos, queda la más barata que no tenga choque; la otra pasa a alternativa.
4. **Precio real**: `precioUnitario` = precio de la línea (o × la conversión declarada, que se recalcula con `conversionDesdeTexto`).
   Reusar `precioEnDocumento` y `factoresPrecioDeCotizacion`.
5. **Medidas y modelo**: reusar `conflictosMedibles` de `compras-cotizacion-emparejar.ts` + agregar la tabla nominal pulgada→mm de la sección 3.
   Choque grave sin modelo igual = se rechaza la asignación (como hoy).
6. **Familia/proceso**: lista corta de pares incompatibles por palabra (electrofusión↔termofusión, sumergible↔centrífuga…) aplicada al
   texto del producto y de la línea; con modelos conocidos (HST 300, Connect, DPS-22, PL/PT) en un diccionario editable POR EMPRESA
   (regla multiempresa: nada escrito para ICA en el código).
7. **Cuadratura por cotización**: Σ(cantidad × precio de las asignaciones) + Σ sobrantes + cargos aparte = neto de la cotización (±0,5 %).
   Si no cuadra → la cotización entera queda «revisar» con la diferencia a la vista. Esta fue la prueba que confirmó el pareo de 727202:
   INGAP 176407 $2.408.772, 176408 $2.327.400, 176397 $12.718.000, Protecnica $21.590.848, Improtek $8.065.400 (asignado + 1 L2000 sobrante + envío).
8. **Toda línea con destino**: ninguna línea con precio queda fuera de asignaciones/alternativas/sobrantes/cargos.

## 6. Cómo encaja con lo que ya existe

- No reemplaza `homologarCotizacionIA`: la lectura por cotización (texto, precios, IVA, USD, flete, kits) sigue igual.
- Paso nuevo «Emparejar todas» por negocio, que corre cuando hay 2+ cotizaciones leídas (o con un botón), toma las líneas ya leídas y
  propone el reparte completo. Las asignaciones salen con su confianza; las «alternativas» calzan con `docs/diseno-opciones-por-producto.md`
  (una alternativa = una opción).
- **Medir antes de desplegar** con `scripts/banco-cotizaciones`: agregar el 1356 completo como caso ORO usando el pareo de la sección 7
  (después de que una persona lo revise) y comparar contra el motor actual (`evaluar.mts --negocio=1356`).

## 7. Respuesta esperada para 727202-72-LP26 (para el banco; REVISAR antes de marcarla ORO)

Ítem del costeo → línea (precio neto por la unidad del costeo). Confianza entre paréntesis.
- INGAP 176407: 2 Codo 90 d90 $19.078 · 3 Tee d90 $17.956 · 4 Stub end d90 $4.171 · 5 Flange d90 $12.187 · 6 Transición 90×3" $55.920 ·
  7 Copla d90 $6.062 · 32 y 115 Copla d110 $7.417 (línea de 40 = 30 + 10) · 135 Copla d63 $3.436 (media: sin diámetro, por cantidad) ·
  132 Codo 90 d63 $12.084 · 133 Codo 45 d63 $12.164 (alta)
- INGAP 176408: 45 Tubería d63 $3.222/m (100 m) · 23 Tubería lisa PN10 $3.222/m (300 m; media: sin diámetro, 400 = 300+100) ·
  114 d110 rollo 50 m $441.900 · 127 1/2" rollo 100 m = d20 $51.600 (media-alta)
- INGAP 176397: DPS-22 $1.380.000 → 16 y 134 (alta, modelo exacto); 1, 64, 73, 83, 106 (media, equivalentes de electrofusión) ·
  SHDS 160 $1.500.000 → 96 (media) y 15 (media-baja: Easy Weld 180 pide 180 mm) · Socket 20×63 $58.000 → 22 (media, genérico)
- Protecnica: 18 SS624/22 $2.737.667 · 117 SS624/20 $2.638.729 · 29 SS609/40 $2.824.067 · 34 y 57 SS642/14 $2.927.265 (revisar: 30 HP pedido,
  15 HP cotizado) · 79 SVM285/32 $1.109.172 · 39 y 70 Subline F14-17 $899.360 (línea de 4 = 2 + 2) · 128 Pedrollo 4SR12M-9 $674.315 ·
  40 SVM150/13 $443.022 · 26 PVXC30/50 $1.244.959 · 27 DM30 $466.948 (alta)
- Improtek: 14 PQ128C $1.799.900 (alta) · 37 y 95 AD21P $949.900 (media: proveedor dice «interiores») · 30 AD21P $949.900 (media, genérico) ·
  81 Terralog → L2000 $1.699.900 (media) · sobra 1 L2000 · envío $16.000
- Makita: 50 esmeril + 2 baterías + cargador $283.160 neto (precios venían con IVA) · despacho $12.000 c/IVA
- Vorwerk: sin asignación principal; alternativas: Connect160 (US$1.187,50) para 1/73/83/106, Connect1000 (US$3.790,50) para 64,
  PT250 (US$8.749,30) para 15 si se exige 180 mm.
