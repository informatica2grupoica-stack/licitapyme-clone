'use client';

// COMPUERTAS DE APROBACIÓN (spec §10) + CREACIÓN DE SKU (spec §7). Dos compuertas separadas e
// independientes: Compra (sobre el escenario ya elegido) y Margen (mínimo 20%, avisa sin bloquear
// bajo eso). El SKU se habilita recién con la Compuerta 1 resuelta a favor.
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchJsonReintento } from '@/app/lib/fetch-reintento';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { TablaAprobacionCompra } from './TablaAprobacionCompra';
import { IconShieldCheck as ShieldCheck, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconCircleX as XCircle, IconEdit as Edit3, IconAlertTriangle as AlertTriangle, IconTag as Tag, IconPlus as Plus, IconX as X, IconHistory as History, IconStar as Star, IconBolt as Zap } from '@tabler/icons-react';

type Estado = 'PENDIENTE' | 'APROBADA' | 'APROBADA_CON_MODIFICACION' | 'RECHAZADA';
type Tipo = 'COMPRA' | 'MARGEN';
type Decision = 'APROBAR' | 'APROBAR_CON_MODIFICACION' | 'RECHAZAR' | 'DESHACER';

interface Aprobacion {
  tipo: Tipo; estado: Estado; detalle: any; motivo: string | null;
  propuestoPorNombre: string | null; propuestoAt: string | null;
  resueltoPorNombre: string | null; resueltoAt: string | null; comentarioResolucion: string | null;
}
interface Margen { ventaNeta: number | null; costoNeto: number | null; margenPct: number | null; fuenteCosto: string | null }
interface Presupuesto { presupuestoOriginal: number | null; costoEscenario: number | null; excedePct: number | null; excede: boolean; costoFlete: number | null }
interface Sku { id: number; productoId: number; skuPropio: string; skuProveedor: string | null; proveedorNombre: string | null; marca: string | null; modelo: string | null; obumaProductoId: string | null; obumaCodigoComercial: string | null }
interface SubcategoriaObuma { id: string; nombre: string; categoriaId?: string }
interface CategoriaObuma { id: string; nombre: string }
interface ObumaCoincidencia { id: string; nombre: string; codigoComercial: string; categoriaId: string; subcategoriaId: string }
interface SugerenciaHistorica { proveedorNombre: string; proveedorRut: string | null; vecesComprado: number; precioPromedio: number | null }
const fmtCLPHist = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
interface Producto { id: number; descripcion: string; subestado: string }

const ESTADO_STYLE: Record<Estado, string> = {
  PENDIENTE: 'text-amber-700 bg-amber-50 border-amber-200', APROBADA: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  APROBADA_CON_MODIFICACION: 'text-teal-700 bg-teal-50 border-teal-200', RECHAZADA: 'text-rose-700 bg-rose-50 border-rose-200',
};
const ESTADO_LABEL: Record<Estado, string> = {
  PENDIENTE: 'Pendiente', APROBADA: 'Aprobada', APROBADA_CON_MODIFICACION: 'Aprobada con modificación', RECHAZADA: 'Rechazada',
};
const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
// Mismo id que OBUMA_CATEGORIA_MERCADO_PUBLICO en app/lib/obuma.ts — solo para distinguir en el
// aviso de duplicados si el parecido está dentro de "Mercado Publico" o en otra categoría de Obuma.
const OBUMA_CATEGORIA_MERCADO_PUBLICO_UI = '13255';

// Aviso bajo un dato del nombre del SKU: verde si se leyó de la cotización, ámbar si falta y hay que completarlo a mano.
function AvisoCampoSku({ valor, leido, cotizacionLeida }: { valor: string; leido: boolean; cotizacionLeida: boolean }) {
  if (valor.trim()) return leido ? <span className="block text-[11px] font-semibold text-emerald-700 mt-0.5">✔ Leído de la cotización</span> : null;
  return <span className="block text-[11px] font-semibold text-amber-700 mt-0.5">⚠ {cotizacionLeida ? 'No aparece en la cotización' : 'No hay cotización de la que leerlo'}: complétalo a mano.</span>;
}

