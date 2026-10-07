# Traspaso: QA y rediseño del módulo Compras (07-oct-2026)

Documento para continuar el trabajo desde otra cuenta de Claude (o cualquier persona). Está pensado para leerse solo, sin el historial de la conversación.

## 0. Reglas del proyecto y del usuario (léelas primero)

- Responder **siempre en español** (acento chileno, trato cercano). El usuario es el dueño/desarrollador del proyecto.
- `AGENTS.md`: este Next.js tiene cambios de API; leer `node_modules/next/dist/docs/` antes de tocar convenciones de Next. Cambios quirúrgicos, sin refactors ajenos.
- **Nunca inventar datos.** No registrar hechos falsos (por ejemplo, "se llamó al cliente") en negocios reales. Toda afirmación de la IA sobre un documento vale solo con una **cita literal verificada por código** (`citaVerificada` en `app/lib/compras-adicionales-ia.ts`).
- La base de datos es **una sola y real** (MySQL en Bluehost, credenciales en `.env.local`, que no se versiona). No hay entorno de pruebas aparte.
- **No escribir en Obuma** (crear SKU, órdenes de compra, pagos) sin OK explícito del usuario: es el ERP real.
- Subir cotizaciones o cambiar precios en un negocio **invalida las aprobaciones de compra y margen** (regla 10.5 de la especificación). Avisar antes.
- Git: el usuario sube a GitHub él mismo; no ofrecer commitear. Hay archivos modificados ajenos a este trabajo (`app/lib/viabilidad-ia.ts`, `app/lib/viabilidad-v4/productos.ts`, `app/lib/__tests__/viabilidad-v4.test.mts`): no tocarlos.
- Scripts de diagnóstico van en `scripts/scratch/` (no en `app/`), y siempre correr `npx tsc --noEmit -p .` además de los tests.

## 1. Cómo verificar

```bash
npx tsc --noEmit -p .                              # debe salir sin salida
npx tsx --test app/lib/__tests__/*.test.mts        # 1457 tests, todos OK al cierre
npm run dev                                        # http://localhost:3000 (el usuario ya lo tiene corriendo)
```

- Pantalla de prueba: `http://localhost:3000/compras/457` (negocio 457, licitación 1173418-1-LE26, Gendarmería, hornos/sobadora/carro). Hay que iniciar sesión (el usuario lo hace; no se escriben contraseñas).
- Con Claude in Chrome el patrón que funcionó: clic en el botón del stepper «Costeo y auditoría», luego en el encabezado «2 · Cotizaciones…»; para subir archivos usar `file_upload` sobre el `<input type=file>` (la ruta debe estar dentro del proyecto; los PDFs del usuario se copiaron a `scripts/scratch/auditoria-compras-docs/reales/`).
- Evitar bucles largos de JavaScript en la pestaña (congelan la extensión) y diálogos nativos del navegador.

## 2. Qué se hizo (todo verificado con tsc + tests; lo visual, en pantalla)

### 2.1 Auditoría inicial → arreglos
Se subieron cotizaciones buenas y malas (fixtures en `scripts/scratch/auditoria-compras-docs/`: `gen.py`, `gen2.py`, `gen3.py`, `truth.json`, y `reales/` con las 3 cotizaciones reales de ROMCO y Barcepan). Arreglado:

