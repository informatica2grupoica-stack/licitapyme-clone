'use client';

// SECCIÓN "COMPRAS" — Módulo de Compras, Fase 1 (spec §3-§5). Aparece cuando el negocio pasa a
// GANADA: resumen ejecutivo de solo lectura, asignación de encargado (jefe de ventas, 3h hábiles
// con fallback automático) y el motor de tareas de Validación/Administrativo.
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { useSession } from '@/app/lib/session-context';
import {
  ShoppingCart, Loader2, UserPlus, Clock, AlertTriangle, CheckCircle2, Circle, PlayCircle,
  Plus, ChevronDown, ChevronUp, DollarSign, FileWarning, Building2, Calendar, X,
  FileText, Save, ClipboardList, Flag, RefreshCw, Zap, ExternalLink,
} from 'lucide-react';

interface ResumenCompras {
  licitacionNombre: string | null; organismo: string | null;
  montoNuestro: number | null; montoOfertado: number | null;
  presupuestoProyecto: number | null; fechaCierreLicitacion: string | null;
  plazoEntregaOfertado: string | null; hitoInicioPlazo: string | null;
  requiereBoletaFielCumplimiento: boolean; requiereFirmaContrato: boolean; plazoAceptacionOC: string;
  existeCosteo: boolean; montoCosteado: number | null; margenPrevisto: number | null;
  contactosCliente: {
    organismo: string | null; unidad: string | null; direccion: string | null; comuna: string | null;
    usuarioNombre: string | null; usuarioCargo: string | null;
    // §4.2 campo 11 ("todo dato disponible") y §17.3 (el contacto de PAGOS, que nunca es la misma
    // persona que la contraparte técnica). Los dos vienen en la ficha de MP.
    responsableContratoNombre?: string | null; responsableContratoEmail?: string | null; responsableContratoFono?: string | null;
    responsablePagoNombre?: string | null; responsablePagoEmail?: string | null;
  } | null;
  faltantes: string[];
}

// Orden de compra DEL CLIENTE (§3.6) — la que el organismo emite a nuestro favor. No es la que
// nosotros le emitimos al proveedor (esa vive en OBUMA).
interface OrdenCompra {
  numero: string | null; emitidaAt: string | null; aceptadaAt: string | null;
  monto: number | null; totalNeto: number | null; difiere: boolean; observacion: string | null;
  registradaPorNombre: string | null; actualizadaAt: string | null;
  // 'mp' = la trajo el sistema solo desde Mercado Público · 'manual' = la tipeó alguien.
  origen: 'mp' | 'manual' | null; codigoMp: string | null; estadoMp: string | null; vinculadaAt: string | null;
}
/** La misma orden, del lado de `ordenes_compra`: es la que tiene el link al portal y el PDF. */
interface OrdenCompraMp { codigo: string; estado: string | null; url: string | null; pdfUrl: string | null }

interface Asignacion {
  negocioId: number; licitacionCodigo: string; ganadoAt: string; vencimientoAsignacionAt: string;
  urgente: boolean; asignadoA: number | null; asignadoNombre: string | null; asignadoAt: string | null; asignadoPor: number | null;
  resumen: ResumenCompras | null;
  ordenCompra: OrdenCompra;
}

// Un campo del formulario de registro de la tarea. Viene del CATÁLOGO (tabla, no código): agregar
// una pregunta al cuestionario del vendedor es un UPDATE — §1.3.5, todo catálogo es enunciativo.
interface CampoRegistro { clave: string; etiqueta: string; tipo: 'texto' | 'parrafo' | 'si_no'; placeholder?: string }

interface Tarea {
  id: number; catalogoClave: string | null; categoria: string; titulo: string; descripcion: string | null;
  estado: 'PENDIENTE' | 'EN_CURSO' | 'HECHA'; responsableId: number | null; responsableNombre: string | null;
  plazoAt: string | null; creadoAt: string; primerContactoAt: string | null;
  cerradoAt: string | null; cerradoPorNombre: string | null; notaCierre: string | null;
  esManual: boolean; vencida: boolean;
  campos: CampoRegistro[]; registro: Record<string, string> | null; registroAt: string | null; hallazgo: boolean;
}

interface Candidato { id: number; nombre: string | null; carga: number }

