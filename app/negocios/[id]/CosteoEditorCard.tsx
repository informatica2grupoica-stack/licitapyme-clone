'use client';

// COSTEO — editor integrado (pestaña propia, arriba del Auditor Técnico), en pantalla completa.
//
// Reemplaza el ciclo "generar el Excel → bajarlo → llenarlo en Excel de verdad → volver a
// subirlo": acá se edita directo, con la MISMA cadena de fórmulas que trae la plantilla real
// (tabla-costeo-v3.xlsx, hoja "Costeo"):
//   Costo unitario neto   = Valor c/IVA / 1.19
//   Costo total neto      = Cantidad × Costo unitario
//   Precio unitario venta = Costo unitario × (1 + margen)      margen fijo de la plantilla: 27%
//   Precio total neto     = Cantidad × Precio unitario (truncado, sin decimales)
// El margen es UN número editable para todo el costeo (en la plantilla real es la misma
// constante ×1.27 repetida en cada fila) — nunca se tipea el precio de venta a mano, se deriva
// del costo, igual que en el Excel. Cada ítem trae además hasta 3 links (mismas columnas "Link 1/2/3"
// de la plantilla) para dejar dónde se cotizó.
//
// La "SECCIÓN COMPRAS" del Excel real (columnas L, M, N — verificado contra
// COSTEO_1271359-92-LE26, hoja "canasta 2") también está: Costo unit. REAL se tipea al comprar y
// las otras dos se derivan con SUS MISMAS fórmulas (M = L×E, N = (L/G)−1). Es lo que alimenta el
// bloque REAL del cuadro comparativo del costado.
//
// Al guardar, el backend (app/api/negocios/[id]/comercial/costeo-editor/route.ts) lo ingresa como
// una versión más del Motor Comercial — mismas 4 alertas, mismo auto-precarga del checklist que si
// se hubiera subido un .xlsx.
//
// Los ítems iniciales salen del manifiesto de viabilidad (adaptarViabilidadACosteo, mismo
// adaptador que usa generar-costeo.ts): una sola hoja si la licitación es global (suma alzada), o
// una hoja por línea si es por línea — el backend ya decide cuál corresponde.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '@/app/components/ui/toast';
// Cuadro comparativo (venta/costo/utilidad/margen, estimado vs real, distancia al presupuesto):
// misma aritmética que el bloque que el comercial arma a mano al pie del Excel. Módulo sin
// dependencias, compartido — acá NO se duplica ninguna de esas fórmulas.
import { calcularComparativo, recargoParaMargen, margenDeRecargo, parsearRecargo, esLinkDeProducto, IVA, type Comparativo } from '@/app/lib/costeo-comparativo';
import {
  Calculator, Loader2, Plus, Trash2, RefreshCw, Save, AlertTriangle, ShieldCheck, Sparkles,
  Maximize2, X, ExternalLink, SplitSquareHorizontal, Combine, FileSearch, Link2 as LinkIcon,
} from 'lucide-react';

const MARGEN_VENTA_DEFECTO = 27;

interface FilaEditor {
  id: string;
  item: number;
  // Número REAL de línea de la licitación — puede diferir de `item` (que es solo la posición
  // visual dentro de la hoja). Se usa para cruzar contra el Auditor Técnico; editable por si la
  // detección automática se equivoca o para etiquetar una fila agregada a mano.
  lineaReal: number | null;
  detalle: string;
  unidad: string;
  skuProveedor: string;
  cantidad: number | null;
  valorConIva: number | null;
  // Costo unitario NETO realmente pagado, cuando se sabe (factura/OC). Alimenta el bloque "REAL"
  // del cuadro comparativo. Vacío mientras no se conozca — nunca se copia del estimado.
  costoRealUnitario: number | null;
  // Recargo sobre el costo de ESTA fila, en %. null/undefined = hereda el de la hoja, y esa el del
  // costeo completo. El global sigue siendo el que manda: esto es el clic puntual sobre un ítem
  // que se vende con otro margen, como en el Excel del asistente (1114-12-LE26: ×2,1 la plataforma
  // satelital y ×2,0 el sensor, en la misma hoja) — ver FilaEditorCosteo en costeo-editor.ts.
  margenVenta?: number | null;
  link1: string; link2: string; link3: string;
}
// ofertamos: ¿se oferta esta hoja/línea? default true. Apagarla la saca de los totales y de lo
// que "Actualizar" vuelve a traer — ver GrupoEditorCosteo en app/lib/costeo-editor.ts (misma idea,
// duplicada acá porque este archivo es un Client Component y se mantiene autocontenido).
interface GrupoEditor {
  nombre: string; linea: number | null; ofertamos: boolean; filas: FilaEditor[];
  // Tope (presupuesto NETO) de ESTA línea/canasta — ver GrupoEditorCosteo en costeo-editor.ts.
  // null/undefined = el que resuelva presupuestoDeHoja (el de su línea, o el global si el costeo
  // es de una sola hoja). El presupuesto casi nunca es uno solo para todo.
  presupuestoNeto?: number | null;
  // Recargo sobre el costo de ESTA hoja, en %. null = usa el del costeo completo. En el Excel real
  // cada canasta tiene el suyo (×1,25 en una, ×1,34 en la otra) — ver GrupoEditorCosteo.
  margenVenta?: number | null;
}
interface EstadoEditor {
  modalidad: 'suma_alzada' | 'por_linea' | 'por_categoria';
  margenVenta: number;
  grupos: GrupoEditor[];
}
interface Alerta { codigo: string; descripcion: string; detalle: string }

const fmtCLP = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const nuevaFila = (item: number): FilaEditor => ({
  id: Math.random().toString(36).slice(2, 10), item, lineaReal: null, detalle: '', unidad: 'UN', skuProveedor: '',
  cantidad: null, valorConIva: null, costoRealUnitario: null, link1: '', link2: '', link3: '',
});

/** Reparte TODAS las filas del costeo en una hoja por línea REAL (lineaReal, no el nombre de hoja
 *  de origen) — para cuando el análisis clasificó la licitación como global pero las bases arman
 *  canastas/líneas con total propio (caso real 03-sep-2026, 1271359-92-LE26). Corrección manual,
 *  acotada a este costeo — no toca el informe de viabilidad ni el checklist del Auditor Técnico. */
function separarPorLinea(estado: EstadoEditor): EstadoEditor {
  const porLinea = new Map<number, GrupoEditor>();
  const sinLinea: FilaEditor[] = [];
  for (const g of estado.grupos) {
    for (const f of g.filas) {
      if (f.lineaReal == null) { sinLinea.push(f); continue; }
      if (!porLinea.has(f.lineaReal)) porLinea.set(f.lineaReal, { nombre: `Línea ${f.lineaReal}`, linea: f.lineaReal, ofertamos: true, filas: [] });
      porLinea.get(f.lineaReal)!.filas.push(f);
    }
  }
  const grupos = [...porLinea.entries()].sort(([a], [b]) => a - b).map(([, g]) => ({ ...g, filas: g.filas.map((f, i) => ({ ...f, item: i + 1 })) }));
  if (sinLinea.length) grupos.push({ nombre: 'Sin línea', linea: null, ofertamos: true, filas: sinLinea.map((f, i) => ({ ...f, item: i + 1 })) });
  return { ...estado, modalidad: 'por_linea', grupos: grupos.length ? grupos : estado.grupos };
}

/** Reverso: junta todas las hojas en una sola. Las hojas marcadas "no ofertamos" NO vuelven —
 *  unirlas de nuevo no debe resucitar en silencio una línea que se decidió excluir. */
function unirEnUnaHoja(estado: EstadoEditor): EstadoEditor {
  const filas = estado.grupos.filter(g => g.ofertamos).flatMap(g => g.filas).map((f, i) => ({ ...f, item: i + 1 }));
  return { ...estado, modalidad: 'suma_alzada', grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas }] };
}