| Tema | Dónde |
|---|---|
| IVA incluido → se guarda neto (÷1,19); vigencia (también «05 DE OCTUBRE DE 2026» + «validez 15 días»); flete incluido; mínimo de venta; «consultar precio» → vacío (no $0); documentos ajenos (Bases) → rechazados; `.txt` leído; `.xlsx`/otros ya no tumban el proceso (Tesseract); HTML del OCR → texto legible | `app/lib/compras-cotizacion-lectura.ts`, `app/lib/compras-cotizacion-ocr.ts`, `app/lib/compras-auditor.ts` (`registrarCotizacion`) |
| Plazo del proveedor vs plazo **ofertado** cuando no hay reloj fijado; vigencia vencida (bug: MySQL devolvía `Date` y se comparaba como texto); mínimo de venta; críticos o «falta lo exigido» bajan el `cumple` a INFERIOR_NEGOCIABLE | `app/lib/compras-plazo-proveedor.ts`, `app/lib/compras-auditoria-cotizacion.ts` (`revisionesPorCodigo`, exportada) |
| Homologación IA: productos con códigos **P1, P2…** (antes la IA confundía el «Item 2» del documento con el producto 2); quemador/bandejas se unen solos como **adicionales**; `incluidoEn` (carro dentro del horno, base $0) y `faltantes`, ambos **solo con cita literal verificada**; limpia filas viejas al re-homologar | `app/lib/compras-auditor.ts` (`homologarCotizacionIA`), `app/lib/compras-adicionales-ia.ts` |
| Stepper: ✓ solo si hay compra elegida / compra y margen aprobados; siguiente-paso «Elige cómo comprar» / «Propón la compra» | `app/lib/compras.ts` (`estadoDelFlujo`), `app/compras/[negocioId]/ComprasChrome.tsx`, `app/lib/compras-siguiente-paso.ts` |
| Proveedor con RUT de dígito verificador malo no entra al catálogo; botones «Entregada/No realizada» piden confirmar; dashboard muestra «relojes sin fijar»; auditor del paso 4 sin avisos duplicados ni por vigencia no declarada; fuera la jerga «spec §…» de las pantallas; aviso de que el «Costo real» aún no es una compra real | varios (`app/compras/page.tsx`, `app/compras/dashboard/page.tsx`, `app/lib/auditor-compras-core.ts`, `app/negocios/[id]/CostoRealCard.tsx`) |

### 2.2 Rediseño del paso «Costeo y auditoría» (2ª tanda)
- **De 952 combinaciones a ≤6 recomendadas** (todo a un proveedor ×3, más barata, más rápida, equilibrada): `app/lib/compras-recomendaciones.ts` (+ tests). `enumerarCombinaciones` devuelve `recomendadas`; la lista se recorta a 30.
- **Armar la compra a mano:** un clic en el precio de la matriz = comprar ese producto a ese proveedor; «Comprar todo aquí» en la cabecera de cada proveedor. Servidor: `evaluarSeleccion` / `elegirSeleccion` en `compras-auditor.ts`; rutas en `app/api/compras/[negocioId]/escenarios/route.ts` (`POST {seleccion}` evalúa sin guardar; `PATCH {tipo:'SELECCION'}` elige). Un producto «incluido» solo vale si el proveedor también vende el que lo contiene.
- **Opción «Va incluido en otro producto»** al asignar productos a una cotización (base $0 explícita).
- **Matriz** (`app/negocios/[id]/MatrizPrecios.tsx`): 6 columnas (resto en «Ver las N»), menú ⋯ por cotización, celdas «no cotizó · + agregar», avisos ⚠ en rojo, pie por proveedor (Cubre / Total / Plazo / Avisos; «★ menor» solo entre los sin avisos). **Ya no existe la lista de cotizaciones**; el panel «¿Qué productos cubre?» y el confirmar-eliminar salen bajo la matriz.
- **Panel «Tu compra» + «Compras recomendadas» + carga al costeo:** `app/negocios/[id]/ArmarCompra.tsx` (reemplaza a `CombinacionesCompra.tsx`, que quedó sin usar).
- **Compra elegida → costeo:** `app/lib/compras-compra-a-costeo.ts` + `app/api/compras/[negocioId]/costeo-compra/route.ts` (GET = plan, POST = cargar). Carga «Costo unit. REAL» y Link 1 (archivo de la cotización) de cada línea del costeo; no toca nada más; el flete no se carga (va como gasto extra).
- **Corrección posterior (el usuario no quería las cotizaciones escondidas):** `app/negocios/[id]/ListaCotizaciones.tsx` es una tabla ordenada de TODAS las cotizaciones (proveedor, qué cubre y a qué precio, total, plazo, vigencia, avisos, acciones) con scroll y encabezado fijo. Y cada tarjeta de «Compras recomendadas» se abre con su **detalle completo** (modal `ModalCombinacion`, exportado desde `CombinacionesCompra.tsx`, que por eso sigue en uso) y se elige desde ahí.
- Productos a cubrir en una línea por producto (`ProductosCompraCard.tsx`); espacio de negociación plegado.