function BloqueCompuerta({ tipo, titulo, aprobacion, esJefeDeVentas, puedeOperar, onProponer, onResolver, resumen, requiereMotivo, motivoLabel, desactualizada, puedeDeshacer, onDeshacer }: {
  tipo: Tipo; titulo: string; aprobacion: Aprobacion | null; esJefeDeVentas: boolean; puedeOperar: boolean;
  onProponer: (motivo: string | null) => void; onResolver: (decision: Decision, comentario: string | null) => void; resumen: React.ReactNode;
  requiereMotivo?: boolean; motivoLabel?: string; desactualizada?: boolean;
  puedeDeshacer?: boolean; onDeshacer?: (comentario: string | null) => void;
}) {
  const [comentario, setComentario] = useState('');
  const [decidiendo, setDecidiendo] = useState(false);
  const [confirmandoDeshacer, setConfirmandoDeshacer] = useState(false);
  // Ya enviada y vigente: el Paso A se pliega (no hay nada que llenar) y solo se abre si se quiere reenviar.
  const [reenviando, setReenviando] = useState(false);
  // Antes: cuando la compuerta necesitaba motivo (margen bajo 20%, o ahora sobre presupuesto), el
  // botón tiraba directo un error del servidor ("requiere motivo") sin que hubiera DÓNDE escribirlo
  // en pantalla — el encargado quedaba atascado sin saber qué hacer. Ahora el campo aparece solo
  // cuando hace falta, y el botón queda deshabilitado (no un error sorpresa) hasta que se llena.
  const [motivoPropuesta, setMotivoPropuesta] = useState('');
  const puedeProponer = !requiereMotivo || motivoPropuesta.trim().length > 0;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-bold text-zinc-800">{titulo}</p>
        {aprobacion && (
          <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${ESTADO_STYLE[aprobacion.estado]}`}>{ESTADO_LABEL[aprobacion.estado]}</span>
        )}
      </div>
      <div className="mt-1.5 text-[12px] text-zinc-600">{resumen}</div>
      {(() => {
        const e = aprobacion?.estado;
        const ok = e === 'APROBADA' || e === 'APROBADA_CON_MODIFICACION';
        const t = ok ? '✔ Aprobada. Este punto está listo.'
          : e === 'PENDIENTE' ? (esJefeDeVentas ? 'Te toca: aprueba, aprueba con cambios o rechaza.' : 'Esperando la decisión del jefe de ventas.')
          : e === 'RECHAZADA' ? 'Rechazada: corrige lo que se pidió y propónla de nuevo.'
          : 'Falta: el encargado la propone para que el jefe de ventas decida.';
        return <p className={`mt-2 text-[12px] font-semibold rounded-lg px-2.5 py-1.5 ${ok ? 'bg-emerald-50 text-emerald-800' : e === 'RECHAZADA' ? 'bg-rose-50 text-rose-800' : 'bg-zinc-50 text-zinc-700'}`}>{t}</p>;
      })()}

      {desactualizada && (
        <p className="mt-1.5 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1 flex items-start gap-1">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          Esto quedó desactualizado — el escenario elegido cambió después de proponerse. Vuelve a proponer con los datos actuales antes de aprobar. Si además cargaste una cotización nueva, primero ve a <b>Costeo y Auditoría → Escenarios</b> y confirma el monto ahí — acá solo se refleja lo que ya quedó elegido.
        </p>
      )}

      {aprobacion?.motivo && <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">{aprobacion.motivo}</p>}
      {aprobacion?.estado === 'RECHAZADA' && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2" data-testid="aprobacion-rechazada">
          <p className="text-[12.5px] font-bold text-rose-800">✖ Rechazada por {aprobacion.resueltoPorNombre || 'el jefe de ventas'}</p>
          {aprobacion.comentarioResolucion && <p className="text-[12.5px] text-rose-900 mt-0.5">Motivo: {aprobacion.comentarioResolucion}</p>}
          <p className="text-[12px] text-rose-800/80 mt-1">Qué hacer: corrige lo que pidió y usa «Corregir y volver a enviar» (Paso A). Mientras tanto no se pueden crear SKU ni órdenes de compra.</p>
        </div>
      )}
      {aprobacion?.estado === 'APROBADA_CON_MODIFICACION' && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2" data-testid="aprobacion-con-cambios">
          <p className="text-[12.5px] font-bold text-amber-900">✔ Aprobada con cambios por {aprobacion.resueltoPorNombre || 'el jefe de ventas'}</p>
          {aprobacion.comentarioResolucion && <p className="text-[12.5px] text-amber-950 mt-0.5">Hay que ajustar: {aprobacion.comentarioResolucion}</p>}
          <p className="text-[12px] text-amber-900/80 mt-1">Ya se puede seguir (SKU y órdenes de compra), pero el encargado debe aplicar estos cambios. Le llegó un aviso por campana, en pantalla y por correo.</p>
        </div>
      )}
      {aprobacion?.estado !== 'RECHAZADA' && aprobacion?.estado !== 'APROBADA_CON_MODIFICACION' && aprobacion?.comentarioResolucion && (
        <p className="mt-1.5 text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1">
          {aprobacion.resueltoPorNombre}: {aprobacion.comentarioResolucion}
        </p>
      )}

      {/* Antes solo aparecía sin propuesta o rechazada — una compuerta invalidada vuelve a
          PENDIENTE (§10.5) con el snapshot VIEJO y no había forma de refrescarlo: el encargado
          quedaba atascado (no podía aprobar por el bloqueo de arriba, ni corregirlo). Ahora también
          se puede volver a proponer estando PENDIENTE — útil siempre, imprescindible si está
          desactualizada. */}
      {(!aprobacion || aprobacion.estado === 'RECHAZADA' || aprobacion.estado === 'PENDIENTE') && puedeOperar && (
        aprobacion?.estado === 'PENDIENTE' && !desactualizada && !reenviando ? (
        <p className="mt-3 text-[12px] text-zinc-500 flex items-center gap-2 flex-wrap" data-testid="paso-a-enviada">
          <span className="font-semibold text-emerald-700">✔ Paso A hecho: ya fue enviada al jefe de ventas.</span>
          <button type="button" onClick={() => setReenviando(true)} className="font-semibold text-teal-700 hover:text-teal-900 underline decoration-dotted">Reenviar con datos nuevos</button>
        </p>
        ) : (
        <div className="mt-3 space-y-1.5 rounded-lg border border-zinc-200 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Paso A · El encargado la envía al jefe de ventas</p>
          <p className="text-[12px] text-zinc-500">{aprobacion?.estado === 'PENDIENTE'
            ? 'Ya fue enviada y espera decisión. Solo vuelve a enviarla si cambiaste cotizaciones o el escenario: así el jefe ve los datos de hoy.'
            : aprobacion?.estado === 'RECHAZADA' ? 'Corrige lo que pidió el jefe de ventas y vuelve a enviarla para que decida de nuevo.'
            : 'Esto avisa al jefe de ventas que ya puede decidir.'}</p>
          {requiereMotivo && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <p className="text-[11.5px] font-bold text-amber-700 flex items-center gap-1"><AlertTriangle size={12} /> Escribe el motivo (es obligatorio para poder enviarla)</p>
              <input value={motivoPropuesta} onChange={e => setMotivoPropuesta(e.target.value)} placeholder={motivoLabel || 'Motivo…'}
                className="mt-1 w-full text-[11.5px] border border-amber-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-500 bg-white" />
            </div>
          )}
          <button onClick={() => { onProponer(motivoPropuesta.trim() || null); setReenviando(false); }} disabled={!puedeProponer}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${aprobacion?.estado === 'PENDIENTE' ? (desactualizada ? 'border-rose-300 text-rose-700 hover:bg-rose-50' : 'border-teal-300 text-teal-800 hover:bg-teal-50') : 'border-teal-600 bg-teal-600 text-white hover:bg-teal-700'}`}>
            {aprobacion?.estado === 'PENDIENTE' ? 'Volver a enviar con los datos de hoy' : aprobacion?.estado === 'RECHAZADA' ? 'Corregir y volver a enviar' : 'Enviar al jefe de ventas'}
          </button>
        </div>
        )
      )}

      {aprobacion && aprobacion.estado !== 'PENDIENTE' && puedeDeshacer && onDeshacer && (
        <div className="mt-2">
          {confirmandoDeshacer ? (
            <div className="space-y-1.5">
              <input value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Motivo (opcional)…"
                className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <p className="text-[11px] text-zinc-600">Vuelve a «Pendiente»: habrá que aprobarla de nuevo. Los SKU ya creados no se borran.</p>
              <div className="flex items-center gap-2">
                <button onClick={() => { setConfirmandoDeshacer(false); onDeshacer(comentario.trim() || null); }} className="text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 px-2 py-1.5 rounded-lg">Sí, deshacer</button>
                <button onClick={() => setConfirmandoDeshacer(false)} className="text-[11px] font-semibold text-zinc-500">No</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmandoDeshacer(true)} className="text-[11.5px] font-semibold text-rose-700 hover:text-rose-800">Deshacer esta decisión</button>
          )}
        </div>
      )}

      {aprobacion?.estado === 'PENDIENTE' && esJefeDeVentas && (
        <div className="mt-3 space-y-1.5 rounded-lg border border-teal-200 bg-teal-50/30 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700">Paso B · El jefe de ventas decide</p>
          <ul className="text-[12px] text-zinc-600 space-y-0.5">
            <li><b className="text-emerald-700">Aprobar:</b> se puede comprar tal como está.</li>
            <li><b className="text-indigo-700">Aprobar con cambios:</b> se aprueba y se sigue, pero escribe abajo qué hay que ajustar: el encargado recibe ese texto por campana, en pantalla y por correo (obligatorio).</li>
            <li><b className="text-rose-700">Rechazar:</b> no se aprueba; escribe abajo el motivo. El encargado lo recibe por campana, en pantalla y por correo, con un botón que lo lleva a corregir; corrige y vuelve a enviar. Hasta entonces no se crean SKU ni órdenes de compra (obligatorio).</li>
          </ul>
          <input value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Comentario (obligatorio si apruebas con cambios o rechazas)…"
            className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setDecidiendo(true); onResolver('APROBAR', comentario || null); }} disabled={decidiendo}
              className="flex items-center gap-1 text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              <CheckCircle2 size={13} /> Aprobar
            </button>
            <button onClick={() => { if (!comentario.trim()) return; setDecidiendo(true); onResolver('APROBAR_CON_MODIFICACION', comentario); }} disabled={decidiendo || !comentario.trim()} title={!comentario.trim() ? 'Escribe qué hay que ajustar' : undefined}
              className="flex items-center gap-1 text-[12px] font-semibold text-indigo-700 border border-indigo-300 bg-white hover:bg-indigo-50 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              <Edit3 size={13} /> Aprobar con cambios
            </button>
            <button onClick={() => { if (!comentario.trim()) return; setDecidiendo(true); onResolver('RECHAZAR', comentario); }} disabled={decidiendo || !comentario.trim()} title={!comentario.trim() ? 'Escribe el motivo' : undefined}
              className="flex items-center gap-1 text-[12px] font-semibold text-rose-700 border border-rose-300 bg-white hover:bg-rose-50 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              <XCircle size={13} /> Rechazar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AprobacionesCompraCard({ negocioId, puedeOperar, parte = 'todo' }: { negocioId: number; puedeOperar: boolean; parte?: 'todo' | 'aprobaciones' | 'sku' }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [compra, setCompra] = useState<Aprobacion | null>(null);
  const [margen, setMargen] = useState<Aprobacion | null>(null);
  const [margenActual, setMargenActual] = useState<Margen | null>(null);
  const [presupuestoActual, setPresupuestoActual] = useState<Presupuesto | null>(null);
  const [escenarioElegidoActual, setEscenarioElegidoActual] = useState<{ tipo: string; costoTotal: number } | null>(null);
  const [esJefeDeVentas, setEsJefeDeVentas] = useState(false);
  const [puedeDeshacer, setPuedeDeshacer] = useState(false);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  // Si no se pudieron leer las aprobaciones NO se pintan las compuertas (con valores por defecto parecerían «sin proponer» y el botón re-propondría y borraría lo aprobado).
  const [errorAprobaciones, setErrorAprobaciones] = useState<string | null>(null);
  const [formSkuProducto, setFormSkuProducto] = useState<number | null>(null);
  // «Crear todos seguidos»: ids de productos que faltan; al guardar uno se abre el formulario del siguiente.
  const [colaSku, setColaSku] = useState<number[] | null>(null);
  // El nombre que se manda a Obuma se arma en vivo con Tipo (obligatorio) + Atributo (opcional) +
  // la Marca/Modelo que YA se escriben arriba para el SKU propio — sin pedirlos dos veces (antes
  // pedía Medida/Marca de nuevo acá y la gente terminaba copiando el código del SKU en "Tipo" por
  // no tener qué poner, spec §7.3: "nunca se copia de producto.descripcion" sigue firme, pero eso
  // no significa duplicar campos que ya existen en el formulario).
  const formSkuVacio = {
    skuPropio: '', skuProveedor: '', proveedorNombre: '', marca: '', modelo: '', obumaProductoId: '',
    crearEnObuma: true, obumaCategoriaId: OBUMA_CATEGORIA_MERCADO_PUBLICO_UI, obumaSubcategoriaId: '', obTipo: '', obAtributo: '', medidas: '',
    precioVenta: '', paraVenta: true, paraCompra: true, inventariable: true, venderEnWeb: false,
  };
  const [formSku, setFormSku] = useState(formSkuVacio);
  const [historicoPorSku, setHistoricoPorSku] = useState<Record<number, SugerenciaHistorica[] | 'cargando' | 'sin_datos'>>({});
  const [guardandoSku, setGuardandoSku] = useState(false);
  const [subcategorias, setSubcategorias] = useState<SubcategoriaObuma[]>([]);
  const [cargandoSubcategorias, setCargandoSubcategorias] = useState(false);
  const [categorias, setCategorias] = useState<CategoriaObuma[]>([]);
  const [errorSubcats, setErrorSubcats] = useState<string | null>(null);
  const [skuPreview, setSkuPreview] = useState<{ estado: 'idle' | 'cargando' | 'listo' | 'error'; codigo: string | null }>({ estado: 'idle', codigo: null });
  const [duplicados, setDuplicados] = useState<{ estado: 'idle' | 'cargando' | 'listo'; productos: ObumaCoincidencia[] }>({ estado: 'idle', productos: [] });
  const [confirmarPeseADuplicado, setConfirmarPeseADuplicado] = useState(false);
  // Pedido explícito: "debo de verificarlo antes que lo mandes por si tiene modificaciones" — el
  // costo viene del escenario elegido y puede haber cambiado desde que se abrió el formulario, así
  // que se muestra ACÁ (mismo dato que después vuelve a comprobar el backend) y hay que confirmarlo
  // a mano antes de que el botón "Guardar" quede habilitado.
  const [costoPreview, setCostoPreview] = useState<{ estado: 'idle' | 'cargando' | 'listo' | 'sin_datos'; monto: number | null; escenarioTipo: string | null }>({ estado: 'idle', monto: null, escenarioTipo: null });
  const [costoConfirmado, setCostoConfirmado] = useState(false);
  // Qué datos del nombre se leyeron de la cotización (para avisar cuáles hay que completar a mano).
  const [leidos, setLeidos] = useState({ marca: false, modelo: false, medida: false });
  // Sugerencia del documento leído (pedido explícito del usuario, 15-sep-2026: "debe de ser capaz
  // de poder darme como referencia el nombre del producto de la cotización si ya lo leyó y lo
  // guardó en la base de datos... y así en todo lo que tenga que llenar lo puede ver"). Prellena
  // Proveedor solo (dato literal, sin ambigüedad); Marca/Modelo NUNCA se autocompletan solos —
  // el documento no los trae como campos separados y adivinarlos sería inventar un dato que se
  // manda tal cual a Obuma — se muestran como texto de referencia para copiar a mano.
  const [sugerenciaSku, setSugerenciaSku] = useState<
    { estado: 'idle' } | { estado: 'cargando' } |
    { estado: 'listo'; proveedorNombre: string | null; descripcionLibre: string | null; archivoUrl: string | null; archivoNombre: string | null; motivo: string | null }
  >({ estado: 'idle' });
  const [verificandoObumaId, setVerificandoObumaId] = useState<number | null>(null);

  // Nombre para Obuma = Tipo + Atributo + Medida + Marca + Modelo (los tres últimos ya están arriba, en el
  // mismo formulario — no se piden de nuevo). Siempre en MAYÚSCULAS — Obuma lo guarda así igual
  // (crearProductoObuma hace .toUpperCase() antes de mandarlo), el preview debe mostrar lo mismo
  // que va a quedar guardado, no una versión distinta que después "cambia sola".
  const nombreObumaPreview = [formSku.obTipo, formSku.obAtributo, formSku.medidas, formSku.marca, formSku.modelo]
    .map(s => s.trim()).filter(Boolean).join(' ').toUpperCase();

  // Solo la ÚLTIMA carga pinta: una lectura anterior que llega tarde no debe pisar el estado nuevo (visto el 14-oct-2026:
  // tras aprobar, la tarjeta a veces seguía en «Pendiente» aunque el servidor ya la había aprobado).
  const cargaActual = useRef(0);
  const cargar = useCallback(async () => {
    const miCarga = ++cargaActual.current;
    try {
      // allSettled: si falla UNA lectura (SKU, productos) las compuertas igual se pintan con lo que sí llegó. Antes un solo fallo dejaba
      // las compuertas en blanco («0 de 2 · Enviar al jefe de ventas») aunque en la BD ya estuvieran aprobadas.
      const [rA, rS, rP] = await Promise.allSettled([
        fetchJsonReintento<any>(`/api/compras/${negocioId}/aprobaciones`), fetchJsonReintento<any>(`/api/compras/${negocioId}/sku`), fetchJsonReintento<any>(`/api/compras/${negocioId}/productos`),
      ]);
      if (miCarga !== cargaActual.current) return;
      const dA = rA.status === 'fulfilled' ? rA.value : null;
      if (dA?.success) {
        setCompra(dA.compra); setMargen(dA.margen); setMargenActual(dA.margenActual); setPresupuestoActual(dA.presupuestoActual);
        setEscenarioElegidoActual(dA.escenarioElegidoActual); setEsJefeDeVentas(dA.esJefeDeVentas); setPuedeDeshacer(!!dA.puedeDeshacer);
        setErrorAprobaciones(null);
      } else {
        setErrorAprobaciones(rA.status === 'rejected' ? String((rA.reason as Error)?.message || rA.reason) : String(dA?.error || 'No se pudo cargar'));
      }
      if (rS.status === 'fulfilled' && rS.value.success) setSkus(rS.value.skus || []);
      if (rP.status === 'fulfilled' && rP.value.success) setProductos((rP.value.productos || []).filter((p: any) => !['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado)));
      if (rA.status === 'rejected') toast.error('No se pudieron cargar las aprobaciones', String((rA.reason as Error)?.message || rA.reason));
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  // Subcategorías reales de Obuma (bajo "Mercado Publico") — solo se piden cuando se abre el
  // formulario de un SKU nuevo, no en cada carga de la pantalla (§7.2: cuota de consultas diarias).
  // Si la consulta falla (Obuma lento o con cuota), se avisa y se puede reintentar: antes quedaba la lista vacía para siempre.
  const cargarSubcategorias = async (forzar = false) => {
    if ((subcategorias.length && !forzar) || cargandoSubcategorias) return;
    setCargandoSubcategorias(true); setErrorSubcats(null);
    try {
      const res = await fetch('/api/compras/obuma-subcategorias');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Obuma no respondió');
      setCategorias(data.categorias || []); setSubcategorias(data.subcategorias || []);
    } catch (e: any) { setErrorSubcats(e.message || 'No se pudo consultar Obuma'); }
    finally { setCargandoSubcategorias(false); }
  };

  useEffect(() => { cargar(); }, [cargar]);

  // Al abrir el formulario de un SKU, se cargan categorías y subcategorías (si aún no están).
  useEffect(() => {
    if (formSkuProducto != null && formSku.crearEnObuma && !subcategorias.length && !cargandoSubcategorias && !errorSubcats) void cargarSubcategorias();
  }, [formSkuProducto, formSku.crearEnObuma, subcategorias.length, cargandoSubcategorias, errorSubcats]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Preview del código SKU-Obuma apenas se elige la subcategoría — mismo gesto que
  // `solicitarNuevoSku` en la intranet: se ve el código real ANTES de guardar, no después.
  useEffect(() => {
    if (!formSku.crearEnObuma || !formSku.obumaSubcategoriaId) { setSkuPreview({ estado: 'idle', codigo: null }); return; }
    let cancelado = false;
    setSkuPreview({ estado: 'cargando', codigo: null });
    fetch(`/api/compras/obuma-siguiente-sku?subcategoriaId=${encodeURIComponent(formSku.obumaSubcategoriaId)}`)
      .then(r => r.json())
      .then(data => { if (!cancelado) setSkuPreview(data.success ? { estado: 'listo', codigo: data.sku } : { estado: 'error', codigo: null }); })
      .catch(() => { if (!cancelado) setSkuPreview({ estado: 'error', codigo: null }); });
    return () => { cancelado = true; };
  }, [formSku.crearEnObuma, formSku.obumaSubcategoriaId]);

  // Aviso de posibles duplicados por nombre — pedido explícito: "si pongo pala debe de mostrar
  // todas las palas que estan en obuma para no duplicarlas". Busca por el campo Tipo (lo más
  // genérico, ej. "Pala", "Notebook") con debounce para no gatillar una consulta por cada tecla.
  useEffect(() => {
    setConfirmarPeseADuplicado(false);
    if (!formSku.crearEnObuma || formSku.obTipo.trim().length < 3) { setDuplicados({ estado: 'idle', productos: [] }); return; }
    let cancelado = false;
    setDuplicados(d => ({ estado: 'cargando', productos: d.productos }));
    const t = setTimeout(() => {
      fetch(`/api/compras/obuma-productos-buscar?q=${encodeURIComponent(formSku.obTipo.trim())}`)
        .then(r => r.json())
        .then(data => { if (!cancelado) setDuplicados({ estado: 'listo', productos: data.success ? (data.productos || []) : [] }); })
        .catch(() => { if (!cancelado) setDuplicados({ estado: 'listo', productos: [] }); });
    }, 450);
    return () => { cancelado = true; clearTimeout(t); };
  }, [formSku.crearEnObuma, formSku.obTipo]);

  // Costo que se va a mandar a Obuma — se pide apenas se marca "Crear también en Obuma", ANTES de
  // que el usuario pueda guardar. Se vuelve a pedir (y a exigir confirmación de nuevo) si cambia de
  // producto, por si el escenario se editó entremedio.
  useEffect(() => {
    setCostoConfirmado(false);
    if (!formSku.crearEnObuma || !formSkuProducto) { setCostoPreview({ estado: 'idle', monto: null, escenarioTipo: null }); return; }
    let cancelado = false;
    setCostoPreview({ estado: 'cargando', monto: null, escenarioTipo: null });
    fetch(`/api/compras/${negocioId}/sku/costo-preview?productoId=${formSkuProducto}&sugerencia=0`)
      .then(r => r.json())
      .then(data => {
        if (cancelado) return;
        if (data.venta != null) setFormSku(f => (f.precioVenta.trim() ? f : { ...f, precioVenta: String(Math.round(data.venta)) }));
        if (data.success && data.costo != null) setCostoPreview({ estado: 'listo', monto: data.costo, escenarioTipo: data.escenarioTipo });
        else setCostoPreview({ estado: 'sin_datos', monto: null, escenarioTipo: null });
      })
      .catch(() => { if (!cancelado) setCostoPreview({ estado: 'sin_datos', monto: null, escenarioTipo: null }); });
    return () => { cancelado = true; };
  }, [formSku.crearEnObuma, formSkuProducto, negocioId]);

  // Sugerencia del documento leído — se pide apenas se abre el formulario para un producto, sin
  // esperar a que se marque "Crear también en Obuma" (a diferencia del preview de costo de arriba,
  // esto sirve igual aunque el SKU sea puramente interno). Reusa el mismo endpoint de costo-preview
  // (ya devuelve la sugerencia junto al costo) para no duplicar la consulta al escenario elegido.
  useEffect(() => {
    setSugerenciaSku({ estado: 'idle' });
    setLeidos({ marca: false, modelo: false, medida: false });
    if (!formSkuProducto) return;
    let cancelado = false;
    setSugerenciaSku({ estado: 'cargando' });
    fetch(`/api/compras/${negocioId}/sku/costo-preview?productoId=${formSkuProducto}`)
      .then(r => r.json())
      .then(data => {
        if (cancelado) return;
        const s = data?.sugerencia;
        if (!data.success || !s) { setSugerenciaSku({ estado: 'idle' }); return; }
        setSugerenciaSku({
          estado: 'listo', proveedorNombre: s.proveedorNombre, descripcionLibre: s.descripcionLibre,
          archivoUrl: s.archivoUrl, archivoNombre: s.archivoNombre, motivo: s.motivo ?? null,
        });
        // Prellena solo campos vacíos (nunca pisa lo que la persona escribió a mano). Marca/modelo/
        // SKU proveedor vienen validados como literales del documento (compras-aprobaciones.ts);
        // el preview de Obuma sigue exigiendo revisión y confirmación antes de guardar.
        setLeidos({ marca: !!s.marca, modelo: !!s.modelo, medida: !!s.medida });
        setFormSku(f => ({
          ...f,
          medidas: f.medidas.trim() ? f.medidas : (s.medida || f.medidas),
          proveedorNombre: f.proveedorNombre.trim() ? f.proveedorNombre : (s.proveedorNombre || f.proveedorNombre),
          marca: f.marca.trim() ? f.marca : (s.marca || f.marca),
          modelo: f.modelo.trim() ? f.modelo : (s.modelo || f.modelo),
          skuProveedor: f.skuProveedor.trim() ? f.skuProveedor : (s.skuProveedor || f.skuProveedor),
          obTipo: f.obTipo.trim() ? f.obTipo : (s.tipo || f.obTipo),
          obAtributo: f.obAtributo.trim() ? f.obAtributo : (s.atributo || f.obAtributo),
        }));
      })
      .catch(() => { if (!cancelado) setSugerenciaSku({ estado: 'idle' }); });
    return () => { cancelado = true; };
  }, [formSkuProducto, negocioId]);

  const proponer = async (tipo: Tipo, motivo?: string | null) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/aprobaciones`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, motivo: motivo || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo proponer');
      toast.success('Propuesta enviada al jefe de ventas');
      await cargar();
      recargarCompartido(); // mueve el badge de "Aprobación y SKU" en el stepper
    } catch (e: any) {
      toast.error('No se pudo proponer', e.message);
    }
  };

  const resolver = async (tipo: Tipo, decision: Decision, comentario: string | null) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/aprobaciones`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, decision, comentario }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo resolver');
      toast.success('Decisión registrada');
      // El PATCH ya trae el estado nuevo de las dos aprobaciones: se muestra al tiro, sin esperar la recarga.
      if ('compra' in data) setCompra(data.compra);
      if ('margen' in data) setMargen(data.margen);
      await cargar();
      // Aprobar la Compuerta 1 habilita el badge de "Compra, Importación y Logística" (hitos
      // administrativos) — sin esto quedaba en blanco hasta recargar la pantalla entera.
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo resolver', e.message);
    }
  };

  // Reutilizar un producto que YA existe en Obuma (pedido explícito: "si pongo martillo y esa es
  // lo que estoy buscando... marcarlo para ocupar ese mismo y asi no se crea y lo reutilizamos") —
  // en vez de crear uno nuevo, se homologa este SKU con el que ya está allá: se apaga "Crear en
  // Obuma" (no hay nada que crear) y se usa su ID y su propio código como identidad, mismo
  // criterio de "un solo código" que ya rige cuando sí se crea uno nuevo.
  const usarProductoExistente = (m: ObumaCoincidencia) => {
    setFormSku(f => ({
      ...f, crearEnObuma: false, obumaProductoId: m.id, skuPropio: m.codigoComercial,
      obumaSubcategoriaId: '', obTipo: '', obAtributo: '',
    }));
    setDuplicados({ estado: 'idle', productos: [] });
    setConfirmarPeseADuplicado(false);
    toast.success('Reutilizando producto existente', `${m.nombre} — código ${m.codigoComercial}`);
  };

  const crearSku = async () => {
    if (!formSkuProducto) return;
    // Licitank y Obuma son la misma empresa: si se crea en Obuma, su código ES el SKU propio — no
    // se pide uno aparte (solo hace falta escribirlo a mano cuando NO se crea en Obuma).
    if (!formSku.crearEnObuma && !formSku.skuPropio.trim()) return;
    if (formSku.crearEnObuma && !formSku.obumaSubcategoriaId) {
      toast.error('Falta la subcategoría', 'Elige la subcategoría de Obuma antes de crear el producto.');
      return;
    }
    if (formSku.crearEnObuma && !nombreObumaPreview) {
      toast.error('Falta el nombre del producto', 'Completa el Tipo (y Marca/Modelo si aplica) — es lo que se está cotizando, no la línea de la licitación.');
      return;
    }
    if (formSku.crearEnObuma && duplicados.productos.length > 0 && !confirmarPeseADuplicado) {
      toast.error('Hay productos parecidos en Obuma', 'Revisa la lista de abajo — si ninguno es este, marca "Crear de todas formas" para continuar.');
      return;
    }
    if (formSku.crearEnObuma && costoPreview.estado !== 'listo') {
      toast.error('Falta el costo', 'No se pudo obtener el costo del escenario elegido — sin eso no se puede crear en Obuma.');
      return;
    }
    if (formSku.crearEnObuma && formSku.paraVenta && !(Number(formSku.precioVenta.replace(/[^\d]/g, '')) > 0)) {
      toast.error('Falta el precio de venta', 'Escribe el precio de venta neto (viene del costeo) o desmarca «Se puede vender».');
      return;
    }
    if (formSku.crearEnObuma && !costoConfirmado) {
      toast.error('Falta confirmar el costo', 'Revisa el monto que se va a mandar a Obuma y marca la casilla de confirmación.');
      return;
    }
    setGuardandoSku(true);
    try {
      const { obTipo, obAtributo, medidas, precioVenta, ...resto } = formSku;
      const res = await fetch(`/api/compras/${negocioId}/sku`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoId: formSkuProducto, ...resto, nombreObuma: nombreObumaPreview || null, costoEsperado: costoPreview.monto, precioVentaNeto: Number(precioVenta.replace(/[^\d]/g, '')) || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success(formSku.crearEnObuma ? 'SKU creado — también se creó el producto real en Obuma' : 'SKU creado');
      setSkus(data.skus); setFormSku(formSkuVacio);
      const siguientes = (colaSku || []).filter(id => id !== formSkuProducto && !(data.skus as Sku[]).some(s => s.productoId === id));
      setColaSku(siguientes.length ? siguientes : null);
      if (siguientes.length) { setFormSkuProducto(siguientes[0]); cargarSubcategorias(); } else setFormSkuProducto(null);
    } catch (e: any) {
      toast.error('No se pudo crear el SKU', e.message);
    } finally {
      setGuardandoSku(false);
    }
  };

  // §19.3 — sugerencia de proveedor histórico, bajo demanda (no automática: la API de OBUMA tiene
  // límite de consultas diarias por endpoint, spec §7.2).
  const verHistorico = async (sku: Sku) => {
    setHistoricoPorSku(h => ({ ...h, [sku.id]: 'cargando' }));
    try {
      const res = await fetch(`/api/compras/${negocioId}/sku/${sku.id}/historico`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo consultar');
      setHistoricoPorSku(h => ({ ...h, [sku.id]: data.sugerencias.length ? data.sugerencias : 'sin_datos' }));
    } catch (e: any) {
      setHistoricoPorSku(h => ({ ...h, [sku.id]: 'sin_datos' }));
      toast.error('No se pudo consultar el histórico', e.message);
    }
  };

  // Obuma no avisa si alguien borra/edita un producto allá directamente — este botón releé en vivo
  // y corrige el vínculo local si ya no coincide (pedido explícito tras encontrar un SKU que seguía
  // mostrando "Creado en Obuma" de un producto que el usuario ya había borrado en Obuma).
  const verificarObuma = async (sku: Sku) => {
    setVerificandoObumaId(sku.id);
    try {
      const res = await fetch(`/api/compras/${negocioId}/sku/${sku.id}/verificar-obuma`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo verificar');
      if (data.existe) toast.success('Sigue existiendo en Obuma', `Código confirmado: ${data.codigoComercial}`);
      else toast.error('Ya no existe en Obuma', 'Se borró allá — se limpió el vínculo local, puedes crearlo de nuevo si corresponde.');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo verificar contra Obuma', e.message);
    } finally {
      setVerificandoObumaId(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  if (errorAprobaciones && !compra && !margen) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-center gap-3 flex-wrap" data-testid="aprobaciones-error">
        <p className="text-[12.5px] text-rose-700 flex-1 min-w-[220px]">No se pudieron leer las aprobaciones ({errorAprobaciones}). No se muestran para no confundir el estado real.</p>
        <button type="button" onClick={() => { setLoading(true); cargar(); }} className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-100">Reintentar</button>
      </div>
    );
  }

  const compraAprobada = compra && ['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(compra.estado);
  // §10.5: la propuesta queda como un snapshot congelado — si después se elige otro escenario, ese
  // snapshot no se actualiza solo (invalidarAprobacionesCompras solo cambia el estado). Se compara
  // contra el escenario elegido EN VIVO para avisar en vez de dejar el número viejo sin marcar.
  const compraDesactualizada = !!(compra?.detalle && escenarioElegidoActual
    && (compra.detalle.escenarioTipo !== escenarioElegidoActual.tipo
      || Math.abs(Number(compra.detalle.costoTotal) - escenarioElegidoActual.costoTotal) > 1));

  return (
    <div className="space-y-3">
      {parte !== 'sku' && (<>
      <TablaAprobacionCompra negocioId={negocioId} refresco={`${compra?.estado}|${compra?.propuestoAt}|${margen?.estado}|${margen?.propuestoAt}`}
        esJefeDeVentas={esJefeDeVentas} compraEstado={compra?.estado ?? null} onAprobarCompra={() => resolver('COMPRA', 'APROBAR', null)} />
      {(() => {
        const ok = (a: typeof compra) => !!a && ['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(a.estado);
        const n = Number(ok(compra)) + Number(ok(margen));
        return (
          <div className={`rounded-xl border px-4 py-2.5 flex items-center gap-3 flex-wrap ${n === 2 ? 'border-emerald-200 bg-emerald-50' : 'border-zinc-200 bg-zinc-50'}`} data-testid="aprobacion-avance">
            <span className={`text-[20px] font-extrabold tabular-nums ${n === 2 ? 'text-emerald-700' : 'text-zinc-800'}`}>{n} de 2</span>
            <p className="text-[12.5px] text-zinc-600 flex-1 min-w-[220px]"><b className="text-zinc-800 flex items-center gap-1"><ShieldCheck size={13} /> aprobaciones listas</b>El jefe de ventas debe aprobar las dos antes de crear los SKU y emitir órdenes de compra.</p>
          </div>
        );
      })()}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <BloqueCompuerta
          tipo="COMPRA" titulo="1 · Aprobar la compra (a quién y cuánto se compra)" aprobacion={compra} esJefeDeVentas={esJefeDeVentas} puedeOperar={puedeOperar}
          onProponer={(motivo) => proponer('COMPRA', motivo)} onResolver={(d, c) => resolver('COMPRA', d, c)} puedeDeshacer={puedeDeshacer} onDeshacer={(c) => resolver('COMPRA', 'DESHACER', c)}
          requiereMotivo={!!presupuestoActual?.excede} motivoLabel="¿Por qué se compra sobre el presupuesto costeado?"
          desactualizada={compraDesactualizada}
          resumen={<>
            {compra?.detalle ? (
              <span className={compraDesactualizada ? 'line-through text-zinc-400' : ''}>Escenario: <b>{compra.detalle.escenarioTipo}</b> · {fmtCLP(compra.detalle.costoTotal)}</span>
            ) : <span>Elige un escenario en el Auditor de Compras y proponlo acá.</span>}
            {compraDesactualizada && escenarioElegidoActual && (
              <span className="block mt-0.5 font-semibold text-zinc-700">Vigente ahora: <b>{escenarioElegidoActual.tipo}</b> · {fmtCLP(escenarioElegidoActual.costoTotal)}</span>
            )}
            {presupuestoActual?.presupuestoOriginal != null && presupuestoActual?.costoEscenario != null && (
              <div className={`mt-1.5 rounded-lg px-2 py-1 text-[10.5px] font-medium ${presupuestoActual.excede ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                {presupuestoActual.excede && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                {presupuestoActual.excede
                  ? <>Al ofertar se costeó en <b>{fmtCLP(presupuestoActual.presupuestoOriginal)}</b> y esta compra cuesta <b>{fmtCLP(presupuestoActual.costoEscenario)}</b>: <b>{fmtCLP(presupuestoActual.costoEscenario - presupuestoActual.presupuestoOriginal)} más ({presupuestoActual.excedePct} %)</b>. {compra?.motivo ? 'El motivo ya está escrito (ver abajo).' : 'Hay que explicar el motivo.'}</>
                  : <>Costeado al ofertar: <b>{fmtCLP(presupuestoActual.presupuestoOriginal)}</b> · esta compra: <b>{fmtCLP(presupuestoActual.costoEscenario)}</b> — dentro de lo previsto.</>}
                <span className="block font-normal opacity-80">(solo mercadería, sin flete)</span>
                {/* Flete aparte, informativo — nunca cuenta como "exceso de presupuesto" (el costeo
                    original no cotiza logística). Pedido explícito del usuario,
                    14-sep-2026: comparar mercadería contra mercadería+flete disparaba el aviso
                    aunque los productos en sí se hubieran cotizado dentro de lo previsto. */}
                {presupuestoActual.costoFlete != null && presupuestoActual.costoFlete > 0 && (
                  <span className="block mt-0.5 font-normal opacity-80">+ {fmtCLP(presupuestoActual.costoFlete)} de flete (aparte, no cuenta para este control).</span>
                )}
              </div>
            )}
          </>}
        />
        <BloqueCompuerta
          tipo="MARGEN" titulo="2 · Aprobar el margen (la ganancia del proyecto)" aprobacion={margen} esJefeDeVentas={esJefeDeVentas} puedeOperar={puedeOperar}
          onProponer={(motivo) => proponer('MARGEN', motivo)} onResolver={(d, c) => resolver('MARGEN', d, c)} puedeDeshacer={puedeDeshacer} onDeshacer={(c) => resolver('MARGEN', 'DESHACER', c)}
          requiereMotivo={margenActual?.margenPct != null && margenActual.margenPct < 20} motivoLabel="¿Por qué se aprueba con margen bajo el 20%?"
          resumen={margenActual?.margenPct != null ? (
            <span className={margenActual.margenPct < 20 ? 'text-rose-600 font-semibold flex items-center gap-1' : ''}>
              {margenActual.margenPct < 20 && <AlertTriangle size={12} />} Ganancia prevista: {margenActual.margenPct} % <span className="font-normal text-zinc-500">· el mínimo exigido es 20 %{margenActual.margenPct >= 20 ? ' ✔ lo cumple' : ' ✖ no lo cumple, hay que explicar el motivo'}</span>
              {margenActual.fuenteCosto === 'costeo_estimado' && ' (costeo estimado, sin escenario elegido aún)'}
            </span>
          ) : <span>Sin datos suficientes para calcular margen todavía.</span>}
        />
      </div>
      {!compra && !margen && (
        <p className="text-[10.5px] text-zinc-400 px-0.5">
          El control de gasto compara automáticamente lo costeado al ofertar y el margen mínimo (20%) contra lo que de verdad se va a comprar — la orden de compra en Obuma no se habilita hasta que ambos hitos queden aprobados.
        </p>
      )}

      </>)}
      {parte === 'sku' && !compraAprobada && (
        <p className="text-[12.5px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">El SKU se crea cuando la jefatura aprueba la compra (paso «Aprobación y SKU»). Todavía no está aprobada.</p>
      )}
      {parte !== 'aprobaciones' && compraAprobada && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 flex items-center gap-3 flex-wrap" data-testid="sku-lista">
            <div className="flex-1 min-w-[220px]">
              <p className="text-[13.5px] font-bold text-zinc-800 flex items-center gap-1.5"><Tag size={14} /> Crear el SKU de cada producto <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-700">{skus.filter(s => productos.some(p => p.id === s.productoId)).length} de {productos.length}</span></p>
              <p className="text-[12px] text-zinc-500">La compra ya está aprobada. Crea el SKU de un producto desde su fila, o todos seguidos.</p>
            </div>
            {puedeOperar && formSkuProducto == null && productos.filter(p => !skus.some(s => s.productoId === p.id)).length > 1 && (
              <button type="button" onClick={() => {
                const faltan = productos.filter(p => !skus.some(s => s.productoId === p.id)).map(p => p.id);
                setColaSku(faltan); setFormSkuProducto(faltan[0]); setFormSku(formSkuVacio); cargarSubcategorias();
              }} className="text-[12.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3.5 py-2 rounded-lg">Crear los {productos.filter(p => !skus.some(s => s.productoId === p.id)).length} que faltan, uno tras otro</button>
            )}
            {colaSku && formSkuProducto != null && <span className="text-[12px] font-semibold text-teal-700">Quedan {colaSku.length} por crear</span>}
          </div>
          <div className="divide-y divide-zinc-100">
            {productos.map(p => {
              const sku = skus.find(s => s.productoId === p.id);
              return (
                <div key={p.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-zinc-800">{p.descripcion}</p>
                    {!sku && puedeOperar && formSkuProducto !== p.id && (
                      <button onClick={() => { setFormSkuProducto(p.id); setFormSku(formSkuVacio); cargarSubcategorias(); }}
                        className="text-[11px] font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"><Plus size={12} /> Crear SKU</button>
                    )}
                    {sku && !sku.obumaProductoId && puedeOperar && formSkuProducto !== p.id && (
                      <button onClick={() => {
                        setFormSkuProducto(p.id);
                        setFormSku({
                          ...formSkuVacio, skuPropio: sku.skuPropio, marca: sku.marca || '', modelo: sku.modelo || '',
                          proveedorNombre: sku.proveedorNombre || '', skuProveedor: sku.skuProveedor || '', crearEnObuma: true,
                        });
                        cargarSubcategorias();
                      }} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                        <Zap size={12} /> Crear en Obuma
                      </button>
                    )}
                  </div>
                  {sku && (
                    <>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        <b>{sku.skuPropio}</b>{sku.marca && ` · ${sku.marca}`}{sku.modelo && ` ${sku.modelo}`}
                        {sku.skuProveedor && ` · SKU proveedor: ${sku.skuProveedor}`}
                      </p>
                      {sku.obumaCodigoComercial && (
                        <p className="text-[10.5px] text-indigo-600 font-semibold mt-0.5 flex items-center gap-1.5">
                          <Zap size={10} /> Creado en Obuma — código {sku.obumaCodigoComercial}
                          {puedeOperar && (
                            <button onClick={() => verificarObuma(sku)} disabled={verificandoObumaId === sku.id}
                              className="text-zinc-400 hover:text-indigo-600 font-normal underline decoration-dotted disabled:opacity-50">
                              {verificandoObumaId === sku.id ? 'Verificando…' : 'Verificar en Obuma'}
                            </button>
                          )}
                        </p>
                      )}
                      {sku.obumaProductoId ? (
                        <div className="mt-1">
                          {!historicoPorSku[sku.id] && (
                            <button onClick={() => verHistorico(sku)} className="text-[10.5px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                              <History size={11} /> Ver proveedor histórico
                            </button>
                          )}
                          {historicoPorSku[sku.id] === 'cargando' && <span className="text-[10.5px] text-zinc-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Consultando OBUMA…</span>}
                          {historicoPorSku[sku.id] === 'sin_datos' && <span className="text-[10.5px] text-zinc-400">Sin historial de compras para este producto en OBUMA.</span>}
                          {Array.isArray(historicoPorSku[sku.id]) && (
                            <div className="mt-1 space-y-0.5">
                              {(historicoPorSku[sku.id] as SugerenciaHistorica[]).slice(0, 3).map((s, i) => (
                                <p key={i} className="text-[10.5px] text-zinc-600 flex items-center gap-1">
                                  {i === 0 && <Star size={10} className="fill-amber-400 text-amber-400" />}
                                  <b>{s.proveedorNombre}</b> — comprado {s.vecesComprado}x, promedio {fmtCLPHist(s.precioPromedio)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] text-zinc-300 mt-0.5">Sin homologar con OBUMA — no se puede buscar histórico.</p>
                      )}
                    </>
                  )}
                  {formSkuProducto === p.id && (
                    <div className="mt-3 rounded-xl border-2 border-teal-200 bg-white overflow-hidden" data-testid="form-sku">
                      <div className="px-4 py-3 bg-teal-50/60 border-b border-teal-100 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-bold text-teal-900">Crear el SKU de este producto</p>
                          <p className="text-[12px] text-teal-800/80 truncate">En la licitación: {p.descripcion}</p>
                        </div>
                        <button onClick={() => { setFormSkuProducto(null); setColaSku(null); }} className="text-zinc-400 hover:text-zinc-700 flex-shrink-0" aria-label="Cerrar"><X size={16} /></button>
                      </div>
                      <div className="p-4 space-y-4">
                        {sugerenciaSku.estado === 'listo' && sugerenciaSku.motivo && (
                          <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{sugerenciaSku.motivo}</p>
                        )}
                        {sugerenciaSku.estado === 'listo' && (sugerenciaSku.descripcionLibre || sugerenciaSku.archivoUrl) && (
                          <details className="text-[12px] text-indigo-800 bg-indigo-50/60 border border-indigo-100 rounded-lg px-3 py-2">
                            <summary className="cursor-pointer font-semibold flex items-center gap-1"><Zap size={12} /> Ver lo que dice el documento de este producto (para copiar marca, modelo y medidas)</summary>
                            {sugerenciaSku.descripcionLibre && <p className="mt-1.5 text-zinc-700 whitespace-pre-line">{sugerenciaSku.descripcionLibre}</p>}
                            {sugerenciaSku.archivoUrl && (
                              <a href={sugerenciaSku.archivoUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1.5 font-semibold underline">
                                Abrir el documento{sugerenciaSku.archivoNombre ? ` (${sugerenciaSku.archivoNombre})` : ''}
                              </a>
                            )}
                          </details>
                        )}

                        <label className="flex items-start gap-2.5 text-[12.5px] text-zinc-700 bg-indigo-50/60 border border-indigo-100 rounded-lg px-3 py-2.5 cursor-pointer">
                          <input type="checkbox" checked={formSku.crearEnObuma}
                            onChange={e => setFormSku(f => ({ ...f, crearEnObuma: e.target.checked, obumaProductoId: '' }))}
                            className="mt-0.5 accent-indigo-600" />
                          <span>
                            <span className="font-bold flex items-center gap-1 text-indigo-900"><Zap size={13} className="text-indigo-600" /> Crearlo también en Obuma</span>
                            <span className="block text-zinc-500">Se crea el producto real en el ERP (categoría «Mercado Publico») y el código que Obuma le dé es el SKU. Si lo desmarcas, solo se guarda un SKU propio aquí.</span>
                          </span>
                        </label>

                        {formSku.crearEnObuma ? (
                          <>
                            {/* Paso 1 */}
                            <section className="space-y-1.5">
                              <p className="text-[13px] font-bold text-zinc-800"><span className="inline-flex w-5 h-5 mr-1.5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">1</span>¿Qué producto es?</p>
                              <p className="text-[12px] text-zinc-500">Con tus palabras, sin marca ni modelo (eso va en el paso 3).</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label className="text-[11.5px] font-semibold text-zinc-600">Tipo de producto
                                  <input value={formSku.obTipo} onChange={e => setFormSku(f => ({ ...f, obTipo: e.target.value }))} placeholder="Ej: Catre clínico"
                                    className="mt-0.5 w-full text-[13px] font-normal text-zinc-900 border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                                </label>
                                <label className="text-[11.5px] font-semibold text-zinc-600">Característica <span className="font-normal text-zinc-400">(opcional)</span>
                                  <input value={formSku.obAtributo} onChange={e => setFormSku(f => ({ ...f, obAtributo: e.target.value }))} placeholder="Ej: Eléctrico, Sumergible, Core i5"
                                    className="mt-0.5 w-full text-[13px] font-normal text-zinc-900 border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                                </label>
                              </div>
                            </section>

                            {/* Paso 2 */}
                            <section className="space-y-1.5" data-testid="sku-existentes">
                              <p className="text-[13px] font-bold text-zinc-800"><span className="inline-flex w-5 h-5 mr-1.5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">2</span>¿Ya lo tenemos en Obuma?</p>
                              {duplicados.estado === 'idle' && <p className="text-[12px] text-zinc-400">Escribe el tipo de producto (paso 1) y busco en Obuma todas sus variantes.</p>}
                              {duplicados.estado === 'cargando' && <p className="text-[12px] text-zinc-500 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Buscando en Obuma todo lo que se parece a «{formSku.obTipo.trim()}»…</p>}
                              {duplicados.estado === 'listo' && duplicados.productos.length === 0 && (
                                <p className="text-[12.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✔ No hay nada parecido a «{formSku.obTipo.trim()}» en Obuma: puedes crear uno nuevo.</p>
                              )}
                              {duplicados.estado === 'listo' && duplicados.productos.length > 0 && (
                                <div className="border border-amber-200 bg-amber-50/60 rounded-lg overflow-hidden">
                                  <p className="px-3 py-2 text-[12.5px] font-bold text-amber-900 flex items-center gap-1.5"><AlertTriangle size={14} /> Encontré {duplicados.productos.length} producto{duplicados.productos.length === 1 ? '' : 's'} en Obuma que se parece{duplicados.productos.length === 1 ? '' : 'n'}. Si uno es el que compras, úsalo en vez de crear otro.</p>
                                  <ul className="max-h-60 overflow-y-auto divide-y divide-amber-100 bg-white">
                                    {duplicados.productos.map(m => (
                                      <li key={m.id} className="px-3 py-2 flex items-center gap-3 text-[12.5px]">
                                        <span className="min-w-0 flex-1">
                                          <b className="block text-zinc-900 truncate">{m.nombre}</b>
                                          <span className="text-zinc-500">código {m.codigoComercial}{String(m.categoriaId) === OBUMA_CATEGORIA_MERCADO_PUBLICO_UI ? '' : ' · otra categoría'}</span>
                                        </span>
                                        <button type="button" onClick={() => usarProductoExistente(m)} className="flex-shrink-0 text-[12px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-2.5 py-1 rounded-lg">Usar este</button>
                                      </li>
                                    ))}
                                  </ul>
                                  <label className="px-3 py-2 flex items-center gap-2 text-[12px] text-amber-900 bg-amber-50/80 border-t border-amber-100 cursor-pointer">
                                    <input type="checkbox" checked={confirmarPeseADuplicado} onChange={e => setConfirmarPeseADuplicado(e.target.checked)} className="accent-amber-600" />
                                    Ninguno de estos es lo que estoy comprando: crear uno nuevo
                                  </label>
                                </div>
                              )}
                            </section>

                            {/* Paso 3 */}
                            <section className="space-y-1.5">
                              <p className="text-[13px] font-bold text-zinc-800"><span className="inline-flex w-5 h-5 mr-1.5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">3</span>Marca, modelo y medidas</p>
                              <p className="text-[12px] text-zinc-500">Se leen de la cotización. Lo que no aparezca queda en ámbar: complétalo a mano (si el producto no tiene marca, modelo o medida, déjalo vacío). Se agregan al nombre y lo distinguen de otras variantes.</p>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <label className="text-[11.5px] font-semibold text-zinc-600">Marca
                                  <input value={formSku.marca} onChange={e => setFormSku(f => ({ ...f, marca: e.target.value }))} placeholder="Ej: CIC"
                                    className={`mt-0.5 w-full text-[13px] font-normal text-zinc-900 border rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500 ${formSku.marca.trim() ? 'border-zinc-200' : 'border-amber-300 bg-amber-50/40'}`} />
                                  <AvisoCampoSku valor={formSku.marca} leido={leidos.marca} cotizacionLeida={sugerenciaSku.estado === 'listo'} />
                                </label>
                                <label className="text-[11.5px] font-semibold text-zinc-600">Modelo
                                  <input value={formSku.modelo} onChange={e => setFormSku(f => ({ ...f, modelo: e.target.value }))} placeholder="Ej: Med Home 8"
                                    className={`mt-0.5 w-full text-[13px] font-normal text-zinc-900 border rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500 ${formSku.modelo.trim() ? 'border-zinc-200' : 'border-amber-300 bg-amber-50/40'}`} />
                                  <AvisoCampoSku valor={formSku.modelo} leido={leidos.modelo} cotizacionLeida={sugerenciaSku.estado === 'listo'} />
                                </label>
                                <label className="text-[11.5px] font-semibold text-zinc-600">Medidas
                                  <input value={formSku.medidas} onChange={e => setFormSku(f => ({ ...f, medidas: e.target.value }))} placeholder="Ej: 215 x 96 cm"
                                    className={`mt-0.5 w-full text-[13px] font-normal text-zinc-900 border rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500 ${formSku.medidas.trim() ? 'border-zinc-200' : 'border-amber-300 bg-amber-50/40'}`} />
                                  <AvisoCampoSku valor={formSku.medidas} leido={leidos.medida} cotizacionLeida={sugerenciaSku.estado === 'listo'} />
                                </label>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                <label className="text-[11.5px] font-semibold text-zinc-600">Proveedor
                                  <input value={formSku.proveedorNombre} onChange={e => setFormSku(f => ({ ...f, proveedorNombre: e.target.value }))} placeholder="Proveedor"
                                    className="mt-0.5 w-full text-[13px] font-normal text-zinc-900 border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                                </label>
                                <label className="text-[11.5px] font-semibold text-zinc-600">Código del proveedor <span className="font-normal text-zinc-400">(opcional)</span>
                                  <input value={formSku.skuProveedor} onChange={e => setFormSku(f => ({ ...f, skuProveedor: e.target.value }))} placeholder="El SKU que usa el proveedor"
                                    className="mt-0.5 w-full text-[13px] font-normal text-zinc-900 border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                                </label>
                              </div>
                              {!formSku.marca.trim() && !formSku.modelo.trim() && formSku.obTipo.trim() && (
                                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5">Sin marca ni modelo, el nombre quedará genérico. Si el producto los tiene, agrégalos para no confundirlo con otras variantes.</p>
                              )}
                            </section>

                            {/* Paso 4 */}
                            <section className="space-y-1.5">
                              <p className="text-[13px] font-bold text-zinc-800"><span className="inline-flex w-5 h-5 mr-1.5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">4</span>¿En qué categoría y subcategoría de Obuma va?</p>
                              {errorSubcats && (
                                <p className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
                                  No se pudieron cargar las categorías de Obuma: {errorSubcats}
                                  <button type="button" onClick={() => cargarSubcategorias(true)} className="font-semibold underline">Reintentar</button>
                                </p>
                              )}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label className="text-[11.5px] font-semibold text-zinc-600">Categoría
                                  <select value={formSku.obumaCategoriaId} onChange={e => setFormSku(f => ({ ...f, obumaCategoriaId: e.target.value, obumaSubcategoriaId: '' }))}
                                    className="mt-0.5 w-full text-[13px] font-normal text-zinc-900 border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500">
                                    {categorias.length === 0 && <option value={formSku.obumaCategoriaId}>{cargandoSubcategorias ? 'Cargando…' : 'Mercado Publico'}</option>}
                                    {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                  </select>
                                </label>
                                <label className="text-[11.5px] font-semibold text-zinc-600">Subcategoría
                                  <select value={formSku.obumaSubcategoriaId} onChange={e => setFormSku(f => ({ ...f, obumaSubcategoriaId: e.target.value }))}
                                    className="mt-0.5 w-full text-[13px] font-normal text-zinc-900 border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500">
                                    <option value="">{cargandoSubcategorias ? 'Cargando subcategorías de Obuma…' : 'Elegir subcategoría…'}</option>
                                    {subcategorias.filter(sc => !sc.categoriaId || sc.categoriaId === formSku.obumaCategoriaId).map(sc => <option key={sc.id} value={sc.id}>{sc.nombre}</option>)}
                                  </select>
                                </label>
                              </div>
                              {!cargandoSubcategorias && !errorSubcats && subcategorias.length > 0 && subcategorias.filter(sc => sc.categoriaId === formSku.obumaCategoriaId).length === 0 && (
                                <p className="text-[12px] text-amber-700">Esa categoría no tiene subcategorías en Obuma: elige otra.</p>
                              )}
                              {formSku.obumaSubcategoriaId && (
                                <p className="text-[12px] text-indigo-700 font-semibold flex items-center gap-1">
                                  {skuPreview.estado === 'cargando' && <><Loader2 size={12} className="animate-spin" /> Consultando el código en Obuma…</>}
                                  {skuPreview.estado === 'listo' && <><Zap size={12} /> Código que le dará Obuma: {skuPreview.codigo}</>}
                                  {skuPreview.estado === 'error' && <span className="text-rose-500">No se pudo consultar el código ahora; se generará igual al guardar.</span>}
                                </p>
                              )}
                            </section>

                            {/* Paso 5 */}
                            <section className="space-y-2" data-testid="sku-precios">
                              <p className="text-[13px] font-bold text-zinc-800"><span className="inline-flex w-5 h-5 mr-1.5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">5</span>Precios y opciones en Obuma</p>
                              {(() => {
                                const venta = Number(formSku.precioVenta.replace(/[^\d]/g, '')) || 0;
                                const costo = costoPreview.estado === 'listo' ? (costoPreview.monto || 0) : 0;
                                const iva = Math.round(venta * 0.19);
                                const margen = venta > 0 && costo > 0 ? Math.round(((venta - costo) / venta) * 1000) / 10 : null;
                                return (
                                  <>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                                        <p className="text-[11.5px] font-semibold text-zinc-500">Precio de costo (neto) · lo que vamos a comprar</p>
                                        <p className="text-[17px] font-extrabold text-zinc-900 tabular-nums">{costoPreview.estado === 'listo' ? fmtCLP(costoPreview.monto) : costoPreview.estado === 'cargando' ? 'consultando…' : '—'}</p>
                                        <p className="text-[11px] text-zinc-400">{costoPreview.estado === 'listo' ? `Del escenario de compra elegido (${costoPreview.escenarioTipo})` : 'Falta elegir el escenario de compra'}</p>
                                      </div>
                                      <label className="rounded-lg border border-zinc-200 px-3 py-2 block">
                                        <span className="block text-[11.5px] font-semibold text-zinc-500">Precio de venta (neto) · lo que cobramos al cliente</span>
                                        <input inputMode="numeric" value={formSku.precioVenta} onChange={e => setFormSku(f => ({ ...f, precioVenta: e.target.value }))} placeholder="Ej: 1173769"
                                          className={`mt-0.5 w-full text-[17px] font-extrabold tabular-nums text-zinc-900 border rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-teal-500 ${venta > 0 ? 'border-zinc-200' : 'border-amber-300 bg-amber-50/40'}`} />
                                        {venta > 0
                                          ? <span className="block text-[11px] text-zinc-400 mt-0.5">IVA {fmtCLP(iva)} · total {fmtCLP(venta + iva)}{margen != null ? ` · margen ${margen} %` : ''}</span>
                                          : <span className="block text-[11px] font-semibold text-amber-700 mt-0.5">⚠ No se encontró el precio de venta de la licitación: complétalo a mano.</span>}
                                      </label>
                                    </div>
                                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-0.5">
                                      {([
                                        ['paraVenta', 'Se puede vender'], ['paraCompra', 'Se puede comprar'], ['inventariable', 'Se mantiene stock'], ['venderEnWeb', 'Sincronizar con la web'],
                                      ] as const).map(([k, et]) => (
                                        <label key={k} className="flex items-center gap-1.5 text-[12.5px] text-zinc-700 cursor-pointer">
                                          <input type="checkbox" checked={formSku[k]} onChange={e => setFormSku(f => ({ ...f, [k]: e.target.checked }))} className="accent-teal-600" /> {et}
                                        </label>
                                      ))}
                                    </div>
                                  </>
                                );
                              })()}
                            </section>

                            {/* Paso 6 */}
                            <section className="rounded-lg border border-teal-200 bg-teal-50/50 px-3.5 py-3 space-y-1.5">
                              <p className="text-[13px] font-bold text-teal-900"><span className="inline-flex w-5 h-5 mr-1.5 rounded-full bg-teal-600 text-white text-[11px] items-center justify-center">6</span>Revisa lo que se va a crear en Obuma</p>
                              <p className="text-[13px] text-zinc-800"><span className="text-zinc-500">Nombre: </span><b>{nombreObumaPreview || <span className="font-normal text-zinc-400 italic">completa el paso 1…</span>}</b></p>
                              <p className="text-[13px] text-zinc-800"><span className="text-zinc-500">Código: </span>{skuPreview.estado === 'listo' ? <b>{skuPreview.codigo}</b> : <span className="text-zinc-400">elige la subcategoría (paso 4)</span>}</p>
                              <p className="text-[13px] text-zinc-800">
                                <span className="text-zinc-500">Costo neto (compra): </span>
                                {costoPreview.estado === 'cargando' && <span className="inline-flex items-center gap-1 text-zinc-400"><Loader2 size={12} className="animate-spin" /> consultando el escenario…</span>}
                                {costoPreview.estado === 'listo' && <><b>{fmtCLP(costoPreview.monto)}</b> <span className="text-zinc-500">(escenario {costoPreview.escenarioTipo})</span></>}
                                {costoPreview.estado === 'sin_datos' && <span className="text-rose-600">no se pudo obtener el costo del escenario elegido</span>}
                              </p>
                              <p className="text-[13px] text-zinc-800"><span className="text-zinc-500">Precio de venta neto: </span>{Number(formSku.precioVenta.replace(/[^\d]/g, '')) > 0 ? <b>{fmtCLP(Number(formSku.precioVenta.replace(/[^\d]/g, '')))}</b> : <span className="text-zinc-400">sin precio de venta</span>}</p>
                              {costoPreview.estado === 'listo' && (
                                <label className="flex items-center gap-2 text-[12.5px] text-teal-900 pt-1 cursor-pointer">
                                  <input type="checkbox" checked={costoConfirmado} onChange={e => setCostoConfirmado(e.target.checked)} className="accent-teal-600" />
                                  Confirmo que este costo es el correcto (puede haber cambiado si se editó el escenario)
                                </label>
                              )}
                            </section>
                          </>
                        ) : (
                          <section className="space-y-2">
                            <p className="text-[12px] text-zinc-500">SKU propio, sin crear nada en Obuma.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input value={formSku.skuPropio} onChange={e => setFormSku(f => ({ ...f, skuPropio: e.target.value }))} placeholder="SKU propio"
                                className="sm:col-span-2 text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                              <input value={formSku.marca} onChange={e => setFormSku(f => ({ ...f, marca: e.target.value }))} placeholder="Marca"
                                className="text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                              <input value={formSku.modelo} onChange={e => setFormSku(f => ({ ...f, modelo: e.target.value }))} placeholder="Modelo"
                                className="text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                              <input value={formSku.proveedorNombre} onChange={e => setFormSku(f => ({ ...f, proveedorNombre: e.target.value }))} placeholder="Proveedor"
                                className="text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                              <input value={formSku.skuProveedor} onChange={e => setFormSku(f => ({ ...f, skuProveedor: e.target.value }))} placeholder="SKU proveedor (opcional)"
                                className="text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                              <input value={formSku.obumaProductoId} onChange={e => setFormSku(f => ({ ...f, obumaProductoId: e.target.value }))} placeholder="ID del producto en Obuma (opcional)"
                                className="sm:col-span-2 text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500" />
                            </div>
                          </section>
                        )}

                        <div className="flex items-center gap-3 pt-1">
                          <button onClick={crearSku} disabled={(!formSku.crearEnObuma && !formSku.skuPropio.trim()) || guardandoSku || (formSku.crearEnObuma && (!formSku.obumaSubcategoriaId || !nombreObumaPreview || (duplicados.productos.length > 0 && !confirmarPeseADuplicado) || costoPreview.estado !== 'listo' || !costoConfirmado || (formSku.paraVenta && !(Number(formSku.precioVenta.replace(/[^\d]/g, '')) > 0))))}
                            className="text-[13.5px] font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-lg">
                            {guardandoSku ? <Loader2 size={14} className="animate-spin" /> : formSku.crearEnObuma ? 'Crear el SKU en Obuma' : 'Guardar SKU'}
                          </button>
                          <button onClick={() => { setFormSkuProducto(null); setColaSku(null); }} className="text-[12.5px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
                          {formSku.crearEnObuma && (
                            <span className="text-[11.5px] text-zinc-400">
                              {!nombreObumaPreview ? 'Falta: el tipo de producto (paso 1)'
                                : duplicados.productos.length > 0 && !confirmarPeseADuplicado ? 'Falta: usar uno existente o marcar que ninguno es (paso 2)'
                                : !formSku.obumaSubcategoriaId ? 'Falta: la subcategoría (paso 4)'
                                : formSku.paraVenta && !(Number(formSku.precioVenta.replace(/[^\d]/g, '')) > 0) ? 'Falta: el precio de venta (paso 5)'
                                : !costoConfirmado ? 'Falta: confirmar el costo (paso 6)' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
