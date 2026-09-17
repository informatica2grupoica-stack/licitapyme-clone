'use client';

// COMPUERTAS DE APROBACIÓN (spec §10) + CREACIÓN DE SKU (spec §7). Dos compuertas separadas e
// independientes: Compra (sobre el escenario ya elegido) y Margen (mínimo 20%, avisa sin bloquear
// bajo eso). El SKU se habilita recién con la Compuerta 1 resuelta a favor.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconShieldCheck as ShieldCheck, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconCircleX as XCircle, IconEdit as Edit3, IconAlertTriangle as AlertTriangle, IconTag as Tag, IconPlus as Plus, IconX as X, IconHistory as History, IconStar as Star, IconBolt as Zap } from '@tabler/icons-react';

type Estado = 'PENDIENTE' | 'APROBADA' | 'APROBADA_CON_MODIFICACION' | 'RECHAZADA';
type Tipo = 'COMPRA' | 'MARGEN';
type Decision = 'APROBAR' | 'APROBAR_CON_MODIFICACION' | 'RECHAZAR';

interface Aprobacion {
  tipo: Tipo; estado: Estado; detalle: any; motivo: string | null;
  propuestoPorNombre: string | null; propuestoAt: string | null;
  resueltoPorNombre: string | null; resueltoAt: string | null; comentarioResolucion: string | null;
}
interface Margen { ventaNeta: number | null; costoNeto: number | null; margenPct: number | null; fuenteCosto: string | null }
interface Presupuesto { presupuestoOriginal: number | null; costoEscenario: number | null; excedePct: number | null; excede: boolean; costoFlete: number | null }
interface Sku { id: number; productoId: number; skuPropio: string; skuProveedor: string | null; proveedorNombre: string | null; marca: string | null; modelo: string | null; obumaProductoId: string | null; obumaCodigoComercial: string | null }
interface SubcategoriaObuma { id: string; nombre: string }
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

