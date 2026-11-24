'use client';

// ENTREGA DEL PROYECTO (spec §16), versión compacta (18-nov-2026, pedido del dueño: «mucho espacio, feo»). Una sola tarjeta:
// franja con verificación y modalidad → tres documentos en fila (acta firmada, guía firmada, capacitación) → quién recibió.
// Al subir el acta o la guía firmada se LEEN solas y llenan el N° de guía y quién recibió; se corrige acá mismo.
// El acta formal se arma en Gestionar documentos. Ya no se pide el N° de nota de venta (nadie lo usaba).
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { urlInline } from './MiniaturaDoc';
import { irAFase } from '@/app/compras/[negocioId]/comprasNavegacion';
import {
  IconPackage as PackageCheck, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconCircleX as XCircle, IconPlus as Plus, IconX as X, IconTrash as Trash2,
  IconUpload as Upload, IconFileText as FileText, IconPencil as Pencil, IconWand as Leer, IconFilePlus as FilePlus, IconCamera as Camara,
} from '@tabler/icons-react';

type Modalidad = 'TOTAL' | 'PARCIAL';
interface FirmaDatos { nombre: string; rut: string; cargo: string; recinto: string; fecha: string }
interface Punto { id: number; direccion: string; comuna: string | null; contactoNombre: string | null; contactoTelefono: string | null }
interface Entrega {
  modalidad: Modalidad; modalidadMotivo: string | null; notaVentaNumero: string | null; guiaDespachoNumero: string | null;
  verificacionConforme: boolean | null; verificacionPorNombre: string | null;
  actaGeneradaAt: string | null; actaAprobadaPorNombre: string | null; actaAprobadaAt: string | null;
  actaConformidad: string | null; actaFirma: FirmaDatos | null; guiaFirma: FirmaDatos | null; guiaTimbre: boolean;
  cerradaAt: string | null; puntos: Punto[];
}
interface Escaneo { id: number; tipo: 'acta' | 'guia' | 'capacitacion' | 'otro' | 'foto'; archivoUrl: string; archivoNombre: string; subidoPorNombre: string | null; creadoAt: string }
interface DocGenerado { id: number; titulo: string; plantillaNombre: string; createdAt: string }

const esPdf = (n: string) => /\.pdf$/i.test(n);
const fmtFecha = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : s; };
const entrada = 'text-[12px] border border-zinc-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 bg-white';

