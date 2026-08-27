'use client';

// MODAL DE COMPARACIÓN — AUDITOR TÉCNICO (bloque TECNICO, ítems tipo='linea_tecnica').
//
// Reemplaza el desplegable inline que tenía FilaLineaTecnica.tsx: acá se ve la comparación
// completa "exigido por las bases" vs "ofertado" en formato de tarjeta (no una línea de texto
// suelta), con el precio y el plazo de esa línea al lado, y el documento fuente. Se abre desde
// dos caminos:
//   1) FilaLineaTecnica.tsx — botón "Ver comparación" dentro de la pestaña Auditor Técnico.
//   2) DocumentosSection.tsx — "Enviar al Auditor" cuando el documento elegido corresponde a una
//      línea técnica: acá se le pasa `documentoInicial` y el modal valida + compara la ficha
//      automáticamente al abrir, para que el resultado se vea de inmediato en vez de un toast.
//
// Autosuficiente a propósito: hace su propio fetch de /comercial (lista completa) para resolver
// su encabezado (título/estado/línea) y el precio/plazo comercial ligado a esa línea — así sirve
// igual desde un lugar que ya tenía el item cargado (la pestaña) que desde uno que no (Documentos).
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Check, HelpCircle, Upload, RefreshCw, Undo2, FileText, Wrench, Trash2, Eye, Paperclip, Copy, Image as ImageIcon } from 'lucide-react';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';

type Veredicto = 'CUMPLE' | 'NO_CUMPLE' | 'CUMPLE_CON_COMPLEMENTO';
type EstadoItem = 'PENDIENTE' | 'CARGADO' | 'APROBADO' | 'OBSERVADO';

interface Caracteristica {
  id: number;
  descripcion: string;
  tipo: 'PISO' | 'TECHO' | 'EXACTO' | 'RANGO';
  valor_requerido_texto: string | null;
  valor_requerido_numero: number | null;
  valor_requerido_numero_max: number | null;
  unidad_requerida: string | null;
  valor_ofertado_texto: string | null;
  valor_ofertado_numero: number | null;
  unidad_ofertada_original: string | null;
  valor_convertido_numero: number | null;
  veredicto: Veredicto | null;
  pendiente_confirmacion_proveedor: boolean;
  fundamento_documento: string | null;
  fundamento_cita: string | null;
  confianza: number | null;
  origen: 'interrogatorio' | 'ficha' | 'manual';
  /** true = lo contestó/corrigió una persona. La IA ya no lo pisa al re-comparar (migration-72). */
  respuesta_manual?: boolean;
  /** Respaldo de ESTA casilla (certificado de capacitación, garantía), no de la línea completa. */
  adjunto_url?: string | null;
  adjunto_nombre?: string | null;
}

interface ItemHeader {
  id: number; titulo: string; estado: EstadoItem; linea_numero: number | null;
  aprobado_por_nombre: string | null; aprobado_at: string | null;
}

interface ProductoOfertado {
  marca: string | null; modelo: string | null; fabricante: string | null;
  paisFabricacion: string | null; anioFabricacion: string | null; garantiaMeses: number | null;
  imagenUrl: string | null;
  /** true = una persona confirmó que la foto corresponde al producto, o la subió ella misma.
   *  INDEPENDIENTE de confirmadoPor (marca/modelo) — ver migration-81. */
  imagenConfirmada: boolean;
  origen: 'ficha' | 'manual'; fuenteDocumento: string | null; confirmadoPor: number | null;
}

