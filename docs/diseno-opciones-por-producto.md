# Diseño — varias opciones del mismo proveedor para un producto

Estado: **PROPUESTA, sin implementar** (18-nov-2026). Nació de revisar las 7 cotizaciones de 727202-72-LP26 (negocio 1356).

## 1. El problema

Una cotización solo puede dar **una línea por producto**: `compras_cotizacion_item` tiene `UNIQUE (cotizacion_id, producto_id)`. Pero un proveedor
suele ofrecer **varias opciones para lo mismo**:

| Cotización | Qué ofrece | Qué pasa hoy |
|---|---|---|
| 351 Improtek | 3 modelos de detector de fugas (L2000 $1.699.900, PQ128C $1.799.900, AD21P $949.900) | se usa uno; el AD21P, el más barato, queda solo **avisado** |
| 352 Vorwerk | 8 máquinas (Connect160/500/1000, PL160/PT160/PT250/PT500/PT1200) para 3-4 productos | 2 se usan; 6 líneas quedan avisadas |
| 360 INGAP | SHDS 160 ($1,5 M) y DPS-22 ($1,38 M) para varios productos parecidos | una por producto; el resto avisado |

Consecuencia: la comparación de precios y la elección de compra **no ven** las opciones sin usar, que pueden ser mejores (la más barata) o la única que cumple.

## 2. Cómo identifica el sistema una oferta hoy (lo que condiciona el diseño)

Verificado en el código:

- La elección de compra se guarda como **«producto → id de cotización»** (`seleccionDesdeClave`, clave `producto:cotizacion|…`; `compras-auditor.ts`).
- `compras_cotizacion_adicional`, `compras_auditoria_cotizacion` y las compras rápidas también cuelgan de **(cotizacion_id, producto_id)**.
- Hay unas **51 referencias** a `compras_cotizacion_item` repartidas en 9 archivos (`compras.ts`, `compras-auditor.ts`, `compras-adicionales.ts`,
  `compras-auditoria-cotizacion.ts`, `compras-aprobaciones.ts`, `compras-avance-estados.ts`, `compras-directas.ts`, `auditor-compras.ts`, `resumen-gastos/route.ts`).
- `calcularEscenarios` identifica al proveedor por **nombre** y cuenta **un solo flete por proveedor**; el propio código contempla «dos cotizaciones
  separadas» del mismo proveedor.
- Las órdenes de compra a Obuma se agrupan por `proveedor_id` (migration-196 ya permite varias OC por proveedor).

## 3. Alternativas evaluadas

**A. Opción = cotización «hija» (RECOMENDADA).** Cada opción extra es una fila de `compras_cotizacion` marcada como hija de la cotización del documento
(mismo proveedor, mismo archivo, mismo texto) que lleva **solo esa línea** y su(s) producto(s). Todo lo que ya existe (matriz, comparación, elección,
escenarios, auditor, adicionales, OC) funciona **sin cambios**, porque ya trabaja por cotización. Solo cambia dónde se crean, cómo se muestran y cómo se borran.

**B. Opción como dimensión del ítem** (`UNIQUE (cotizacion_id, producto_id, opcion)`). Es lo «puro», pero obliga a cambiar la clave de **todo**: los 9 archivos,
adicionales, auditoría, la clave de selección `p:c`, compra rápida, costeo→compra y escenarios. Riesgo alto, semanas, y toca decisiones ya aprobadas por el equipo.

**C. Seguir como hoy** (subir la cotización partida a mano). Sin cambios, pero obliga a trabajo manual y se pierde la comparación automática.

Se elige **A**: mismo resultado para el usuario con una fracción del riesgo.

## 4. Diseño de A

### 4.1 Datos (migration-200, mínima y reversible)
```sql
ALTER TABLE compras_cotizacion
  ADD COLUMN cotizacion_padre_id INT NULL,
  ADD COLUMN opcion_etiqueta VARCHAR(160) NULL,
  ADD INDEX idx_compras_cotizacion_padre (cotizacion_padre_id);
```
Sin tocar `compras_cotizacion_item`. Cuelga de `negocios` (empresa por JOIN), igual que el resto: no hay datos de ninguna empresa en el código (skill `multiempresa-escalable`).
Una hija lleva `origen = 'opcion'`, proveedor/RUT/archivo/texto/vigencia copiados, `precio_unitario` = el de su línea.