const fmtCLP = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  try { return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
};

const SI_NO = ['Sí', 'No'] as const;

const CATEGORIA_LABEL: Record<string, string> = { VALIDACION: 'Validación', ADMINISTRATIVO: 'Plazos administrativos', MANUAL: 'Tareas propias del proyecto' };

function BadgeEstadoTarea({ estado, vencida }: { estado: Tarea['estado']; vencida: boolean }) {
  if (estado === 'HECHA') return <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"><CheckCircle2 size={11} /> Hecha</span>;
  if (estado === 'EN_CURSO') return <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full"><PlayCircle size={11} /> En curso</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-1.5 py-0.5 rounded-full border ${
      vencida ? 'text-rose-700 bg-rose-50 border-rose-200' : 'text-zinc-500 bg-zinc-50 border-zinc-200'
    }`}>
      <Circle size={11} /> {vencida ? 'Vencida' : 'Pendiente'}
    </span>
  );
}

export function ComprasSection({ negocioId }: { negocioId: number }) {
  const { usuario } = useSession();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asignacion, setAsignacion] = useState<Asignacion | null>(null);
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [licitacionNombre, setLicitacionNombre] = useState<string | null>(null);
  const [licitacionOrganismo, setLicitacionOrganismo] = useState<string | null>(null);
  const [ocMp, setOcMp] = useState<OrdenCompraMp | null>(null);
  const [resumenAbierto, setResumenAbierto] = useState(true);
  const [asignando, setAsignando] = useState(false);
  const [candidatoElegido, setCandidatoElegido] = useState<string>('');
  const [guardandoTarea, setGuardandoTarea] = useState<number | null>(null);
  const [formNuevaTarea, setFormNuevaTarea] = useState(false);
  const [tituloNuevaTarea, setTituloNuevaTarea] = useState('');
  const [creandoTarea, setCreandoTarea] = useState(false);
  // Orden de compra del cliente (§3.6) — se edita en su propio bloque, no dentro de una tarea.
  const [ocAbierta, setOcAbierta] = useState(false);
  const [ocForm, setOcForm] = useState({ numero: '', emitidaAt: '', aceptadaAt: '', monto: '', difiere: false, observacion: '' });
  const [guardandoOC, setGuardandoOC] = useState(false);
  const [regenerando, setRegenerando] = useState(false);
  // Registro de ejecución de UNA tarea (§5.3/§5.4): se abre de a una, con su propio borrador.
  const [tareaAbierta, setTareaAbierta] = useState<number | null>(null);
  const [registroBorrador, setRegistroBorrador] = useState<Record<string, string>>({});
  const [hallazgoBorrador, setHallazgoBorrador] = useState(false);
  const [guardandoRegistro, setGuardandoRegistro] = useState(false);

  const esAdmin = usuario?.rol === 'admin';
  const esJefeDeVentas = esAdmin || !!usuario?.permisos?.aprobar_comercial;
  const puedeOperar = esAdmin || !!usuario?.permisos?.compras || !!usuario?.permisos?.aprobar_comercial || asignacion?.asignadoA === usuario?.id;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar Compras');
      setAsignacion(data.asignacion);
      const oc: OrdenCompra | undefined = data.asignacion?.ordenCompra;
      setOcForm({
        numero: oc?.numero || '', emitidaAt: oc?.emitidaAt || '', aceptadaAt: oc?.aceptadaAt || '',
        monto: oc?.monto != null ? String(oc.monto) : '', difiere: !!oc?.difiere, observacion: oc?.observacion || '',
      });
      setTareas(data.tareas || []);
      setCandidatos(data.candidatos || []);
      setLicitacionNombre(data.licitacionNombre);
      setLicitacionOrganismo(data.licitacionOrganismo);
      setOcMp(data.ordenCompraMp || null);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const asignar = async () => {
    if (!candidatoElegido) return;
    setAsignando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/asignar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encargadoId: Number(candidatoElegido) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo asignar');
      toast.success('Encargado asignado', 'Se sembraron las tareas de Compras.');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo asignar', e.message);
    } finally {
      setAsignando(false);
    }
  };

  const cambiarEstado = async (tareaId: number, estado: Tarea['estado']) => {
    setGuardandoTarea(tareaId);
    try {
      const res = await fetch(`/api/compras/tarea/${tareaId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo actualizar la tarea', e.message);
    } finally {
      setGuardandoTarea(null);
    }
  };

  const siguienteEstado = (estado: Tarea['estado']): Tarea['estado'] =>
    estado === 'PENDIENTE' ? 'EN_CURSO' : estado === 'EN_CURSO' ? 'HECHA' : 'PENDIENTE';

  /** El resumen es una foto congelada al ganar (§4.1) y así se queda: esto NO lo regenera solo.
   *  Es la salida a mano para cuando la foto salió mal — el paquete de traspaso se congeló antes de
   *  que existiera el costeo, o Mercado Público estaba caído y no dio los contactos del cliente. */
  const regenerarResumen = async () => {
    setRegenerando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/resumen`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      const faltan: string[] = data.faltantes || [];
      toast.success('Resumen ejecutivo actualizado',
        faltan.length ? `Quedan ${faltan.length} dato(s) sin resolver.` : 'Quedó completo.');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo actualizar el resumen', e.message);
    } finally {
      setRegenerando(false);
    }
  };

  const guardarOC = async () => {
    setGuardandoOC(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/orden-compra`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero: ocForm.numero.trim() || null,
          emitidaAt: ocForm.emitidaAt || null,
          aceptadaAt: ocForm.aceptadaAt || null,
          monto: ocForm.monto.trim() === '' ? null : Number(ocForm.monto.replace(/[^\d.-]/g, '')),
          difiere: ocForm.difiere,
          observacion: ocForm.observacion.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Orden de compra registrada',
        data.tareaAceptacionCerrada ? 'La tarea "Aceptación de la orden de compra" quedó hecha.' : undefined);
      setOcAbierta(false);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo registrar la orden de compra', e.message);
    } finally {
      setGuardandoOC(false);
    }
  };

  /** Abre (o cierra) el formulario de registro de una tarea, precargado con lo ya anotado. */
  const alternarRegistro = (t: Tarea) => {
    if (tareaAbierta === t.id) { setTareaAbierta(null); return; }
    setTareaAbierta(t.id);
    setRegistroBorrador({ ...(t.registro || {}) });
    setHallazgoBorrador(t.hallazgo);
  };

  /** Guarda lo anotado. Con `cerrar`, además da la tarea por hecha en la misma llamada — es el
   *  gesto natural: se termina de llenar el cuestionario y se cierra. */
  const guardarRegistro = async (t: Tarea, cerrar: boolean) => {
    setGuardandoRegistro(true);
    try {
      const res = await fetch(`/api/compras/tarea/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registro: registroBorrador,
          hallazgo: hallazgoBorrador,
          ...(cerrar ? { estado: 'HECHA' } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      if (cerrar) setTareaAbierta(null);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo guardar el registro', e.message);
    } finally {
      setGuardandoRegistro(false);
    }
  };

  const crearTareaManual = async () => {
    if (!tituloNuevaTarea.trim()) return;
    setCreandoTarea(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/tarea`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo: tituloNuevaTarea.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo crear la tarea');
      setTituloNuevaTarea('');
      setFormNuevaTarea(false);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo crear la tarea', e.message);
    } finally {
      setCreandoTarea(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  }
  if (error) return <Banner variante="error" accion={{ label: 'Reintentar', onClick: cargar }}>{error}</Banner>;
  if (!asignacion) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <ShoppingCart size={28} className="text-zinc-300" />
        <p className="text-[13.5px] font-semibold text-zinc-500">Compras todavía no se abre para este negocio</p>
        <p className="text-[12px] text-zinc-400 max-w-sm">Se abre automáticamente apenas Mercado Público confirma que ganamos.</p>
      </div>
    );
  }

  const r = asignacion.resumen;
  const oc = asignacion.ordenCompra;
  const vencimientoPasado = new Date(asignacion.vencimientoAsignacionAt.replace(' ', 'T')).getTime() < Date.now();
  const porCategoria: Record<string, Tarea[]> = {};
  for (const t of tareas) (porCategoria[t.categoria] ||= []).push(t);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${asignacion.urgente ? 'bg-rose-50' : 'bg-teal-50'}`}>
          <ShoppingCart size={17} className={asignacion.urgente ? 'text-rose-600' : 'text-teal-600'} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold text-zinc-900 leading-tight">Compras</h2>
            {asignacion.urgente && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">
                <AlertTriangle size={11} /> Cadena de Urgencia
              </span>
            )}
          </div>
          <p className="text-[12px] text-zinc-500">Ganado {fmtFecha(asignacion.ganadoAt)}</p>
        </div>
      </div>

      {/* Los faltantes traen su propia salida: casi siempre el dato SÍ existe hoy y lo que estaba
          viejo era la foto (el paquete de traspaso se congela al postular, semanas antes de ganar).
          Volver a armar el resumen es más barato que salir a buscar cada dato a mano. */}
      {r?.faltantes && r.faltantes.length > 0 && (
        <Banner variante="warning" accion={puedeOperar ? { label: 'Volver a armar el resumen', onClick: regenerarResumen, cargando: regenerando } : undefined}>
          <span className="font-semibold">El resumen ejecutivo quedó incompleto:</span> {r.faltantes.join(' · ')}
        </Banner>
      )}

      {/* Asignación */}
      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <p className="text-[11px] font-bold text-zinc-400 uppercase mb-2">Encargado de Compras</p>
        {asignacion.asignadoA ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13.5px] text-zinc-800">
              <span className="font-bold">{asignacion.asignadoNombre}</span>
              <span className="text-zinc-400"> — asignado {fmtFecha(asignacion.asignadoAt)}{asignacion.asignadoPor == null ? ' (automático, por carga)' : ''}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[12.5px] text-zinc-500 flex items-center gap-1.5">
              <Clock size={13} className={vencimientoPasado ? 'text-rose-500' : 'text-amber-500'} />
              {vencimientoPasado
                ? 'Plazo de asignación vencido — se asignará automáticamente al de menor carga.'
                : `Sin asignar. Plazo: ${fmtFecha(asignacion.vencimientoAsignacionAt)} (3h hábiles).`}
            </p>
            {esJefeDeVentas && (
              <div className="flex items-center gap-2">
                <Select
                  value={candidatoElegido} onChange={setCandidatoElegido}
                  placeholder="Elegir encargado…" minWidth={220}
                  options={candidatos.map(c => ({ value: String(c.id), label: `${c.nombre || `Usuario ${c.id}`} (${c.carga} tarea${c.carga === 1 ? '' : 's'} activa${c.carga === 1 ? '' : 's'})` }))}
                />
                <button onClick={asignar} disabled={!candidatoElegido || asignando}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors">
                  {asignando ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Asignar
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Orden de compra DEL CLIENTE (§3.6). "El módulo recibe y registra la orden de compra del
          organismo como parte de la documentación, y la fecha de aceptación". Y manda sobre lo
          ofertado: si el alcance o el monto adjudicado difiere, es la OC la que vale — por eso la
          marca "difiere" es una casilla propia y no una nota perdida en un texto. */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-zinc-400 uppercase flex items-center gap-1.5">
              <FileText size={12} /> Orden de compra del cliente
              {/* De dónde salió el dato. Si la trajo el sistema, decirlo importa: nadie tiene que ir
                  al portal a copiarla, y si alguien la edita a mano después, se nota el cambio. */}
              {oc.origen === 'mp' && (
                <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded-full normal-case">
                  <Zap size={10} /> Llegó sola desde Mercado Público
                </span>
              )}
            </p>
            {oc.numero || oc.aceptadaAt ? (
              <>
                <p className="text-[12.5px] text-zinc-700 mt-0.5">
                  {oc.numero && <span className="font-bold">N° {oc.numero}</span>}
                  {oc.monto != null && <span className="text-zinc-500"> · {fmtCLP(oc.monto)} c/IVA</span>}
                  {oc.emitidaAt && <span className="text-zinc-400"> · emitida {oc.emitidaAt}</span>}
                  {oc.aceptadaAt
                    ? <span className="text-emerald-700 font-semibold"> · aceptada {oc.aceptadaAt}</span>
                    : <span className="text-amber-600 font-semibold"> · sin aceptar todavía</span>}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  {oc.estadoMp && <span className="text-[10.5px] font-semibold text-zinc-500">Estado en MP: {oc.estadoMp}</span>}
                  {ocMp?.url && (
                    <a href={ocMp.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-indigo-600 hover:text-indigo-700">
                      <ExternalLink size={10} /> Ver en Mercado Público
                    </a>
                  )}
                  {ocMp?.pdfUrl && (
                    <a href={ocMp.pdfUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-indigo-600 hover:text-indigo-700">
                      <FileText size={10} /> PDF de la orden
                    </a>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[12px] text-zinc-400 mt-0.5">
                Todavía no llega. El sistema la busca solo en Mercado Público y la carga acá apenas aparece.
              </p>
            )}
          </div>
          {puedeOperar && (
            <button onClick={() => setOcAbierta(v => !v)}
              className="flex-shrink-0 text-[12px] font-semibold text-teal-700 hover:text-teal-800">
              {ocAbierta ? 'Cerrar' : oc.origen === 'mp' ? 'Corregir a mano' : (oc.numero || oc.aceptadaAt ? 'Editar' : 'Registrar a mano')}
            </button>
          )}
        </div>

        {oc.difiere && (
          <div className="px-4 pb-3">
            <Banner variante="warning">
              <span className="font-semibold">La orden de compra difiere de lo ofertado.</span> Manda la OC, no nuestra oferta: revisa alcance y monto antes de comprar.
              {oc.observacion && <span className="block mt-0.5">{oc.observacion}</span>}
            </Banner>
          </div>
        )}

        {ocAbierta && puedeOperar && (
          <div className="border-t border-zinc-100 px-4 py-3 space-y-2.5">
            {/* Todo opcional a propósito: la OC llega por partes (primero el número, la aceptación
                días después). Exigirla completa haría que no se registre nada hasta el final. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <label className="text-[11px] font-semibold text-zinc-500">
                N° de la OC
                <input value={ocForm.numero} onChange={e => setOcForm(f => ({ ...f, numero: e.target.value }))}
                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
              </label>
              <label className="text-[11px] font-semibold text-zinc-500">
                Emitida
                <input type="date" value={ocForm.emitidaAt} onChange={e => setOcForm(f => ({ ...f, emitidaAt: e.target.value }))}
                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
              </label>
              <label className="text-[11px] font-semibold text-zinc-500">
                Aceptada en el portal
                <input type="date" value={ocForm.aceptadaAt} onChange={e => setOcForm(f => ({ ...f, aceptadaAt: e.target.value }))}
                  title="Al anotarla, la tarea 'Aceptación de la orden de compra' queda hecha sola."
                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
              </label>
              <label className="text-[11px] font-semibold text-zinc-500">
                Monto de la OC
                <input inputMode="numeric" value={ocForm.monto} onChange={e => setOcForm(f => ({ ...f, monto: e.target.value }))}
                  placeholder="Neto o total, como venga"
                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
              </label>
            </div>
            <label className="flex items-start gap-2 text-[12px] text-zinc-700">
              <input type="checkbox" checked={ocForm.difiere} onChange={e => setOcForm(f => ({ ...f, difiere: e.target.checked }))}
                className="mt-0.5 accent-teal-600" />
              <span>
                <span className="font-semibold">El alcance o el monto difiere de lo que ofertamos.</span>
                <span className="text-zinc-400"> Caso típico: se ofertaron 10 productos y el presupuesto alcanzó para 5. Manda la OC.</span>
              </span>
            </label>
            <textarea value={ocForm.observacion} onChange={e => setOcForm(f => ({ ...f, observacion: e.target.value }))}
              rows={2} placeholder="En qué difiere, o cualquier nota de la orden de compra…"
              className="w-full text-[12.5px] text-zinc-800 border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
            <div className="flex items-center gap-2">
              <button onClick={guardarOC} disabled={guardandoOC}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
                {guardandoOC ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
              </button>
              {oc.actualizadaAt && (
                <span className="text-[10.5px] text-zinc-400">Última vez: {fmtFecha(oc.actualizadaAt)}{oc.registradaPorNombre ? ` · ${oc.registradaPorNombre}` : ''}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Resumen ejecutivo */}
      {r && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors">
            <button onClick={() => setResumenAbierto(v => !v)} className="flex-1 flex items-center justify-between text-left">
              <p className="text-[12.5px] font-bold text-zinc-700">Resumen ejecutivo</p>
            </button>
            <div className="flex items-center gap-2 pl-2">
              {puedeOperar && (
                <button onClick={regenerarResumen} disabled={regenerando}
                  title="Vuelve a leer el costeo, los contactos del cliente y los plazos de las bases. El resumen no se actualiza solo: es una foto del momento de ganar."
                  className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-teal-700 disabled:opacity-50">
                  {regenerando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Volver a armar
                </button>
              )}
              <button onClick={() => setResumenAbierto(v => !v)}>
                {resumenAbierto ? <ChevronUp size={15} className="text-zinc-400" /> : <ChevronDown size={15} className="text-zinc-400" />}
              </button>
            </div>
          </div>
          {resumenAbierto && (
            <div className="border-t border-zinc-100 px-4 py-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase flex items-center gap-1"><DollarSign size={11} /> Precio de venta ganado</p>
                  <p className="text-[13px] font-bold text-zinc-800">{fmtCLP(r.montoNuestro)}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Presupuesto del proyecto</p>
                  <p className="text-[13px] font-bold text-zinc-800">{fmtCLP(r.presupuestoProyecto)}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Margen previsto</p>
                  <p className={`text-[13px] font-bold ${r.margenPrevisto != null && r.margenPrevisto < 20 ? 'text-rose-600' : 'text-zinc-800'}`}>
                    {r.margenPrevisto != null ? `${r.margenPrevisto}%` : '— (sin costeo)'}
                  </p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Monto costeado</p>
                  <p className="text-[13px] font-bold text-zinc-800">{r.existeCosteo ? fmtCLP(r.montoCosteado) : 'Sin costeo'}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Plazo de entrega ofertado</p>
                  <p className="text-[12.5px] font-semibold text-zinc-800">{r.plazoEntregaOfertado || '—'}</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-2.5">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase">Desde cuándo corre</p>
                  <p className="text-[12.5px] font-semibold text-zinc-800">{r.hitoInicioPlazo || '—'}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border ${r.requiereBoletaFielCumplimiento ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-zinc-400 bg-zinc-50 border-zinc-200'}`}>
                  <FileWarning size={12} /> Boleta de fiel cumplimiento: {r.requiereBoletaFielCumplimiento ? 'Sí' : 'No'}
                </span>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border ${r.requiereFirmaContrato ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-zinc-400 bg-zinc-50 border-zinc-200'}`}>
                  <FileWarning size={12} /> Firma de contrato: {r.requiereFirmaContrato ? 'Sí' : 'No'}
                </span>
              </div>
              <p className="text-[11.5px] text-zinc-500">Plazo para aceptar la OC: {r.plazoAceptacionOC}</p>

              {/* A quién llamar. Es el insumo de la primera tarea del encargado (§5.3, contacto
                  inicial) y del contacto de pagos (§17.3) — por eso van los tres roles separados y
                  no solo "el organismo": en MP casi nunca son la misma persona. */}
              {r.contactosCliente && (
                <div className="pt-2 border-t border-zinc-100">
                  <p className="text-[11px] font-bold text-zinc-500 uppercase mb-1 flex items-center gap-1"><Building2 size={12} /> Contactos del cliente</p>
                  <p className="text-[12px] text-zinc-600">{[r.contactosCliente.organismo, r.contactosCliente.unidad].filter(Boolean).join(' · ')}</p>
                  {[r.contactosCliente.direccion, r.contactosCliente.comuna].filter(Boolean).length > 0 && (
                    <p className="text-[11.5px] text-zinc-400">{[r.contactosCliente.direccion, r.contactosCliente.comuna].filter(Boolean).join(', ')}</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                    {([
                      ['Contraparte', r.contactosCliente.usuarioNombre, r.contactosCliente.usuarioCargo, null],
                      ['Responsable del contrato', r.contactosCliente.responsableContratoNombre, r.contactosCliente.responsableContratoEmail, r.contactosCliente.responsableContratoFono],
                      ['Responsable de pagos', r.contactosCliente.responsablePagoNombre, r.contactosCliente.responsablePagoEmail, null],
                    ] as const).map(([rol, nombre, dato1, dato2]) => nombre ? (
                      <div key={rol} className="bg-zinc-50 rounded-lg p-2">
                        <p className="text-[10px] font-bold text-zinc-400 uppercase">{rol}</p>
                        <p className="text-[12px] font-semibold text-zinc-700">{nombre}</p>
                        {[dato1, dato2].filter(Boolean).map(d => (
                          <p key={String(d)} className="text-[11px] text-zinc-500 break-words">{d}</p>
                        ))}
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tareas */}
      {asignacion.asignadoA && (
        <div className="space-y-3">
          {(['VALIDACION', 'ADMINISTRATIVO', 'MANUAL'] as const).map(cat => {
            const items = porCategoria[cat];
            if (!items || items.length === 0) return null;
            return (
              <div key={cat} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                <p className="px-4 py-2.5 text-[11px] font-bold text-zinc-500 uppercase bg-zinc-50 border-b border-zinc-100">{CATEGORIA_LABEL[cat] || cat}</p>
                <div className="divide-y divide-zinc-100">
                  {items.map(t => (
                    <div key={t.id} className="px-4 py-3 flex items-start gap-3">
                      <button
                        onClick={() => puedeOperar && cambiarEstado(t.id, siguienteEstado(t.estado))}
                        disabled={!puedeOperar || guardandoTarea === t.id}
                        title="Cambiar estado"
                        className="mt-0.5 flex-shrink-0 disabled:cursor-default"
                      >
                        {guardandoTarea === t.id ? <Loader2 size={16} className="animate-spin text-zinc-400" /> :
                          t.estado === 'HECHA' ? <CheckCircle2 size={17} className="text-emerald-500" /> :
                          t.estado === 'EN_CURSO' ? <PlayCircle size={17} className="text-indigo-500" /> :
                          <Circle size={17} className={t.vencida ? 'text-rose-400' : 'text-zinc-300'} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-[13px] font-semibold ${t.estado === 'HECHA' ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{t.titulo}</p>
                          <BadgeEstadoTarea estado={t.estado} vencida={t.vencida} />
                          {/* Hallazgo (§5.4): la tarea se ejecutó, pero lo que se encontró NO es lo
                              esperado. Se muestra aparte del estado a propósito — "hecha" y "salió
                              mal" son dos cosas distintas, y no existe el estado "incumplida". */}
                          {t.hallazgo && (
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                              <Flag size={11} /> Con hallazgo
                            </span>
                          )}
                        </div>
                        {t.descripcion && <p className="text-[11.5px] text-zinc-500 mt-0.5">{t.descripcion}</p>}
                        <div className="flex items-center gap-3 mt-1 text-[10.5px] text-zinc-400">
                          {t.responsableNombre && <span>{t.responsableNombre}</span>}
                          {t.plazoAt && <span className="flex items-center gap-0.5"><Calendar size={10} /> {fmtFecha(t.plazoAt)}</span>}
                          {(t.campos.length > 0 || t.registro) && puedeOperar && (
                            <button onClick={() => alternarRegistro(t)}
                              className="flex items-center gap-0.5 text-[10.5px] font-semibold text-teal-700 hover:text-teal-800">
                              <ClipboardList size={11} /> {tareaAbierta === t.id ? 'Cerrar' : t.registro ? 'Ver / editar registro' : 'Registrar lo que se hizo'}
                            </button>
                          )}
                        </div>

                        {/* Lo ya anotado, a la vista, para no obligar a abrir el formulario solo
                            para leerlo. Las claves salen del catálogo: se muestran con su etiqueta
                            cuando existe, y con la clave cruda si el catálogo cambió después. */}
                        {t.registro && tareaAbierta !== t.id && (
                          <div className="mt-1.5 bg-zinc-50 border border-zinc-100 rounded-lg px-2.5 py-1.5 space-y-0.5">
                            {Object.entries(t.registro).map(([k, v]) => (
                              <p key={k} className="text-[11px] text-zinc-600">
                                <span className="text-zinc-400">{t.campos.find(c => c.clave === k)?.etiqueta || k}: </span>{v}
                              </p>
                            ))}
                            {t.registroAt && <p className="text-[10px] text-zinc-400 pt-0.5">Anotado {fmtFecha(t.registroAt)}</p>}
                          </div>
                        )}

                        {/* El formulario viene del CATÁLOGO (campos_json), no del código: acá solo
                            se pinta lo que la tarea declara. Una tarea manual no declara nada, así
                            que cae al campo de texto libre. */}
                        {tareaAbierta === t.id && (
                          <div className="mt-2 border border-zinc-200 rounded-lg p-2.5 space-y-2 bg-zinc-50/60">
                            {t.campos.map(c => (
                              <label key={c.clave} className="block text-[11px] font-semibold text-zinc-500">
                                {c.etiqueta}
                                {c.tipo === 'si_no' ? (
                                  <div className="mt-0.5 flex gap-1.5">
                                    {SI_NO.map(op => (
                                      <button key={op} type="button"
                                        onClick={() => setRegistroBorrador(b => ({ ...b, [c.clave]: b[c.clave] === op ? '' : op }))}
                                        className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                                          registroBorrador[c.clave] !== op
                                            ? 'bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300'
                                            : op === SI_NO[0]
                                              ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                              : 'bg-rose-50 border-rose-300 text-rose-700'
                                        }`}>{op}</button>
                                    ))}
                                  </div>
                                ) : c.tipo === 'parrafo' ? (
                                  <textarea rows={2} value={registroBorrador[c.clave] || ''} placeholder={c.placeholder}
                                    onChange={e => setRegistroBorrador(b => ({ ...b, [c.clave]: e.target.value }))}
                                    className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                                ) : (
                                  <input value={registroBorrador[c.clave] || ''} placeholder={c.placeholder}
                                    onChange={e => setRegistroBorrador(b => ({ ...b, [c.clave]: e.target.value }))}
                                    className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                                )}
                              </label>
                            ))}
                            {t.campos.length === 0 && (
                              <label className="block text-[11px] font-semibold text-zinc-500">
                                Qué se hizo
                                <textarea rows={2} value={registroBorrador.observaciones || ''}
                                  onChange={e => setRegistroBorrador(b => ({ ...b, observaciones: e.target.value }))}
                                  className="mt-0.5 w-full text-[12.5px] font-normal text-zinc-800 bg-white border border-zinc-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none" />
                              </label>
                            )}

                            <label className="flex items-start gap-2 text-[11.5px] text-zinc-700 pt-0.5">
                              <input type="checkbox" checked={hallazgoBorrador} onChange={e => setHallazgoBorrador(e.target.checked)}
                                className="mt-0.5 accent-amber-600" />
                              <span>
                                <span className="font-semibold">Levantar hallazgo.</span>
                                <span className="text-zinc-400"> Se hizo la tarea, pero lo que se encontró no es lo esperado (sin stock, no cumple, plazo incompatible...).</span>
                              </span>
                            </label>

                            <div className="flex items-center gap-2 pt-0.5">
                              <button onClick={() => guardarRegistro(t, false)} disabled={guardandoRegistro}
                                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors">
                                {guardandoRegistro ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                              </button>
                              {t.estado !== 'HECHA' && (
                                <button onClick={() => guardarRegistro(t, true)} disabled={guardandoRegistro}
                                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors">
                                  <CheckCircle2 size={13} /> Guardar y dar por hecha
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {puedeOperar && (
            <div className="bg-white rounded-xl border border-zinc-200 p-3">
              {formNuevaTarea ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus value={tituloNuevaTarea} onChange={e => setTituloNuevaTarea(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && crearTareaManual()}
                    placeholder="Título de la tarea…"
                    className="flex-1 text-[12.5px] border border-zinc-200 rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-teal-500 outline-none"
                  />
                  <button onClick={crearTareaManual} disabled={!tituloNuevaTarea.trim() || creandoTarea}
                    className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
                    {creandoTarea ? <Loader2 size={13} className="animate-spin" /> : 'Crear'}
                  </button>
                  <button onClick={() => { setFormNuevaTarea(false); setTituloNuevaTarea(''); }} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
                </div>
              ) : (
                <button onClick={() => setFormNuevaTarea(true)} className="flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 hover:text-teal-800">
                  <Plus size={14} /> Agregar tarea propia del proyecto
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