/** Primera página chica del escaneo (PDF) o un ícono (foto). */
function Mini({ e, titulo, onAbrir }: { e: Escaneo; titulo: string; onAbrir: () => void }) {
  return (
    <button type="button" onClick={onAbrir} title={`Abrir ${titulo}`} className="relative flex-shrink-0 w-[52px] h-[68px] rounded-md border border-zinc-200 bg-zinc-50 overflow-hidden hover:border-teal-400">
      {esPdf(e.archivoNombre)
        ? <iframe src={`${urlInline(e.archivoUrl)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} title={titulo} tabIndex={-1} loading="lazy" className="absolute top-0 left-0 border-0 pointer-events-none" style={{ width: 208, height: 272, transform: 'scale(0.25)', transformOrigin: 'top left' }} />
        : <span className="absolute inset-0 flex items-center justify-center text-zinc-300"><FileText size={20} /></span>}
    </button>
  );
}

/** Un documento de la entrega: miniatura + estado + acciones, en una tarjeta baja. */
function TarjetaDoc({ titulo, vacio, tipo, escaneos, puedeOperar, subiendo, onSubir, onQuitar, onAbrir, extra }: {
  titulo: string; vacio: string; tipo: Escaneo['tipo']; escaneos: Escaneo[]; puedeOperar: boolean; subiendo: boolean;
  onSubir: (tipo: Escaneo['tipo'], f: File) => void; onQuitar: (id: number) => void; onAbrir: (d: VisorDoc) => void; extra?: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const mios = escaneos.filter(e => e.tipo === tipo);
  const ultimo = mios[mios.length - 1];
  return (
    <div className={`rounded-xl border p-2.5 flex gap-2.5 min-w-0 ${ultimo ? 'border-emerald-200 bg-emerald-50/30' : 'border-dashed border-zinc-300 bg-zinc-50/50'}`}>
      {ultimo
        ? <Mini e={ultimo} titulo={titulo} onAbrir={() => onAbrir({ nombre: ultimo.archivoNombre, url: ultimo.archivoUrl, titulo })} />
        : <span className="flex-shrink-0 w-[52px] h-[68px] rounded-md border border-dashed border-zinc-300 flex items-center justify-center text-zinc-300"><FileText size={20} /></span>}
      <div className="min-w-0 flex-1 flex flex-col">
        <p className="text-[12.5px] font-semibold text-zinc-800 leading-tight">{titulo}</p>
        <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">
          {ultimo ? <>Cargada {fmtFecha(ultimo.creadoAt.slice(0, 10))}{mios.length > 1 && ` · ${mios.length} archivos`}</> : vacio}
        </p>
        <div className="mt-auto pt-1.5 flex items-center gap-3 flex-wrap">
          {puedeOperar && (
            <>
              <button onClick={() => input.current?.click()} disabled={subiendo} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50 flex items-center gap-1">
                {subiendo ? <><Loader2 size={12} className="animate-spin" /> Leyendo…</> : <><Upload size={12} /> {ultimo ? 'Subir otro' : 'Subir'}</>}
              </button>
              <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onSubir(tipo, f); e.target.value = ''; }} />
            </>
          )}
          {extra}
          {puedeOperar && ultimo && <button onClick={() => onQuitar(ultimo.id)} title="Quitar" aria-label="Quitar" className="text-zinc-400 hover:text-rose-600 ml-auto"><Trash2 size={13} /></button>}
        </div>
      </div>
    </div>
  );
}

/** Respaldo de entrega: galería de fotos (camión, bultos, producto instalado, cliente recibiendo). Solo se guardan; no cierran nada. */
function RespaldoFotos({ escaneos, puedeOperar, subiendo, onSubir, onQuitar, onAbrir }: {
  escaneos: Escaneo[]; puedeOperar: boolean; subiendo: boolean; onSubir: (tipo: Escaneo['tipo'], f: File) => void; onQuitar: (id: number) => void; onAbrir: (d: VisorDoc) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const fotos = escaneos.filter(e => e.tipo === 'foto');
  return (
    <div className="rounded-xl border border-zinc-200 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-[12.5px] font-semibold text-zinc-800 flex items-center gap-1.5"><Camara size={14} /> Respaldo de entrega{fotos.length > 0 && <span className="text-[11px] font-medium text-zinc-400">{fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'}</span>}</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Fotos de la entrega: la carga, los bultos, el producto instalado o el cliente recibiendo.</p>
        </div>
        {puedeOperar && (
          <>
            <button onClick={() => input.current?.click()} disabled={subiendo} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50 flex items-center gap-1">
              {subiendo ? <><Loader2 size={12} className="animate-spin" /> Subiendo…</> : <><Upload size={12} /> Subir fotos</>}
            </button>
            <input ref={input} type="file" accept="image/*" multiple className="hidden"
              onChange={async e => { const fs = Array.from(e.target.files || []); e.target.value = ''; for (const f of fs) await onSubir('foto', f); }} />
          </>
        )}
      </div>
      {fotos.length > 0 ? (
        <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
          {fotos.map(e => (
            <div key={e.id} className="relative group aspect-square rounded-lg border border-zinc-200 bg-zinc-50 overflow-hidden">
              <button type="button" onClick={() => onAbrir({ nombre: e.archivoNombre, url: e.archivoUrl, titulo: e.archivoNombre })} title={`${e.archivoNombre} · ${fmtFecha(e.creadoAt.slice(0, 10))}`} className="absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urlInline(e.archivoUrl)} alt={e.archivoNombre} loading="lazy" className="w-full h-full object-cover" />
              </button>
              {puedeOperar && <button onClick={() => onQuitar(e.id)} title="Quitar foto" aria-label="Quitar foto" className="absolute top-1 right-1 rounded-md bg-white/90 p-1 text-zinc-500 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"><Trash2 size={12} /></button>}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] text-zinc-400">{puedeOperar ? 'Aún no hay fotos. Puedes subir varias a la vez.' : 'Aún no hay fotos de la entrega.'}</p>
      )}
    </div>
  );
}

/** Documentos extra de la entrega (fotos, correos, constancias…): se suben los que hagan falta, cada uno se abre o se quita. */
function OtrosDocumentos({ escaneos, puedeOperar, subiendo, onSubir, onQuitar, onAbrir }: {
  escaneos: Escaneo[]; puedeOperar: boolean; subiendo: boolean; onSubir: (tipo: Escaneo['tipo'], f: File) => void; onQuitar: (id: number) => void; onAbrir: (d: VisorDoc) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const otros = escaneos.filter(e => e.tipo === 'otro');
  if (!puedeOperar && otros.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap text-[12px]">
      <span className="text-[10.5px] font-semibold text-zinc-400">Otros documentos</span>
      {otros.map(e => (
        <span key={e.id} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white pl-2 pr-1.5 py-1 max-w-[260px]">
          <FileText size={12} className="text-zinc-400 flex-shrink-0" />
          <button onClick={() => onAbrir({ nombre: e.archivoNombre, url: e.archivoUrl, titulo: e.archivoNombre })} title={e.archivoNombre} className="truncate text-zinc-700 hover:text-teal-700">{e.archivoNombre}</button>
          {puedeOperar && <button onClick={() => onQuitar(e.id)} title="Quitar" aria-label="Quitar" className="text-zinc-400 hover:text-rose-600 flex-shrink-0"><Trash2 size={12} /></button>}
        </span>
      ))}
      {puedeOperar && (
        <>
          <button onClick={() => input.current?.click()} disabled={subiendo} className="font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50 flex items-center gap-1">
            {subiendo ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Agregar documento
          </button>
          <input ref={input} type="file" accept="application/pdf,image/*" multiple className="hidden"
            onChange={async e => { const fs = Array.from(e.target.files || []); e.target.value = ''; for (const f of fs) await onSubir('otro', f); }} />
        </>
      )}
    </div>
  );
}

function FormRecepcion({ inicial, guiaInicial, recintoPorDefecto, guardando, onGuardar, onCancelar }: {
  inicial: FirmaDatos | null; guiaInicial: string; recintoPorDefecto: string; guardando: boolean; onGuardar: (f: FirmaDatos, guia: string) => void; onCancelar: () => void;
}) {
  const [f, setF] = useState<FirmaDatos>(inicial ? { ...inicial } : { nombre: '', rut: '', cargo: '', recinto: recintoPorDefecto, fecha: '' });
  const [guia, setGuia] = useState(guiaInicial);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
      <input value={f.nombre} onChange={e => setF(v => ({ ...v, nombre: e.target.value }))} placeholder="Quién recibió" className={`${entrada} sm:col-span-2`} />
      <input value={f.rut} onChange={e => setF(v => ({ ...v, rut: e.target.value }))} placeholder="RUT" className={entrada} />
      <input value={f.cargo} onChange={e => setF(v => ({ ...v, cargo: e.target.value }))} placeholder="Cargo" className={entrada} />
      <input type="date" value={f.fecha} onChange={e => setF(v => ({ ...v, fecha: e.target.value }))} className={entrada} />
      <input value={guia} onChange={e => setGuia(e.target.value)} placeholder="N° guía" className={entrada} />
      <div className="col-span-2 sm:col-span-6 flex items-center gap-2">
        <button onClick={() => onGuardar(f, guia)} disabled={guardando || !f.nombre.trim() || !f.fecha} className="text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
          {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
        </button>
        <button onClick={onCancelar} className="text-[11.5px] text-zinc-500 hover:text-zinc-700">Cancelar</button>
      </div>
    </div>
  );
}

// `puedeVerificar`: además del encargado (`puedeOperar`), el perfil "bodega" (§2.2) puede marcar Conforme/No conforme (§16.4). Lo demás es solo del encargado.
export function EntregaCard({ negocioId, puedeOperar, puedeVerificar = false }: { negocioId: number; puedeOperar: boolean; puedeVerificar?: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [entrega, setEntrega] = useState<Entrega | null>(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [formPunto, setFormPunto] = useState(false);
  const [punto, setPunto] = useState({ direccion: '', comuna: '', contactoNombre: '', contactoTelefono: '' });
  const [modalidadPendiente, setModalidadPendiente] = useState(false);
  const [motivoParcial, setMotivoParcial] = useState('');
  const [escaneos, setEscaneos] = useState<Escaneo[]>([]);
  const [subiendoTipo, setSubiendoTipo] = useState<string | null>(null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const [actasGeneradas, setActasGeneradas] = useState<DocGenerado[]>([]);
  const [hayPlantillas, setHayPlantillas] = useState(false);
  const [organismo, setOrganismo] = useState('');
  const [editandoRecepcion, setEditandoRecepcion] = useState(false);
  const [leyendo, setLeyendo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/entrega`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setEntrega(data.entrega);
    } catch (e: any) {
      toast.error('No se pudo cargar la entrega', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar]);

  const cargarDocumentos = useCallback(async () => {
    try {
      const [a, g] = await Promise.all([
        fetch(`/api/compras/${negocioId}/entrega-archivos`).then(r => r.json()).catch(() => null),
        fetch(`/api/compras/${negocioId}/documentos-generados`).then(r => r.json()).catch(() => null),
      ]);
      if (a?.success) setEscaneos(a.archivos || []);
      if (g?.success && g.habilitado) {
        setHayPlantillas(true); setOrganismo(g.contexto?.organismo || '');
        setActasGeneradas((g.historial || []).filter((h: any) => /acta/i.test(h.plantillaNombre || h.titulo || '')));
      }
    } catch { /* la tarjeta sigue sirviendo sin esto */ }
  }, [negocioId]);
  useEffect(() => { cargarDocumentos(); }, [cargarDocumentos]);

  const accion = async (body: Record<string, unknown>) => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/entrega`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar');
      setEntrega(data.entrega);
      recargarCompartido();
      return true;
    } catch (e: any) {
      toast.error('No se pudo actualizar', e.message);
      return false;
    } finally {
      setGuardando(false);
    }
  };

  const subirEscaneo = async (tipo: Escaneo['tipo'], f: File) => {
    setSubiendoTipo(tipo);
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('tipo', tipo);
      const res = await fetch(`/api/compras/${negocioId}/entrega-archivos`, { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo subir');
      setEscaneos(d.archivos || []);
      toast.success('Documento cargado', d.llenado?.length ? `Se llenó solo: ${d.llenado.join(', ')}. Revisa lo escrito a mano: la letra no siempre se lee bien.` : (tipo === 'capacitacion' || tipo === 'foto' || tipo === 'otro' ? undefined : 'No se pudieron leer datos: puedes escribirlos con «Corregir».'));
      await cargar(); recargarCompartido();
    } catch (e: any) { toast.error('No se pudo subir el documento', e.message); }
    finally { setSubiendoTipo(null); }
  };

  const quitarEscaneo = async (id: number) => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/entrega-archivos?id=${id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo quitar');
      setEscaneos(d.archivos || []);
      await cargar(); recargarCompartido();
    } catch (e: any) { toast.error('No se pudo quitar el documento', e.message); }
  };

  const releer = async (id: number) => {
    setLeyendo(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/entrega-archivos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ releer: id }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo leer');
      toast.success(d.llenado?.length ? 'Datos leídos' : 'No se encontró nada nuevo', d.llenado?.length ? `Se llenó: ${d.llenado.join(', ')}.` : 'El documento no trae datos claros o ya estaban llenos.');
      await cargar();
    } catch (e: any) { toast.error('No se pudo leer el documento', e.message); }
    finally { setLeyendo(false); }
  };

  if (loading || !entrega) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  const actaCargada = escaneos.find(e => e.tipo === 'acta');
  const guiaCargada = escaneos.find(e => e.tipo === 'guia');
  const recibio = entrega.actaFirma;
  const comunes = { escaneos, puedeOperar, onSubir: subirEscaneo, onQuitar: quitarEscaneo, onAbrir: setVisor };

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex-wrap">
        <p className="text-[12.5px] font-semibold text-zinc-700 flex items-center gap-1.5">
          <PackageCheck size={14} /> Entrega del proyecto
          {entrega.cerradaAt && <span className="text-[10.5px] font-medium text-emerald-700">Cerrada {fmtFecha(entrega.cerradaAt.slice(0, 10))}</span>}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {entrega.verificacionConforme != null ? (
            <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full border ${entrega.verificacionConforme ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
              Bodega: {entrega.verificacionConforme ? 'conforme' : 'no conforme'} — {entrega.verificacionPorNombre}
            </span>
          ) : (puedeOperar || puedeVerificar) ? (
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">Verificación en bodega:</span>
              <button onClick={() => accion({ accion: 'verificacion', conforme: true })} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded-lg"><CheckCircle2 size={11} /> Conforme</button>
              <button onClick={() => accion({ accion: 'verificacion', conforme: false })} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 px-2 py-1 rounded-lg"><XCircle size={11} /> No conforme</button>
            </span>
          ) : <span className="text-[11px] text-zinc-400">Verificación pendiente</span>}
          <Select value={entrega.modalidad} disabled={!puedeOperar} minWidth={130}
            onChange={v => { if (v === 'PARCIAL') { setModalidadPendiente(true); setMotivoParcial(''); } else { setModalidadPendiente(false); accion({ accion: 'modalidad', modalidad: v }); } }}
            options={[{ value: 'TOTAL', label: 'Entrega total' }, { value: 'PARCIAL', label: 'Entrega parcial' }]} />
        </div>
      </div>

      <div className="p-3 space-y-3">
        {(modalidadPendiente || (entrega.modalidadMotivo && entrega.modalidad === 'PARCIAL')) && (
          modalidadPendiente ? (
            <div className="flex items-center gap-1.5">
              <input value={motivoParcial} onChange={e => setMotivoParcial(e.target.value)} placeholder="Motivo de la entrega parcial (excepcional, a petición del cliente)" className={`flex-1 ${entrada}`} />
              <button onClick={async () => { if (await accion({ accion: 'modalidad', modalidad: 'PARCIAL', motivo: motivoParcial.trim() })) setModalidadPendiente(false); }}
                disabled={!motivoParcial.trim()} className="text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Guardar</button>
              <button onClick={() => setModalidadPendiente(false)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
            </div>
          ) : <p className="text-[11px] text-zinc-500">Entrega parcial: {entrega.modalidadMotivo}</p>
        )}

        {/* Tres documentos en fila */}
        <div className="grid gap-2.5 grid-cols-1 md:grid-cols-3">
          <TarjetaDoc titulo="Acta de entrega firmada" tipo="acta" vacio="Sube el acta con la firma del cliente: se leen sola la guía y quién recibió."
            subiendo={subiendoTipo === 'acta'} {...comunes}
            extra={<>
              {puedeOperar && actaCargada && <button onClick={() => releer(actaCargada.id)} disabled={leyendo} title="Volver a leer el documento" className="text-[11.5px] font-semibold text-zinc-500 hover:text-teal-700 flex items-center gap-1 disabled:opacity-50">{leyendo ? <Loader2 size={12} className="animate-spin" /> : <Leer size={12} />} Leer datos</button>}
              {puedeOperar && hayPlantillas && <button onClick={() => irAFase('gestion')} className="text-[11.5px] font-semibold text-zinc-500 hover:text-teal-700 flex items-center gap-1"><FilePlus size={12} /> {actasGeneradas.length ? `Acta formal (${actasGeneradas.length})` : 'Armar acta'}</button>}
            </>} />
          <TarjetaDoc titulo="Guía de despacho firmada" tipo="guia" vacio="Sube la guía firmada por quien recibió: la entrega queda hecha."
            subiendo={subiendoTipo === 'guia'} {...comunes}
            extra={puedeOperar && guiaCargada ? <button onClick={() => releer(guiaCargada.id)} disabled={leyendo} title="Volver a leer el documento" className="text-[11.5px] font-semibold text-zinc-500 hover:text-teal-700 flex items-center gap-1 disabled:opacity-50">{leyendo ? <Loader2 size={12} className="animate-spin" /> : <Leer size={12} />} Leer datos</button> : null} />
          <TarjetaDoc titulo="Capacitación (listado de asistentes)" tipo="capacitacion" vacio="Si hubo capacitación, sube el listado firmado." subiendo={subiendoTipo === 'capacitacion'} {...comunes} />
        </div>

        <RespaldoFotos escaneos={escaneos} puedeOperar={puedeOperar} subiendo={subiendoTipo === 'foto'} onSubir={subirEscaneo} onQuitar={quitarEscaneo} onAbrir={setVisor} />

        {/* Otros documentos: correos, constancias… los que haga falta */}
        <OtrosDocumentos escaneos={escaneos} puedeOperar={puedeOperar} subiendo={subiendoTipo === 'otro'} onSubir={subirEscaneo} onQuitar={quitarEscaneo} onAbrir={setVisor} />

        {/* Quién recibió + guía (se llena solo con el acta) */}
        {editandoRecepcion ? (
          <FormRecepcion inicial={recibio} guiaInicial={entrega.guiaDespachoNumero || ''} recintoPorDefecto={organismo} guardando={guardando} onCancelar={() => setEditandoRecepcion(false)}
            onGuardar={async (f, guia) => { if (await accion({ accion: 'recepcion', firma: f, guiaNumero: guia })) setEditandoRecepcion(false); }} />
        ) : (recibio || entrega.guiaDespachoNumero) ? (
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px] text-zinc-600 rounded-lg bg-zinc-50 px-3 py-2">
            {entrega.guiaDespachoNumero && <span>Guía de despacho <b className="text-zinc-800">N° {entrega.guiaDespachoNumero}</b></span>}
            {recibio && <span>Recibió <b className="text-zinc-800">{recibio.nombre}</b>{recibio.rut && ` · ${recibio.rut}`}{recibio.cargo && ` · ${recibio.cargo}`} · {fmtFecha(recibio.fecha)}</span>}
            {puedeOperar && <button onClick={() => setEditandoRecepcion(true)} className="ml-auto text-[11.5px] font-semibold text-zinc-500 hover:text-teal-700 flex items-center gap-1"><Pencil size={11} /> Corregir</button>}
          </div>
        ) : puedeOperar && (actaCargada || guiaCargada) ? (
          <button onClick={() => setEditandoRecepcion(true)} className="text-[11.5px] font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-1"><Pencil size={11} /> Escribir quién recibió y el N° de guía</button>
        ) : null}

        {/* Puntos de entrega: solo si hay o se agregan (caso menor, §16.2) */}
        {(entrega.puntos.length > 0 || formPunto || puedeOperar) && (
          <div className="flex items-start gap-2 flex-wrap text-[11.5px]">
            <span className="text-[10.5px] font-semibold text-zinc-400 pt-0.5">Puntos de entrega</span>
            {entrega.puntos.map(p => (
              <span key={p.id} className="inline-flex items-center gap-1 bg-zinc-50 rounded-lg px-2 py-0.5 text-zinc-600">
                {p.direccion}{p.comuna && `, ${p.comuna}`}
                {puedeOperar && <button onClick={() => accion({ accion: 'punto_quitar', puntoId: p.id })} className="text-zinc-400 hover:text-rose-600"><Trash2 size={11} /></button>}
              </span>
            ))}
            {puedeOperar && !formPunto && <button onClick={() => setFormPunto(true)} className="font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-0.5"><Plus size={11} /> Agregar</button>}
            {formPunto && (
              <span className="inline-flex items-center gap-1.5">
                <input value={punto.direccion} onChange={e => setPunto(f => ({ ...f, direccion: e.target.value }))} placeholder="Dirección" className={entrada} />
                <button onClick={async () => { if (await accion({ accion: 'punto_agregar', ...punto })) { setPunto({ direccion: '', comuna: '', contactoNombre: '', contactoTelefono: '' }); setFormPunto(false); } }}
                  disabled={!punto.direccion.trim()} className="text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1 rounded-lg">Guardar</button>
                <button onClick={() => setFormPunto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
              </span>
            )}
          </div>
        )}
      </div>
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