### 4.2 Qué es una «opción» (reglas generales, ya existen las piezas)
Una línea con precio del documento que **no** quedó en ningún producto y que:
1. se parece a un producto (`productosCandidatos`, puntaje ≥ 0,5) **sin choque grave de medida** (`conflictosMedibles`),
2. no es flete, total ni accesorio/componente ya cargado como adicional,
3. o es una línea que `lineasAlternativas` ya detecta (parecida a un producto que tomó el precio de otra línea).

Una opción = una línea = una hija. Si varias filas iguales del mismo producto (las 3 HST 300) la aceptan, la hija las cubre todas. **Tope: 8 hijas por cotización** (el resto queda avisado como hoy).

### 4.3 Ciclo de vida
- **Re-leer el padre:** las hijas del agente se rehacen. Si una persona tocó la hija (precio editado, adicional propio, elegida en un escenario), **se conserva**.
- **Borrar el padre:** borra sus hijas y desmarca escenarios, igual que hoy (`eliminarCotizacion`).
- **Una hija nunca se re-homologa sola** (si no, relee todo el documento y duplica).
- **Elegida en un escenario/aprobación:** no se borra ni se rehace sin aviso.

### 4.4 Pantalla
- Lista de cotizaciones: las hijas van **plegadas bajo el padre** («+2 opciones»); el contador «7 recibidas» no cambia.
- Matriz y cuadro comparativo: aparecen como filas propias etiquetadas **«Improtek · AD21P»**.
- «Cómo se leyó el documento»: la línea muestra «→ opción aparte de *Geófono para detección de fugas*» en vez de «⚠ sin asignar».
- El cuadro «Diferencia» del documento no cuenta dos veces las líneas de las hijas.

### 4.5 Qué no cambia (a verificar en la fase 0)
Elección por producto, escenarios, aprobación, SKU, OC a Obuma, costo real y cierre.

## 5. Plan por fases

| Fase | Qué | Aceptación | Esfuerzo |
|---|---|---|---|
| **0** | Verificar con 2 cotizaciones del mismo proveedor en una copia: flete único por proveedor, escenarios, OC | los números cuadran sin tocar código | ~½ día |
| **1** | migration-200 + botón **«Como opción aparte»** en el panel de línea sin asignar (manual) + cascada de borrado + etiqueta | crear una opción del AD21P en el 1356 y compararla | ~1 día |
| **2** | Pantalla: hijas plegadas bajo el padre, etiqueta en matriz y cuadro | se lee sin confusión en notebook (~1366 px) | ~½ día |
| **3** | Generación **automática** al leer (reglas de 4.2), con tope y «conservar lo tocado a mano» | las 3 cotizaciones del 1356 dejan sus opciones sin pasos manuales | ~1 día |

Se empieza **manual** (fase 1) a propósito: así el equipo valida si el concepto sirve antes de que el sistema cree filas solo.

## 6. Riesgos y decisiones abiertas

1. **Flete.** Si la hija copia el flete y el padre también, un proveedor puede cobrarse dos veces. Propuesta: la hija no copia `flete_monto` y se usa el del proveedor (ya único por proveedor en escenarios); **verificar en la fase 0**.
2. **Ruido en pantalla.** Vorwerk generaría 6 hijas. Por eso van plegadas y hay tope.
3. **Una opción que no cumple.** La hija pasa por el auditor como cualquier cotización (`cumple` + aviso); no se excluye (spec §8.8.1).
4. **Equivalencias dudosas** (Easy Weld 180 ← SHDS 160): hoy no se detectan por código; las hijas las dejan **visibles y elegibles**, que es mejor que taparlas.
5. **Multiempresa:** columnas nuevas sin datos de empresa; sirve igual a otros clientes.

## 7. Lo que se necesita decidir

1. ¿Empezar por **manual (fase 1)** y automatizar después? *(recomendado)*
2. ¿Tope de **8** opciones por cotización?
3. ¿Qué pasa con el flete: **uno por proveedor** (propuesto) u otro criterio?