const fmtFecha = (s: string | null) => {
  if (!s) return '';
  try { return new Date(s.replace(' ', 'T')).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};
interface ComercialLigado {
  precio: { valorNumero: number | null; estado: EstadoItem } | null;
  plazo: { valorTexto: string | null; estado: EstadoItem } | null;
}

const VEREDICTO_STYLE: Record<Veredicto, { bg: string; text: string; label: string }> = {
  CUMPLE:                { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Cumple' },
  NO_CUMPLE:              { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'No cumple' },
  CUMPLE_CON_COMPLEMENTO: { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Con complemento' },
};

// El clasificador (IA) a veces guarda 0 en vez de dejar el campo numérico vacío para
// características que en realidad son texto ("Impresión digital en blanco y negro" quedaba con
// valor_requerido_numero=0). Por eso el texto SIEMPRE manda cuando existe — el número solo se
// usa si no hay texto Y el número no es 0 (0 sin texto no aporta nada, es "sin dato").
function requeridoDe(c: Caracteristica): string {
  if (c.valor_requerido_texto && c.valor_requerido_texto.trim()) return c.valor_requerido_texto;
  if (c.tipo === 'RANGO' && c.valor_requerido_numero)
    return `${c.valor_requerido_numero} a ${c.valor_requerido_numero_max ?? c.valor_requerido_numero}${c.unidad_requerida ? ` ${c.unidad_requerida}` : ''}`;
  if (c.valor_requerido_numero) return `${c.valor_requerido_numero}${c.unidad_requerida ? ` ${c.unidad_requerida}` : ''}`;
  return '—';
}

function ofertadoDe(c: Caracteristica): string {
  if (c.valor_ofertado_texto && c.valor_ofertado_texto.trim()) return c.valor_ofertado_texto;
  if (c.valor_ofertado_numero)
    return `${c.valor_convertido_numero ?? c.valor_ofertado_numero}${c.unidad_ofertada_original ? ` ${c.unidad_ofertada_original}` : ''}`;
  return '—';
}

const fmtCLP = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function ModalAuditorLineaTecnica({
  negocioId, itemId, licitacionCodigo, puedeAprobar, bloqueado, documentoInicial, onClose, onAccion, onCambio,
}: {
  negocioId: number;
  itemId: number;
  licitacionCodigo: string;
  puedeAprobar: boolean;
  bloqueado: boolean;
  documentoInicial?: { url: string; nombre: string } | null;
  onClose: () => void;
  onAccion?: (itemId: number, accion: string, extra?: Record<string, unknown>) => Promise<boolean>;
  onCambio?: () => void;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const base = `/api/negocios/${negocioId}/comercial/${itemId}/caracteristicas`;
  const [cargando, setCargando] = useState(true);
  const [item, setItem] = useState<ItemHeader | null>(null);
  const [comercial, setComercial] = useState<ComercialLigado>({ precio: null, plazo: null });
  const [caracteristicas, setCaracteristicas] = useState<Caracteristica[]>([]);
  const [documentos, setDocumentos] = useState<Array<{ id: number; url: string; nombre: string }>>([]);
  const [producto, setProducto] = useState<ProductoOfertado | null>(null);
  const [editandoProducto, setEditandoProducto] = useState(false);
  const [confirmandoProducto, setConfirmandoProducto] = useState(false);
  const [formProducto, setFormProducto] = useState({ marca: '', modelo: '', fabricante: '', paisFabricacion: '', anioFabricacion: '' });
  const [visorDoc, setVisorDoc] = useState<VisorDoc | null>(null);
  const [validando, setValidando] = useState(false);
  const [subiendoFicha, setSubiendoFicha] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [confirmandoImagen, setConfirmandoImagen] = useState(false);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [quitandoImagen, setQuitandoImagen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);
  const autoEjecutado = useRef(false);

  const cargarTodo = useCallback(async () => {
    const [rHeader, rCaract] = await Promise.all([
      fetch(`/api/negocios/${negocioId}/comercial`),
      fetch(base),
    ]);
    const dHeader = await rHeader.json().catch(() => ({}));
    const dCaract = await rCaract.json().catch(() => ({}));
    const items: any[] = dHeader.items || [];
    const propio = items.find((i: any) => i.id === itemId);
    if (propio) {
      setItem({
        id: propio.id, titulo: propio.titulo, estado: propio.estado, linea_numero: propio.linea_numero,
        aprobado_por_nombre: propio.aprobado_por_nombre ?? null, aprobado_at: propio.aprobado_at ?? null,
      });
      setDocumentos(Array.isArray(propio.documentos) ? propio.documentos : []);
      const precio = propio.linea_numero != null
        ? items.find((i: any) => i.bloque === 'COMERCIAL' && i.tipo === 'precio' && i.linea_numero === propio.linea_numero)
        : null;
      const plazo = items.find((i: any) => i.bloque === 'COMERCIAL' && i.tipo === 'dato' && /plazo/i.test(i.titulo || ''));
      setComercial({
        precio: precio ? { valorNumero: precio.valor_numero, estado: precio.estado } : null,
        plazo: plazo ? { valorTexto: plazo.valor_texto, estado: plazo.estado } : null,
      });
    }
    if (dCaract.success) {
      setCaracteristicas(dCaract.caracteristicas || []);
      setProducto(dCaract.productoOfertado ?? null);
    }
  }, [negocioId, itemId, base]);

  useEffect(() => {
    let activo = true;
    (async () => {
      setCargando(true);
      await cargarTodo();
      if (activo) setCargando(false);
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const validar = useCallback(async (avisar = true): Promise<boolean> => {
    setValidando(true);
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'validar' }) });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo validar la línea'); return false; }
      setCaracteristicas(d.caracteristicas || []);
      if (avisar) toast.success(d.nuevas ? `${d.nuevas} característica(s) clasificada(s)` : 'Ya estaba clasificada');
      onCambio?.();
      return true;
    } catch (e) {
      toast.error('Error de red', String(e));
      return false;
    } finally {
      setValidando(false);
    }
  }, [base, toast, onCambio]);

  const compararFicha = useCallback(async (documentoUrl: string, documentoNombre: string, avisar = true): Promise<boolean> => {
    const r = await fetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'comparar_ficha', documentoUrl, documentoNombre }),
    });
    const d = await r.json();
    if (!r.ok) { toast.error(d.error || 'No se pudo comparar la ficha'); return false; }
    setCaracteristicas(d.caracteristicas || []);
    // Las casillas contestadas a mano quedan fuera de la comparación (migration-72): se avisa
    // para que no parezca que la IA "no las miró" — es a propósito, y son intocables.
    if (avisar) toast.success('Ficha comparada', d.respetadas
      ? `${d.respetadas} respuesta(s) manual(es) quedaron intactas.` : undefined);
    onCambio?.();
    return true;
  }, [base, toast, onCambio]);

  // Camino "Enviar al Auditor" desde Documentos: llega con el archivo ya elegido — valida la
  // línea si hace falta y compara automáticamente, sin esperar un clic más del usuario.
  useEffect(() => {
    if (!documentoInicial || autoEjecutado.current || cargando) return;
    autoEjecutado.current = true;
    (async () => {
      if (caracteristicas.length === 0) {
        setProgreso('Clasificando las características de las bases…');
        const ok = await validar(false);
        if (!ok) { setProgreso(null); return; }
      }
      setProgreso('Comparando contra el documento…');
      await compararFicha(documentoInicial.url, documentoInicial.nombre, false);
      setProgreso(null);
    })();
  }, [cargando, documentoInicial, caracteristicas.length, validar, compararFicha]);

  const subirFicha = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendoFicha(true);
    try {
      const fd = new FormData();
      fd.append('licitacionCodigo', licitacionCodigo);
      fd.append('files', files[0]);
      const rSubida = await fetch('/api/documentos/subir', { method: 'POST', body: fd });
      const dSubida = await rSubida.json();
      if (!rSubida.ok || !dSubida.documentos?.length) { toast.error(dSubida.error || 'No se pudo subir la ficha'); return; }
      const doc = dSubida.documentos[0];
      if (caracteristicas.length === 0) await validar(false);
      await compararFicha(doc.url, doc.nombre);
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally {
      setSubiendoFicha(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Confirmar la foto que quedó de la extracción automática (o de una confirmación anterior).
  // Probado contra fichas reales: a veces la extracción trae la imagen equivocada, así que esto
  // es una decisión aparte de confirmar marca/modelo — ver migration-81.
  const confirmarImagen = async () => {
    setConfirmandoImagen(true);
    try {
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'confirmar_imagen_producto' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || 'No se pudo confirmar la foto'); return; }
      setProducto(d.productoOfertado ?? null);
      toast.success('Foto confirmada');
      onCambio?.();
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally { setConfirmandoImagen(false); }
  };

  // Quita la foto (la extracción trajo la equivocada y no hay con qué reemplazarla todavía).
  const quitarImagen = async () => {
    setQuitandoImagen(true);
    try {
      const r = await fetch(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'quitar_imagen_producto' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || 'No se pudo quitar la foto'); return; }
      setProducto(d.productoOfertado ?? null);
      toast.success('Foto quitada');
      onCambio?.();
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally { setQuitandoImagen(false); }
  };

  // Reemplaza por una foto subida a mano — queda CONFIRMADA de una: subirla ya es la revisión.
  const subirImagen = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendoImagen(true);
    try {
      const fd = new FormData();
      fd.append('file', files[0]);
      const r = await fetch(`/api/negocios/${negocioId}/comercial/${itemId}/producto-imagen`, { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(d.error || 'No se pudo subir la foto'); return; }
      setProducto(d.productoOfertado ?? null);
      toast.success('Foto reemplazada');
      onCambio?.();
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally {
      setSubiendoImagen(false);
      if (imgFileRef.current) imgFileRef.current.value = '';
    }
  };

  const reiniciar = async () => {
    const ok = await confirmar({
      titulo: '¿Borrar toda la comparación de esta línea?',
      mensaje: 'Se eliminan las características clasificadas y lo que se comparó hasta ahora. La línea vuelve a "sin validar", como si nunca se hubiera tocado.',
      confirmarLabel: 'Borrar y empezar de nuevo',
      peligro: true,
    });
    if (!ok) return;
    setReiniciando(true);
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'reiniciar' }) });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || 'No se pudo reiniciar la línea'); return; }
      setCaracteristicas([]);
      toast.success('Línea reiniciada', 'Ya puedes validar de nuevo o subir otra ficha.');
      onCambio?.();
      await cargarTodo();
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally {
      setReiniciando(false);
    }
  };

  const responder = async (caracteristicaId: number, extra: Record<string, unknown>) => {
    const r = await fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'responder', caracteristicaId, ...extra }) });
    const d = await r.json();
    if (!r.ok) { toast.error(d.error || 'No se pudo guardar la respuesta'); return; }
    setCaracteristicas(d.caracteristicas || []);
    onCambio?.();
  };

  // Respaldo de UNA casilla: el certificado de la capacitación, la carta de garantía. Sube al
  // mismo repositorio de documentos de la licitación que "Subir ficha" y queda colgado de esa
  // característica — distinto de los documentos de la línea completa, que prueban el conjunto.
  const adjuntarACaracteristica = async (caracteristicaId: number, file: File) => {
    const fd = new FormData();
    fd.append('licitacionCodigo', licitacionCodigo);
    fd.append('files', file);
    const rSubida = await fetch('/api/documentos/subir', { method: 'POST', body: fd });
    const dSubida = await rSubida.json();
    if (!rSubida.ok || !dSubida.documentos?.length) { toast.error(dSubida.error || 'No se pudo subir el respaldo'); return; }
    const doc = dSubida.documentos[0];
    await responder(caracteristicaId, { adjuntoUrl: doc.url, adjuntoNombre: doc.nombre });
    toast.success('Respaldo adjuntado', doc.nombre);
  };

  const quitarAdjunto = async (caracteristicaId: number) => {
    await responder(caracteristicaId, { quitarAdjunto: true });
  };

  const corregir = async (caracteristicaId: number, veredicto: string) => {
    const r = await fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'corregir', caracteristicaId, veredicto }) });
    const d = await r.json();
    if (!r.ok) { toast.error(d.error || 'No se pudo corregir'); return; }
    setCaracteristicas(d.caracteristicas || []);
    onCambio?.();
  };

  const documentoReferencia = caracteristicas.find(c => c.origen === 'ficha' && c.fundamento_documento)?.fundamento_documento
    || documentoInicial?.nombre || null;

  const resumen = {
    total: caracteristicas.length,
    cumplen: caracteristicas.filter(c => c.veredicto === 'CUMPLE').length,
    noCumplen: caracteristicas.filter(c => c.veredicto === 'NO_CUMPLE').length,
    complemento: caracteristicas.filter(c => c.veredicto === 'CUMPLE_CON_COMPLEMENTO').length,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3"
      role="dialog" aria-modal="true" aria-label="Comparación del Auditor Técnico"
    >
      {/* El clic en el fondo NO cierra: acá se sube ficha, se corrigen casillas y se aprueba una
          línea, así que un clic afuera por descuido perdía trabajo. Solo cierra la X o "Cerrar". */}
      <div className="w-full max-w-3xl max-h-[88vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-start gap-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0"><Wrench size={15} className="text-violet-600" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-bold text-zinc-900 leading-snug">{item?.titulo || 'Comparación técnica'}</p>
            <p className="text-[12px] text-zinc-400 mt-0.5">
              {resumen.total > 0 ? (
                <>
                  {resumen.cumplen} de {resumen.total} cumple
                  {resumen.noCumplen > 0 && <span className="text-rose-600 font-semibold"> · {resumen.noCumplen} no cumple</span>}
                  {resumen.complemento > 0 && <span className="text-amber-600 font-semibold"> · {resumen.complemento} con complemento</span>}
                </>
              ) : 'Sin características clasificadas todavía'}
            </p>
            {item?.estado === 'APROBADO' && item.aprobado_por_nombre && (
              <p className="text-[10.5px] text-emerald-600 font-medium mt-0.5 flex items-center gap-1">
                <Check size={11} /> {item.aprobado_por_nombre}{item.aprobado_at ? ` · ${fmtFecha(item.aprobado_at)}` : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors flex-shrink-0" aria-label="Cerrar"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-5">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 text-[12.5px] text-zinc-400 py-10"><Loader2 size={14} className="animate-spin" /> Cargando comparación…</div>
          ) : (
            <>
              {progreso && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-violet-50 border border-violet-100 rounded-lg text-[12.5px] text-violet-700">
                  <Loader2 size={13} className="animate-spin flex-shrink-0" /> {progreso}
                </div>
              )}

              {/* MARCA / MODELO / FABRICANTE del producto que ofertamos — lo pide la tabla
                  "Información de la oferta" de los formularios técnicos, y hasta ahora no existía
                  en ninguna parte del sistema (no es un dato de la empresa: es del producto).
                  Se intenta leer solo al subir una ficha (producto-ofertado.ts); acá se confirma o
                  se corrige a mano — lo que escribe una persona siempre manda sobre lo leído. */}
              <div className="mb-3 rounded-lg border border-zinc-100 bg-zinc-50/60 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">Producto que ofertamos</p>
                  {!editandoProducto && !bloqueado && (
                    <button
                      onClick={() => {
                        setFormProducto({
                          marca: producto?.marca || '', modelo: producto?.modelo || '',
                          fabricante: producto?.fabricante || '', paisFabricacion: producto?.paisFabricacion || '',
                          anioFabricacion: producto?.anioFabricacion || '',
                        });
                        setEditandoProducto(true);
                      }}
                      className="text-[11px] font-semibold text-violet-600 hover:text-violet-800"
                    >
                      {producto ? 'Corregir' : 'Completar'}
                    </button>
                  )}
                </div>

                {editandoProducto ? (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <input value={formProducto.marca} onChange={e => setFormProducto(f => ({ ...f, marca: e.target.value }))}
                        placeholder="Marca" className="px-2 py-1 text-[12px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
                      <input value={formProducto.modelo} onChange={e => setFormProducto(f => ({ ...f, modelo: e.target.value }))}
                        placeholder="Modelo" className="px-2 py-1 text-[12px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
                      <input value={formProducto.fabricante} onChange={e => setFormProducto(f => ({ ...f, fabricante: e.target.value }))}
                        placeholder="Fabricante" className="px-2 py-1 text-[12px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
                      <input value={formProducto.paisFabricacion} onChange={e => setFormProducto(f => ({ ...f, paisFabricacion: e.target.value }))}
                        placeholder="País de fabricación" className="px-2 py-1 text-[12px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
                      <input value={formProducto.anioFabricacion} onChange={e => setFormProducto(f => ({ ...f, anioFabricacion: e.target.value }))}
                        placeholder="Año de fabricación" className="px-2 py-1 text-[12px] border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200" />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          setConfirmandoProducto(true);
                          try {
                            const r = await fetch(base, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ accion: 'confirmar_producto', ...formProducto }),
                            });
                            const d = await r.json().catch(() => ({}));
                            if (!r.ok) { toast.error(d.error || 'No se pudo guardar'); return; }
                            setProducto(d.productoOfertado ?? null);
                            setEditandoProducto(false);
                            toast.success('Producto confirmado');
                            onCambio?.();
                          } catch (e) {
                            toast.error('Error de red', String(e));
                          } finally { setConfirmandoProducto(false); }
                        }}
                        disabled={confirmandoProducto}
                        className="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50"
                      >
                        {confirmandoProducto ? <Loader2 size={11} className="animate-spin inline" /> : 'Confirmar'}
                      </button>
                      <button onClick={() => setEditandoProducto(false)} className="text-[11.5px] text-zinc-400 hover:text-zinc-600 px-1">Cancelar</button>
                    </div>
                  </div>
                ) : producto && (producto.marca || producto.modelo || producto.fabricante) ? (
                  <div className="flex items-center gap-2 flex-wrap text-[12px]">
                    {producto.marca && <span><b>Marca:</b> {producto.marca}</span>}
                    {producto.modelo && <span><b>Modelo:</b> {producto.modelo}</span>}
                    {producto.fabricante && producto.fabricante !== producto.marca && <span><b>Fabricante:</b> {producto.fabricante}</span>}
                    {producto.paisFabricacion && <span><b>País:</b> {producto.paisFabricacion}</span>}
                    {producto.origen === 'ficha' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700" title={producto.fuenteDocumento || ''}>
                        leído de la ficha — sin confirmar
                      </span>
                    )}
                    {producto.origen === 'manual' && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">confirmado</span>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px] text-zinc-400">Sin datos todavía. Se completa solo al subir la ficha, o "Completar" a mano.</p>
                )}

                {/* FOTO DEL PRODUCTO — sacada automáticamente de la ficha del proveedor al comparar
                    (ver ficha-imagen-extraer.ts) o subida a mano. Confirmación APARTE de marca/
                    modelo (migration-81): probado contra fichas reales, la extracción automática a
                    veces trae la imagen equivocada (una foto decorativa, una franja de logos), así
                    que hasta que alguien la revise se avisa en vez de darla por buena. */}
                {producto?.imagenUrl && (
                  <div className="mt-2.5 pt-2.5 border-t border-zinc-200/70 flex items-start gap-2.5">
                    <img src={producto.imagenUrl} alt="Foto del producto" className="w-16 h-16 object-contain rounded-lg border border-zinc-200 bg-white flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      {producto.imagenConfirmada ? (
                        <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">foto confirmada</span>
                      ) : (
                        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          foto leída automáticamente — revisar antes de confirmar
                        </span>
                      )}
                      {!bloqueado && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {!producto.imagenConfirmada && (
                            <button onClick={confirmarImagen} disabled={confirmandoImagen}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 px-1.5 py-0.5 rounded-lg disabled:opacity-50">
                              {confirmandoImagen ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Es la foto correcta
                            </button>
                          )}
                          <button onClick={() => imgFileRef.current?.click()} disabled={subiendoImagen}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:bg-violet-50 px-1.5 py-0.5 rounded-lg disabled:opacity-50">
                            {subiendoImagen ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Reemplazar
                          </button>
                          <button onClick={quitarImagen} disabled={quitandoImagen}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-rose-600 hover:bg-rose-50 px-1.5 py-0.5 rounded-lg disabled:opacity-50">
                            {quitandoImagen ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Quitar
                          </button>
                          <input ref={imgFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                            onChange={e => subirImagen(e.target.files)} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {!producto?.imagenUrl && !bloqueado && (
                  <div className="mt-2.5 pt-2.5 border-t border-zinc-200/70">
                    <button onClick={() => imgFileRef.current?.click()} disabled={subiendoImagen}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:bg-violet-50 px-1.5 py-0.5 rounded-lg disabled:opacity-50">
                      {subiendoImagen ? <Loader2 size={11} className="animate-spin" /> : <ImageIcon size={11} />} Subir foto del producto
                    </button>
                    <input ref={imgFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={e => subirImagen(e.target.files)} />
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <p className="text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide">Comparación técnica</p>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => validar()} disabled={validando || bloqueado}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-50">
                      {validando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {resumen.total > 0 ? 'Re-validar' : 'Validar'}
                    </button>
                    <input ref={fileRef} type="file" className="hidden" onChange={e => subirFicha(e.target.files)} />
                    <button onClick={() => fileRef.current?.click()} disabled={subiendoFicha || bloqueado}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold text-zinc-500 hover:bg-zinc-50 rounded-lg border border-zinc-200 transition-colors disabled:opacity-50">
                      {subiendoFicha ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Subir ficha
                    </button>
                    {caracteristicas.length > 0 && !bloqueado && (
                      <button onClick={reiniciar} disabled={reiniciando} title="Borrar toda la comparación y volver a empezar"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold text-rose-500 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50">
                        {reiniciando ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Reiniciar
                      </button>
                    )}
                  </div>
                </div>

                {caracteristicas.length === 0 ? (
                  <p className="text-[12px] text-zinc-400 py-3">Sin características clasificadas todavía. Pulsa "Validar" o sube la ficha del producto.</p>
                ) : (
                  <div className="border border-zinc-100 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_auto] gap-x-3 px-3 py-2 bg-zinc-50 text-[10px] font-bold text-zinc-400 uppercase tracking-wide">
                      <span>Lo que pide el producto</span>
                      <span>Lo que subió el asistente</span>
                      <span>Resultado</span>
                    </div>
                    <div className="divide-y divide-zinc-100">
                      {caracteristicas.map(c => (
                        <FilaComparacion key={c.id} c={c} puedeAprobar={puedeAprobar} bloqueado={bloqueado}
                          onResponder={responder} onCorregir={corregir}
                          onAdjuntar={adjuntarACaracteristica} onQuitarAdjunto={quitarAdjunto}
                          onVerAdjunto={doc => setVisorDoc(doc)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <p className="text-[11.5px] font-bold text-zinc-500 uppercase tracking-wide mb-2">Comercial</p>
                <div className="space-y-2">
                  {comercial.precio && (
                    <div className="border border-zinc-100 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-zinc-800">Precio de esta línea</p>
                        <p className="text-[10.5px] text-zinc-400">Definido en el bloque Comercial</p>
                      </div>
                      <span className="text-[13px] font-bold text-emerald-700 flex-shrink-0">{fmtCLP(comercial.precio.valorNumero)}</span>
                    </div>
                  )}
                  {comercial.plazo && (
                    <div className="border border-zinc-100 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-zinc-800">Plazo de entrega</p>
                        <p className="text-[10.5px] text-zinc-400">General de toda la oferta, no exclusivo de esta línea</p>
                      </div>
                      <span className="text-[13px] font-semibold text-zinc-700 flex-shrink-0">{comercial.plazo.valorTexto || '—'}</span>
                    </div>
                  )}
                  {!comercial.precio && !comercial.plazo && (
                    <p className="text-[12px] text-zinc-400">Sin datos comerciales ligados a esta línea todavía.</p>
                  )}
                </div>
              </div>

              {documentos.length > 0 ? (
                <div className="space-y-1.5">
                  {documentos.map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 rounded-lg border border-zinc-100">
                      <FileText size={15} className="text-zinc-400 flex-shrink-0" />
                      <span className="text-[12.5px] text-zinc-600 truncate flex-1" title={doc.nombre}>{doc.nombre}</span>
                      <button onClick={() => setVisorDoc({ nombre: doc.nombre, url: doc.url })} title="Ver documento"
                        className="p-1 text-zinc-400 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors flex-shrink-0">
                        <Eye size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : documentoReferencia && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 rounded-lg border border-zinc-100">
                  <FileText size={15} className="text-zinc-400 flex-shrink-0" />
                  <span className="text-[12.5px] text-zinc-600 truncate flex-1" title={documentoReferencia}>{documentoReferencia}</span>
                </div>
              )}
            </>
          )}
        </div>

        {!cargando && (
          <div className="px-5 py-3.5 border-t border-zinc-100 flex items-center justify-end gap-2 flex-shrink-0">
            {puedeAprobar && item?.estado === 'CARGADO' && (
              <button onClick={async () => { if (await onAccion?.(itemId, 'APROBAR')) onClose(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold rounded-lg transition-colors">
                <Check size={13} /> Aprobar línea
              </button>
            )}
            {puedeAprobar && item?.estado === 'APROBADO' && (
              <button onClick={async () => { if (await onAccion?.(itemId, 'REABRIR')) onClose(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-zinc-500 hover:bg-zinc-50 border border-zinc-200 text-[12px] font-semibold rounded-lg transition-colors">
                <Undo2 size={13} /> Reabrir
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-[12px] font-semibold text-zinc-400 hover:text-zinc-600">Cerrar</button>
          </div>
        )}
        {/* Dentro de la tarjeta interna para que cerrar el visor de documento no cierre también
            este modal — los clics de un portal burbujean por el árbol de React, no por el DOM,
            así que la posición en el JSX importa. */}
        <DocumentViewerModal doc={visorDoc} onClose={() => setVisorDoc(null)} />
      </div>
    </div>,
    document.body,
  );
}

// Una fila = un ítem en las DOS listas a la vez ("lo que pide" / "lo que subió"), no una tarjeta
// con etiquetas sueltas — así se lee como una comparación real, no como un formulario.
//
// Al desplegarla se puede contestar la casilla A MANO. Eso importa en los requisitos que ninguna
// ficha técnica responde — una capacitación que se compromete a dictar, una garantía que se
// ofrece por escrito: se pega el texto (botón "Usar lo exigido" para no transcribirlo), se
// adjunta el respaldo de ESA casilla si lo hay, y el asesor puede fijar el veredicto de su puño
// y letra. Lo contestado así queda marcado como manual y la IA ya no lo pisa (migration-72).
function FilaComparacion({ c, puedeAprobar, bloqueado, onResponder, onCorregir, onAdjuntar, onQuitarAdjunto, onVerAdjunto }: {
  c: Caracteristica;
  puedeAprobar: boolean;
  bloqueado: boolean;
  onResponder: (id: number, extra: Record<string, unknown>) => Promise<void>;
  onCorregir: (id: number, veredicto: string) => Promise<void>;
  onAdjuntar: (id: number, file: File) => Promise<void>;
  onQuitarAdjunto: (id: number) => Promise<void>;
  onVerAdjunto: (doc: VisorDoc) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [respondiendo, setRespondiendo] = useState(false);
  const [valorNumero, setValorNumero] = useState('');
  const [unidad, setUnidad] = useState(c.unidad_requerida || '');
  const [valorTexto, setValorTexto] = useState('');
  const [veredictoManual, setVeredictoManual] = useState<'' | Veredicto>('');
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const est = c.veredicto ? VEREDICTO_STYLE[c.veredicto] : { bg: 'bg-zinc-100', text: 'text-zinc-400', label: 'Sin evaluar' };
  // Mismo criterio "texto manda" de requeridoDe(): el clasificador (IA) a veces guarda 0 en vez de
  // null para exigencias que en realidad son texto (una capacitación, una certificación). Sin este
  // chequeo, esas características mostraban el campo numérico + "Unidad" en vez del cuadro de
  // texto, "Usar lo exigido" copiaba "0", y lo que el usuario tipeaba ahí se perdía al guardar
  // (Number("texto libre") = NaN → se serializa como null).
  const esNumerica = !(c.valor_requerido_texto && c.valor_requerido_texto.trim()) && !!c.valor_requerido_numero;
  const exigido = requeridoDe(c);

  // El editor arranca con lo que YA está guardado, no en blanco: corregir una respuesta era
  // reescribirla entera, y en un texto largo (una capacitación) eso es rehacer el trabajo.
  const abrirEditor = () => {
    setValorNumero(c.valor_ofertado_numero != null ? String(c.valor_ofertado_numero) : '');
    setUnidad(c.unidad_ofertada_original || c.unidad_requerida || '');
    setValorTexto(c.valor_ofertado_texto || '');
    setVeredictoManual('');
    setRespondiendo(true);
  };

  // "Ofrezco exactamente lo que piden" es el caso más común en requisitos de servicio: en vez de
  // transcribir el párrafo de las bases, se copia de un clic. Después se puede editar.
  const usarLoExigido = () => {
    if (esNumerica) {
      setValorNumero(String(c.valor_requerido_numero ?? ''));
      setUnidad(c.unidad_requerida || '');
    } else {
      setValorTexto(c.valor_requerido_texto || exigido);
    }
  };

  const copiarExigido = async () => {
    try {
      await navigator.clipboard.writeText(exigido);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { /* sin portapapeles (http o permisos): "Usar lo exigido" sigue sirviendo */ }
  };

  const guardar = async () => {
    if (!valorNumero.trim() && !valorTexto.trim() && !veredictoManual) return;
    setGuardando(true);
    try {
      await onResponder(c.id, {
        valorOfertadoNumero: valorNumero.trim() ? Number(valorNumero) : null,
        unidadOfertadaOriginal: unidad.trim() || null,
        valorOfertadoTexto: valorTexto.trim() || null,
        // Solo el asesor puede fijarlo; el backend lo ignora para el resto (misma regla que
        // "corregir"), así que mandarlo de más nunca salta la doble firma del checklist.
        ...(veredictoManual ? { veredicto: veredictoManual } : {}),
      });
      setRespondiendo(false);
    } finally {
      setGuardando(false);
    }
  };

  const subirRespaldo = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSubiendo(true);
    try { await onAdjuntar(c.id, files[0]); }
    finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className={abierto ? 'bg-zinc-50/60' : ''}>
      <button
        type="button" onClick={() => setAbierto(v => !v)}
        className="w-full grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_auto] gap-x-3 items-start px-3 py-2.5 text-left hover:bg-zinc-50 transition-colors"
      >
        <div className="min-w-0">
          <p className="text-[10px] text-zinc-400 leading-snug">{c.descripcion}</p>
          <p className="text-[12.5px] font-medium text-zinc-800 leading-snug mt-0.5 break-words">{exigido}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] text-zinc-700 leading-snug break-words whitespace-pre-wrap">{ofertadoDe(c)}</p>
          {c.pendiente_confirmacion_proveedor && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-0.5"><HelpCircle size={10} /> Por confirmar</p>
          )}
          {c.adjunto_url && (
            <p className="text-[10px] text-violet-600 flex items-center gap-1 mt-0.5 truncate">
              <Paperclip size={10} className="flex-shrink-0" /> {c.adjunto_nombre || 'Respaldo adjunto'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {c.respuesta_manual && (
            <span title="Contestada a mano — la IA ya no la modifica"
              className="text-[10px] font-semibold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded whitespace-nowrap">a mano</span>
          )}
          <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${est.bg} ${est.text}`}>{est.label}</span>
        </div>
      </button>

      {abierto && (
        <div className="px-3 pb-3 -mt-1">
          {c.fundamento_cita && <p className="text-[10.5px] text-zinc-400 mb-2">Fuente: {c.fundamento_cita}</p>}

          {respondiendo ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {esNumerica ? (
                  <>
                    <input type="text" inputMode="decimal" autoFocus value={valorNumero} onChange={e => setValorNumero(e.target.value)}
                      placeholder="Valor ofertado" className="w-28 px-2 py-1 text-[12px] border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300" />
                    <input type="text" value={unidad} onChange={e => setUnidad(e.target.value)}
                      placeholder="Unidad" className="w-20 px-2 py-1 text-[12px] border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-300" />
                  </>
                ) : (
                  <textarea autoFocus rows={3} value={valorTexto} onChange={e => setValorTexto(e.target.value)}
                    placeholder="Escribe o pega lo que se ofrece (por ejemplo: la capacitación que se dictará, dónde y a cuántas personas)"
                    className="w-full px-2 py-1.5 text-[12px] leading-snug border border-zinc-200 rounded resize-y focus:outline-none focus:ring-1 focus:ring-violet-300" />
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={usarLoExigido} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">
                  Usar lo exigido
                </button>
                <button type="button" onClick={copiarExigido} className="text-[11px] text-zinc-400 hover:text-zinc-600 inline-flex items-center gap-1">
                  <Copy size={11} /> {copiado ? 'Copiado' : 'Copiar lo exigido'}
                </button>
              </div>

              {/* El veredicto a mano es del asesor: hay requisitos que ninguna IA puede resolver
                  leyendo un texto ("la capacitación se dictará en dependencias municipales"). Si
                  se deja en "que lo evalúe el sistema", sigue el camino de siempre. */}
              {puedeAprobar && (
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="text-zinc-400">Resultado:</span>
                  {([['', 'Que lo evalúe el sistema'], ['CUMPLE', 'Cumple'], ['NO_CUMPLE', 'No cumple'], ['CUMPLE_CON_COMPLEMENTO', 'Con complemento']] as const).map(([v, label]) => (
                    <button key={v || 'auto'} type="button" onClick={() => setVeredictoManual(v as '' | Veredicto)}
                      className={`px-1.5 py-0.5 rounded font-semibold ${veredictoManual === v ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <button onClick={guardar} disabled={guardando} className="px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold rounded disabled:opacity-50">
                  {guardando ? <Loader2 size={11} className="animate-spin" /> : 'Guardar'}
                </button>
                <button onClick={() => setRespondiendo(false)} className="text-[11px] text-zinc-400 hover:text-zinc-600">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {!bloqueado && (
                <button onClick={abrirEditor} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">
                  {c.veredicto ? 'Corregir respuesta' : 'Responder'}
                </button>
              )}

              {/* Respaldo de ESTA casilla (certificado, carta de garantía), no de la línea entera:
                  el archivo prueba este requisito puntual y viaja con él. */}
              {!bloqueado && (
                <>
                  <input ref={fileRef} type="file" className="hidden" onChange={e => subirRespaldo(e.target.files)} />
                  <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                    className="text-[11px] text-zinc-400 hover:text-zinc-700 inline-flex items-center gap-1 disabled:opacity-50">
                    {subiendo ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />}
                    {c.adjunto_url ? 'Cambiar respaldo' : 'Adjuntar respaldo'}
                  </button>
                </>
              )}
              {c.adjunto_url && (
                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5 max-w-[16rem]">
                  <span className="truncate">{c.adjunto_nombre || 'Respaldo'}</span>
                  <button onClick={() => onVerAdjunto({ nombre: c.adjunto_nombre || 'Respaldo', url: c.adjunto_url! })}
                    title="Ver respaldo" className="text-zinc-400 hover:text-zinc-700"><Eye size={11} /></button>
                  {!bloqueado && (
                    <button onClick={() => onQuitarAdjunto(c.id)} title="Quitar respaldo" className="text-zinc-400 hover:text-rose-600"><X size={11} /></button>
                  )}
                </span>
              )}

              {puedeAprobar && (
                <div className="flex items-center gap-1">
                  {(['CUMPLE', 'NO_CUMPLE', 'CUMPLE_CON_COMPLEMENTO'] as const).filter(v => v !== c.veredicto).map(v => (
                    <button key={v} onClick={() => onCorregir(c.id, v)}
                      className="text-[10.5px] font-semibold text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 px-1.5 py-0.5 rounded">
                      → {VEREDICTO_STYLE[v].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
