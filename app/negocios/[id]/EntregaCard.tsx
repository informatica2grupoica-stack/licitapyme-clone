'use client';

// ENTREGA DEL PROYECTO Y ACTA (spec §16). Único documento oficial que genera el módulo. Secuencia:
// verificación → números de OBUMA (nota de venta / guía) → generar acta → aprobar → firmar acta y
// guía → cierre (§16.7, cuando ambas firmas existen).
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Banner } from '@/app/components/ui/Banner';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { MiniaturaDoc, urlInline } from './MiniaturaDoc';
import { irAFase } from '@/app/compras/[negocioId]/comprasNavegacion';
import { IconUpload as Upload, IconPackage as PackageCheck, IconLoader2 as Loader2, IconCircleCheck as CheckCircle2, IconCircleX as XCircle, IconSignature as FileSignature, IconPlus as Plus, IconX as X, IconTrash as Trash2 } from '@tabler/icons-react';

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

interface Escaneo { id: number; tipo: 'acta' | 'guia' | 'capacitacion'; archivoUrl: string; archivoNombre: string; subidoPorNombre: string | null; creadoAt: string }
interface DocGenerado { id: number; titulo: string; plantillaNombre: string; createdAt: string }
const esPdf = (n: string) => /.pdf$/i.test(n);