## 3. Estado actual del negocio 457 (datos de prueba que el usuario pidió NO borrar)

- Cotizaciones 39–41: las del usuario (ROMCO ×2, Barcepan). Re-auditadas con las reglas nuevas.
- Cotizaciones 42–64: de prueba (C* = malas/buenas genéricas; M* = mixtas; REAL_* = copias de las reales). Siguen ahí. Los proveedores 416–421 de la primera prueba sí se borraron.
- La compra elegida hoy es una combinación de ROMCO (clave con cotizaciones 39/41). **Las aprobaciones de compra y margen que el usuario dio a las 13:38 UTC quedaron invalidadas** por las subidas posteriores.
- Respaldo del estado inicial: `scripts/scratch/_snap457-antes-auditoria.json`.
- El «Costo real» del costeo del 457 trae valores viejos (horno $15.299.857, sobadora $6.640.500, carro $232.830) que no vienen de una compra real.

## 4. Pendiente (en este orden sugerido)

1. **Cargar la compra elegida al costeo (POST) y ver el resultado.** Solo la vista previa (GET) se probó; el POST **no** se ejecutó porque reemplaza el costo real actual. Preguntar al usuario.
2. **Seguir con el reordenamiento general del paso** (propuesto con un mockup, aún no construido): tres etapas arriba (Cotizar → Comparar y elegir → Verificar costo) y una franja única de «qué falta» con su botón; sacar de la vista «Fichas técnicas: próximamente».
3. **Probar el flujo restante:** elegir y proponer la compra/margen, aprobaciones, crear SKU y órdenes de compra en Obuma (pedir OK), hitos administrativos, entrega, acta y postventa.
4. **Tareas** (Contacto inicial, Validación técnica, etc.): son formularios de hechos reales; no inventar. Si el usuario quiere, llenarlas marcadas «[PRUEBA]».
5. Datos sucios sin tocar: usuario «Perfil Compras (prueba)» asignado a un negocio, organismo con «Mar�a Pinto», 2 negocios sin monto, casi todos con «0/7 tareas · 6 vencidas».
6. Decidir si se borran los scripts `_*.mjs/_*.mts` de `scripts/scratch/`.

## 5. Decisiones de diseño ya tomadas

- Vigencia **vencida sí alerta** (el PROMPT 5 · V7 manda sobre la especificación §8.12); vigencia no declarada no alerta.
- Los **servicios** (puesta en marcha, instalación) no se unen como adicionales.
- El descuento «por pago contado 2 %» de Barcepan se aplica como descuento normal.
- Una cotización con un problema crítico (plazo que no alcanza, compra con pérdida) o a la que le falta lo exigido **no se excluye** (§8.8.1) pero baja a «inferior negociable» y las recomendaciones la ordenan detrás.
- Compras audita **precio contra lo costeado**, no la ficha técnica (ese comparador es otro documento, aún no construido: «Próximamente»).

## 6. Memoria de Claude Code (local a la máquina)

Hay notas equivalentes en `C:\Users\droku\.claude\projects\D--licitapyme-clone\memory\` (índice `MEMORY.md`, entrada `project_compras_auditoria_qa_arreglos_oct2026.md`). Si se usa otra cuenta en la **misma máquina**, ese directorio sirve; si es otra máquina, este documento es la fuente.