function normDesc(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** ¿"la misma fila", con texto exacto o no? BUG REAL (03-sep-2026, 1271359-92-LE26): al volver a
 *  analizar la viabilidad, la IA no solo reclasificó las líneas — también RECORTÓ las
 *  descripciones ("Locker metálicos colores 15 cuerpos - Sin marca/modelo de referencia
 *  explícito" pasó a solo "Locker metálicos colores"). Comparar por texto EXACTO hacía que
 *  ninguna fila ya guardada calzara con la fresca. Alcanza con que una sea prefijo largo de la
 *  otra (≥12 caracteres, para no confundir dos productos cortos que empiecen igual). MISMA
 *  función que app/lib/costeo-editor.ts:mismoProducto — duplicada acá porque este componente es
 *  cliente y se mantiene autocontenido. */
function mismoProducto(a: string, b: string): boolean {
  const na = normDesc(a), nb = normDesc(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [corta, larga] = na.length <= nb.length ? [na, nb] : [nb, na];
  return corta.length >= 12 && larga.startsWith(corta);
}
function buscarMismoProducto<T extends { detalle: string }>(filas: T[], detalle: string): T | undefined {
  return filas.find(f => mismoProducto(f.detalle, detalle));
}

/** RECONCILIA, no solo agrega — MISMA lógica que app/lib/costeo-editor.ts:fusionarConViabilidad
 *  (duplicada acá porque este componente es cliente y se mantiene autocontenido, y porque
 *  "Actualizar" tiene que fusionar contra lo que hay EN PANTALLA —que puede traer cambios sin
 *  guardar, como un recién hecho "Separar por línea"— no contra lo último guardado en el
 *  servidor). El generador del Excel siempre relee la viabilidad fresca, así que si el análisis se
 *  corrigió (caso real: pasó de "6 líneas sueltas" a "Pasto solo + los 5 muebles como UN paquete,
 *  línea 2") el Excel regenerado sale bien de inmediato. Este editor guarda una FOTO editable, así
 *  que sin esto la reclasificación nunca llegaba a una fila ya existente — solo se agregaba lo que
 *  faltaba, duplicando todo lo demás. */
function fusionarLocal(actual: EstadoEditor, nuevo: EstadoEditor): { estado: EstadoEditor; agregados: number; reclasificados: number } {
  const frescas = nuevo.grupos.flatMap(g => g.filas);
  const lineasExcluidas = new Set(actual.grupos.filter(g => !g.ofertamos && g.linea != null).map(g => g.linea as number));
  const organizadoPorLinea = actual.grupos.some(g => g.linea != null);

  let reclasificados = 0;
  const reubicar: FilaEditor[] = [];
  let grupos: GrupoEditor[] = actual.grupos.map(g => {
    const filas: FilaEditor[] = [];
    for (const f of g.filas) {
      const fresco = buscarMismoProducto(frescas, f.detalle);
      const lineaFresca = fresco?.lineaReal ?? f.lineaReal;
      if (lineaFresca === f.lineaReal) { filas.push(f); continue; }
      reclasificados++;
      const actualizada = { ...f, lineaReal: lineaFresca };
      if (organizadoPorLinea) reubicar.push(actualizada); else filas.push(actualizada);
    }
    return { ...g, filas };
  });

  if (reubicar.length) {
    const porLineaTmp = new Map(grupos.filter(g => g.linea != null).map(g => [g.linea as number, g]));
    for (const f of reubicar) {
      let destino = f.lineaReal != null ? porLineaTmp.get(f.lineaReal) : undefined;
      if (!destino) {
        destino = { nombre: f.lineaReal != null ? `Línea ${f.lineaReal}` : 'Sin línea', linea: f.lineaReal, ofertamos: true, filas: [] };
        grupos.push(destino);
        if (f.lineaReal != null) porLineaTmp.set(f.lineaReal, destino);
      }
      destino.filas.push(f);
    }
    grupos = grupos.filter(g => g.filas.length > 0).map(g => ({ ...g, filas: g.filas.map((f, i) => ({ ...f, item: i + 1 })) }));
  }

  const existentes = grupos.flatMap(g => g.filas);
  const porNombre = new Map(grupos.map(g => [g.nombre, g]));
  const porLinea = new Map(grupos.filter(g => g.linea != null).map(g => [g.linea as number, g]));
  let agregados = 0;

  for (const gNuevo of nuevo.grupos) {
    for (const f of gNuevo.filas) {
      if (f.lineaReal != null && lineasExcluidas.has(f.lineaReal)) continue;
      if (!f.detalle?.trim() || buscarMismoProducto(existentes, f.detalle)) continue;
      let destino = (f.lineaReal != null ? porLinea.get(f.lineaReal) : undefined) ?? porNombre.get(gNuevo.nombre);
      if (!destino) {
        destino = { nombre: gNuevo.nombre, linea: gNuevo.linea, ofertamos: true, filas: [] };
        grupos.push(destino);
        porNombre.set(gNuevo.nombre, destino);
        if (gNuevo.linea != null) porLinea.set(gNuevo.linea, destino);
      }
      const nueva = { ...f, id: Math.random().toString(36).slice(2, 10), item: destino.filas.length + 1 };
      destino.filas.push(nueva);
      existentes.push(nueva);
      agregados++;
    }
  }
  return { estado: { ...actual, grupos }, agregados, reclasificados };
}

/** MISMA cadena de fórmulas que la plantilla real (F→G→H→I→J→K) — ver cabecera del archivo. */
function calcularFormulas(f: FilaEditor, margenVenta: number) {
  const costoUnitario = f.valorConIva != null ? f.valorConIva / 1.19 : null;
  const costoTotal = f.cantidad != null && costoUnitario != null ? f.cantidad * costoUnitario : null;
  const precioUnitario = costoUnitario != null ? costoUnitario * (1 + margenVenta / 100) : null;
  const precioUnitarioSinDecimales = precioUnitario != null ? Math.trunc(precioUnitario) : null;
  const precioTotal = f.cantidad != null && precioUnitarioSinDecimales != null ? f.cantidad * precioUnitarioSinDecimales : null;
  return { costoUnitario, costoTotal, precioUnitarioSinDecimales, precioTotal };
}

/** Recargo con el que vende ESTA hoja: el suyo si lo tiene, si no el del costeo completo. */
function margenDeGrupo(grp: GrupoEditor, general: number): number {
  return Number.isFinite(grp.margenVenta as number) ? (grp.margenVenta as number) : general;
}
/** …y el de UNA fila: el suyo, si no el de su hoja, si no el global. Misma cascada de tres niveles
 *  que margenDeFila en app/lib/costeo-editor.ts (el backend recalcula todo con ella al guardar). */
function margenDeFila(f: FilaEditor, grp: GrupoEditor, general: number): number {
  return Number.isFinite(f.margenVenta as number) ? (f.margenVenta as number) : margenDeGrupo(grp, general);
}
/** El link del producto es obligatorio en toda fila ya COTIZADA (con "Valor c/IVA" cargado): sin
 *  él, el precio con el que se oferta no tiene de dónde volver a revisarse. Las filas todavía sin
 *  cotizar se pueden guardar igual — el costeo se llena de a poco. Espejo de filasSinLink en
 *  app/lib/costeo-editor.ts, que es donde el guardado se corta de verdad. */
function faltaLink(f: FilaEditor): boolean {
  return f.valorConIva != null && !esLinkDeProducto(f.link1) && !esLinkDeProducto(f.link2) && !esLinkDeProducto(f.link3);
}

/** ¿Cuántas filas de la hoja tienen recargo propio? Solo para avisarlo en el cuadro comparativo:
 *  ahí el "% Margen" es un promedio ponderado y no coincide con ningún número tipeado. */
function filasConMargenPropio(grp: GrupoEditor): number {
  return grp.filas.filter(f => Number.isFinite(f.margenVenta as number)).length;
}

function totalGrupo(grp: GrupoEditor, general: number) {
  return grp.filas.reduce((s, f) => s + (calcularFormulas(f, margenDeFila(f, grp, general)).precioTotal ?? 0), 0);
}
function costoGrupo(grp: GrupoEditor, general: number) {
  return grp.filas.reduce((s, f) => s + (calcularFormulas(f, margenDeFila(f, grp, general)).costoTotal ?? 0), 0);
}
/** ¿Qué tope (presupuesto NETO) le corresponde a ESTA hoja? En la mayoría de las licitaciones el
 *  presupuesto se publica POR LÍNEA y el global es solo la suma, así que comparar una línea contra
 *  el global da una distancia inventada — caso real 1271359-92-LE26: la canasta 2 contra el global
 *  ($33.040.000) parecía tener 40% de holgura, y contra SU tope ($21.478.000 c/IVA = $18.048.739
 *  neto) iba 8% por encima. Orden: lo escrito a mano → el de la línea de la hoja → el global, y
 *  este último SOLO si el costeo es de una sola hoja (si hay varias, el global no es tope de
 *  ninguna). Sin tope conocido devuelve null y el cuadro pide escribirlo. */
function presupuestoDeHoja(
  grp: GrupoEditor,
  grupos: GrupoEditor[],
  porLinea: Record<number, number>,
  global: number | null,
): { valor: number | null; fuente: 'manual' | 'linea' | 'global' | null } {
  if (grp.presupuestoNeto != null) return { valor: grp.presupuestoNeto, fuente: 'manual' };
  // Línea de la hoja: la suya, o la única línea real que tengan todas sus filas.
  const lineasDeFilas = new Set(grp.filas.map(f => f.lineaReal).filter((n): n is number => n != null));
  const linea = grp.linea ?? (lineasDeFilas.size === 1 ? [...lineasDeFilas][0] : null);
  if (linea != null && porLinea[linea] != null) return { valor: porLinea[linea], fuente: 'linea' };
  if (grupos.length === 1 && global != null) return { valor: global, fuente: 'global' };
  return { valor: null, fuente: null };
}

/** Costo REAL total de una fila — el que se pagó, no el cotizado. null si todavía no se cargó. */
function costoRealFila(f: FilaEditor): number | null {
  return f.cantidad != null && f.costoRealUnitario != null ? f.cantidad * f.costoRealUnitario : null;
}
function costoRealGrupo(grp: GrupoEditor) {
  return grp.filas.reduce((s, f) => s + (costoRealFila(f) ?? 0), 0);
}

// Estética de planilla real (pedido del usuario, 02-sep-2026): líneas de grilla finas en cada
// celda, letras de columna + números de fila como en Excel/Sheets, celda activa con borde azul
// grueso, celdas con fórmula con un tinte gris que las distingue de las que se tipean a mano.
const GRID_BORDE = '#d0d3d8';
const FUENTE_HOJA = "Calibri, 'Segoe UI', Arial, sans-serif";
const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];

function celdaInput(extra = '') {
  return `w-full h-full bg-transparent text-[12.5px] px-1.5 py-1 outline-none disabled:opacity-60 ` +
    `focus:ring-2 focus:ring-inset focus:ring-[#1a73e8] focus:bg-[#e8f0fe]/40 ${extra}`;
}

function CeldaNumero({ value, onChange, disabled }: {
  value: number | null; onChange: (v: number | null) => void; disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      disabled={disabled}
      className={celdaInput('text-right tabular-nums')}
      placeholder=""
    />
  );
}

/** Recargo de UNA fila. Vacía = hereda (muestra en gris el que le toca por la hoja/el costeo
 *  completo); con número propio queda en azul, para que se vea de un vistazo cuál se tocó a mano.
 *
 *  Lo tipeado lo lee parsearRecargo (acepta "110" y también "x2,1", que es como está escrito en el
 *  Excel del asistente). Se confirma con Enter o al salir, no en cada tecla: escribiendo "110" el
 *  paso intermedio "1" recalcularía la fila por un instante. Borrar el contenido devuelve la fila
 *  a lo que mande el costeo completo. */
function CeldaMargenFila({ propio, efectivo, onChange, disabled }: {
  propio: number | null;                 // el recargo tipeado en ESTA fila (null = hereda)
  efectivo: number;                      // el que se está aplicando de verdad
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const txtDe = (n: number) => (Math.round(n * 100) / 100).toString().replace('.', ',');
  const confirmar = () => {
    const txt = borrador;
    setBorrador(null);
    if (txt == null) return;
    const r = parsearRecargo(txt);
    if (r === undefined) return;                                 // basura: se descarta, queda lo que había
    onChange(r);                                                 // null = vaciar, vuelve a heredar
  };
  return (
    <input
      value={borrador ?? (propio == null ? '' : txtDe(propio))}
      disabled={disabled}
      onChange={e => setBorrador(e.target.value)}
      onBlur={confirmar}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setBorrador(null); }}
      placeholder={txtDe(efectivo)}
      title={propio == null
        ? `Hereda ${txtDe(efectivo)}% del costeo completo (×${(1 + efectivo / 100).toFixed(2).replace('.', ',')}). Escribe un número acá para venderle a ESTE ítem con otro margen — también vale "x2,1". Vacío = vuelve a heredar.`
        : `Margen propio de este ítem: ${txtDe(propio)}% sobre el costo (×${(1 + propio / 100).toFixed(2).replace('.', ',')}) = ${margenDeRecargo(propio).toFixed(1).replace('.', ',')}% sobre la venta. Borra la celda para volver al del costeo completo.`}
      className={`w-full h-full bg-transparent text-right text-[12.5px] tabular-nums px-1.5 py-1 outline-none disabled:opacity-60 ` +
        `focus:ring-2 focus:ring-inset focus:ring-[#1a73e8] focus:bg-[#e8f0fe]/40 ` +
        (propio == null ? 'text-zinc-400 placeholder:text-zinc-400' : 'font-semibold text-[#1a73e8]')}
    />
  );
}

function CeldaLink({ value, onChange, disabled, label }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; label: string;
}) {
  return (
    <div className="relative w-full h-full flex items-center">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder={label}
        className={celdaInput('pr-5 truncate')}
      />
      {value && (
        <button
          type="button"
          onClick={() => window.open(value, '_blank', 'noopener,noreferrer')}
          title={value}
          className="absolute right-0.5 p-0.5 text-zinc-400 hover:text-indigo-600"
        >
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  );
}

// ── Cuadro comparativo ────────────────────────────────────────────────────────────────────────
// El mismo bloque que el comercial arma a mano al pie del Excel (pedido del usuario, 03-sep-2026,
// con la planilla real a la vista): a la izquierda lo ESTIMADO que sale del costeo, a la derecha lo
// REAL una vez comprado, y la distancia contra el presupuesto de la licitación. Los números salen
// todos de calcularComparativo (app/lib/costeo-comparativo.ts) — acá solo se pintan.
const CUADRO_AZUL = '#dbe5f1';
const CUADRO_SALMON = '#fbdac4';
const CUADRO_VERDE = '#d9ead3';
const CUADRO_AMARILLO = '#fff3b0';

const fmtPct = (n: number | null) =>
  n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%`;

function FilaCuadro({ etiqueta, valor, fondo, fuerte, titulo, tono }: {
  etiqueta: string; valor: string; fondo?: string; fuerte?: boolean; titulo?: string;
  tono?: 'ok' | 'malo' | 'neutro';
}) {
  const color = tono === 'malo' ? 'text-rose-700' : tono === 'ok' ? 'text-emerald-700' : 'text-zinc-800';
  return (
    <tr title={titulo}>
      <td className="px-2 py-[3px] text-[11px] text-zinc-700 text-right whitespace-nowrap"
          style={{ border: `1px solid ${GRID_BORDE}`, background: fondo }}>{etiqueta}</td>
      <td className={`px-2 py-[3px] text-[11.5px] text-right tabular-nums ${fuerte ? 'font-bold' : 'font-semibold'} ${color}`}
          style={{ border: `1px solid ${GRID_BORDE}` }}>{valor}</td>
    </tr>
  );
}

/** El "% Margen s/venta" del cuadro es un RESULTADO… pero es el número por el que se decide, así
 *  que también se puede fijar al revés: escribes el margen que quieres y el editor despeja el
 *  recargo de esa hoja (03-sep-2026 — el usuario intentaba editar el 20% y no pasaba nada, porque
 *  era texto). Se confirma con Enter o al salir del campo, no en cada tecla: escribiendo "25" el
 *  paso intermedio "2" recalcularía todo el costeo por un instante. */
function CeldaMargenObjetivo({ valor, onFijar, disabled }: {
  valor: number | null; onFijar: (m: number) => void; disabled?: boolean;
}) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const confirmar = () => {
    const txt = borrador;
    setBorrador(null);
    if (txt == null || txt.trim() === '') return;
    const m = Number(txt.replace(',', '.'));
    if (recargoParaMargen(m) == null) return; // fuera de rango: se descarta y queda el valor real
    onFijar(m);
  };
  return (
    <input
      value={borrador ?? (valor == null ? '' : valor.toFixed(1).replace('.', ','))}
      disabled={disabled}
      onChange={e => setBorrador(e.target.value)}
      onBlur={confirmar}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setBorrador(null); }}
      placeholder="—"
      title="Editable: escribe el margen que quieres sobre la venta y el recargo sobre el costo se despeja solo (20% s/venta = 25% s/costo). Enter para confirmar."
      className="w-full bg-transparent text-right text-[11.5px] font-semibold text-zinc-800 tabular-nums outline-none focus:ring-2 focus:ring-inset focus:ring-[#1a73e8] focus:bg-[#e8f0fe]/40 disabled:opacity-60"
    />
  );
}

/** Input numérico con coma decimal (convención chilena) y al menos 2 decimales de precisión —
 *  pedido del usuario, 03-sep-2026: con type="number" no se podía escribir "14,45" (la coma no es
 *  un carácter válido ahí, y el separador que ese input entiende es el punto). Mismo patrón de
 *  borrador+confirmar-al-salir que CeldaMargenObjetivo: si se recalculara en cada tecla, escribir
 *  "14,45" pasaría por el estado intermedio "14," y el campo se pelearía con lo que el usuario está
 *  tipeando. El valor que se GUARDA conserva toda la precisión escrita; solo la que se MUESTRA se
 *  redondea a 2 decimales, para no ensuciar la celda con colas de punto flotante. */
function InputDecimalCL({ valor, onFijar, disabled, className, title }: {
  valor: number; onFijar: (v: number) => void; disabled?: boolean; className?: string; title?: string;
}) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const confirmar = () => {
    const txt = borrador;
    setBorrador(null);
    if (txt == null || txt.trim() === '') { onFijar(0); return; }
    const n = Number(txt.replace(',', '.'));
    if (!Number.isFinite(n)) return; // ilegible: se descarta y queda el valor anterior
    onFijar(n);
  };
  const mostrar = (n: number) => n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  return (
    <input
      inputMode="decimal"
      value={borrador ?? mostrar(valor)}
      disabled={disabled}
      title={title}
      onChange={e => setBorrador(e.target.value)}
      onBlur={confirmar}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setBorrador(null); }}
      className={className}
    />
  );
}

function CuadroComparativo({ comp, titulo, fuente, presupuestoManual, onPresupuesto, congelado, apagada, recargo, recargoPropio, itemsConRecargoPropio, onMargenObjetivo, ancho = false }: {
  comp: Comparativo;
  titulo: string;                                   // qué línea/hoja es este cuadro
  fuente: 'manual' | 'linea' | 'global' | null;     // de dónde salió el tope que se está usando
  presupuestoManual: number | null;                 // lo escrito a mano en ESTA hoja (null = heredado)
  onPresupuesto: (v: number | null) => void;
  congelado: boolean;
  apagada: boolean;                                 // hoja marcada "no ofertamos"
  recargo: number;                                  // % sobre el costo con que vende esta hoja
  recargoPropio: boolean;                           // ¿es suyo, o heredado del costeo completo?
  itemsConRecargoPropio: number;                    // filas que se venden con SU propio recargo
  onMargenObjetivo: (m: number) => void;            // fijar el margen s/venta → despeja el recargo
  /** DEBAJO de la planilla en vez de al costado (pantalla completa). Los tres bloques se reparten
   *  en columnas que se adaptan al ancho, en vez de apilarse en una tira de 268 px: en un notebook
   *  esa columna lateral se comía la planilla, que es lo que se está editando (pedido del usuario,
   *  03-sep-2026: "al lado acorta la pantalla, sobre todo en un notebook"). */
  ancho?: boolean;
}) {
  return (
    <div className={`bg-white border border-[#c6c6c6] shadow-sm p-2.5 ${ancho ? 'space-y-2' : 'space-y-2.5'} ${apagada ? 'opacity-60' : ''}`} style={{ fontFamily: FUENTE_HOJA }}>
      {/* Un cuadro POR HOJA: cada línea/canasta se compara contra SU tope, nunca las dos juntas
          contra el global (pedido del usuario, 03-sep-2026, con el Excel de 1271359-92-LE26 a la
          vista: ahí cada canasta tiene su propia celda "Presupuesto iva incluido"). */}
      <p className="text-[10.5px] font-bold text-zinc-500 px-1 flex items-center gap-1.5">
        <span className="truncate">{titulo}</span>
        {apagada && <span className="text-[9.5px] font-semibold text-zinc-400 flex-shrink-0">· no se oferta</span>}
      </p>
      {/* Al ancho: tres columnas que se adaptan. Angosto: exactamente el apilado de antes — las
          clases de separación se conservan una por una para no mover ni un pixel de esa vista. */}
      <div className={ancho ? 'grid gap-x-4 gap-y-2 grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-start' : 'space-y-2.5'}>
      {/* ── Estimado: lo que sale del costeo ───────────────────────────────────────────────── */}
      <div className={`${ancho ? 'min-w-0 ' : ''}space-y-2.5`}>
      <table className="border-collapse w-full">
        <tbody>
          <FilaCuadro etiqueta="Total venta C/IVA" valor={fmtCLP(Math.round(comp.ventaConIva))} fondo={CUADRO_AZUL} titulo="= Precio total neto × 1,19" />
          <FilaCuadro etiqueta="Venta IVA" valor={fmtCLP(Math.round(comp.ventaIva))} fondo={CUADRO_AZUL} titulo="IVA de la venta" />
          <FilaCuadro etiqueta="Total neto venta" valor={fmtCLP(Math.round(comp.ventaNeta))} fondo={CUADRO_AZUL} fuerte titulo="Suma de la columna Precio total neto (solo hojas ofertadas)" />
          <FilaCuadro etiqueta="Total costo neto" valor={fmtCLP(Math.round(comp.costoNetoEstimado))} fondo={CUADRO_SALMON} titulo="Suma de la columna Costo total neto — lo que se supuso al cotizar" />
          <FilaCuadro etiqueta="Utilidad total neta" valor={fmtCLP(Math.round(comp.utilidadEstimada))} fondo={CUADRO_VERDE} fuerte
                      tono={comp.utilidadEstimada < 0 ? 'malo' : 'ok'} titulo="= Total neto venta − Total costo neto" />
          {/* Única fila EDITABLE del bloque estimado: fijar acá el margen despeja el recargo. */}
          <tr title="Utilidad SOBRE LA VENTA. Se puede escribir: el recargo sobre el costo se ajusta solo.">
            <td className="px-2 py-[3px] text-[11px] text-zinc-700 text-right whitespace-nowrap" style={{ border: `1px solid ${GRID_BORDE}` }}>% Margen s/venta</td>
            <td className="px-2 py-[3px]" style={{ border: `1px solid ${GRID_BORDE}`, background: congelado ? undefined : '#fffdf3' }}>
              <CeldaMargenObjetivo valor={comp.margenEstimado} onFijar={onMargenObjetivo} disabled={congelado} />
            </td>
          </tr>
          <FilaCuadro etiqueta="% distancia del tope" valor={fmtPct(comp.distanciaPresupuesto)}
                      titulo="= 1 − (venta neta / presupuesto neto), igual que K20 del Excel. Negativo = la oferta se pasó del tope."
                      tono={comp.distanciaPresupuesto == null ? 'neutro' : comp.distanciaPresupuesto < 0 ? 'malo' : 'ok'} />
        </tbody>
      </table>

      {/* El recargo con que se llegó a ese margen — el número que de verdad multiplica cada fila
          (en el Excel va incrustado como literal dentro de la fórmula de la columna I: ×1,25 en la
          canasta 2, ×1,34 en la 1). Se muestra acá para que se lean los dos juntos. */}
      <p className="text-[10px] text-zinc-400 px-1 -mt-1.5">
        Recargo s/costo {recargo.toFixed(recargo % 1 === 0 ? 0 : 1).replace('.', ',')}%
        {recargoPropio ? ' · propio de esta hoja' : ' · del costeo completo'}
        {/* Con ítems de margen propio el "% Margen s/venta" de arriba es el promedio ponderado de
            la hoja, no el recargo de ninguna fila en particular — y fijarlo a mano no toca esas
            filas (son una decisión explícita). Se avisa acá para que el número no confunda. */}
        {itemsConRecargoPropio > 0 && (
          <span className="text-[#1a73e8]" title="Esos ítems tienen su propio recargo en la columna '% margen' de la planilla y no cambian al fijar el margen de acá. Borra esa celda para devolverlos al margen del costeo.">
            {' '}· {itemsConRecargoPropio} ítem{itemsConRecargoPropio === 1 ? '' : 's'} con margen propio
          </span>
        )}
      </p>
      </div>


      {/* Presupuesto de la licitación. Se TIPEA CON IVA y el neto se deriva — igual que el Excel
          ("Presupuesto iva incluido" en F15, y K14 = F15/1,19): las bases publican el monto con
          IVA, así que pedir el neto obligaba a dividir a mano. Se precarga con el publicado que
          trae la viabilidad (el mismo que usa la alerta "Sobre presupuesto" del Motor Comercial) y
          se corrige cuando el tope real es por canasta y no el global. */}
      <div className={`${ancho ? 'min-w-0 ' : ''}space-y-2.5`}>
      <div className="flex items-center gap-1.5 px-1 py-[2px]" style={{ background: CUADRO_AMARILLO }}>
        <span className="text-[10.5px] text-zinc-700 flex-1">Presupuesto iva incluido</span>
        <input
          type="number"
          value={presupuestoManual != null ? Math.round(presupuestoManual * IVA) : ''}
          disabled={congelado}
          placeholder={fuente !== 'manual' && comp.presupuestoConIva != null ? String(Math.round(comp.presupuestoConIva)) : 'escríbelo'}
          onChange={e => onPresupuesto(e.target.value === '' ? null : Number(e.target.value) / IVA)}
          className="w-[110px] bg-white/70 border border-amber-300 text-right text-[11px] font-bold text-zinc-800 px-1 py-[1px] outline-none tabular-nums disabled:opacity-60"
          title="Tope de ESTA línea, CON IVA. El neto (el que se compara contra la oferta) se calcula solo: monto / 1,19. Vacío = se usa el presupuesto de la línea que trae el informe."
        />
      </div>
      <p className="text-[10px] text-zinc-400 px-1 -mt-1.5 leading-snug">
        {comp.presupuestoNeto == null
          ? 'Sin tope conocido para esta línea: escríbelo (con IVA) para ver la distancia.'
          : <>Neto {fmtCLP(Math.round(comp.presupuestoNeto))}
              {fuente === 'linea' && ' · presupuesto de esta línea, del informe'}
              {fuente === 'global' && ' · presupuesto global de la licitación'}
              {fuente === 'manual' && ' · escrito a mano'}</>}
      </p>
      </div>

      {/* ── Real: lo que de verdad costó ───────────────────────────────────────────────────── */}
      <div className={ancho ? 'min-w-0' : 'pt-1.5 border-t border-dashed border-zinc-300'}>
        <p className="text-[10.5px] font-bold text-zinc-500 mb-1 px-1"
           title='Lo que se ofertó (Total neto) es un dato fijo. Lo demás de este bloque se calcula desde lo que en verdad pagaste al proveedor — se carga ítem por ítem en la planilla, columna "Costo unit. REAL", cuando llega la factura/OC. Mientras esa columna esté vacía, este bloque no tiene de dónde sacar el costo real y se ve en blanco: no es un error.'>
          COMPARATIVO REAL
        </p>
        <table className="border-collapse w-full">
          <tbody>
            <FilaCuadro etiqueta="Total neto" valor={fmtCLP(Math.round(comp.ventaNeta))} fondo={CUADRO_AZUL} titulo="La venta no cambia: es lo que se ofertó" />
            <FilaCuadro etiqueta="Total costo REAL" valor={comp.costoNetoReal != null ? fmtCLP(Math.round(comp.costoNetoReal)) : '—'} fondo={CUADRO_SALMON}
                        titulo="Suma de cantidad × costo real unitario de las filas que ya tienen costo real cargado" />
            <FilaCuadro etiqueta="Utilidad neta REAL" valor={comp.utilidadReal != null ? fmtCLP(Math.round(comp.utilidadReal)) : '—'} fondo={CUADRO_VERDE} fuerte
                        tono={comp.utilidadReal == null ? 'neutro' : comp.utilidadReal < 0 ? 'malo' : 'ok'} />
            <FilaCuadro etiqueta="% Margen s/venta" valor={fmtPct(comp.margenReal)}
                        tono={comp.margenReal == null ? 'neutro' : comp.margenReal < 0 ? 'malo' : 'neutro'} />
            <FilaCuadro etiqueta="% de Variación" valor={fmtPct(comp.variacionCosto)}
                        titulo="= (costo real − costo estimado) / costo estimado. Negativo = se compró más barato de lo cotizado."
                        tono={comp.variacionCosto == null ? 'neutro' : comp.variacionCosto > 0 ? 'malo' : 'ok'} />
          </tbody>
        </table>
        {/* Un costo real a medio cargar da una utilidad inflada — se dice en vez de dejar que el
            número se lea como cierre. El nombre de la columna citado acá tiene que calzar EXACTO
            con el que ve el usuario en la planilla (línea ~837: 'Costo unit. REAL') — antes decía
            "Costo real unit." (orden de palabras invertido) y el usuario, buscando esa columna,
            no la encontraba: reportó "no sé qué es esto, no se llena" el 03-sep-2026. */}
        <p className="text-[10px] text-zinc-400 mt-1 px-1 leading-snug">
          {comp.filasConCostoReal === 0
            ? 'Vacío porque falta el costo REAL: se llena a mano, ítem por ítem, en la columna "Costo unit. REAL" de la planilla (a la derecha de "Precio total neto") cuando compres. Mientras no la llenes, este bloque no tiene qué mostrar — no es un error.'
            : comp.realCompleto
              ? `Costo real completo — los ${comp.filasTotales} ítems cargados.`
              : `Parcial: ${comp.filasConCostoReal} de ${comp.filasTotales} ítems con "Costo unit. REAL" cargado (la utilidad real todavía sale alta).`}
        </p>
      </div>
      </div>
    </div>
  );
}

export function CosteoEditorCard({ negocioId, licitacionCodigo }: { negocioId: number; licitacionCodigo: string }) {
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [recargando, setRecargando] = useState(false);
  const [estado, setEstado] = useState<EstadoEditor | null>(null);
  const [guardado, setGuardado] = useState<EstadoEditor | null>(null); // última versión persistida — para detectar cambios sin guardar
  const [sinViabilidad, setSinViabilidad] = useState(false);
  // Presupuesto publicado en el informe de viabilidad — valor por defecto del cuadro comparativo
  // (el mismo que usa la alerta "Sobre presupuesto" del Motor Comercial).
  const [presupuestoPublicado, setPresupuestoPublicado] = useState<number | null>(null);
  // Tope NETO por línea que trae el informe (presupuesto_linea, ya filtrado de los "unitarios" en
  // el backend). Es el que manda: el global casi siempre es solo la suma de estos.
  const [presupuestosPorLinea, setPresupuestosPorLinea] = useState<Record<number, number>>({});
  const [migracionPendiente, setMigracionPendiente] = useState(false);
  const [congelado, setCongelado] = useState(false);
  const [grupoActivo, setGrupoActivo] = useState(0);
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [ultimoGuardado, setUltimoGuardado] = useState<string | null>(null);
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  // Fichas técnicas en proceso (04-sep-2026) — por id de fila, no un solo booleano: varias filas
  // pueden estar generando su ficha a la vez, cada una independiente.
  const [generandoFicha, setGenerandoFicha] = useState<Set<string>>(new Set());

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial/costeo-editor`);
      const d = await r.json();
      if (d.migracionPendiente) { setMigracionPendiente(true); return; }
      setSinViabilidad(!!d.sinViabilidad);
      setCongelado(!!d.congelado);
      const pub = Number(d.presupuestoPublicado); // ojo: Number(null) es 0, no NaN
      setPresupuestoPublicado(d.presupuestoPublicado != null && Number.isFinite(pub) && pub > 0 ? pub : null);
      setPresupuestosPorLinea(d.presupuestosPorLinea && typeof d.presupuestosPorLinea === 'object' ? d.presupuestosPorLinea : {});
      if (d.estado) {
        setEstado(d.estado);
        setGuardado(d.sinGuardar ? null : d.estado);
      }
    } catch { /* silencioso: no bloquear la pestaña por el costeo */ }
    finally { setCargando(false); }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Escape cierra la pantalla completa — como cualquier editor de verdad.
  useEffect(() => {
    if (!pantallaCompleta) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPantallaCompleta(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pantallaCompleta]);

  const dirty = useMemo(() => JSON.stringify(estado) !== JSON.stringify(guardado), [estado, guardado]);

  const actualizarFila = (gi: number, fi: number, patch: Partial<FilaEditor>) => {
    setEstado(prev => {
      if (!prev) return prev;
      const grupos = prev.grupos.map((g, i) => i !== gi ? g : {
        ...g, filas: g.filas.map((f, j) => j !== fi ? f : { ...f, ...patch }),
      });
      return { ...prev, grupos };
    });
  };

  const agregarFila = (gi: number) => {
    setEstado(prev => {
      if (!prev) return prev;
      const grupos = prev.grupos.map((g, i) => i !== gi ? g : { ...g, filas: [...g.filas, nuevaFila(g.filas.length + 1)] });
      return { ...prev, grupos };
    });
  };

  const alternarOfertamos = (gi: number) => {
    setEstado(prev => {
      if (!prev) return prev;
      const grupos = prev.grupos.map((g, i) => i !== gi ? g : { ...g, ofertamos: !g.ofertamos });
      return { ...prev, grupos };
    });
  };

  const eliminarFila = (gi: number, fi: number) => {
    setEstado(prev => {
      if (!prev) return prev;
      const grupos = prev.grupos.map((g, i) => i !== gi ? g : {
        ...g, filas: g.filas.filter((_, j) => j !== fi).map((f, k) => ({ ...f, item: k + 1 })),
      });
      return { ...prev, grupos };
    });
  };

  // Ficha técnica del producto desde su link (04-sep-2026) — usa el PRIMER link no vacío de la
  // fila (link1 → link2 → link3, en ese orden); el backend hace la extracción y sube el PDF a
  // Documentos Propios. No inventa nada: si la tienda no trae datos técnicos aprovechables, el
  // endpoint responde error y acá solo se avisa, sin subir un PDF vacío.
  const generarFichaProducto = async (f: FilaEditor) => {
    const link = f.link1?.trim() || f.link2?.trim() || f.link3?.trim();
    if (!link) { toast.info('Esta fila no tiene ningún link cargado'); return; }
    if (!f.detalle?.trim()) { toast.info('Esta fila no tiene descripción de producto'); return; }
    setGenerandoFicha(prev => new Set(prev).add(f.id));
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial/costeo-editor/ficha-producto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detalle: f.detalle, link }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) { toast.error(d.error || 'No se pudo generar la ficha técnica'); return; }
      const detalleExito = d.especificaciones > 0
        ? `${d.especificaciones} especificación${d.especificaciones === 1 ? '' : 'es'}`
        : d.tieneDescripcionLibre ? 'descripción del proveedor (sin tabla de specs)' : '';
      toast.success(`Ficha generada — ${d.nombre}`, detalleExito || undefined);
    } catch (e: any) {
      toast.error(e?.message || 'Error de red al generar la ficha');
    } finally {
      setGenerandoFicha(prev => { const next = new Set(prev); next.delete(f.id); return next; });
    }
  };

  const recargarDesdeViabilidad = async () => {
    if (!estado) return;
    setRecargando(true);
    try {
      // Trae SOLO la propuesta fresca de viabilidad (sin merge del servidor) y fusiona contra lo
      // que hay EN PANTALLA ahora mismo — así un "Separar por línea" recién hecho, o cualquier
      // otro cambio sin guardar, no se pierde al apretar Actualizar.
      const r = await fetch(`/api/negocios/${negocioId}/comercial/costeo-editor?soloViabilidad=1`);
      const d = await r.json();
      if (!r.ok || !d.estado) { toast.error('No se pudo leer la viabilidad'); return; }
      const { estado: fusionado, agregados, reclasificados } = fusionarLocal(estado, d.estado);
      setEstado(fusionado);
      const partes = [
        agregados > 0 && `${agregados} ítem(s) nuevo(s)`,
        reclasificados > 0 && `${reclasificados} reclasificado(s) a su línea correcta`,
      ].filter(Boolean);
      toast.success(partes.length ? partes.join(' · ') : 'Ya estaba al día con la viabilidad');
    } finally { setRecargando(false); }
  };

  const guardar = async () => {
    if (!estado) return;
    setGuardando(true);
    try {
      const r = await fetch(`/api/negocios/${negocioId}/comercial/costeo-editor`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(estado),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || 'No se pudo guardar el costeo'); return; }
      setGuardado(estado);
      setAlertas(d.alertas || []);
      setUltimoGuardado(new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }));
      if ((d.alertas || []).length > 0) toast.warning(`Costeo guardado — ${d.alertas.length} alerta(s) del Motor Comercial`, d.alertas.map((a: Alerta) => a.descripcion).join(' · '));
      else toast.success('Costeo guardado sin alertas');
    } finally { setGuardando(false); }
  };

  if (cargando) return (
    <div className="flex items-center gap-2 text-[13px] text-zinc-400 py-10 justify-center">
      <Loader2 size={14} className="animate-spin" /> Cargando costeo…
    </div>
  );

  if (migracionPendiente) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-800">
      Falta aplicar la <strong>migración 85</strong> (<code>docs/migration-85-costeo-editor.sql</code>) en la base de datos.
    </div>
  );

  if (!estado) return (
    <div className="bg-white rounded-xl border border-zinc-200 p-10 text-center">
      <Calculator size={26} className="text-zinc-300 mx-auto mb-3" />
      <p className="text-[13px] font-semibold text-zinc-700 mb-1">Sin ítems todavía</p>
      <p className="text-[12px] text-zinc-400 max-w-sm mx-auto">
        {sinViabilidad
          ? 'El costeo se arma desde el manifiesto de viabilidad. Corre el análisis de viabilidad y vuelve acá.'
          : 'No se encontraron productos en el manifiesto de esta licitación.'}
      </p>
    </div>
  );

  const grupos = estado.grupos;
  const margen = estado.margenVenta ?? MARGEN_VENTA_DEFECTO;
  // Los totales de arriba reflejan SOLO lo que se va a guardar de verdad — las hojas apagadas
  // (ofertamos=false) no cuentan, igual que en editorAFilasCosteo del backend.
  const gruposOfertados = grupos.filter(g => g.ofertamos);
  // Cada hoja vende con SU recargo (o el general si no tiene uno propio) — igual que el Excel, que
  // usa ×1,25 en una canasta y ×1,34 en la otra.
  const totalGeneral = gruposOfertados.reduce((s, grp) => s + totalGrupo(grp, margen), 0);
  const costoGeneral = gruposOfertados.reduce((s, grp) => s + costoGrupo(grp, margen), 0);
  // ¿Alguien pisó el recargo global más adentro? (una hoja, o un ítem suelto). Solo cambia cómo se
  // rotula el número de arriba: pasa a ser la BASE de la que cuelgan las excepciones, no "el"
  // recargo del costeo.
  const hojasConMargenPropio = grupos.filter(grp => Number.isFinite(grp.margenVenta as number)).length;
  const itemsConMargenPropio = grupos.reduce((n, grp) => n + filasConMargenPropio(grp), 0);
  const hayMargenPropio = hojasConMargenPropio > 0 || itemsConMargenPropio > 0;
  // Ítems cotizados a los que les falta el link — el guardado queda bloqueado hasta completarlos
  // (el backend corta igual, ver filasSinLink). Solo se miran las hojas que SÍ se ofertan.
  const sinLink = gruposOfertados.flatMap(grp =>
    grp.filas.filter(faltaLink).map(f => ({ hoja: grp.nombre, detalle: (f.detalle || '').trim() || `fila ${f.item}` })),
  );
  // ¿Vale la pena ofrecer "Separar por línea"? Solo si sigue todo en una sola hoja, esa hoja
  // mezcla ≥2 líneas reales distintas, Y ADEMÁS al menos 2 de esas líneas tienen su PROPIO
  // presupuesto independiente (presupuestosPorLinea) — la señal real de que las bases las tratan
  // como canastas separadas (caso 1271359-92-LE26: canasta 1 tope $17.839.600, canasta 2 tope
  // $21.478.000, cada una con su propio máximo).
  //
  // Sin ese segundo chequeo, un manifiesto con varias "líneas" dispara el aviso aunque sean puro
  // artefacto del documento fuente: caso real 2408-162-LE26 (mobiliario Municipalidad de Los
  // Ángeles), el Anexo Económico numera los ítems "1.1..1.8" / "2.1..2.20" por EDIFICIO de
  // entrega (Oficinas Fomento / Dirección de Medio Ambiente), no por lote licitable — la
  // licitación es GLOBAL con un solo presupuesto de $24M para todo, sin tope por edificio, y
  // "separar por línea" ahí rompería el costeo en vez de ayudarlo.
  const lineasEnUnaHoja = grupos.length === 1
    ? new Set(grupos[0].filas.map(f => f.lineaReal).filter((n): n is number => n != null))
    : new Set<number>();
  const lineasConPresupuestoPropio = [...lineasEnUnaHoja].filter(n => presupuestosPorLinea[n] != null).length;
  const hayCanastasSeparables = lineasEnUnaHoja.size >= 2 && lineasConPresupuestoPropio >= 2;

  // ── Cuadro comparativo, UNO POR HOJA ────────────────────────────────────────────────────────
  // El presupuesto se publica por línea, así que cada línea/canasta se compara contra SU tope: un
  // cuadro que mezclara las dos contra el global daría una distancia que no existe (pedido del
  // usuario, 03-sep-2026). Solo filas con algún dato, igual que editorAFilasCosteo del backend
  // (una fila recién agregada y vacía no debe contar como "ítem sin costo real").
  const cuadroDeHoja = (grp: GrupoEditor, gi: number, ancho = false) => {
    const filas = grp.filas.filter(f => f.detalle.trim() !== '' || f.cantidad != null || f.valorConIva != null);
    const { valor, fuente } = presupuestoDeHoja(grp, grupos, presupuestosPorLinea, presupuestoPublicado);
    const recargo = margenDeGrupo(grp, margen);
    const comp = calcularComparativo({
      ventaNeta: totalGrupo(grp, margen),
      costoNetoEstimado: costoGrupo(grp, margen),
      costoNetoReal: costoRealGrupo(grp),
      filasConCostoReal: filas.filter(f => f.costoRealUnitario != null).length,
      filasTotales: filas.length,
      presupuestoNeto: valor,
    });
    return (
      <CuadroComparativo
        key={grp.nombre}
        ancho={ancho}
        comp={comp}
        titulo={grp.linea != null ? `Línea ${grp.linea}` : grp.nombre}
        fuente={fuente}
        presupuestoManual={grp.presupuestoNeto ?? null}
        apagada={!grp.ofertamos}
        congelado={congelado}
        recargo={recargo}
        recargoPropio={Number.isFinite(grp.margenVenta as number)}
        itemsConRecargoPropio={filasConMargenPropio(grp)}
        onPresupuesto={v => setEstado(prev => prev ? {
          ...prev, grupos: prev.grupos.map((x, i) => i !== gi ? x : { ...x, presupuestoNeto: v }),
        } : prev)}
        // Fijar el margen s/venta escribe el recargo de ESTA hoja (no el del costeo completo): así
        // dos canastas pueden venderse con márgenes distintos, como en el Excel.
        onMargenObjetivo={m => setEstado(prev => {
          const r = recargoParaMargen(m);
          if (!prev || r == null) return prev;
          return { ...prev, grupos: prev.grupos.map((x, i) => i !== gi ? x : { ...x, margenVenta: r }) };
        })}
      />
    );
  };

  // ── Cabecera + resumen (siempre visible, dentro o fuera de pantalla completa) ──────────────
  const Cabecera = (
    <div className="bg-white p-4" style={pantallaCompleta ? { borderBottom: `1px solid ${GRID_BORDE}` } : undefined}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Calculator size={16} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-zinc-900 leading-tight">Costeo · {licitacionCodigo}</h2>
            <p className="text-[11.5px] text-zinc-400">
              {estado.modalidad === 'suma_alzada' ? 'Global (suma alzada)' : estado.modalidad === 'por_linea' ? `Por línea — ${grupos.length} línea(s)` : `Por categoría — ${grupos.length} grupo(s)`}
              {ultimoGuardado && ` · guardado ${ultimoGuardado}`}
              {dirty && <span className="text-amber-600 font-semibold"> · cambios sin guardar</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Se rotula "Recargo s/costo" y no "Margen" a secas (03-sep-2026): es un multiplicador
              del costo (×1,25), NO la utilidad sobre la venta que muestra el cuadro comparativo.
              Con el rótulo viejo, un recargo de 25% arriba y un margen de 20% abajo parecían una
              contradicción. El equivalente se muestra al lado para que se lean juntos. */}
          <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-zinc-500 px-2 py-1.5 border border-zinc-200 rounded-lg" title="Recargo SOBRE EL COSTO: precio de venta = costo neto × (1 + recargo). Es el ×1,27 de la plantilla, editable. No confundir con el '% Margen' del cuadro comparativo, que es la utilidad sobre la VENTA.">
            {hayMargenPropio ? 'Recargo base' : 'Recargo s/costo'}
            <InputDecimalCL
              valor={margen}
              disabled={congelado}
              onFijar={v => setEstado(prev => prev ? { ...prev, margenVenta: v } : prev)}
              title="Admite decimales con coma, ej. 14,45"
              className="w-14 bg-transparent text-right font-bold text-zinc-800 outline-none disabled:opacity-60"
            />
            %
            {/* margen sobre la venta = recargo / (1 + recargo) — el mismo número que sale en el
                cuadro comparativo, dicho acá para que no parezcan dos cifras en desacuerdo. */}
            <span className="text-[10.5px] font-normal text-zinc-400" title="Equivalencia: un recargo del 25% sobre el costo deja una utilidad del 20% sobre la venta. Las hojas —y los ítems— con recargo propio no siguen este número.">
              = {margenDeRecargo(margen).toFixed(1).replace('.', ',')}% s/venta
              {hayMargenPropio && ` · ${[
                hojasConMargenPropio ? `${hojasConMargenPropio} hoja${hojasConMargenPropio === 1 ? '' : 's'}` : '',
                itemsConMargenPropio ? `${itemsConMargenPropio} ítem${itemsConMargenPropio === 1 ? '' : 's'}` : '',
              ].filter(Boolean).join(' y ')} con recargo propio`}
            </span>
          </label>
          <button
            onClick={recargarDesdeViabilidad}
            disabled={recargando || congelado}
            title="Trae los ítems nuevos que tenga la viabilidad, sin tocar lo que ya llenaste"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-lg border border-zinc-200 transition-colors disabled:opacity-50"
          >
            {recargando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Actualizar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || congelado || !dirty || sinLink.length > 0}
            title={sinLink.length > 0
              ? `Falta el link del producto en ${sinLink.length} ítem(s) ya cotizado(s). Pégalo en la columna Link 1 de cada uno para poder guardar.`
              : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-40"
          >
            {guardando ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Guardar
          </button>
          {pantallaCompleta ? (
            <button onClick={() => setPantallaCompleta(false)} title="Cerrar (Esc)" className="p-1.5 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg transition-colors">
              <X size={16} />
            </button>
          ) : (
            <button
              onClick={() => setPantallaCompleta(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
            >
              <Maximize2 size={12} /> Pantalla completa
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-zinc-500 mt-2">
        <span>Costo total: <span className="font-bold text-zinc-700">{fmtCLP(costoGeneral)}</span></span>
        <span>Precio total: <span className="font-bold text-emerald-700">{fmtCLP(totalGeneral)}</span></span>
        {gruposOfertados.length < grupos.length && (
          <span className="text-zinc-400">({grupos.length - gruposOfertados.length} línea(s) apagada(s), no cuentan)</span>
        )}
      </div>

      {/* Todo ítem cotizado tiene que decir DE DÓNDE salió su precio. Se avisa acá, con nombre y
          apellido de los que faltan, en vez de dejar que el usuario descubra el bloqueo recién al
          apretar Guardar. */}
      {!congelado && sinLink.length > 0 && (
        <div className="mt-2 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          <LinkIcon size={13} className="text-rose-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-rose-800 flex-1">
            <span className="font-semibold">Falta el link del producto en {sinLink.length} ítem(s) cotizado(s).</span>{' '}
            Pega en <span className="font-semibold">Link 1</span> la página donde cotizaste cada uno — sin eso no se puede guardar el costeo.
            <span className="block text-[11px] text-rose-600/90 mt-0.5">
              {sinLink.slice(0, 4).map(f => f.detalle.slice(0, 45)).join(' · ')}{sinLink.length > 4 ? ` · y ${sinLink.length - 4} más` : ''}
            </span>
          </p>
        </div>
      )}

      {/* Las bases pueden armar canastas/líneas con total propio aunque el análisis haya
          clasificado la licitación como global — caso real 1271359-92-LE26. Separar deja cada
          línea en su hoja, con su propio interruptor "¿ofertamos?". Solo se ofrece cuando esas
          líneas tienen presupuesto propio (ver hayCanastasSeparables arriba) — si no, lo más
          probable es que sean solo un artefacto de numeración del documento fuente. */}
      {!congelado && hayCanastasSeparables && (
        <div className="mt-2 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
          <p className="text-[11.5px] text-amber-800 flex-1">
            Esta hoja mezcla {lineasEnUnaHoja.size} líneas distintas ({[...lineasEnUnaHoja].sort((a, b) => a - b).join(', ')}). Si las bases las tratan por separado (ej. "Canasta N°"), sepáralas para poder ofertar solo algunas.
          </p>
          <button
            onClick={() => setEstado(prev => prev ? separarPorLinea(prev) : prev)}
            className="flex items-center gap-1 flex-shrink-0 text-[11.5px] font-bold text-amber-800 hover:text-amber-950 bg-white border border-amber-300 rounded px-2 py-1"
          >
            <SplitSquareHorizontal size={12} /> Separar por línea
          </button>
        </div>
      )}

      {alertas && alertas.length > 0 && (
        <div className="mt-2 space-y-1">
          {alertas.map(a => (
            <p key={a.codigo} className="text-[11.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span><span className="font-semibold">{a.descripcion}.</span> {a.detalle}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );

  const giActivo = Math.min(grupoActivo, grupos.length - 1);
  const g = grupos[giActivo];

  // ── La "hoja" ────────────────────────────────────────────────────────────────────────────
  const Hoja = (
    <div className="border border-[#c6c6c6] bg-white shadow-sm flex-1 min-h-0 min-w-0 flex flex-col" style={{ fontFamily: FUENTE_HOJA }}>
      <div className="overflow-auto flex-1">
        <table className="border-collapse w-full" style={{ minWidth: 1452 }}>
          <colgroup>
            <col style={{ width: 34 }} />{/* # de fila */}
            <col style={{ width: 56 }} />{/* A Línea */}
            <col style={{ minWidth: 220 }} />{/* B Detalle */}
            <col style={{ width: 64 }} />{/* C Unidad */}
            <col style={{ width: 110 }} />{/* D Sku */}
            <col style={{ width: 76 }} />{/* E Cantidad */}
            <col style={{ width: 100 }} />{/* F Valor c/IVA */}
            <col style={{ width: 96 }} />{/* G Costo unit. neto */}
            <col style={{ width: 96 }} />{/* H Costo total neto */}
            <col style={{ width: 72 }} />{/* I % margen (por fila) */}
            <col style={{ width: 96 }} />{/* J Precio unit. venta */}
            <col style={{ width: 100 }} />{/* K Precio total neto */}
            <col style={{ width: 104 }} />{/* L Costo unitario REAL */}
            <col style={{ width: 104 }} />{/* M Costo total neto REAL */}
            <col style={{ width: 78 }} />{/* N VARIACION */}
            <col style={{ width: 100 }} />{/* O Link 1 */}
            <col style={{ width: 100 }} />{/* P Link 2 */}
            <col style={{ width: 100 }} />{/* Q Link 3 */}
            <col style={{ width: 28 }} />{/* borrar fila */}
          </colgroup>
          <thead className="sticky top-0 z-10">
            {/* Fila de letras de columna — puro decorado, como el chrome de Excel/Sheets. */}
            <tr style={{ background: '#f3f2f1' }}>
              <th className="h-[18px] text-[9px] font-normal text-zinc-400" style={{ border: `1px solid ${GRID_BORDE}` }} />
              {LETRAS.map(l => (
                <th key={l} className="h-[18px] text-[9px] font-normal text-zinc-400 text-center select-none" style={{ border: `1px solid ${GRID_BORDE}` }}>{l}</th>
              ))}
            </tr>
            {/* Fila 1 de la hoja: los encabezados de columna, iguales a la plantilla real. */}
            <tr style={{ background: '#f3f2f1' }}>
              <th className="text-[11px] font-normal text-zinc-500 text-center" style={{ border: `1px solid ${GRID_BORDE}` }}>1</th>
              {([
                ['Línea', ''], ['Detalle de producto', ''], ['Unidad', ''], ['Sku proveedor', ''],
                ['Cantidad', ''], ['Valor c/IVA', ''],
                ['Costo unit. neto', ''], ['Costo total neto', ''],
                // Margen POR ÍTEM: normalmente vacío (hereda el del costeo completo, que es el que
                // manda). Se llena solo cuando un producto se vende con otro recargo, como en el
                // Excel del asistente — 1114-12-LE26 tiene =G4*2.1 en la plataforma satelital y
                // =G5*2 en el sensor, en la misma hoja.
                ['% margen', 'Recargo sobre el costo de ESTE ítem. Vacío = usa el margen del costeo completo (el número gris es el que se está aplicando). Escribe otro número —o "x2,1"— para venderle a este ítem con margen propio.'],
                ['Precio unit. venta', ''], ['Precio total neto', ''],
                // Único encabezado con tooltip propio: es la ÚNICA columna que se tipea a mano en
                // esta sección y de la que depende todo el bloque "COMPARATIVO REAL" del costado —
                // el usuario no la ubicaba porque el aviso de ese bloque la nombraba al revés
                // ("Costo real unit.") hasta el 03-sep-2026.
                ['Costo unit. REAL', 'Se tipea a mano cuando llega la factura/OC del proveedor. Alimenta el bloque "COMPARATIVO REAL" del costado — mientras esté vacía, ese bloque no tiene costo real que mostrar.'],
                ['Costo total REAL', ''], ['VARIACIÓN', ''], ['Link 1', ''], ['Link 2', ''], ['Link 3', ''],
              ] as const).map(([h, tip]) => (
                <th key={h} title={tip || undefined} className="px-1.5 py-1 text-left text-[11.5px] font-bold text-zinc-800 whitespace-nowrap" style={{ border: `1px solid ${GRID_BORDE}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.filas.map((f, fi) => {
              const margenFila = margenDeFila(f, g, margen);
              const leFaltaLink = g.ofertamos && faltaLink(f);
              const { costoUnitario, costoTotal, precioUnitarioSinDecimales, precioTotal } = calcularFormulas(f, margenFila);
              const bajoCosto = costoTotal != null && precioTotal != null && precioTotal < costoTotal;
              // VARIACIÓN de la fila — misma fórmula que la columna N del Excel: =(L/G)−1, en %.
              const variacion = f.costoRealUnitario != null && costoUnitario ? (f.costoRealUnitario / costoUnitario - 1) * 100 : null;
              const celda = { border: `1px solid ${GRID_BORDE}`, height: 24 };
              const celdaFormula = { ...celda, background: bajoCosto ? '#fdeceb' : '#f8f9fb' };
              return (
                <tr key={f.id} className="group">
                  <td className="text-[11px] text-zinc-400 text-center" style={{ ...celda, background: '#f3f2f1' }}>{fi + 2}</td>
                  <td style={celda} className="p-0" title="Número REAL de línea de la licitación — cruza contra el Auditor Técnico. Corrígelo si no calza.">
                    <CeldaNumero value={f.lineaReal} onChange={v => actualizarFila(grupoActivo, fi, { lineaReal: v })} disabled={congelado} />
                  </td>
                  <td style={celda} className="p-0">
                    <input value={f.detalle} onChange={e => actualizarFila(grupoActivo, fi, { detalle: e.target.value })} disabled={congelado} className={celdaInput()} placeholder="Descripción del ítem" />
                  </td>
                  <td style={celda} className="p-0">
                    <input value={f.unidad} onChange={e => actualizarFila(grupoActivo, fi, { unidad: e.target.value })} disabled={congelado} className={celdaInput()} />
                  </td>
                  <td style={celda} className="p-0">
                    <input value={f.skuProveedor} onChange={e => actualizarFila(grupoActivo, fi, { skuProveedor: e.target.value })} disabled={congelado} className={celdaInput()} placeholder="Tienda / SKU" />
                  </td>
                  <td style={celda} className="p-0"><CeldaNumero value={f.cantidad} onChange={v => actualizarFila(grupoActivo, fi, { cantidad: v })} disabled={congelado} /></td>
                  <td style={celda} className="p-0"><CeldaNumero value={f.valorConIva} onChange={v => actualizarFila(grupoActivo, fi, { valorConIva: v })} disabled={congelado} /></td>
                  <td style={celdaFormula} className="px-1.5 text-right text-[12.5px] tabular-nums text-zinc-600" title="= Valor c/IVA / 1.19">{fmtCLP(costoUnitario != null ? Math.round(costoUnitario) : null)}</td>
                  <td style={celdaFormula} className="px-1.5 text-right text-[12.5px] tabular-nums text-zinc-600" title="= Cantidad × Costo unitario">{fmtCLP(costoTotal)}</td>
                  {/* Margen de ESTA fila — la única celda de la cadena de fórmulas que se puede
                      pisar a mano. Vacía = hereda; con número propio, azul. */}
                  <td style={{ ...celda, background: f.margenVenta != null ? '#e8f0fe' : undefined }} className="p-0">
                    <CeldaMargenFila
                      propio={Number.isFinite(f.margenVenta as number) ? (f.margenVenta as number) : null}
                      efectivo={margenFila}
                      onChange={v => actualizarFila(grupoActivo, fi, { margenVenta: v })}
                      disabled={congelado}
                    />
                  </td>
                  <td style={celdaFormula} className="px-1.5 text-right text-[12.5px] tabular-nums text-zinc-600" title={`= Costo unitario × (1 + ${margenFila}%)`}>{fmtCLP(precioUnitarioSinDecimales)}</td>
                  <td style={celdaFormula} className={`px-1.5 text-right text-[12.5px] font-semibold tabular-nums ${bajoCosto ? 'text-rose-600' : 'text-emerald-700'}`} title="= Cantidad × Precio unitario">{fmtCLP(precioTotal)}</td>
                  {/* "SECCIÓN COMPRAS" del Excel (columnas L, M y N de la plantilla real): el costo
                      unitario REAL se tipea cuando llega la factura/OC —es el único dato del cuadro
                      que no se deriva de nada— y las otras dos salen solas, con las MISMAS fórmulas:
                        M = L × E (costo total real)     N = (L / G) − 1 (variación contra lo cotizado) */}
                  <td style={{ ...celda, background: f.costoRealUnitario != null ? '#fff7e6' : undefined }} className="p-0"
                      title="Costo unitario NETO realmente pagado al proveedor. Se llena después de comprar; alimenta el bloque REAL del cuadro comparativo.">
                    <CeldaNumero value={f.costoRealUnitario} onChange={v => actualizarFila(grupoActivo, fi, { costoRealUnitario: v })} disabled={congelado} />
                  </td>
                  <td style={celdaFormula} className="px-1.5 text-right text-[12.5px] tabular-nums text-zinc-600" title="= Cantidad × Costo unitario REAL">{fmtCLP(costoRealFila(f))}</td>
                  <td style={celdaFormula} className={`px-1.5 text-right text-[12.5px] tabular-nums font-semibold ${variacion == null ? 'text-zinc-400' : variacion > 0 ? 'text-rose-600' : 'text-emerald-700'}`}
                      title="= (Costo unitario REAL / Costo unitario neto) − 1. Positivo = salió más caro de lo cotizado.">{fmtPct(variacion)}</td>
                  {/* Link 1 en rojo mientras la fila esté cotizada y sin respaldo: es la celda que
                      hay que llenar para poder guardar (ver faltaLink). */}
                  <td style={{ ...celda, background: leFaltaLink ? '#fdeceb' : undefined }} className="p-0"
                      title={leFaltaLink ? 'Este ítem ya tiene precio pero no dice de dónde salió. Pega acá el link del producto — sin eso el costeo no se guarda.' : undefined}>
                    <CeldaLink value={f.link1} onChange={v => actualizarFila(grupoActivo, fi, { link1: v })} disabled={congelado} label={leFaltaLink ? 'Falta el link' : 'Link 1'} />
                  </td>
                  <td style={celda} className="p-0"><CeldaLink value={f.link2} onChange={v => actualizarFila(grupoActivo, fi, { link2: v })} disabled={congelado} label="Link 2" /></td>
                  <td style={celda} className="p-0"><CeldaLink value={f.link3} onChange={v => actualizarFila(grupoActivo, fi, { link3: v })} disabled={congelado} label="Link 3" /></td>
                  <td style={{ border: `1px solid ${GRID_BORDE}` }} className="text-center whitespace-nowrap">
                    {(f.link1 || f.link2 || f.link3) && (
                      generandoFicha.has(f.id) ? (
                        <span className="inline-block p-0.5 text-indigo-400" title="Generando ficha técnica…">
                          <Loader2 size={11} className="animate-spin" />
                        </span>
                      ) : (
                        <button
                          onClick={() => generarFichaProducto(f)}
                          title="Generar ficha técnica desde el primer link cargado (sube un PDF a Documentos Propios)"
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-300 hover:text-indigo-600 transition-opacity"
                        >
                          <FileSearch size={11} />
                        </button>
                      )
                    )}
                    {!congelado && (
                      <button onClick={() => eliminarFila(grupoActivo, fi)} className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-300 hover:text-rose-600 transition-opacity">
                        <Trash2 size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {g.filas.length === 0 && (
              <tr><td colSpan={19} className="px-4 py-6 text-center text-zinc-400 text-[12px]" style={{ border: `1px solid ${GRID_BORDE}` }}>Sin ítems en esta hoja</td></tr>
            )}
            {/* Fila de totales — mismo lugar que la fila SUMA() de la plantilla de Excel. Cada
                suma queda justo bajo SU columna (Costo total neto / Precio total neto). */}
            <tr>
              <td className="text-[11px] text-zinc-400 text-center" style={{ border: `1px solid ${GRID_BORDE}`, background: '#f3f2f1', height: 26 }}>{g.filas.length + 2}</td>
              <td colSpan={6} className="px-1.5 text-[11.5px] font-bold text-zinc-500" style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5' }}>TOTALES DE ESTA HOJA</td>
              <td style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5' }} />
              <td className="px-1.5 text-right text-[12.5px] font-bold text-zinc-800 tabular-nums" style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5', borderTop: `2px solid ${GRID_BORDE}` }}>{fmtCLP(costoGrupo(g, margen))}</td>
              <td colSpan={2} style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5' }} />
              <td className="px-1.5 text-right text-[12.5px] font-bold text-emerald-700 tabular-nums" style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5', borderTop: `2px solid ${GRID_BORDE}` }}>{fmtCLP(totalGrupo(g, margen))}</td>
              <td style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5' }} />
              <td className="px-1.5 text-right text-[12.5px] font-bold text-amber-700 tabular-nums" title="Costo REAL total de esta hoja (solo las filas que ya tienen costo real cargado)" style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5', borderTop: `2px solid ${GRID_BORDE}` }}>{costoRealGrupo(g) > 0 ? fmtCLP(costoRealGrupo(g)) : '—'}</td>
              {/* Variación de la hoja: sobre los TOTALES, no el promedio de las filas (el AVERAGE
                  del Excel le da el mismo peso a un ítem de $80.000 que a uno de $3.000.000). */}
              <td className="px-1.5 text-right text-[12.5px] font-bold tabular-nums text-zinc-600" title="= (Costo total REAL / Costo total neto) − 1, sobre los totales de la hoja" style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5', borderTop: `2px solid ${GRID_BORDE}` }}>
                {costoRealGrupo(g) > 0 && costoGrupo(g, margen) > 0 ? fmtPct((costoRealGrupo(g) / costoGrupo(g, margen) - 1) * 100) : '—'}
              </td>
              <td colSpan={4} style={{ border: `1px solid ${GRID_BORDE}`, background: '#eef1f5' }} />
            </tr>
          </tbody>
        </table>
      </div>
      {!congelado && (
        <div className="px-2 py-1.5 border-t border-[#c6c6c6] flex-shrink-0" style={{ background: '#f9fafb' }}>
          <button onClick={() => agregarFila(grupoActivo)} className="flex items-center gap-1 text-[11.5px] font-semibold text-zinc-500 hover:text-indigo-700">
            <Plus size={12} /> Agregar fila
          </button>
        </div>
      )}

      {/* ── Pestañas de hoja, abajo — igual que Excel/Sheets. Cada una trae su propio check
          "¿ofertamos?" — como el selector de líneas a ofertar del resto de la app, pero acá
          alcanza con marcar la hoja: ver GrupoEditor.ofertamos. ─────────────────────────── */}
      {grupos.length > 1 && (
        <div className="flex items-end gap-1 px-1.5 pt-1.5 pb-1 border-t border-[#c6c6c6] overflow-x-auto flex-shrink-0" style={{ background: '#f3f2f1' }}>
          {grupos.map((grp, i) => (
            <div
              key={grp.nombre}
              className={`flex-shrink-0 flex items-center gap-1.5 pl-2 pr-3 py-1.5 text-[11.5px] font-semibold transition-colors cursor-pointer ${
                i === grupoActivo
                  ? 'bg-white text-zinc-900 border border-b-0 border-[#c6c6c6] rounded-t-sm -mb-px'
                  : 'text-zinc-500 hover:text-zinc-800 hover:bg-white/60 rounded-t-sm'
              } ${!grp.ofertamos ? 'opacity-50' : ''}`}
              onClick={() => setGrupoActivo(i)}
            >
              {!congelado && (
                <input
                  type="checkbox"
                  checked={grp.ofertamos}
                  onClick={e => e.stopPropagation()}
                  onChange={() => alternarOfertamos(i)}
                  title="¿Ofertamos esta línea?"
                  className="h-3 w-3 accent-emerald-600"
                />
              )}
              <span className={!grp.ofertamos ? 'line-through' : ''}>{grp.linea != null ? `Línea ${grp.linea}` : grp.nombre}</span>
            </div>
          ))}
          {!congelado && (
            <button
              onClick={() => setEstado(prev => prev ? unirEnUnaHoja(prev) : prev)}
              title="Vuelve a juntar todas las hojas ofertadas en una sola"
              className="flex-shrink-0 flex items-center gap-1 ml-auto px-2 py-1 text-[11px] font-semibold text-zinc-400 hover:text-zinc-700"
            >
              <Combine size={11} /> Unir en una hoja
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (pantallaCompleta) {
    return createPortal(
      <div className="fixed inset-0 z-[100] bg-zinc-100 flex flex-col">
        {Cabecera}
        {/* LA PLANILLA ARRIBA, A TODO EL ANCHO, Y EL CUADRO COMPARATIVO DEBAJO (03-sep-2026).
            Antes el cuadro era una columna fija de 268 px al costado —imitando dónde vive en el
            Excel del comercial—, y en un notebook le quitaba ese ancho justo a lo que se está
            editando: la planilla (1.380 px de columnas) quedaba apretada y encima se desbordaba
            POR ENCIMA del cuadro, porque el contenedor de la hoja no tenía `min-w-0` y un flex
            child con una tabla adentro no se encoge sin eso. Abajo, el mismo cuadro se reparte en
            columnas que se adaptan al ancho disponible y ocupa menos alto que la tira vertical. */}
        <div className="flex-1 min-h-0 p-3 flex flex-col gap-3">
          <div className="flex-1 min-h-0 min-w-0 flex">{Hoja}</div>
          {/* El cuadro de la hoja que se está mirando — el de las otras líneas se ve al cambiar de
              pestaña, para no comparar dos topes distintos en el mismo lugar. */}
          <div className="flex-shrink-0 max-h-[42vh] overflow-y-auto">{cuadroDeHoja(g, giActivo, true)}</div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="space-y-4 fade-in">
      {congelado && (
        <div className="bg-zinc-800 text-white rounded-xl px-4 py-3 flex items-center gap-2.5">
          <ShieldCheck size={16} className="text-zinc-300 flex-shrink-0" />
          <p className="text-[12.5px] font-bold">Congelado — esta licitación ya se postuló, el costeo quedó de solo lectura.</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-zinc-200">{Cabecera}</div>

      {/* Vista previa chica — el editor de verdad vive en pantalla completa (pedido del usuario,
          02-sep-2026: una planilla de más de 8 columnas no cabe cómoda en el panel angosto del
          negocio). Clic en cualquier parte abre lo mismo que "Pantalla completa" de arriba. */}
      <button
        onClick={() => setPantallaCompleta(true)}
        className="w-full bg-white rounded-xl border border-dashed border-zinc-300 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors p-8 flex flex-col items-center gap-2 text-center"
      >
        <Maximize2 size={20} className="text-zinc-400" />
        <p className="text-[13px] font-semibold text-zinc-700">Abrir la planilla de costeo</p>
        <p className="text-[11.5px] text-zinc-400 max-w-sm">
          {grupos.reduce((s, x) => s + x.filas.length, 0)} ítem(s)
          {grupos.length > 1 ? ` en ${grupos.length} hoja(s)` : ''} · se edita en pantalla completa, como el Excel
        </p>
      </button>

      {/* Los cuadros comparativos se ven también acá, sin abrir la planilla: es el resumen que el
          comercial mira para decidir. Uno por línea, cada uno contra SU tope. */}
      {/* Una tarjeta por hoja, en columnas que se adaptan al panel (antes eran 272 px fijos: en un
          panel angosto sobraba espacio a la derecha y en uno ancho no se aprovechaba). */}
      <div className="grid gap-3 items-start grid-cols-[repeat(auto-fill,minmax(min(100%,272px),1fr))]">
        {grupos.map((grp, i) => <div key={grp.nombre} className="min-w-0">{cuadroDeHoja(grp, i)}</div>)}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-zinc-400 px-1">
        <Sparkles size={11} className="flex-shrink-0 mt-0.5" />
        Costo y precio se calculan solos desde el valor con IVA y el margen — misma fórmula que la plantilla de Excel. Al guardar, el Motor Comercial recalcula sus alertas con estos mismos datos.
      </p>
    </div>
  );
}
