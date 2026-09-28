'use client';

// AUDITOR DE COMPRA — pestaña propia del negocio, debajo del Auditor Técnico (28-sep-2026), visible
// solo cuando el negocio ganó. Por cada producto del Costeo (ya cargado en negocio_costeo_editor,
// con su link y su precio web) se registra si de verdad se cotizó o no, y la cotización real que lo
// respalda: un documento que puede cubrir UNO o VARIOS productos a la vez (migration-130), cada uno
// con su propio precio cotizado — el precio "nuevo" que trae esa cotización, distinto del precio
// web de referencia. El documento puede ser uno YA subido en Documentos Propios (subcategoría
// "cotizaciones" — el usuario ya las sube ahí a mano) o uno nuevo: no hace falta subirlo dos veces.
//
// No es el "Auditor de Compras" del módulo Compras post-adjudicación (AuditorCosteoCard /
// AuditorComprasCard, en /compras/[negocioId]): ese verifica y audita con IA cada línea del costeo
// ya comprado; este es más simple — un registro manual de trazabilidad por producto, en la etapa
// comercial. Backend: app/api/negocios/[id]/comercial/auditor-compra/route.ts.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Switch } from '@/app/components/ui/Switch';
import { Modal } from '@/app/components/ui/Modal';
import {
  IconShoppingCart as ShoppingCart, IconLoader2 as Loader2, IconExternalLink as ExternalLink,
  IconFileText as FileText, IconUpload as Upload, IconCircleCheck as CheckCircle,
} from '@tabler/icons-react';

interface LineaAuditorCompra {
  filaId: string;
  hoja: string;
  item: number;
  detalle: string;
  unidad: string;
  cantidad: number | null;
  links: string[];
  precioWeb: number | null;
  cotizado: boolean;
  cotizacionId: number | null;
  precioCotizado: number | null;
  documentoUrl: string | null;
  documentoNombre: string | null;
}

interface CotizacionExistente { url: string; nombre: string }

