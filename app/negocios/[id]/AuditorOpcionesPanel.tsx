'use client';

// AUDITOR unificado — pestaña "Compra": cotizaciones de Documentos leídas con el Lector (Prompt 6),
// OPCIONES por línea del costeo (línea + producto + proveedor), verificación calculada por código,
// cuadro comparativo de costo por línea y el ciclo firma → aprobación.
// Spec: docs/ESPECIFICACION_AUDITOR_v1.md. Backend: app/api/negocios/[id]/auditor/route.ts.
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Modal } from '@/app/components/ui/Modal';
import {
  IconLoader2 as Loader2, IconFileText as FileText, IconSparkles as Sparkles, IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight, IconAlertTriangle as Alerta, IconCircleCheck as Check, IconExternalLink as ExternalLink,
  IconRefresh as Refresh,
} from '@tabler/icons-react';
import type { PanelAuditorDTO, LineaAuditorDTO, OpcionDTO, DocumentoCotizacionDTO } from '@/app/lib/auditor-opciones';

const fmtCLP = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

const ESTADO_OPCION: Record<string, { label: string; cls: string }> = {
  tanteo: { label: 'Tanteo', cls: 'bg-zinc-100 text-zinc-600' },
  formalizada: { label: 'Formalizada', cls: 'bg-sky-100 text-sky-700' },
  verificada: { label: 'Verificada', cls: 'bg-emerald-100 text-emerald-700' },
  definitiva: { label: 'Definitiva', cls: 'bg-indigo-100 text-indigo-700' },
  en_aprobacion: { label: 'En aprobación', cls: 'bg-amber-100 text-amber-700' },
  aprobada: { label: 'Aprobada', cls: 'bg-emerald-600 text-white' },
  descartada: { label: 'Descartada', cls: 'bg-zinc-200 text-zinc-500 line-through' },
};
const VEREDICTO: Record<string, { label: string; cls: string }> = {
  VERIFICADO: { label: 'Verificado', cls: 'bg-emerald-100 text-emerald-700' },
  VERIFICADO_CON_ALERTAS: { label: 'Verificado con alertas', cls: 'bg-lime-100 text-lime-800' },
  REQUIERE_HABILITACION: { label: 'Requiere habilitación EM', cls: 'bg-violet-100 text-violet-700' },
  NO_VERIFICADO: { label: 'No verificado', cls: 'bg-red-100 text-red-700' },
  SIN_RESPALDO: { label: 'Sin respaldo', cls: 'bg-red-100 text-red-700' },
  PENDIENTE_CRUCE_TECNICO: { label: 'Pendiente cruce técnico', cls: 'bg-zinc-100 text-zinc-600' },
};