/** Un documento firmado de la entrega: se sube el escaneo, se ve en miniatura y se puede quitar. */
function CasillaEscaneo({ titulo, ayuda, tipo, escaneos, puedeOperar, subiendo, onSubir, onQuitar, onAbrir }: {
  titulo: string; ayuda: string; tipo: Escaneo['tipo']; escaneos: Escaneo[]; puedeOperar: boolean; subiendo: boolean;
  onSubir: (tipo: Escaneo['tipo'], f: File) => void; onQuitar: (id: number) => void; onAbrir: (d: VisorDoc) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const mios = escaneos.filter(e => e.tipo === tipo);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-semibold text-zinc-700">{titulo} {mios.length > 0 && <span className="ml-1 text-[10.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">Cargada</span>}</p>
        {puedeOperar && (
          <>
            <button onClick={() => input.current?.click()} disabled={subiendo} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50 flex items-center gap-1">
              {subiendo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {mios.length ? 'Subir otra' : 'Subir escaneo'}
            </button>
            <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onSubir(tipo, f); e.target.value = ''; }} />
          </>
        )}
      </div>
      {mios.length === 0 ? <p className="text-[11px] text-zinc-400">{ayuda}</p> : (
        <div className="flex flex-wrap gap-2">
          {mios.map(e => (
            <div key={e.id} className="relative">
              <MiniaturaDoc src={esPdf(e.archivoNombre) ? urlInline(e.archivoUrl) : null} titulo={titulo} detalle={e.creadoAt} onAbrir={() => onAbrir({ nombre: e.archivoNombre, url: e.archivoUrl, titulo })} />
              {puedeOperar && <button onClick={() => onQuitar(e.id)} aria-label="Quitar" title="Quitar" className="absolute top-1 right-1 p-1 rounded bg-white/90 text-zinc-400 hover:text-rose-600"><Trash2 size={12} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const firmaVacia: FirmaDatos = { nombre: '', rut: '', cargo: '', recinto: '', fecha: '' };

function FormFirma({ onGuardar, guardando, inicial }: { onGuardar: (f: FirmaDatos, extra?: Record<string, unknown>) => void; guardando: boolean; inicial?: FirmaDatos | null }) {
  // Casi siempre la misma persona firma guía y acta: se precarga lo ya firmado (editable) para no escribirlo dos veces (4152-22-LE26, 13-nov-2026).
  const [f, setF] = useState<FirmaDatos>(inicial ? { ...inicial } : firmaVacia);
  return (
    <div className="grid grid-cols-2 gap-2">
      <input value={f.nombre} onChange={e => setF(v => ({ ...v, nombre: e.target.value }))} placeholder="Nombre"
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
      <input value={f.rut} onChange={e => setF(v => ({ ...v, rut: e.target.value }))} placeholder="RUT"
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
      <input value={f.cargo} onChange={e => setF(v => ({ ...v, cargo: e.target.value }))} placeholder="Cargo"
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
      <input value={f.recinto} onChange={e => setF(v => ({ ...v, recinto: e.target.value }))} placeholder="Recinto de recepción"
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
      <input type="date" value={f.fecha} onChange={e => setF(v => ({ ...v, fecha: e.target.value }))}
        className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500 col-span-2" />
      <button onClick={() => onGuardar(f)} disabled={guardando || !f.nombre || !f.rut || !f.cargo || !f.recinto || !f.fecha}
        className="col-span-2 text-[11.5px] font-semibold text-white bg-zinc-800 hover:bg-zinc-900 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
        {guardando ? <Loader2 size={13} className="animate-spin mx-auto" /> : 'Guardar firma'}
      </button>
    </div>
  );
}

// `puedeVerificar`: además del encargado (`puedeOperar`), el perfil "bodega" (§2.2) puede marcar
// Conforme/No conforme (§16.4) aunque no sea el encargado del negocio. El resto de la tarjeta
// (modalidad, puntos de entrega, acta, firmas) sigue exclusivo de `puedeOperar` — bodega no genera
// ni firma nada, solo constata que el producto llegó bien.
export function EntregaCard({ negocioId, puedeOperar, puedeVerificar = false }: { negocioId: number; puedeOperar: boolean; puedeVerificar?: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
  const [entrega, setEntrega] = useState<Entrega | null>(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [formPunto, setFormPunto] = useState(false);
  const [punto, setPunto] = useState({ direccion: '', comuna: '', contactoNombre: '', contactoTelefono: '' });
  const [numeros, setNumeros] = useState({ notaVentaNumero: '', guiaDespachoNumero: '' });
  const [firmandoActa, setFirmandoActa] = useState(false);
  const [firmandoGuia, setFirmandoGuia] = useState(false);
  const [conformidad, setConformidad] = useState<'CONFORME' | 'NO_CONFORME'>('CONFORME');
  // Antes `window.prompt` para el motivo de entrega parcial — se reemplaza por un campo real que
  // aparece al elegir "Entrega parcial", mismo criterio que el resto de la pantalla.
  const [modalidadPendiente, setModalidadPendiente] = useState(false);
  const [motivoParcial, setMotivoParcial] = useState('');

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/entrega`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setEntrega(data.entrega);
      setNumeros({ notaVentaNumero: data.entrega.notaVentaNumero || '', guiaDespachoNumero: data.entrega.guiaDespachoNumero || '' });
    } catch (e: any) {
      toast.error('No se pudo cargar la entrega', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Documentos firmados de la entrega (escaneos) y actas hechas en Gestionar documentos. Los hooks van antes del return temprano de abajo.
  const [escaneos, setEscaneos] = useState<Escaneo[]>([]);
  const [subiendoTipo, setSubiendoTipo] = useState<string | null>(null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const [actasGeneradas, setActasGeneradas] = useState<DocGenerado[]>([]);
  const [hayPlantillas, setHayPlantillas] = useState(false);

  const cargarDocumentos = useCallback(async () => {
    try {
      const [a, g] = await Promise.all([
        fetch(`/api/compras/${negocioId}/entrega-archivos`).then(r => r.json()).catch(() => null),
        fetch(`/api/compras/${negocioId}/documentos-generados`).then(r => r.json()).catch(() => null),
      ]);
      if (a?.success) setEscaneos(a.archivos || []);
      if (g?.success && g.habilitado) {
        setHayPlantillas(true);
        setActasGeneradas((g.historial || []).filter((h: any) => /acta/i.test(h.plantillaNombre || h.titulo || '')));
      }
    } catch { /* la tarjeta sigue sirviendo sin esto */ }
  }, [negocioId]);
  useEffect(() => { cargarDocumentos(); }, [cargarDocumentos]);

  const subirEscaneo = async (tipo: Escaneo['tipo'], f: File) => {
    setSubiendoTipo(tipo);
    try {
      const fd = new FormData(); fd.append('file', f); fd.append('tipo', tipo);
      const res = await fetch(`/api/compras/${negocioId}/entrega-archivos`, { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo subir');
      setEscaneos(d.archivos || []);
      toast.success('Documento cargado');
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

  const accion = async (body: Record<string, unknown>) => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/entrega`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
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

  if (loading || !entrega) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5">
          <PackageCheck size={14} /> Entrega del proyecto
          {entrega.cerradaAt && <span className="text-[10.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">Cerrada</span>}
        </p>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={entrega.modalidad} disabled={!puedeOperar} minWidth={140}
            onChange={v => { if (v === 'PARCIAL') { setModalidadPendiente(true); setMotivoParcial(''); } else { setModalidadPendiente(false); accion({ accion: 'modalidad', modalidad: v }); } }}
            options={[{ value: 'TOTAL', label: 'Entrega total' }, { value: 'PARCIAL', label: 'Entrega parcial' }]} />
          {entrega.modalidadMotivo && !modalidadPendiente && <span className="text-[11px] text-zinc-400">{entrega.modalidadMotivo}</span>}
          {modalidadPendiente && (
            <div className="w-full flex items-center gap-1.5">
              <input value={motivoParcial} onChange={e => setMotivoParcial(e.target.value)} placeholder="Motivo (excepcional, a petición del cliente)"
                className="flex-1 text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <button onClick={async () => { if (await accion({ accion: 'modalidad', modalidad: 'PARCIAL', motivo: motivoParcial.trim() })) setModalidadPendiente(false); }}
                disabled={!motivoParcial.trim()} className="text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Guardar</button>
              <button onClick={() => setModalidadPendiente(false)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
            </div>
          )}
        </div>

        {/* Puntos de entrega múltiples (§16.2) */}
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold text-zinc-400 uppercase">Puntos de entrega</p>
            {puedeOperar && <button onClick={() => setFormPunto(v => !v)} className="text-[11px] font-semibold text-teal-700 hover:text-teal-800 flex items-center gap-0.5"><Plus size={11} /> Agregar</button>}
          </div>
          {entrega.puntos.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-2 bg-zinc-50 rounded-lg px-2 py-1 mt-1">
              <span className="text-[11.5px] text-zinc-600">{p.direccion}{p.comuna && `, ${p.comuna}`}</span>
              {puedeOperar && <button onClick={() => accion({ accion: 'punto_quitar', puntoId: p.id })} className="text-zinc-400 hover:text-rose-600"><Trash2 size={12} /></button>}
            </div>
          ))}
          {formPunto && (
            <div className="mt-1.5 space-y-1.5">
              <input value={punto.direccion} onChange={e => setPunto(f => ({ ...f, direccion: e.target.value }))} placeholder="Dirección"
                className="w-full text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <div className="flex items-center gap-1.5">
                <button onClick={async () => { if (await accion({ accion: 'punto_agregar', ...punto })) { setPunto({ direccion: '', comuna: '', contactoNombre: '', contactoTelefono: '' }); setFormPunto(false); } }}
                  disabled={!punto.direccion.trim()} className="text-[11px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1 rounded-lg">Guardar</button>
                <button onClick={() => setFormPunto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={14} /></button>
              </div>
            </div>
          )}
        </div>

        {/* Verificación (§16.4) */}
        <div className="flex items-center gap-2">
          <p className="text-[10.5px] font-bold text-zinc-400 uppercase">Verificación</p>
          {entrega.verificacionConforme != null ? (
            <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full border ${entrega.verificacionConforme ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
              {entrega.verificacionConforme ? 'Conforme' : 'No conforme'} — {entrega.verificacionPorNombre}
            </span>
          ) : (puedeOperar || puedeVerificar) ? (
            <div className="flex items-center gap-1.5">
              <button onClick={() => accion({ accion: 'verificacion', conforme: true })} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded-lg"><CheckCircle2 size={11} /> Conforme</button>
              <button onClick={() => accion({ accion: 'verificacion', conforme: false })} className="flex items-center gap-1 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 px-2 py-1 rounded-lg"><XCircle size={11} /> No conforme</button>
            </div>
          ) : <span className="text-[11px] text-zinc-400">Pendiente</span>}
        </div>

        {/* Números de OBUMA (§16.4/§17.2 — el módulo solo los registra) */}
        <div className="grid grid-cols-2 gap-2">
          <input value={numeros.notaVentaNumero} onChange={e => setNumeros(f => ({ ...f, notaVentaNumero: e.target.value }))}
            onBlur={() => numeros.notaVentaNumero && accion({ accion: 'numeros', notaVentaNumero: numeros.notaVentaNumero })}
            placeholder="N° nota de venta (OBUMA)" disabled={!puedeOperar}
            className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <input value={numeros.guiaDespachoNumero} onChange={e => setNumeros(f => ({ ...f, guiaDespachoNumero: e.target.value }))}
            onBlur={() => numeros.guiaDespachoNumero && accion({ accion: 'numeros', guiaDespachoNumero: numeros.guiaDespachoNumero })}
            placeholder="N° guía de despacho (OBUMA)" disabled={!puedeOperar}
            className="text-[11.5px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
        </div>

        {/* Documentos de la entrega: el acta se genera formal en Gestionar documentos y lo firmado se carga acá (escaneo). */}
        <div className="pt-2 border-t border-zinc-100 space-y-3">
          <p className="text-[10.5px] font-bold text-zinc-400 uppercase flex items-center gap-1"><FileSignature size={11} /> Acta de entrega y documentos firmados</p>

          {hayPlantillas && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-2.5 space-y-2">
              <p className="text-[11.5px] text-zinc-600">El acta se arma en <b>Gestionar documentos</b> (con los artículos y la guía ya cargados), se imprime y la firma el cliente. El escaneo firmado se sube abajo.</p>
              {actasGeneradas.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {actasGeneradas.map(a => (
                    <MiniaturaDoc key={a.id} src={`/api/compras/${negocioId}/documentos-generados?pdf=${a.id}`} titulo={a.plantillaNombre || a.titulo} detalle={a.createdAt.slice(0, 10)}
                      onAbrir={() => setVisor({ nombre: `acta-${a.id}.pdf`, url: `/api/compras/${negocioId}/documentos-generados?pdf=${a.id}`, titulo: a.plantillaNombre || a.titulo })} />
                  ))}
                </div>
              )}
              {puedeOperar && <button onClick={() => irAFase('gestion')} className="text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-2.5 py-1.5 rounded-lg">{actasGeneradas.length ? 'Ir a Gestionar documentos' : 'Generar el acta en Gestionar documentos'}</button>}
            </div>
          )}

          <CasillaEscaneo titulo="Acta de entrega firmada" tipo="acta" ayuda="Sube el acta con la firma y el timbre del cliente (PDF o foto). Al cargarla se da por hecha la tarea del acta."
            escaneos={escaneos} puedeOperar={puedeOperar} subiendo={subiendoTipo === 'acta'} onSubir={subirEscaneo} onQuitar={quitarEscaneo} onAbrir={setVisor} />
          <CasillaEscaneo titulo="Guía de despacho firmada" tipo="guia" ayuda="Sube la guía de despacho firmada por quien recibió. Al cargarla la entrega queda hecha."
            escaneos={escaneos} puedeOperar={puedeOperar} subiendo={subiendoTipo === 'guia'} onSubir={subirEscaneo} onQuitar={quitarEscaneo} onAbrir={setVisor} />
          <CasillaEscaneo titulo="Listado de asistentes a la capacitación" tipo="capacitacion" ayuda="Si hubo capacitación, sube el listado firmado por los asistentes."
            escaneos={escaneos} puedeOperar={puedeOperar} subiendo={subiendoTipo === 'capacitacion'} onSubir={subirEscaneo} onQuitar={quitarEscaneo} onAbrir={setVisor} />

          {(entrega.actaFirma || entrega.guiaFirma) && (
            <div className="text-[11.5px] text-zinc-600 space-y-0.5">
              {entrega.actaFirma && <p>Acta registrada a mano: <b>{entrega.actaFirma.nombre}</b> ({entrega.actaFirma.cargo}) — {entrega.actaConformidad === 'CONFORME' ? 'Conforme' : 'No conforme'}, {entrega.actaFirma.fecha}</p>}
              {entrega.guiaFirma && <p>Guía registrada a mano: <b>{entrega.guiaFirma.nombre}</b> ({entrega.guiaFirma.cargo}) — {entrega.guiaFirma.fecha}{entrega.guiaTimbre && ' · con timbre'}</p>}
            </div>
          )}

          {/* Forma anterior (acta interna + firma tecleada): queda para quien no tenga escaneo o no use plantillas. */}
          {puedeOperar && (!entrega.actaFirma || !entrega.guiaFirma) && (
            <details className="text-[11.5px]">
              <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 font-semibold">Registrar la firma a mano (sin escaneo)</summary>
              <div className="mt-2 space-y-3">
                {!entrega.actaFirma && (
                  <div className="space-y-2">
                    <p className="text-[10.5px] font-bold text-zinc-400 uppercase">Acta interna</p>
                    {!entrega.actaGeneradaAt ? (
                      <button onClick={() => accion({ accion: 'generar_acta' })} disabled={guardando} className="text-[11.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Generar acta</button>
                    ) : !entrega.actaAprobadaAt ? (
                      <>
                        <Banner variante="info">Acta generada {entrega.actaGeneradaAt}.</Banner>
                        <button onClick={() => accion({ accion: 'aprobar_acta' })} disabled={guardando} className="text-[11.5px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">Aprobar acta (encargado de compras)</button>
                      </>
                    ) : (
                      <>
                        <Banner variante="info">Acta aprobada por {entrega.actaAprobadaPorNombre} — lista para firmarse.</Banner>
                        <div className="space-y-1.5">
                          <Select value={conformidad} onChange={v => setConformidad(v as any)} minWidth={140}
                            options={[{ value: 'CONFORME', label: 'Conforme' }, { value: 'NO_CONFORME', label: 'No conforme' }]} />
                          <FormFirma guardando={guardando} inicial={entrega.guiaFirma} onGuardar={f => accion({ accion: 'firmar_acta', firma: f, conformidad })} />
                        </div>
                      </>
                    )}
                  </div>
                )}
                {!entrega.guiaFirma && (
                  <div className="space-y-2">
                    <p className="text-[10.5px] font-bold text-zinc-400 uppercase">Firma de la guía de despacho</p>
                    <FormFirma guardando={guardando} inicial={entrega.actaFirma} onGuardar={f => accion({ accion: 'firmar_guia', firma: f, timbre: false })} />
                  </div>
                )}
              </div>
            </details>
          )}
        </div>

        {entrega.cerradaAt && <Banner variante="success">Ciclo de entrega cerrado {entrega.cerradaAt}.</Banner>}
      </div>
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