function BloqueCompuerta({ tipo, titulo, aprobacion, esJefeDeVentas, puedeOperar, onProponer, onResolver, resumen, requiereMotivo, motivoLabel, desactualizada }: {
  tipo: Tipo; titulo: string; aprobacion: Aprobacion | null; esJefeDeVentas: boolean; puedeOperar: boolean;
  onProponer: (motivo: string | null) => void; onResolver: (decision: Decision, comentario: string | null) => void; resumen: React.ReactNode;
  requiereMotivo?: boolean; motivoLabel?: string; desactualizada?: boolean;
}) {
  const [comentario, setComentario] = useState('');
  const [decidiendo, setDecidiendo] = useState(false);
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
      <div className="mt-1.5 text-[11.5px] text-zinc-500">{resumen}</div>

      {desactualizada && (
        <p className="mt-1.5 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1 flex items-start gap-1">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          Esto quedó desactualizado — el escenario elegido cambió después de proponerse. Vuelve a proponer con los datos actuales antes de aprobar. Si además cargaste una cotización nueva, primero ve a <b>Costeo y Auditoría → Escenarios</b> y confirma el monto ahí — acá solo se refleja lo que ya quedó elegido.
        </p>
      )}

      {aprobacion?.motivo && <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">{aprobacion.motivo}</p>}
      {aprobacion?.comentarioResolucion && (
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
        <div className="mt-2 space-y-1.5">
          {requiereMotivo && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <p className="text-[10.5px] font-bold text-amber-700 flex items-center gap-1"><AlertTriangle size={11} /> Necesita un motivo para proponerse</p>
              <input value={motivoPropuesta} onChange={e => setMotivoPropuesta(e.target.value)} placeholder={motivoLabel || 'Motivo…'}
                className="mt-1 w-full text-[11.5px] border border-amber-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-500 bg-white" />
            </div>
          )}
          <button onClick={() => onProponer(motivoPropuesta.trim() || null)} disabled={!puedeProponer}
            className={`text-[11.5px] font-semibold disabled:text-zinc-300 disabled:cursor-not-allowed ${desactualizada ? 'text-rose-700 hover:text-rose-800' : 'text-teal-700 hover:text-teal-800'}`}>
            {aprobacion?.estado === 'PENDIENTE' ? 'Actualizar propuesta' : 'Proponer para aprobación'}
          </button>
        </div>
      )}

      {aprobacion?.estado === 'PENDIENTE' && esJefeDeVentas && (
        <div className="mt-2 space-y-1.5">
          <input value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Comentario (obligatorio si rechaza)…"
            className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setDecidiendo(true); onResolver('APROBAR', comentario || null); }} disabled={decidiendo}
              className="flex items-center gap-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-2 py-1.5 rounded-lg">
              <CheckCircle2 size={12} /> Aprobar
            </button>
            <button onClick={() => { setDecidiendo(true); onResolver('APROBAR_CON_MODIFICACION', comentario || null); }} disabled={decidiendo}
              className="flex items-center gap-1 text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2 py-1.5 rounded-lg">
              <Edit3 size={12} /> Con modificación
            </button>
            <button onClick={() => { if (!comentario.trim()) return; setDecidiendo(true); onResolver('RECHAZAR', comentario); }} disabled={decidiendo}
              className="flex items-center gap-1 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-2 py-1.5 rounded-lg">
              <XCircle size={12} /> Rechazar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AprobacionesCompraCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [compra, setCompra] = useState<Aprobacion | null>(null);
  const [margen, setMargen] = useState<Aprobacion | null>(null);
  const [margenActual, setMargenActual] = useState<Margen | null>(null);
  const [presupuestoActual, setPresupuestoActual] = useState<Presupuesto | null>(null);
  const [escenarioElegidoActual, setEscenarioElegidoActual] = useState<{ tipo: string; costoTotal: number } | null>(null);
  const [esJefeDeVentas, setEsJefeDeVentas] = useState(false);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [formSkuProducto, setFormSkuProducto] = useState<number | null>(null);
  // El nombre que se manda a Obuma se arma en vivo con Tipo (obligatorio) + Atributo (opcional) +
  // la Marca/Modelo que YA se escriben arriba para el SKU propio — sin pedirlos dos veces (antes
  // pedía Medida/Marca de nuevo acá y la gente terminaba copiando el código del SKU en "Tipo" por
  // no tener qué poner, spec §7.3: "nunca se copia de producto.descripcion" sigue firme, pero eso
  // no significa duplicar campos que ya existen en el formulario).
  const formSkuVacio = {
    skuPropio: '', skuProveedor: '', proveedorNombre: '', marca: '', modelo: '', obumaProductoId: '',
    crearEnObuma: false, obumaSubcategoriaId: '', obTipo: '', obAtributo: '',
  };
  const [formSku, setFormSku] = useState(formSkuVacio);
  const [historicoPorSku, setHistoricoPorSku] = useState<Record<number, SugerenciaHistorica[] | 'cargando' | 'sin_datos'>>({});
  const [guardandoSku, setGuardandoSku] = useState(false);
  const [subcategorias, setSubcategorias] = useState<SubcategoriaObuma[]>([]);
  const [cargandoSubcategorias, setCargandoSubcategorias] = useState(false);
  const [skuPreview, setSkuPreview] = useState<{ estado: 'idle' | 'cargando' | 'listo' | 'error'; codigo: string | null }>({ estado: 'idle', codigo: null });
  const [duplicados, setDuplicados] = useState<{ estado: 'idle' | 'cargando' | 'listo'; productos: ObumaCoincidencia[] }>({ estado: 'idle', productos: [] });
  const [confirmarPeseADuplicado, setConfirmarPeseADuplicado] = useState(false);
  // Pedido explícito: "debo de verificarlo antes que lo mandes por si tiene modificaciones" — el
  // costo viene del escenario elegido y puede haber cambiado desde que se abrió el formulario, así
  // que se muestra ACÁ (mismo dato que después vuelve a comprobar el backend) y hay que confirmarlo
  // a mano antes de que el botón "Guardar" quede habilitado.
  const [costoPreview, setCostoPreview] = useState<{ estado: 'idle' | 'cargando' | 'listo' | 'sin_datos'; monto: number | null; escenarioTipo: string | null }>({ estado: 'idle', monto: null, escenarioTipo: null });
  const [costoConfirmado, setCostoConfirmado] = useState(false);
  // Sugerencia del documento leído (pedido explícito del usuario, 15-sep-2026: "debe de ser capaz
  // de poder darme como referencia el nombre del producto de la cotización si ya lo leyó y lo
  // guardó en la base de datos... y así en todo lo que tenga que llenar lo puede ver"). Prellena
  // Proveedor solo (dato literal, sin ambigüedad); Marca/Modelo NUNCA se autocompletan solos —
  // el documento no los trae como campos separados y adivinarlos sería inventar un dato que se
  // manda tal cual a Obuma — se muestran como texto de referencia para copiar a mano.
  const [sugerenciaSku, setSugerenciaSku] = useState<
    { estado: 'idle' } | { estado: 'cargando' } |
    { estado: 'listo'; proveedorNombre: string | null; descripcionLibre: string | null; archivoUrl: string | null; archivoNombre: string | null }
  >({ estado: 'idle' });
  const [verificandoObumaId, setVerificandoObumaId] = useState<number | null>(null);

  // Nombre para Obuma = Tipo + Atributo + Marca + Modelo (estos dos últimos ya están arriba, en el
  // mismo formulario — no se piden de nuevo). Siempre en MAYÚSCULAS — Obuma lo guarda así igual
  // (crearProductoObuma hace .toUpperCase() antes de mandarlo), el preview debe mostrar lo mismo
  // que va a quedar guardado, no una versión distinta que después "cambia sola".
  const nombreObumaPreview = [formSku.obTipo, formSku.obAtributo, formSku.marca, formSku.modelo]
    .map(s => s.trim()).filter(Boolean).join(' ').toUpperCase();

  const cargar = useCallback(async () => {
    try {
      const [rA, rS, rP] = await Promise.all([
        fetch(`/api/compras/${negocioId}/aprobaciones`), fetch(`/api/compras/${negocioId}/sku`), fetch(`/api/compras/${negocioId}/productos`),
      ]);
      const [dA, dS, dP] = await Promise.all([rA.json(), rS.json(), rP.json()]);
      if (dA.success) {
        setCompra(dA.compra); setMargen(dA.margen); setMargenActual(dA.margenActual); setPresupuestoActual(dA.presupuestoActual);
        setEscenarioElegidoActual(dA.escenarioElegidoActual); setEsJefeDeVentas(dA.esJefeDeVentas);
      }
      if (dS.success) setSkus(dS.skus || []);
      if (dP.success) setProductos((dP.productos || []).filter((p: any) => p.subestado !== 'RENUNCIADO'));
    } catch (e: any) {
      toast.error('No se pudieron cargar las aprobaciones', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  // Subcategorías reales de Obuma (bajo "Mercado Publico") — solo se piden cuando se abre el
  // formulario de un SKU nuevo, no en cada carga de la pantalla (§7.2: cuota de consultas diarias).
  const cargarSubcategorias = async () => {
    if (subcategorias.length || cargandoSubcategorias) return;
    setCargandoSubcategorias(true);
    try {
      const res = await fetch('/api/compras/obuma-subcategorias');
      const data = await res.json();
      if (data.success) setSubcategorias(data.subcategorias || []);
    } catch { /* el checkbox "Crear en Obuma" simplemente no tendrá opciones — no bloquea el resto del formulario */ }
    finally { setCargandoSubcategorias(false); }
  };

  useEffect(() => { cargar(); }, [cargar]);

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
    fetch(`/api/compras/${negocioId}/sku/costo-preview?productoId=${formSkuProducto}`)
      .then(r => r.json())
      .then(data => {
        if (cancelado) return;
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
          archivoUrl: s.archivoUrl, archivoNombre: s.archivoNombre,
        });
        // Solo prellena Proveedor (dato literal de la cotización) — nunca pisa lo que la persona
        // ya escribió a mano.
        if (s.proveedorNombre) setFormSku(f => f.proveedorNombre.trim() ? f : { ...f, proveedorNombre: s.proveedorNombre });
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
    if (formSku.crearEnObuma && !costoConfirmado) {
      toast.error('Falta confirmar el costo', 'Revisa el monto que se va a mandar a Obuma y marca la casilla de confirmación.');
      return;
    }
    setGuardandoSku(true);
    try {
      const { obTipo, obAtributo, ...resto } = formSku;
      const res = await fetch(`/api/compras/${negocioId}/sku`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoId: formSkuProducto, ...resto, nombreObuma: nombreObumaPreview || null, costoEsperado: costoPreview.monto }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear');
      toast.success(formSku.crearEnObuma ? 'SKU creado — también se creó el producto real en Obuma' : 'SKU creado');
      setSkus(data.skus); setFormSkuProducto(null); setFormSku(formSkuVacio);
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

  const compraAprobada = compra && ['APROBADA', 'APROBADA_CON_MODIFICACION'].includes(compra.estado);
  // §10.5: la propuesta queda como un snapshot congelado — si después se elige otro escenario, ese
  // snapshot no se actualiza solo (invalidarAprobacionesCompras solo cambia el estado). Se compara
  // contra el escenario elegido EN VIVO para avisar en vez de dejar el número viejo sin marcar.
  const compraDesactualizada = !!(compra?.detalle && escenarioElegidoActual
    && (compra.detalle.escenarioTipo !== escenarioElegidoActual.tipo
      || Math.abs(Number(compra.detalle.costoTotal) - escenarioElegidoActual.costoTotal) > 1));

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold text-zinc-400 uppercase flex items-center gap-1.5 px-0.5"><ShieldCheck size={13} /> Compuertas de aprobación</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <BloqueCompuerta
          tipo="COMPRA" titulo="Compuerta 1 — Aprobación de compra" aprobacion={compra} esJefeDeVentas={esJefeDeVentas} puedeOperar={puedeOperar}
          onProponer={(motivo) => proponer('COMPRA', motivo)} onResolver={(d, c) => resolver('COMPRA', d, c)}
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
                Presupuesto costeado (mercadería): {fmtCLP(presupuestoActual.presupuestoOriginal)} · Comprando (mercadería): {fmtCLP(presupuestoActual.costoEscenario)}
                {presupuestoActual.excede ? ` — ${presupuestoActual.excedePct}% sobre lo previsto` : ' — dentro de presupuesto'}
                {/* Flete aparte, informativo — nunca cuenta como "exceso de presupuesto" (el costeo
                    original no cotiza logística, spec §8.10.2). Pedido explícito del usuario,
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
          tipo="MARGEN" titulo="Compuerta 2 — Aprobación de margen" aprobacion={margen} esJefeDeVentas={esJefeDeVentas} puedeOperar={puedeOperar}
          onProponer={(motivo) => proponer('MARGEN', motivo)} onResolver={(d, c) => resolver('MARGEN', d, c)}
          requiereMotivo={margenActual?.margenPct != null && margenActual.margenPct < 20} motivoLabel="¿Por qué se aprueba con margen bajo el 20%?"
          resumen={margenActual?.margenPct != null ? (
            <span className={margenActual.margenPct < 20 ? 'text-rose-600 font-semibold flex items-center gap-1' : ''}>
              {margenActual.margenPct < 20 && <AlertTriangle size={12} />} Margen previsto: {margenActual.margenPct}%
              {margenActual.fuenteCosto === 'costeo_estimado' && ' (costeo estimado, sin escenario elegido aún)'}
            </span>
          ) : <span>Sin datos suficientes para calcular margen todavía.</span>}
        />
      </div>
      {!compra && !margen && (
        <p className="text-[10.5px] text-zinc-400 px-0.5">
          El control de gasto compara automáticamente lo costeado al ofertar y el margen mínimo (20%) contra lo que de verdad se va a comprar — la orden de compra en Obuma no se habilita hasta que ambas compuertas queden aprobadas.
        </p>
      )}

      {compraAprobada && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100 flex items-center gap-1.5"><Tag size={13} /> SKU</p>
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
                              <History size={11} /> Ver proveedor histórico (spec §19.3)
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
                    <div className="mt-2 space-y-1.5">
                      {/* Sugerencia del documento leído (pedido explícito, 15-sep-2026): Marca/Modelo
                          no se autocompletan solos (el documento no los trae como campos separados,
                          adivinarlos sería inventar), pero se muestra el texto del documento ya
                          leído para copiar el nombre exacto sin volver a abrir el PDF. */}
                      {sugerenciaSku.estado === 'listo' && (sugerenciaSku.descripcionLibre || sugerenciaSku.archivoUrl) && (
                        <div className="text-[10.5px] text-indigo-700 bg-indigo-50/60 border border-indigo-100 rounded-lg px-2.5 py-2">
                          <p className="font-semibold mb-0.5 flex items-center gap-1"><Zap size={10} /> Del documento ya leído — copia Marca/Modelo de acá si aparecen:</p>
                          {sugerenciaSku.descripcionLibre && (
                            <p className="text-zinc-600 line-clamp-3 whitespace-pre-line">{sugerenciaSku.descripcionLibre}</p>
                          )}
                          {sugerenciaSku.archivoUrl && (
                            <a href={sugerenciaSku.archivoUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 font-semibold underline">
                              Ver documento{sugerenciaSku.archivoNombre ? ` (${sugerenciaSku.archivoNombre})` : ''}
                            </a>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5">
                        {formSku.crearEnObuma ? (
                          <p className="col-span-2 text-[10.5px] text-indigo-600 bg-indigo-50/60 border border-indigo-100 rounded-lg px-2 py-1.5 flex items-center gap-1">
                            <Zap size={11} /> El código que Obuma le asigne va a ser el SKU — no hace falta inventar uno aparte.
                          </p>
                        ) : (
                          <input value={formSku.skuPropio} onChange={e => setFormSku(f => ({ ...f, skuPropio: e.target.value }))}
                            placeholder="SKU propio" className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 col-span-2" />
                        )}
                        <input value={formSku.marca} onChange={e => setFormSku(f => ({ ...f, marca: e.target.value }))}
                          placeholder={formSku.crearEnObuma ? 'Marca (va en el nombre de Obuma)' : 'Marca'} className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
                        <input value={formSku.modelo} onChange={e => setFormSku(f => ({ ...f, modelo: e.target.value }))}
                          placeholder={formSku.crearEnObuma ? 'Modelo (va en el nombre de Obuma)' : 'Modelo'} className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
                        <input value={formSku.proveedorNombre} onChange={e => setFormSku(f => ({ ...f, proveedorNombre: e.target.value }))}
                          placeholder="Proveedor" className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
                        <input value={formSku.skuProveedor} onChange={e => setFormSku(f => ({ ...f, skuProveedor: e.target.value }))}
                          placeholder="SKU proveedor (opcional)" className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
                        {!formSku.crearEnObuma && (
                          <input value={formSku.obumaProductoId} onChange={e => setFormSku(f => ({ ...f, obumaProductoId: e.target.value }))}
                            placeholder="ID producto en OBUMA (opcional, habilita histórico §19.3)" className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 col-span-2" />
                        )}
                      </div>

                      <label className="flex items-start gap-2 text-[11px] text-zinc-700 bg-indigo-50/60 border border-indigo-100 rounded-lg px-2.5 py-2">
                        <input type="checkbox" checked={formSku.crearEnObuma}
                          onChange={e => setFormSku(f => ({ ...f, crearEnObuma: e.target.checked, obumaProductoId: '' }))}
                          className="mt-0.5 accent-indigo-600" />
                        <span>
                          <span className="font-semibold flex items-center gap-1"><Zap size={11} className="text-indigo-600" /> Crear también en Obuma</span>
                          <span className="text-zinc-400"> — escritura real en el ERP (categoría "Mercado Publico"), usa el costo del escenario elegido, código de barra generado por Obuma.</span>
                        </span>
                      </label>

                      {formSku.crearEnObuma && (
                        <div className="space-y-1.5">
                          <select value={formSku.obumaSubcategoriaId} onChange={e => setFormSku(f => ({ ...f, obumaSubcategoriaId: e.target.value }))}
                            className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500">
                            <option value="">{cargandoSubcategorias ? 'Cargando subcategorías de Obuma…' : 'Elegir subcategoría (Mercado Publico)…'}</option>
                            {subcategorias.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>

                          {formSku.obumaSubcategoriaId && (
                            <p className="text-[10.5px] text-indigo-600 font-semibold flex items-center gap-1">
                              {skuPreview.estado === 'cargando' && <><Loader2 size={10} className="animate-spin" /> Consultando código en Obuma…</>}
                              {skuPreview.estado === 'listo' && <><Zap size={10} /> Código Obuma: {skuPreview.codigo}</>}
                              {skuPreview.estado === 'error' && <span className="text-rose-500">No se pudo consultar el código en Obuma — se generará igual al guardar.</span>}
                            </p>
                          )}

                          <p className="text-[10px] text-zinc-400 uppercase font-semibold pt-0.5">Qué estamos comprando (§7.3) — usa la Marca/Modelo de arriba, no la línea de la licitación</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <input value={formSku.obTipo} onChange={e => setFormSku(f => ({ ...f, obTipo: e.target.value }))}
                              placeholder="Tipo (ej: Sensor de presión, Notebook)" className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                            <input value={formSku.obAtributo} onChange={e => setFormSku(f => ({ ...f, obAtributo: e.target.value }))}
                              placeholder="Atributo (opcional, ej: Sumergible, Core i5)" className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500" />
                          </div>
                          {!formSku.marca && !formSku.modelo && (
                            <p className="text-[10.5px] text-zinc-400 italic">La Marca y el Modelo que escribas arriba se agregan solos al nombre — no hace falta repetirlos acá.</p>
                          )}

                          {duplicados.estado === 'cargando' && (
                            <p className="text-[10.5px] text-zinc-400 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Buscando productos parecidos en Obuma…</p>
                          )}
                          {duplicados.estado === 'listo' && duplicados.productos.length > 0 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 space-y-1.5">
                              <p className="text-[10.5px] font-bold text-amber-700 flex items-center gap-1">
                                <AlertTriangle size={11} /> Ya existen {duplicados.productos.length} producto(s) parecidos en Obuma — revisa antes de crear otro:
                              </p>
                              <div className="max-h-32 overflow-y-auto space-y-1">
                                {duplicados.productos.map(m => (
                                  <div key={m.id} className="flex items-center justify-between gap-2 text-[10.5px] text-amber-800">
                                    <p className="min-w-0">
                                      <b>{m.nombre}</b> — código {m.codigoComercial}
                                      {String(m.categoriaId) === OBUMA_CATEGORIA_MERCADO_PUBLICO_UI ? '' : ' (otra categoría)'}
                                    </p>
                                    <button type="button" onClick={() => usarProductoExistente(m)}
                                      className="flex-shrink-0 font-semibold text-indigo-600 hover:text-indigo-700 underline decoration-dotted">
                                      Usar este
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <label className="flex items-center gap-1.5 text-[10.5px] text-amber-800 pt-0.5">
                                <input type="checkbox" checked={confirmarPeseADuplicado} onChange={e => setConfirmarPeseADuplicado(e.target.checked)} className="accent-amber-600" />
                                Ninguno de estos es lo que estoy comprando — crear de todas formas
                              </label>
                            </div>
                          )}

                          <div className="bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-2 space-y-1.5">
                            <p className="text-[10px] font-bold text-teal-700 uppercase">Esto es lo que se va a mandar a Obuma — revísalo</p>
                            <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Nombre: </span>{nombreObumaPreview || <span className="text-zinc-300 italic">completa Tipo arriba…</span>}</p>
                            <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">Código: </span>{skuPreview.estado === 'listo' ? skuPreview.codigo : '—'}</p>
                            <p className="text-[11px] text-zinc-700">
                              <span className="text-zinc-400">Costo neto: </span>
                              {costoPreview.estado === 'cargando' && <span className="inline-flex items-center gap-1 text-zinc-400"><Loader2 size={10} className="animate-spin" /> Consultando el escenario…</span>}
                              {costoPreview.estado === 'listo' && (
                                <><b>{fmtCLP(costoPreview.monto)}</b> <span className="text-zinc-400">(escenario {costoPreview.escenarioTipo})</span></>
                              )}
                              {costoPreview.estado === 'sin_datos' && <span className="text-rose-500">No se pudo obtener el costo del escenario elegido.</span>}
                            </p>
                            {costoPreview.estado === 'listo' && (
                              <label className="flex items-center gap-1.5 text-[10.5px] text-teal-800 pt-0.5">
                                <input type="checkbox" checked={costoConfirmado} onChange={e => setCostoConfirmado(e.target.checked)} className="accent-teal-600" />
                                Confirmo que este es el costo correcto — puede haber cambiado si se editó el escenario
                              </label>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5">
                        <button onClick={crearSku} disabled={(!formSku.crearEnObuma && !formSku.skuPropio.trim()) || guardandoSku || (formSku.crearEnObuma && (!formSku.obumaSubcategoriaId || !nombreObumaPreview || (duplicados.productos.length > 0 && !confirmarPeseADuplicado) || costoPreview.estado !== 'listo' || !costoConfirmado))}
                          className="text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                          {guardandoSku ? <Loader2 size={12} className="animate-spin" /> : 'Guardar'}
                        </button>
                        <button onClick={() => setFormSkuProducto(null)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
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