async function post(negocioId: number, body: Record<string, unknown>) {
  const res = await fetch(`/api/negocios/${negocioId}/auditor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || 'No se pudo completar la acción');
  return data;
}

export function AuditorOpcionesPanel({ negocioId, puedeAprobar }: { negocioId: number; puedeAprobar: boolean }) {
  const toast = useToast();
  const [panel, setPanel] = useState<PanelAuditorDTO | null>(null);
  const [cargando, setCargando] = useState(true);
  const [leyendo, setLeyendo] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [traiendo, setTraiendo] = useState<{ actual: number; total: number } | null>(null);
  const [agregandoLink, setAgregandoLink] = useState<string | null>(null);
  const [verificando, setVerificando] = useState<Set<number>>(new Set());
  const [modal, setModal] = useState<{ tipo: 'descartar' | 'rechazar' | 'no_ofertar' | 'anular_costo'; ref: number | string } | null>(null);
  const [texto, setTexto] = useState('');

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const res = await fetch(`/api/negocios/${negocioId}/auditor`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setPanel(data);
      if (!silencioso) setAbiertas(new Set((data.lineas as LineaAuditorDTO[]).filter(l => l.opciones.length > 0).map(l => l.filaId)));
    } catch (e: any) {
      toast.error('No se pudo cargar el Auditor', e.message);
    } finally {
      setCargando(false);
    }
  }, [negocioId, toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const leerDocumento = async (d: DocumentoCotizacionDTO) => {
    setLeyendo(prev => new Set(prev).add(d.url));
    try {
      const r = await post(negocioId, { accion: 'leer_documento', url: d.url });
      const n = (r.creadas || []).length, sin = (r.sinEmparejar || []).length;
      toast.success(`"${d.nombre}" leída`, `${n} producto${n === 1 ? '' : 's'} emparejado${n === 1 ? '' : 's'} con su línea${sin ? ` · ${sin} sin emparejar (asígnalos a mano)` : ''}.`);
    } catch (e: any) {
      toast.error(`No se pudo leer "${d.nombre}"`, e.message);
    } finally {
      setLeyendo(prev => { const n = new Set(prev); n.delete(d.url); return n; });
      await cargar(true);
    }
  };

  const leerTodas = async () => {
    for (const d of (panel?.documentos || []).filter(x => !x.leido)) await leerDocumento(d);
  };

  const agregarLink = async (filaId: string, url: string): Promise<boolean> => {
    setAgregandoLink(filaId);
    try {
      const r = await post(negocioId, { accion: 'agregar_link', filaId, url });
      if (r.estadoLink === 'ya_registrado') toast.success('Ese link ya estaba registrado en esta línea');
      else if (r.error) toast.error('Link registrado, pero no se pudo leer el precio', r.error);
      else if (['caido', 'redirige', 'login'].includes(r.estadoLink)) toast.error('El link no sirve como respaldo', `Estado: ${r.estadoLink}`);
      else toast.success('Link registrado como opción en tanteo');
      return true;
    } catch (e: any) { toast.error('No se pudo registrar el link', e.message); return false; }
    finally { setAgregandoLink(null); await cargar(true); }
  };

  // Verificación técnica (Prompt 4 v2.0): una llamada de IA por opción, puede tardar 1-3 minutos.
  const verificarTecnico = async (opcionId: number) => {
    setVerificando(prev => new Set(prev).add(opcionId));
    try {
      const r = await post(negocioId, { accion: 'verificar_tecnico', opcionId });
      const e = { CUMPLE: 'cumple todo', CON_PENDIENTES: 'quedó con pendientes', NO_CUMPLE: 'no cumple', SIN_EVALUAR: 'sin evaluar' }[r.estado as string] || r.estado;
      toast.success(`Verificación técnica lista: ${e}`, [r.costosCreados ? `${r.costosCreados} costo${r.costosCreados === 1 ? '' : 's'} asociado${r.costosCreados === 1 ? '' : 's'} creado${r.costosCreados === 1 ? '' : 's'}.` : '', r.descartada ? 'La opción quedó descartada: ruta insalvable.' : ''].filter(Boolean).join(' ') || undefined);
    } catch (e: any) { toast.error('No se pudo verificar lo técnico', e.message); }
    finally { setVerificando(prev => { const n = new Set(prev); n.delete(opcionId); return n; }); await cargar(true); }
  };

  const verificarTodoTecnico = async () => {
    const pend = (panel?.lineas || []).flatMap(l => l.opciones.filter(o => o.via === 'completa' && o.estado !== 'descartada' && o.tecnico.estado === 'NO_CORRIDO' && o.tecnico.requisitosTotal > 0));
    for (const o of pend) await verificarTecnico(o.id);
  };

  // Registra de a uno los links que el Costeo ya trae (link1..link3 de cada fila): cada uno se visita, se captura y se lee.
  const traerLinksDelCosteo = async () => {
    const lista = panel?.linksPendientes || [];
    for (let i = 0; i < lista.length; i++) {
      setTraiendo({ actual: i + 1, total: lista.length });
      await agregarLink(lista[i].filaId, lista[i].url);
    }
    setTraiendo(null);
  };

  const accion = async (opcionId: number, a: string, extra: Record<string, unknown> = {}, ok?: string) => {
    setOcupado(opcionId);
    try {
      const r = await post(negocioId, { accion: a, opcionId, ...extra });
      if (ok) toast.success(ok, Array.isArray(r.cambios) && r.cambios.length ? r.cambios.join(' ') : undefined);
    }
    catch (e: any) { toast.error('No se pudo completar', e.message); }
    finally { setOcupado(null); await cargar(true); }
  };

  const emparejarDeNuevo = async (d: DocumentoCotizacionDTO) => {
    if (d.extraccionId == null) return;
    try {
      const r = await post(negocioId, { accion: 'emparejar_documento', extraccionId: d.extraccionId });
      const n = (r.creadas || []).length;
      toast.success(n ? `${n} producto${n === 1 ? '' : 's'} emparejado${n === 1 ? '' : 's'}` : 'No hay productos nuevos que emparejar');
    } catch (e: any) { toast.error('No se pudo emparejar', e.message); }
    finally { await cargar(true); }
  };

  // Acciones que no son de una opción (líneas y costos asociados).
  const accionLinea = async (a: string, extra: Record<string, unknown>, ok?: string) => {
    try { await post(negocioId, { accion: a, ...extra }); if (ok) toast.success(ok); }
    catch (e: any) { toast.error('No se pudo completar', e.message); }
    finally { await cargar(true); }
  };

  const asignar = async (d: DocumentoCotizacionDTO, productoIdx: number, filaId: string) => {
    if (!filaId || d.extraccionId == null) return;
    try { await post(negocioId, { accion: 'asignar_producto', extraccionId: d.extraccionId, productoIdx, filaId }); toast.success('Producto asignado a la línea'); }
    catch (e: any) { toast.error('No se pudo asignar', e.message); }
    finally { await cargar(true); }
  };

  const confirmarModal = async () => {
    if (!modal) return;
    const { tipo, ref } = modal;
    if (!texto.trim()) { toast.error(({ descartar: 'Indica el motivo del descarte', rechazar: 'El rechazo requiere un comentario', no_ofertar: 'Indica el motivo por el que no se oferta la línea', anular_costo: 'Anular un costo asociado exige un comentario' })[tipo]); return; }
    setModal(null);
    if (tipo === 'descartar') await accion(Number(ref), 'descartar', { motivo: texto }, 'Opción descartada');
    else if (tipo === 'rechazar') await accion(Number(ref), 'rechazar', { comentario: texto }, 'Opción devuelta a verificada');
    else if (tipo === 'no_ofertar') await accionLinea('no_ofertar', { filaId: String(ref), motivo: texto }, 'Línea marcada como NO OFERTADA');
    else await accionLinea('anular_costo_asociado', { id: Number(ref), comentario: texto }, 'Costo asociado anulado');
    setTexto('');
  };

  const lineasSinAsignar = useMemo(() => (panel?.lineas || []).map(l => ({ id: l.filaId, label: `Ítem ${l.item} · ${l.detalle.slice(0, 48)}` })), [panel]);

  if (cargando) {
    return <div className="bg-white rounded-2xl border border-zinc-200 p-10 flex items-center justify-center gap-2 text-zinc-400"><Loader2 size={18} className="animate-spin" /> Cargando Auditor…</div>;
  }
  if (!panel) return null;
  if (panel.sinCosteo) {
    return <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center text-[13px] text-zinc-500">Este negocio todavía no tiene un Costeo guardado: el Auditor trabaja sobre sus líneas.</div>;
  }

  const sinLeer = panel.documentos.filter(d => !d.leido).length;
  const r = panel.resumen;

  return (
    <div className="space-y-4">
      {/* ── Resumen ── */}
      <div className="bg-white rounded-2xl border border-zinc-200 px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <h2 className="text-[15px] font-bold text-zinc-900">Auditor · Compra</h2>
          <p className="text-[11.5px] text-zinc-400">Opciones por línea, verificación de costo y aprobación</p>
        </div>
        <Stat label="Líneas con opción" valor={`${r.conOpcion}/${r.lineas}`} />
        <Stat label="Definitivas" valor={String(r.definitivas)} />
        <Stat label="Aprobadas" valor={String(r.aprobadas)} />
        <Stat label="Con bloqueos" valor={String(r.bloqueadas)} rojo={r.bloqueadas > 0} />
        {panel.margen?.margenFinal != null && (
          <Stat label={`Margen con definitivas${panel.margen.margenBase != null ? ` (base ${panel.margen.margenBase}%)` : ''}`} valor={`${panel.margen.margenFinal}%`} rojo={panel.margen.margenFinal < 20} />
        )}
        <div className="ml-auto flex items-center gap-3 text-[11.5px]">
          <span className="text-zinc-400">Datos OBUMA (opciones firmadas):</span>
          <a href={`/api/negocios/${negocioId}/auditor/obuma?tipo=proveedores&incluir=firmadas`} className="text-indigo-600 hover:underline">Proveedores CSV</a>
          <a href={`/api/negocios/${negocioId}/auditor/obuma?tipo=productos&incluir=firmadas`} className="text-indigo-600 hover:underline">Productos CSV</a>
          <button onClick={() => cargar(true)} className="text-zinc-400 hover:text-zinc-700" title="Actualizar"><Refresh size={16} /></button>
        </div>
      </div>

      {/* ── Cotizaciones en Documentos ── */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2">
          <FileText size={16} className="text-amber-600" />
          <h3 className="text-[13.5px] font-bold text-zinc-900">Cotizaciones en Documentos</h3>
          <span className="text-[11.5px] text-zinc-400">— el Lector las lee una sola vez y las empareja con su línea</span>
          {sinLeer > 0 && (
            <button onClick={leerTodas} disabled={leyendo.size > 0}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 disabled:opacity-50">
              <Sparkles size={13} /> Leer {sinLeer} sin leer
            </button>
          )}
        </div>
        {panel.documentos.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] text-zinc-400">No hay cotizaciones subidas en la caja «Cotizaciones» de Documentos Propios.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {panel.documentos.map(d => (
              <li key={d.documentoId} className="px-5 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[12.5px] font-semibold text-indigo-600 hover:underline">
                    <FileText size={13} /> {d.nombre}
                  </a>
                  {d.leido && <span className="text-[11px] text-zinc-500">{d.proveedor || 'proveedor sin identificar'}{d.rut ? ` · ${d.rut}` : ''}{d.fechaEmision ? ` · ${d.fechaEmision}` : ''}{d.formalidad === 'informal' ? ' · informal' : ''}</span>}
                  {d.error && <span className="flex items-center gap-1 text-[11.5px] text-red-600"><Alerta size={12} /> {d.error}</span>}
                  <div className="ml-auto">
                    {leyendo.has(d.url) ? (
                      <span className="flex items-center gap-1.5 text-[12px] text-amber-700"><Loader2 size={13} className="animate-spin" /> Leyendo con el Lector…</span>
                    ) : !d.leido ? (
                      <button onClick={() => leerDocumento(d)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-[12px] font-semibold hover:bg-amber-100">
                        <Sparkles size={12} /> {d.error ? 'Reintentar' : 'Leer con IA'}
                      </button>
                    ) : (
                      <span className="flex items-center gap-2 text-[11.5px] text-emerald-600"><Check size={13} /> Leída · {d.productos.length} producto{d.productos.length === 1 ? '' : 's'}
                        {d.productos.some(p => !p.filaId && !p.esCargo && p.precio != null) && (
                          <button onClick={() => emparejarDeNuevo(d)} className="text-amber-700 underline decoration-dotted hover:text-amber-900">Emparejar de nuevo</button>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                {d.leido && d.productos.length > 0 && (
                  <ul className="mt-2 ml-5 space-y-1">
                    {d.productos.map(p => (
                      <li key={p.idx} className="flex items-center gap-2 text-[12px] text-zinc-600 flex-wrap">
                        <span className="font-medium text-zinc-800">{p.nombre}</span>
                        <span>{fmtCLP(p.precio)}{p.iva === 'no_declarado' ? ' · IVA no declarado' : p.iva === 'incluido' ? ' con IVA' : ' + IVA'}</span>
                        {p.cantidad != null && <span className="text-zinc-400">x{p.cantidad}</span>}
                        {p.filaId ? (
                          <span className="text-emerald-600">→ ítem {panel.lineas.find(l => l.filaId === p.filaId)?.item}</span>
                        ) : p.esCargo ? (
                          <span className="text-zinc-400">cargo aparte (flete/despacho): no es un producto</span>
                        ) : p.precio != null ? (
                          <select defaultValue="" onChange={e => asignar(d, p.idx, e.target.value)} className="text-[11.5px] border border-zinc-200 rounded-md px-1.5 py-0.5 bg-white text-zinc-600">
                            <option value="">Sin emparejar — asignar a línea…</option>
                            {lineasSinAsignar.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                          </select>
                        ) : <span className="text-zinc-400">sin precio legible</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Avance a PRE-POSTULACIÓN (avance parcial permitido salvo licitación GLOBAL) ── */}
      <div className={`rounded-2xl border px-5 py-3 text-[12.5px] ${panel.avance.puede ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-zinc-200 bg-white text-zinc-600'}`}>
        <span className="font-bold">{panel.avance.puede ? '✓ Listo para PRE-POSTULACIÓN' : 'Avance a PRE-POSTULACIÓN'}</span>
        <span className="ml-2">{panel.avance.mensaje}</span>
        <span className="ml-2 text-zinc-400">({panel.avance.aprobadas} de {panel.avance.ofertadas} líneas ofertadas con opción aprobada)</span>
      </div>

      {/* ── Costos asociados (compromisos de las bases con costo) ── */}
      <CostosAsociados costos={panel.costosAsociados} total={panel.totalCostosAsociados} lineas={panel.lineas}
        onAccion={accionLinea} onAnular={id => { setTexto(''); setModal({ tipo: 'anular_costo', ref: id }); }} />

      {/* ── Mensaje único por proveedor ── */}
      {panel.mensajes.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2">
            <h3 className="text-[13.5px] font-bold text-zinc-900">Mensaje al proveedor</h3>
            <span className="text-[11.5px] text-zinc-400">— uno por proveedor: lo que bloquea primero, los datos para crearlo al final. Lo envías tú.</span>
          </div>
          <ul className="divide-y divide-zinc-100">
            {panel.mensajes.map(m => (
              <li key={m.opcionIds.join('-')} className="px-5 py-3">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="text-[12.5px] font-semibold text-zinc-800">{m.proveedor}</span>
                  {m.bloquea && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">responde algo que bloquea</span>}
                  <span className="text-[11.5px] text-zinc-400">{[m.vendedor, m.email, m.telefono].filter(Boolean).join(' · ')}</span>
                  <button onClick={() => { navigator.clipboard?.writeText(m.texto); toast.success('Mensaje copiado'); }}
                    className="ml-auto px-2.5 py-1 rounded-md border border-zinc-200 text-[11.5px] font-semibold text-zinc-600 hover:bg-zinc-50">Copiar</button>
                </div>
                <pre className="whitespace-pre-wrap text-[12px] text-zinc-600 bg-zinc-50 rounded-lg px-3 py-2 font-sans">{m.texto}</pre>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Líneas con su cuadro comparativo ── */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-100 flex items-center gap-2">
          <h3 className="text-[13.5px] font-bold text-zinc-900">Líneas y opciones</h3>
          <span className="text-[11.5px] text-zinc-400">— costo unitario neto de cada opción frente a lo costeado</span>
          {(() => {
            const pend = panel.lineas.flatMap(l => l.opciones.filter(o => o.via === 'completa' && o.estado !== 'descartada' && o.tecnico.estado === 'NO_CORRIDO' && o.tecnico.requisitosTotal > 0)).length;
            return pend > 0 ? (
              <button onClick={verificarTodoTecnico} disabled={verificando.size > 0}
                className={`${(panel.linksPendientes?.length ?? 0) > 0 ? '' : 'ml-auto'} flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 text-[12px] font-semibold hover:bg-indigo-50 disabled:opacity-60`}>
                {verificando.size > 0 ? <><Loader2 size={13} className="animate-spin" /> Verificando…</> : <>Verificar técnico ({pend} opción{pend === 1 ? '' : 'es'})</>}
              </button>
            ) : null;
          })()}
          {(panel.linksPendientes?.length ?? 0) > 0 && (
            <button onClick={traerLinksDelCosteo} disabled={!!traiendo || leyendo.size > 0}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 disabled:opacity-60">
              {traiendo ? <><Loader2 size={13} className="animate-spin" /> Leyendo link {traiendo.actual} de {traiendo.total}…</> : <><Sparkles size={13} /> Traer {panel.linksPendientes.length} link{panel.linksPendientes.length === 1 ? '' : 's'} del costeo</>}
            </button>
          )}
        </div>
        <ul className="divide-y divide-zinc-100">
          {panel.lineas.map(l => {
            const abierta = abiertas.has(l.filaId);
            const activas = l.opciones.filter(o => o.estado !== 'descartada');
            return (
              <li key={l.filaId} className={l.noOfertada ? 'opacity-60' : ''}>
                <button onClick={() => setAbiertas(prev => { const n = new Set(prev); if (n.has(l.filaId)) n.delete(l.filaId); else n.add(l.filaId); return n; })}
                  className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-zinc-50">
                  {abierta ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
                  <span className="text-[11px] font-bold text-zinc-400 w-8">#{l.item}</span>
                  <span className="text-[12.5px] font-semibold text-zinc-800 truncate flex-1">{l.detalle}</span>
                  <span className="text-[11.5px] text-zinc-400 whitespace-nowrap">x{l.cantidad} · costeado {fmtCLP(l.costeadoNeto)}</span>
                  {l.noOfertada && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-zinc-200 text-zinc-600">NO OFERTADA</span>}
                  {l.opcionDefinitivaId != null && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">definitiva</span>}
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${activas.length ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-400'}`}>{activas.length === 1 ? '1 opción' : `${activas.length} opciones`}</span>
                </button>
                {abierta && (
                  <div className="px-5 pb-4">
                    {l.noOfertada && <p className="text-[12px] text-zinc-500 ml-6 mb-2">No se oferta: {l.motivoNoOfertada}</p>}
                    <div className="flex items-center gap-3 flex-wrap">
                      <AgregarLink filaId={l.filaId} ocupado={agregandoLink === l.filaId} onAgregar={agregarLink} />
                      {l.noOfertada
                        ? <button onClick={() => accionLinea('reofertar', { filaId: l.filaId }, 'Línea vuelve a ofertarse')} className="mb-3 text-[11.5px] font-semibold text-indigo-600 hover:underline">Volver a ofertar</button>
                        : <button onClick={() => { setTexto(''); setModal({ tipo: 'no_ofertar', ref: l.filaId }); }} className="mb-3 text-[11.5px] font-semibold text-zinc-500 hover:text-red-600">No ofertar esta línea</button>}
                    </div>
                    {l.opciones.length === 0 ? (
                      <p className="text-[12px] text-zinc-400 ml-6">Sin opciones todavía. Lee una cotización de arriba o asigna un producto a esta línea.{l.links.length > 0 && <> Link de referencia: <a href={l.links[0]} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">abrir <ExternalLink size={10} /></a></>}</p>
                    ) : (
                      <CuadroLinea negocioId={negocioId} linea={l} ocupado={ocupado} verificando={verificando} onVerificar={verificarTecnico} puedeAprobar={puedeAprobar}
                        onAccion={accion} onModal={(tipo, opcionId) => { setTexto(''); setModal({ tipo, ref: opcionId }); }} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={({ descartar: 'Descartar opción', rechazar: 'Rechazar con comentario', no_ofertar: 'Marcar línea como NO OFERTADA', anular_costo: 'Anular costo asociado' } as Record<string, string>)[modal?.tipo || 'descartar']} size="md"
        footer={<>
          <button onClick={() => setModal(null)} className="px-4 py-2 text-[13px] font-semibold text-zinc-600 hover:text-zinc-900">Cancelar</button>
          <button onClick={confirmarModal} className="px-4 py-2 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700">Confirmar</button>
        </>}>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} autoFocus
          placeholder={({ descartar: 'Motivo del descarte (obligatorio)…', rechazar: 'Comentario para el asistente (obligatorio)…', no_ofertar: 'Motivo por el que no se oferta esta línea (obligatorio)…', anular_costo: 'Por qué este costo no aplica (obligatorio)…' } as Record<string, string>)[modal?.tipo || 'descartar']}
          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-amber-400" />
      </Modal>
    </div>
  );
}

const MATERIAS = ['capacitacion', 'instalacion', 'puesta_en_marcha', 'despacho', 'visitas', 'mantencion', 'garantia_extendida', 'repuestos', 'calibracion', 'personalizacion', 'otro'];

function CostosAsociados({ costos, total, lineas, onAccion, onAnular }: {
  costos: PanelAuditorDTO['costosAsociados']; total: number; lineas: LineaAuditorDTO[];
  onAccion: (accion: string, extra: Record<string, unknown>, ok?: string) => Promise<void>; onAnular: (id: number) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState({ materia: 'capacitacion', cuantificacion: '', filaId: '', monto: '' });
  const [montos, setMontos] = useState<Record<number, string>>({});
  const activos = costos.filter(c => !c.anulado), sinMonto = activos.filter(c => c.montoEstimado == null).length;
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <button onClick={() => setAbierto(a => !a)} className="w-full px-5 py-3.5 flex items-center gap-2 text-left hover:bg-zinc-50">
        {abierto ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
        <h3 className="text-[13.5px] font-bold text-zinc-900">Costos asociados</h3>
        <span className="text-[11.5px] text-zinc-400">— compromisos de las bases que cuestan plata: solo suben el costo, sin margen, y los estimas tú</span>
        <span className="ml-auto text-[12px] font-semibold text-zinc-700">{activos.length} activo{activos.length === 1 ? '' : 's'} · {fmtCLP(total)}{sinMonto > 0 && <span className="text-red-600"> · {sinMonto} sin estimar</span>}</span>
      </button>
      {abierto && (
        <div className="px-5 pb-4">
          {costos.length === 0 && <p className="text-[12px] text-zinc-400 mb-3">Todavía no hay costos asociados. El verificador técnico los crea al detectar compromisos de las bases; también puedes agregar uno a mano.</p>}
          <ul className="divide-y divide-zinc-100 mb-3">
            {costos.map(c => (
              <li key={c.id} className={`py-2 flex items-start gap-3 flex-wrap ${c.anulado ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-[240px]">
                  <p className="text-[12.5px] font-semibold text-zinc-800">{c.materia.replace(/_/g, ' ')}{c.cuantificacion ? ` · ${c.cuantificacion}` : ''}
                    <span className="ml-2 text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ESTIMACIÓN</span>
                    {c.origen === 'tecnico' && <span className="ml-1 text-[10.5px] text-zinc-400">detectado por el verificador técnico</span>}</p>
                  {c.exigeBaseLiteral && <p className="text-[11.5px] text-zinc-500">«{c.exigeBaseLiteral}»{c.fuenteBases ? ` — ${c.fuenteBases}` : ''}</p>}
                  {c.filaId && <p className="text-[11px] text-zinc-400">Línea {lineas.find(l => l.filaId === c.filaId)?.item ?? '?'}</p>}
                  {c.anulado && <p className="text-[11.5px] text-zinc-500">Anulado: {c.comentarioAnulacion}</p>}
                </div>
                {!c.anulado ? <>
                  <input value={montos[c.id] ?? (c.montoEstimado != null ? String(c.montoEstimado) : '')} placeholder="Monto neto"
                    onChange={e => setMontos(m => ({ ...m, [c.id]: e.target.value }))} inputMode="numeric"
                    onBlur={() => { const v = (montos[c.id] ?? '').replace(/[^\d]/g, ''); if (montos[c.id] !== undefined && (v ? Number(v) : null) !== c.montoEstimado) onAccion('estimar_costo_asociado', { id: c.id, monto: v ? Number(v) : null }, 'Estimación guardada'); }}
                    className="w-32 text-right text-[12.5px] font-semibold text-amber-700 bg-amber-50/60 border border-amber-200 rounded-lg px-2 py-1 outline-none focus:border-amber-400" />
                  <button onClick={() => onAnular(c.id)} className="text-[11.5px] text-zinc-500 hover:text-red-600">Anular</button>
                </> : <button onClick={() => onAccion('restaurar_costo_asociado', { id: c.id }, 'Costo restaurado')} className="text-[11.5px] text-indigo-600 hover:underline">Restaurar</button>}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            <select value={nuevo.materia} onChange={e => setNuevo(n => ({ ...n, materia: e.target.value }))} className="border border-zinc-200 rounded-md px-2 py-1 bg-white">
              {MATERIAS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
            <input value={nuevo.cuantificacion} onChange={e => setNuevo(n => ({ ...n, cuantificacion: e.target.value }))} placeholder="Como lo exigen las bases (ej. 8 horas)" className="w-56 border border-zinc-200 rounded-md px-2 py-1" />
            <select value={nuevo.filaId} onChange={e => setNuevo(n => ({ ...n, filaId: e.target.value }))} className="border border-zinc-200 rounded-md px-2 py-1 bg-white max-w-[180px]">
              <option value="">General (toda la licitación)</option>
              {lineas.map(l => <option key={l.filaId} value={l.filaId}>Línea {l.item}</option>)}
            </select>
            <input value={nuevo.monto} onChange={e => setNuevo(n => ({ ...n, monto: e.target.value.replace(/[^\d]/g, '') }))} placeholder="Monto neto" inputMode="numeric" className="w-28 text-right border border-zinc-200 rounded-md px-2 py-1" />
            <button onClick={async () => { await onAccion('agregar_costo_asociado', { materia: nuevo.materia, cuantificacion: nuevo.cuantificacion, filaId: nuevo.filaId || null, montoEstimado: nuevo.monto || null }, 'Costo asociado agregado'); setNuevo({ materia: 'capacitacion', cuantificacion: '', filaId: '', monto: '' }); }}
              className="px-3 py-1 rounded-md bg-amber-600 text-white font-semibold hover:bg-amber-700">Agregar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AgregarLink({ filaId, ocupado, onAgregar }: { filaId: string; ocupado: boolean; onAgregar: (filaId: string, url: string) => Promise<boolean> }) {
  const [url, setUrl] = useState('');
  const enviar = async () => { if (url.trim() && await onAgregar(filaId, url.trim())) setUrl(''); };
  return (
    <div className="flex items-center gap-2 mb-3 ml-6">
      <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enviar(); }} disabled={ocupado}
        placeholder="Pegar el link de un producto para esta línea (tanteo)…"
        className="flex-1 max-w-xl text-[12px] border border-zinc-200 rounded-lg px-3 py-1.5 outline-none focus:border-amber-400 disabled:opacity-50" />
      <button onClick={enviar} disabled={ocupado || !url.trim()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-[12px] font-semibold hover:bg-amber-100 disabled:opacity-40">
        {ocupado ? <><Loader2 size={12} className="animate-spin" /> Leyendo página…</> : 'Agregar link'}
      </button>
    </div>
  );
}

function Stat({ label, valor, rojo }: { label: string; valor: string; rojo?: boolean }) {
  return <div><p className="text-[10.5px] uppercase tracking-wide text-zinc-400 font-bold">{label}</p><p className={`text-[15px] font-bold ${rojo ? 'text-red-600' : 'text-zinc-800'}`}>{valor}</p></div>;
}

// ── Cuadro comparativo de UNA línea: columnas = opciones, filas = costo y verificación ────────────
function CuadroLinea({ negocioId, linea, ocupado, verificando, onVerificar, puedeAprobar, onAccion, onModal }: {
  negocioId: number; linea: LineaAuditorDTO; ocupado: number | null; verificando: Set<number>; onVerificar: (opcionId: number) => void; puedeAprobar: boolean;
  onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void;
  onModal: (tipo: 'descartar' | 'rechazar', opcionId: number) => void;
}) {
  const vivas = linea.opciones.filter(o => o.estado !== 'descartada');
  const costos = vivas.map(o => o.verificacion?.costoNetoUnitario).filter((x): x is number => x != null);
  const minimo = costos.length > 1 ? Math.min(...costos) : null;
  const columnas = [...vivas, ...linea.opciones.filter(o => o.estado === 'descartada')];

  return (
    <div className="overflow-x-auto ml-6">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-left align-top">
            <th className="w-32 pr-3 pb-2 text-[10.5px] uppercase tracking-wide text-zinc-400 font-bold">Opción</th>
            {columnas.map(o => (
              <th key={o.id} className={`pb-2 pr-4 min-w-[210px] font-normal ${o.estado === 'descartada' ? 'opacity-50' : ''}`}>
                <p className="font-semibold text-zinc-800">{o.proveedorRazonSocial || 'Proveedor sin identificar'}</p>
                <p className="text-zinc-500">{[o.marca, o.modelo].filter(Boolean).join(' ') || o.producto?.nombre || 'Producto sin identificar'}</p>
                <span className={`inline-block mt-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full ${ESTADO_OPCION[o.estado]?.cls}`}>{ESTADO_OPCION[o.estado]?.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="align-top">
          <Fila etiqueta="Costo unit. neto">
            {columnas.map(o => {
              const c = o.verificacion?.costoNetoUnitario ?? null;
              return <td key={o.id} className="py-1.5 pr-4"><span className={`text-[13px] font-bold ${c != null && c === minimo ? 'text-emerald-600' : 'text-zinc-800'}`}>{fmtCLP(c)}</span>{c != null && c === minimo && <span className="ml-1 text-[10px] text-emerald-600 font-bold">más barata</span>}
                {c == null && o.producto?.precio != null && <span className="block text-[11px] text-zinc-400">el documento dice {fmtCLP(o.producto.precio)} ({o.producto.iva === 'no_declarado' ? 'IVA sin definir' : o.producto.moneda})</span>}</td>;
            })}
          </Fila>
          <Fila etiqueta="Costeado">
            {columnas.map(o => {
              const v = o.verificacion;
              return <td key={o.id} className="py-1.5 pr-4 text-zinc-600">{fmtCLP(linea.costeadoNeto)}{v?.diffPct != null && <span className={`ml-1.5 font-semibold ${v.direccion === 'MAS_CARO' ? 'text-red-600' : v.direccion === 'MAS_BARATO' ? 'text-emerald-600' : 'text-zinc-400'}`}>{v.diffPct > 0 ? '+' : ''}{v.diffPct}%</span>}</td>;
            })}
          </Fila>
          <Fila etiqueta="Veredicto">
            {columnas.map(o => <td key={o.id} className="py-1.5 pr-4">{o.verificacion ? <span className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full ${VEREDICTO[o.verificacion.veredicto]?.cls}`}>{VEREDICTO[o.verificacion.veredicto]?.label}</span> : <span className="text-zinc-300">—</span>}</td>)}
          </Fila>
          <Fila etiqueta="Técnico">
            {columnas.map(o => <td key={o.id} className="py-1.5 pr-4"><EstadoTecnico o={o} ocupado={verificando.has(o.id)} onVerificar={onVerificar} /></td>)}
          </Fila>
          <Fila etiqueta="Respaldo">
            {columnas.map(o => {
              const r = o.respaldos.find(x => x.sostieneCosto) || o.respaldos[0];
              return <td key={o.id} className="py-1.5 pr-4 text-zinc-600">{r ? <a href={r.documentoUrl || r.url || '#'} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{r.documentoNombre || 'Ver'}</a> : '—'}{o.respaldos.length > 1 && <span className="text-zinc-400"> (+{o.respaldos.length - 1})</span>}<br /><span className="text-[11px] text-zinc-400">{o.verificacion?.origenDato === 'RESPALDO_INFORMAL' ? 'informal' : o.respaldos[0]?.tipo?.replace(/_/g, ' ')}</span>
                {o.capturas[0] && <><br /><span className="text-[11px] text-zinc-400">captura {o.capturas[0].capturadoAt.slice(0, 16).replace('T', ' ')} · {o.capturas[0].estado}{o.capturas[0].hayImagen && <> · <a href={`/api/negocios/${negocioId}/auditor/captura/${o.capturas[0].id}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">ver</a></>}</span></>}</td>;
            })}
          </Fila>
          <Fila etiqueta="Stock · Plazo">
            {columnas.map(o => <td key={o.id} className="py-1.5 pr-4 text-zinc-600">{o.producto?.stock || '—'}<br /><span className="text-[11px] text-zinc-400">{o.producto?.plazoTexto || 'plazo no declarado'}</span></td>)}
          </Fila>
          <Fila etiqueta="Bloqueos y alertas">
            {columnas.map(o => (
              <td key={o.id} className="py-1.5 pr-4">
                {(o.verificacion?.bloqueos || []).map((b, i) => (
                  <div key={`b${i}`} className="mb-1.5 rounded-md bg-red-50 border border-red-100 px-2 py-1.5">
                    <p className="text-red-700 font-semibold">🔴 {b.codigo} — {b.mensaje}</p>
                    <p className="text-[11px] text-red-600/80 mt-0.5">Salida: {b.salida}</p>
                  </div>
                ))}
                {(o.verificacion?.alertas || []).filter(a => a.nivel !== 'info').map((a, i) => (
                  <p key={`a${i}`} className={`mb-1 ${a.nivel === 'rojo' ? 'text-red-600' : 'text-amber-700'}`}>{a.nivel === 'rojo' ? '🔴' : '🟡'} {a.codigo} — {a.mensaje}</p>
                ))}
                {(o.verificacion?.alertas || []).filter(a => a.nivel === 'info').map((a, i) => <p key={`i${i}`} className="mb-1 text-zinc-500">ℹ️ {a.codigo} — {a.mensaje}</p>)}
                {o.motivoDescarte && <p className="text-zinc-500">Descartada: {o.motivoDescarte}</p>}
              </td>
            ))}
          </Fila>
          <Fila etiqueta="Acciones">
            {columnas.map(o => <td key={o.id} className="py-2 pr-4"><Acciones o={o} exigeViaCompleta={linea.exigeViaCompleta} ocupado={ocupado === o.id} puedeAprobar={puedeAprobar} onAccion={onAccion} onModal={onModal} /></td>)}
          </Fila>
        </tbody>
      </table>
      <CuadroTecnico linea={linea} puedeAprobar={puedeAprobar} onAccion={onAccion} />
    </div>
  );
}

const CHIP_TECNICO: Record<string, { label: string; cls: string }> = {
  CUMPLE: { label: 'Cumple todo', cls: 'bg-emerald-100 text-emerald-700' },
  CON_PENDIENTES: { label: 'Con pendientes', cls: 'bg-amber-100 text-amber-800' },
  NO_CUMPLE: { label: 'No cumple', cls: 'bg-red-100 text-red-700' },
  NO_CORRIDO: { label: 'Sin verificar', cls: 'bg-zinc-100 text-zinc-600' },
  SIN_REQUISITOS: { label: 'Sin requisitos heredados', cls: 'bg-zinc-100 text-zinc-500' },
  NO_APLICA: { label: 'Vía liviana: no corre', cls: 'bg-zinc-100 text-zinc-500' },
  SIN_EVALUAR: { label: 'Sin evaluar', cls: 'bg-zinc-100 text-zinc-600' },
};
const ICONO_VEREDICTO: Record<string, string> = { CUMPLE: '✅', NO_CUMPLE: '❌', CUMPLE_CON_COMPLEMENTO: '➕', SIN_VEREDICTO: '⏳' };
const MARCA_ORIGEN: Record<string, string> = { FICHA_WEB: '🌐', CONFIRMACION_INFORMAL: '💬', DECLARADO: '✍️', CONTRADICE_FICHA: '⚠️' };

function EstadoTecnico({ o, ocupado, onVerificar }: { o: OpcionDTO; ocupado: boolean; onVerificar: (opcionId: number) => void }) {
  const t = o.tecnico;
  const r = t.resultado;
  const puede = o.via === 'completa' && t.requisitosTotal > 0 && o.estado !== 'descartada' && !['aprobada', 'en_aprobacion'].includes(o.estado);
  return (
    <div>
      <span className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full ${CHIP_TECNICO[t.estado]?.cls}`}>{CHIP_TECNICO[t.estado]?.label}</span>
      {r && <span className="ml-1.5 text-[11px] text-zinc-500">{r.resumen.cumple + r.resumen.conComplemento} ✅ · {r.resumen.noCumple} ❌ · {r.resumen.riesgo} 🔴 · {r.resumen.porAfinar} 🔧</span>}
      {t.error && <p className="text-[11px] text-red-600 mt-0.5">{t.error}</p>}
      {t.corridoAt && <p className="text-[10.5px] text-zinc-400">Verificado {t.corridoAt.slice(0, 16).replace('T', ' ')}{t.segundaPasadaAt ? ' · 2ª pasada hecha' : ''}</p>}
      {puede && (
        <button onClick={() => onVerificar(o.id)} disabled={ocupado}
          className="mt-1 flex items-center gap-1 px-2 py-0.5 rounded-md border border-indigo-200 text-indigo-700 text-[11px] font-semibold hover:bg-indigo-50 disabled:opacity-50">
          {ocupado ? <><Loader2 size={11} className="animate-spin" /> Verificando…</> : t.corridoAt ? 'Volver a verificar' : 'Verificar técnico'}
        </button>
      )}
    </div>
  );
}

// ── Cuadro comparativo TÉCNICO de una línea: filas = requisitos (texto literal de las bases), columnas = opciones ────
function CuadroTecnico({ linea, puedeAprobar, onAccion }: {
  linea: LineaAuditorDTO; puedeAprobar: boolean;
  onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void;
}) {
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [declarando, setDeclarando] = useState<{ opcionId: number; n: number } | null>(null);
  const [textoDecl, setTextoDecl] = useState('');
  const [respaldoDecl, setRespaldoDecl] = useState('');
  const columnas = linea.opciones.filter(o => o.estado !== 'descartada' && o.tecnico.resultado);
  if (columnas.length === 0) return null;
  const base = columnas[0].tecnico.resultado!.filas;
  const alertas = columnas.flatMap(o => (o.tecnico.resultado!.alertas || []).filter(a => a.nivel !== 'info').map(a => ({ ...a, opcion: o })));
  const costos = columnas.map(o => o.verificacion?.costoNetoUnitario ?? null);
  const minimo = costos.filter((x): x is number => x != null).length > 1 ? Math.min(...costos.filter((x): x is number => x != null)) : null;
  const fila = (o: OpcionDTO, n: number) => o.tecnico.resultado!.filas.find(f => f.n === n);

  return (
    <div className="ml-6 mt-4">
      <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1.5">Cuadro comparativo técnico · {base.length} requisitos</p>
      {alertas.slice(0, 4).map((a, i) => (
        <p key={i} className={`text-[11.5px] mb-1 ${a.nivel === 'rojo' ? 'text-red-600' : 'text-amber-700'}`}>{a.nivel === 'rojo' ? '🔴' : '🟡'} {columnas.length > 1 ? `[${o_nombre(a.opcion)}] ` : ''}{a.texto}</p>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-left align-top">
              <th className="pr-3 pb-1.5 text-[10.5px] uppercase tracking-wide text-zinc-400 font-bold min-w-[260px]">Requerimiento (literal de las bases)</th>
              {columnas.map(o => <th key={o.id} className="pb-1.5 pr-3 min-w-[150px] font-semibold text-zinc-700">{o_nombre(o)}</th>)}
            </tr>
          </thead>
          <tbody className="align-top">
            {base.map(f0 => {
              const abierto = abiertos.has(f0.n);
              return (
                <Fragment key={f0.n}>
                  <tr className={`border-t border-zinc-100 cursor-pointer hover:bg-zinc-50 ${f0.rojo ? 'bg-red-50/40' : ''}`}
                    onClick={() => setAbiertos(prev => { const nx = new Set(prev); if (nx.has(f0.n)) nx.delete(f0.n); else nx.add(f0.n); return nx; })}>
                    <td className="pr-3 py-1.5 text-zinc-700">{f0.rojo && <span title="Puede dejarnos fuera (INADMISIBLE)">🔴 </span>}{f0.requeridoTexto}<span className="block text-[10.5px] text-zinc-400">{f0.fuenteBases}</span></td>
                    {columnas.map(o => {
                      const f = fila(o, f0.n);
                      if (!f) return <td key={o.id} className="pr-3 py-1.5 text-zinc-300">—</td>;
                      return (
                        <td key={o.id} className="pr-3 py-1.5">
                          <span title={f.resumenPartes}>{ICONO_VEREDICTO[f.veredicto]}</span>{f.origen && MARCA_ORIGEN[f.origen] && <span className="ml-1" title={f.origen}>{MARCA_ORIGEN[f.origen]}</span>}
                          {f.habilitacion === 'EM' && !f.habilitado && <span className="ml-1 text-[10px] font-bold text-violet-600" title={f.motivoHabilitacion || ''}>EM</span>}
                          {f.sobrecumple && <span className="ml-1 text-[10px] text-sky-600">sobrecumple</span>}
                          <span className="block text-[11px] text-zinc-500">{f.valorCorto}</span>
                          {!f.cerrada && f.motivoPendiente && <span className="text-[10px] font-bold text-amber-700">{f.motivoPendiente === 'RIESGO' ? '🔴 RIESGO' : '🔧 POR AFINAR'}</span>}
                        </td>
                      );
                    })}
                  </tr>
                  {abierto && (
                    <tr className="bg-zinc-50/60">
                      <td colSpan={columnas.length + 1} className="px-3 py-2">
                        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columnas.length}, minmax(0, 1fr))` }}>
                          {columnas.map(o => {
                            const f = fila(o, f0.n);
                            if (!f) return <div key={o.id} />;
                            return (
                              <div key={o.id} className="text-[11.5px] text-zinc-600 space-y-1">
                                <p className="font-semibold text-zinc-700">{o_nombre(o)} · {f.resumenPartes}</p>
                                {f.partes.filter(p => p.citaOriginal).slice(0, 2).map((p, i) => <p key={i} className="text-zinc-500">«{p.citaOriginal}»{p.citaTraduccion ? ` (${p.citaTraduccion})` : ''}{p.calculo ? ` — ${p.calculo}` : ''}</p>)}
                                {f.partes.flatMap(p => p.guardarrailes).map((g, i) => <p key={`g${i}`} className="text-amber-700">⚙ {g}</p>)}
                                {f.rectificacion && <p className="text-red-600 font-semibold">Rectificación: {f.rectificacion}</p>}
                                {!f.cerrada && f.ayuda && (<>
                                  {f.ayuda.diagnostico && <p><b>Diagnóstico:</b> {f.ayuda.diagnostico}</p>}
                                  {f.ayuda.hipotesisCausa.length > 0 && <p><b>Causa probable:</b> {f.ayuda.hipotesisCausa[0]}</p>}
                                  {f.ayuda.veredictoEquivalencia && <p><b>Frente a las bases:</b> {f.ayuda.veredictoEquivalencia}</p>}
                                  {f.ayuda.preguntaProveedor && <p><b>Pregunta al proveedor:</b> {f.ayuda.preguntaProveedor}</p>}
                                  {f.ayuda.declaracionPropuesta && <p><b>Declaración propuesta:</b> {f.ayuda.declaracionPropuesta}</p>}
                                </>)}
                                {!f.cerrada && <p><b>Ruta ({f.ayuda?.ruta || 'SALVABLE'}):</b> {f.rutaCierre}</p>}
                                <div className="flex gap-2 flex-wrap pt-0.5">
                                  {f.habilitacion === 'EM' && puedeAprobar && !f.habilitado && f.veredicto !== 'SIN_VEREDICTO' && f.veredicto !== 'NO_CUMPLE' &&
                                    <button onClick={e => { e.stopPropagation(); onAccion(o.id, 'habilitar_item_tecnico', { n: f.n }, 'Dato habilitado'); }} className="px-2 py-0.5 rounded-md bg-violet-600 text-white font-semibold text-[11px]">Habilitar (EM)</button>}
                                  {!f.cerrada && f.veredicto !== 'NO_CUMPLE' && (
                                    <button onClick={e => { e.stopPropagation(); setDeclarando({ opcionId: o.id, n: f.n }); setTextoDecl(''); setRespaldoDecl(''); }} className="px-2 py-0.5 rounded-md border border-zinc-300 text-zinc-600 font-semibold text-[11px]">Declarar con respaldo</button>)}
                                </div>
                                {declarando && declarando.opcionId === o.id && declarando.n === f.n && (
                                  <div className="space-y-1 border border-zinc-200 rounded-md p-2 bg-white" onClick={e => e.stopPropagation()}>
                                    <textarea value={textoDecl} onChange={e => setTextoDecl(e.target.value)} rows={2} placeholder="Declaración (qué afirmas del producto)…" className="w-full border border-zinc-200 rounded px-2 py-1 text-[11.5px]" />
                                    <input value={respaldoDecl} onChange={e => setRespaldoDecl(e.target.value)} placeholder="Respaldo obligatorio: link o nombre del documento adjunto…" className="w-full border border-zinc-200 rounded px-2 py-1 text-[11.5px]" />
                                    <div className="flex gap-2">
                                      <button onClick={() => { onAccion(o.id, 'declarar_item_tecnico', { n: f.n, texto: textoDecl, respaldo: respaldoDecl }, 'Declaración registrada (pasa por el EM)'); setDeclarando(null); }} className="px-2 py-0.5 rounded bg-amber-600 text-white text-[11px] font-semibold">Guardar</button>
                                      <button onClick={() => setDeclarando(null)} className="text-[11px] text-zinc-500">Cancelar</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr className="border-t-2 border-zinc-300">
              <td className="pr-3 py-2 text-[11px] font-bold uppercase tracking-wide text-zinc-600">Costo unitario neto</td>
              {columnas.map((o, i) => <td key={o.id} className={`pr-3 py-2 text-[13px] font-bold ${costos[i] != null && costos[i] === minimo ? 'text-emerald-600' : 'text-zinc-800'}`}>{fmtCLP(costos[i])}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
const o_nombre = (o: OpcionDTO) => [o.proveedorRazonSocial, [o.marca, o.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || `Opción #${o.id}`;

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return <tr className="border-t border-zinc-100"><td className="pr-3 py-1.5 text-[10.5px] uppercase tracking-wide text-zinc-400 font-bold align-top">{etiqueta}</td>{children}</tr>;
}

function Acciones({ o, exigeViaCompleta, ocupado, puedeAprobar, onAccion, onModal }: {
  o: OpcionDTO; exigeViaCompleta: boolean; ocupado: boolean; puedeAprobar: boolean;
  onAccion: (opcionId: number, accion: string, extra?: Record<string, unknown>, ok?: string) => void;
  onModal: (tipo: 'descartar' | 'rechazar', opcionId: number) => void;
}) {
  const btn = 'px-2.5 py-1 rounded-md text-[11.5px] font-semibold disabled:opacity-40';
  if (ocupado) return <Loader2 size={14} className="animate-spin text-zinc-400" />;
  const bloqueada = (o.verificacion?.bloqueos.length ?? 0) > 0;
  return (
    <div className="flex flex-wrap gap-1.5">
      {!['descartada', 'aprobada', 'en_aprobacion', 'definitiva'].includes(o.estado) && (
        <select value={o.via} onChange={e => onAccion(o.id, 'cambiar_via', { via: e.target.value })}
          title={exigeViaCompleta ? 'Esta línea tiene exigencias que pueden dejarnos fuera: requiere verificación completa.' : 'Vía de verificación de esta opción'}
          className="text-[11px] border border-zinc-200 rounded-md px-1.5 py-1 bg-white text-zinc-600">
          <option value="completa">Vía completa</option>
          <option value="liviana" disabled={exigeViaCompleta}>Vía liviana{exigeViaCompleta ? ' (no permitida)' : ''}</option>
        </select>
      )}
      {o.estado === 'descartada' && <button className={`${btn} border border-zinc-200 text-zinc-600`} onClick={() => onAccion(o.id, 'restaurar')}>Restaurar</button>}
      {['tanteo', 'formalizada', 'verificada'].includes(o.estado) && (
        <button className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`} disabled={bloqueada || o.estado !== 'verificada' && o.verificacion?.veredicto !== 'REQUIERE_HABILITACION'}
          title={bloqueada ? 'Hay bloqueos abiertos' : 'Firmar como la opción a ofertar'} onClick={() => onAccion(o.id, 'firmar', {}, 'Opción firmada como definitiva')}>Firmar</button>
      )}
      {o.estado === 'definitiva' && <>
        <button className={`${btn} bg-amber-600 text-white hover:bg-amber-700`} onClick={() => onAccion(o.id, 'solicitar_aprobacion', {}, 'Pasada final correcta: en aprobación')}>Solicitar aprobación</button>
        <button className={`${btn} border border-zinc-200 text-zinc-600`} onClick={() => onAccion(o.id, 'quitar_firma')}>Quitar firma</button>
      </>}
      {o.estado === 'en_aprobacion' && puedeAprobar && <>
        <button className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} onClick={() => onAccion(o.id, 'aprobar', {}, 'Opción aprobada')}>Aprobar</button>
        <button className={`${btn} border border-red-200 text-red-600`} onClick={() => onModal('rechazar', o.id)}>Rechazar</button>
      </>}
      {o.estado === 'en_aprobacion' && !puedeAprobar && <span className="text-[11.5px] text-amber-700">Esperando al EM</span>}
      {o.estado === 'aprobada' && <span className="text-[11.5px] text-emerald-700 font-semibold">✓ Aprobada</span>}
      {!['descartada', 'aprobada', 'en_aprobacion'].includes(o.estado) && <button className={`${btn} border border-zinc-200 text-zinc-500 hover:text-red-600`} onClick={() => onModal('descartar', o.id)}>Descartar</button>}
      {o.firmadaPorNombre && <p className="w-full text-[10.5px] text-zinc-400">Firmada por {o.firmadaPorNombre}</p>}
    </div>
  );
}