const fmtCLP = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function AuditorCompraCard({
  negocioId, licitacionCodigo, cotizacionesExistentes = [],
}: {
  negocioId: number;
  licitacionCodigo: string;
  // Documentos ya subidos en "Documentos Propios" (subcategoría "cotizaciones") de esta
  // licitación — para reusarlos acá en vez de subirlos dos veces (pedido del usuario, 28-sep-2026).
  cotizacionesExistentes?: CotizacionExistente[];
}) {
  const toast = useToast();
  const [lineas, setLineas] = useState<LineaAuditorCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sinCosteo, setSinCosteo] = useState(false);
  const [guardando, setGuardando] = useState<Set<string>>(new Set());

  // Selección para adjuntar UNA cotización a varios productos a la vez.
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());

  // Modal "Adjuntar cotización": `modalFilas` = a qué producto(s) se les va a enganchar el
  // documento (uno solo desde el botón por fila, varios desde la barra de selección).
  const [modalFilas, setModalFilas] = useState<string[] | null>(null);
  const [docElegido, setDocElegido] = useState<string | null>(null); // url de una cotización existente
  const [archivoNuevo, setArchivoNuevo] = useState<File | null>(null);
  const [guardandoModal, setGuardandoModal] = useState(false);
  const inputArchivoRef = useRef<HTMLInputElement | null>(null);

  // Precio cotizado: edición inline por fila (texto libre mientras se escribe, se guarda al salir).
  const [preciosEdit, setPreciosEdit] = useState<Record<string, string>>({});

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/negocios/${negocioId}/comercial/auditor-compra`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar');
      setLineas(data.lineas || []);
      setSinCosteo(!!data.sinCosteo);
    } catch (e: any) {
      toast.error('No se pudo cargar el Auditor de Compra', e.message);
    } finally {
      setCargando(false);
    }
  }, [negocioId, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const marcarGuardando = (filaId: string, activo: boolean) =>
    setGuardando(prev => { const next = new Set(prev); if (activo) next.add(filaId); else next.delete(filaId); return next; });

  const guardarFila = async (filaId: string, patch: { cotizado?: boolean; precioCotizado?: number | null; documentoUrl?: string; documentoNombre?: string }) => {
    marcarGuardando(filaId, true);
    const actual = lineas.find(l => l.filaId === filaId);
    if (!actual) { marcarGuardando(filaId, false); return; }
    try {
      const res = await fetch(`/api/negocios/${negocioId}/comercial/auditor-compra`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filaId,
          cotizado: patch.cotizado ?? actual.cotizado,
          precioCotizado: patch.precioCotizado !== undefined ? patch.precioCotizado : undefined,
          documentoUrl: patch.documentoUrl ?? actual.documentoUrl,
          documentoNombre: patch.documentoNombre ?? actual.documentoNombre,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      setLineas(prev => prev.map(l => l.filaId === filaId ? { ...l, ...patch } : l));
    } catch (e: any) {
      toast.error('No se pudo guardar', e.message);
    } finally {
      marcarGuardando(filaId, false);
    }
  };

  // Precio cotizado: se guarda al salir del campo (blur) o con Enter, solo si cambió de verdad.
  const guardarPrecioCotizado = (l: LineaAuditorCompra) => {
    const texto = preciosEdit[l.filaId];
    if (texto === undefined) return;
    const limpio = texto.replace(/[^\d]/g, '');
    const nuevo = limpio ? parseInt(limpio, 10) : null;
    if (nuevo === l.precioCotizado) return;
    guardarFila(l.filaId, { precioCotizado: nuevo });
  };

  const toggleSeleccion = (filaId: string) =>
    setSeleccionadas(prev => { const next = new Set(prev); if (next.has(filaId)) next.delete(filaId); else next.add(filaId); return next; });

  const cerrarModal = () => {
    setModalFilas(null);
    setDocElegido(null);
    setArchivoNuevo(null);
  };

  // Confirma la cotización del modal (uno o varios productos): usa el documento existente elegido,
  // o sube el archivo nuevo si no se eligió ninguno — un solo camino para el botón por fila y la
  // barra de selección múltiple.
  const confirmarCotizacion = async () => {
    if (!modalFilas || (!docElegido && !archivoNuevo)) return;
    setGuardandoModal(true);
    try {
      let url: string; let nombre: string | null;
      if (archivoNuevo) {
        if (archivoNuevo.size > 20 * 1024 * 1024) throw new Error(`"${archivoNuevo.name}" supera los 20 MB.`);
        url = await subirArchivoCotizacion(archivoNuevo, licitacionCodigo);
        nombre = archivoNuevo.name;
      } else {
        const doc = cotizacionesExistentes.find(d => d.url === docElegido);
        if (!doc) throw new Error('No se encontró el documento elegido');
        url = doc.url; nombre = doc.nombre;
      }

      const filas = modalFilas.map(filaId => ({ filaId, precioCotizado: null }));
      const res = await fetch(`/api/negocios/${negocioId}/comercial/auditor-compra`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentoUrl: url, documentoNombre: nombre, filas }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar la cotización');
      toast.success(
        `Cotización adjuntada a ${filas.length} producto${filas.length > 1 ? 's' : ''}`,
        filas.length > 1 ? 'Ingresa el precio cotizado de cada uno abajo.' : undefined,
      );
      setSeleccionadas(new Set());
      cerrarModal();
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo adjuntar la cotización', e.message);
    } finally {
      setGuardandoModal(false);
    }
  };

  if (cargando) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 p-10 flex items-center justify-center gap-2 text-zinc-400">
        <Loader2 size={18} className="animate-spin" /> Cargando Auditor de Compra…
      </div>
    );
  }

  if (sinCosteo || lineas.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center">
        <ShoppingCart size={28} className="mx-auto text-zinc-300 mb-2" />
        <p className="text-[13px] text-zinc-500">
          {sinCosteo ? 'Este negocio todavía no tiene un Costeo guardado.' : 'El Costeo no tiene productos para auditar.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-100 flex items-center gap-2 flex-wrap">
        <ShoppingCart size={18} className="text-amber-600" />
        <h2 className="text-[15px] font-bold text-zinc-900">Auditor de Compra</h2>
        <span className="text-[11.5px] text-zinc-400">— link, precio web y cotización de cada producto</span>

        {seleccionadas.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] font-semibold text-amber-700">
              {seleccionadas.size} producto{seleccionadas.size > 1 ? 's' : ''} seleccionado{seleccionadas.size > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={() => setModalFilas([...seleccionadas])}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700"
            >
              <Upload size={13} /> Adjuntar una cotización a los seleccionados
            </button>
            <button type="button" onClick={() => setSeleccionadas(new Set())} className="text-[12px] text-zinc-400 hover:text-zinc-700">
              Cancelar
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
              <th className="px-4 py-2 font-bold w-8"></th>
              <th className="px-4 py-2 font-bold">Producto</th>
              <th className="px-4 py-2 font-bold">Link(s) web</th>
              <th className="px-4 py-2 font-bold text-right">Precio web</th>
              <th className="px-4 py-2 font-bold text-right">Precio cotizado</th>
              <th className="px-4 py-2 font-bold text-center">¿Cotizado?</th>
              <th className="px-4 py-2 font-bold">Documento de cotización</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map(l => {
              const tieneLink = l.links.length > 0;
              const precioEditado = preciosEdit[l.filaId] ?? (l.precioCotizado != null ? String(l.precioCotizado) : '');
              return (
                <tr key={l.filaId} className={`border-b border-zinc-50 align-top ${seleccionadas.has(l.filaId) ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={seleccionadas.has(l.filaId)}
                      onChange={() => toggleSeleccion(l.filaId)}
                      className="w-3.5 h-3.5 accent-amber-600 cursor-pointer"
                      title="Seleccionar para adjuntar una cotización junto con otros productos"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-zinc-800">{l.detalle}</p>
                    <p className="text-[11px] text-zinc-400">{l.hoja} · ítem {l.item}{l.unidad ? ` · ${l.unidad}` : ''}{l.cantidad != null ? ` · x${l.cantidad}` : ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    {tieneLink ? (
                      <div className="flex flex-col gap-0.5">
                        {l.links.map((link, i) => (
                          <a key={i} href={/^https?:\/\//i.test(link) ? link : `https://${link}`} target="_blank" rel="noopener noreferrer"
                             className="flex items-center gap-1 text-indigo-600 hover:underline truncate max-w-[220px]">
                            <ExternalLink size={11} className="flex-shrink-0" /> <span className="truncate">{link}</span>
                          </a>
                        ))}
                      </div>
                    ) : <span className="text-zinc-300">Sin link</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-700 whitespace-nowrap">{fmtCLP(l.precioWeb)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <input
                      value={precioEditado}
                      onChange={e => setPreciosEdit(prev => ({ ...prev, [l.filaId]: e.target.value }))}
                      onBlur={() => guardarPrecioCotizado(l)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      disabled={guardando.has(l.filaId)}
                      placeholder="—"
                      inputMode="numeric"
                      className="w-28 text-right font-semibold text-amber-700 bg-amber-50/60 border border-amber-200 rounded-lg px-2 py-1 outline-none focus:border-amber-400 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <Switch
                        checked={l.cotizado}
                        onChange={() => guardarFila(l.filaId, { cotizado: !l.cotizado })}
                        disabled={guardando.has(l.filaId)}
                        label="¿Se cotizó este producto?"
                      />
                      <span className={l.cotizado ? 'text-emerald-600 font-semibold' : 'text-zinc-400'}>{l.cotizado ? 'Sí' : 'No'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {l.documentoUrl ? (
                      <a href={l.documentoUrl} target="_blank" rel="noopener noreferrer"
                         className="flex items-center gap-1.5 text-indigo-600 hover:underline">
                        <FileText size={13} className="flex-shrink-0" /> <span className="truncate max-w-[180px]">{l.documentoNombre || 'Ver documento'}</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setModalFilas([l.filaId])}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 font-semibold hover:bg-amber-100"
                      >
                        <Upload size={13} /> Adjuntar cotización
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalFilas !== null}
        onClose={cerrarModal}
        title="Adjuntar cotización"
        subtitle={modalFilas && modalFilas.length > 1 ? `Un mismo documento para ${modalFilas.length} productos` : undefined}
        size="md"
        footer={
          <>
            <button onClick={cerrarModal} className="px-4 py-2 text-[13px] font-semibold text-zinc-600 hover:text-zinc-900">Cancelar</button>
            <button
              onClick={confirmarCotizacion}
              disabled={(!docElegido && !archivoNuevo) || guardandoModal}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700 disabled:opacity-40"
            >
              {guardandoModal && <Loader2 size={13} className="animate-spin" />} Adjuntar cotización
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {cotizacionesExistentes.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide mb-2">
                Cotizaciones ya subidas en Documentos
              </p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {cotizacionesExistentes.map(doc => (
                  <button
                    key={doc.url}
                    type="button"
                    onClick={() => { setDocElegido(doc.url === docElegido ? null : doc.url); setArchivoNuevo(null); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-[12.5px] transition-colors ${
                      docElegido === doc.url ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    {docElegido === doc.url ? <CheckCircle size={14} className="text-amber-600 flex-shrink-0" /> : <FileText size={14} className="text-zinc-400 flex-shrink-0" />}
                    <span className="truncate">{doc.nombre}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            {cotizacionesExistentes.length > 0 && (
              <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide mb-2">O sube un documento nuevo</p>
            )}
            <input
              ref={inputArchivoRef}
              type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { setArchivoNuevo(f); setDocElegido(null); } e.target.value = ''; }}
            />
            <button
              type="button"
              onClick={() => inputArchivoRef.current?.click()}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed text-left text-[12.5px] transition-colors ${
                archivoNuevo ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-zinc-300 hover:bg-zinc-50 text-zinc-500'
              }`}
            >
              {archivoNuevo ? <CheckCircle size={14} className="text-amber-600 flex-shrink-0" /> : <Upload size={14} className="flex-shrink-0" />}
              <span className="truncate">{archivoNuevo ? archivoNuevo.name : 'Elegir un archivo (PDF, imagen)…'}</span>
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Presign + PUT directo al bucket — mismo flujo que ya usaba la subida por fila.
async function subirArchivoCotizacion(file: File, licitacionCodigo: string): Promise<string> {
  const pres = await fetch('/api/documentos/presign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licitacionCodigo, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
  });
  const p = await pres.json();
  if (!pres.ok || !p.uploadUrl) throw new Error(p.error || 'No se pudo preparar la subida');
  const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!put.ok) throw new Error('Error subiendo el archivo');
  return p.publicUrl as string;
}
