'use client';

import { useState, useRef, useEffect } from 'react';
import {
  FileText, Sparkles, RefreshCw, Loader2, Bot,
  CheckCircle, Eye, Download, FolderOpen, AlertTriangle, GripVertical, TableProperties,
  Upload, Trash2,
} from 'lucide-react';
import { DocumentoAdjunto } from '@/app/types/search.types';
import { getFileIcon, formatFileSize, esUrlAnalizable, SectionHeader } from '../utils';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { DocumentoIAModal } from '@/app/components/DocumentoIAModal';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';

// Categoría de documentos SUBIDOS por el equipo (los únicos que se pueden eliminar;
// los oficiales descargados de Mercado Público quedan protegidos).
const CAT_PROPIOS = 'DOCUMENTOS_PROPIOS';

// ─── Configuración de cajas (v2.0) ────────────────────────────────────────────
// Estilo común a todas las cajas (neutro). El color real lo da el contenido.
const ESTILO_CAJA = {
  colorBg: 'bg-white',
  colorBorder: 'border-slate-200',
  colorHeader: 'bg-slate-50',
  colorIcon: 'text-slate-500',
  colorCount: 'bg-slate-100 text-slate-600',
  colorDrop: 'ring-2 ring-indigo-300 bg-indigo-50/40',
} as const;

// Etiqueta legible por categoría conocida. El ORDEN aquí define el orden de render.
// Las cajas se muestran de forma DINÁMICA: solo aparece la que tiene documentos
// (más una caja "Sin clasificar" para los que no tienen categoría).
const CAJA_LABELS: Record<string, string> = {
  BASES_ADMINISTRATIVAS: 'Bases Administrativas',
  BASES_TECNICAS: 'Bases Técnicas',
  ANEXOS_OFERENTE: 'Anexos Oferente',
  DOCUMENTOS_PROCESO: 'Documentos Proceso',
  DOCUMENTOS_PROPIOS: 'Documentos Propios',
  OTROS: 'Otros',
};

// Orden preferente de las cajas. Categorías desconocidas van al final.
const ORDEN_CAJAS = [
  'BASES_ADMINISTRATIVAS',
  'BASES_TECNICAS',
  'ANEXOS_OFERENTE',
  'DOCUMENTOS_PROCESO',
  'DOCUMENTOS_PROPIOS',
  'OTROS',
];

// Convierte una clave de categoría en etiqueta legible (incluye categorías nuevas
// que aún no estén en CAJA_LABELS).
function labelDeCaja(key: string): string {
  return CAJA_LABELS[key] ?? key.replace(/_/g, ' ').toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

interface CajaConfig {
  key: string;
  label: string;
  colorBg: string;
  colorBorder: string;
  colorHeader: string;
  colorIcon: string;
  colorCount: string;
  colorDrop: string;
}

// ─── Item draggable ───────────────────────────────────────────────────────────
function DocItem({
  doc,
  onDragStart,
  isDragging,
  onView,
  onOpenIA,
  onDelete,
}: {
  doc: DocumentoAdjunto & { categoria?: string };
  onDragStart: (e: React.DragEvent, doc: DocumentoAdjunto) => void;
  isDragging: boolean;
  onView: (doc: VisorDoc) => void;
  onOpenIA: (doc: { nombre: string; url: string }) => void;
  onDelete?: (doc: DocumentoAdjunto & { categoria?: string }) => void;
}) {
  const analizable = esUrlAnalizable(doc.url_local || doc.url);
  const esPropio = (doc.categoria || '').toUpperCase() === CAT_PROPIOS;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, doc)}
      className={`
        group flex items-center gap-2 px-2.5 py-2 rounded-lg border
        cursor-grab active:cursor-grabbing select-none transition-all
        ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'}
        bg-white border-slate-100 hover:bg-slate-50
      `}
    >
      <GripVertical size={12} className="text-slate-300 flex-shrink-0" />
      <span className="text-base flex-shrink-0">{getFileIcon(doc.nombre)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold text-slate-700 truncate leading-tight" title={doc.nombre}>
          {doc.nombre}
        </p>
        {doc.size && (
          <p className="text-[10px] text-slate-400 leading-tight">{formatFileSize(doc.size)}</p>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenIA({ nombre: doc.nombre, url: doc.url_local || doc.url }); }}
          className="p-1 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
          title="Preguntar sobre este documento"
          draggable={false}
        >
          <Sparkles size={11} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onView({ nombre: doc.nombre, url: doc.url_local || doc.url }); }}
          className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          title="Ver en el visor"
          draggable={false}
        >
          <Eye size={11} />
        </button>
        <a
          href={doc.url_local || doc.url} download={doc.nombre}
          onClick={(e) => e.stopPropagation()}
          className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
          title="Descargar"
          draggable={false}
        >
          <Download size={11} />
        </a>
        {esPropio && onDelete && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(doc); }}
            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="Eliminar documento propio"
            draggable={false}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Caja droppable ───────────────────────────────────────────────────────────
function CajaDroppable({
  caja,
  docs,
  isDragOver,
  isDraggingActive,
  draggingDoc,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onView,
  onOpenIA,
  onUpload,
  onDelete,
  subiendo,
}: {
  caja: CajaConfig;
  docs: (DocumentoAdjunto & { categoria?: string })[];
  isDragOver: boolean;
  isDraggingActive: boolean;
  draggingDoc: DocumentoAdjunto | null;
  onDragStart: (e: React.DragEvent, doc: DocumentoAdjunto) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDragEnter: (e: React.DragEvent, key: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, key: string) => void;
  onView: (doc: VisorDoc) => void;
  onOpenIA: (doc: { nombre: string; url: string }) => void;
  onUpload: (file: File, categoria: string) => void;
  onDelete: (doc: DocumentoAdjunto & { categoria?: string }) => void;
  subiendo: string | null; // key de la caja que está subiendo un archivo
}) {
  const isDraggingHere = draggingDoc && docs.some(d => d.nombre === draggingDoc.nombre);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const estaSubiendo = subiendo === caja.key;

  return (
    <div
      className={`
        flex flex-col rounded-xl border transition-all duration-150
        ${isDragOver ? caja.colorDrop : `${caja.colorBorder} ${caja.colorBg}`}
        ${isDraggingActive && !isDraggingHere ? 'border-dashed' : ''}
      `}
      onDragOver={(e) => onDragOver(e, caja.key)}
      onDragEnter={(e) => onDragEnter(e, caja.key)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, caja.key)}
    >
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-xl ${caja.colorHeader}`}>
        <FolderOpen size={13} className={caja.colorIcon} />
        <span className="flex-1 text-[11.5px] font-bold text-slate-700 truncate">
          {caja.label}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f, caja.key);
            e.target.value = ''; // permite volver a subir el mismo archivo
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={estaSubiendo}
          title={`Subir documento propio a "${caja.label}"`}
          className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50"
        >
          {estaSubiendo ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
        </button>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${caja.colorCount}`}>
          {docs.length}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 p-1.5 space-y-1 min-h-[72px]">
        {docs.map((doc) => (
          <DocItem
            key={doc.nombre}
            doc={doc}
            onDragStart={onDragStart}
            isDragging={draggingDoc?.nombre === doc.nombre}
            onView={onView}
            onOpenIA={onOpenIA}
            onDelete={onDelete}
          />
        ))}

        {/* Zona de drop vacía */}
        {isDragOver && (
          <div className="flex items-center justify-center h-10 border-2 border-dashed border-current/30 rounded-lg opacity-60">
            <span className={`text-[10px] font-semibold ${caja.colorIcon}`}>Soltar aquí</span>
          </div>
        )}
        {docs.length === 0 && !isDragOver && (
          <div className="flex items-center justify-center h-10">
            <span className="text-[10px] text-slate-300 font-medium">Sin documentos</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Grid de cajas con DnD ────────────────────────────────────────────────────
function DocumentosGrid({
  documentos,
  codigoDecoded,
  onView,
  onOpenIA,
  onRefrescar,
}: {
  documentos: (DocumentoAdjunto & { categoria?: string })[];
  codigoDecoded: string;
  onView: (doc: VisorDoc) => void;
  onOpenIA: (doc: { nombre: string; url: string }) => void;
  onRefrescar: () => void;
}) {
  // Agrupa los documentos por su categoría real (sin pre-crear cajas vacías).
  const buildGrupos = (docs: (DocumentoAdjunto & { categoria?: string })[]) => {
    const g: Record<string, (DocumentoAdjunto & { categoria?: string })[]> = { SIN_CATEGORIA: [] };
    for (const doc of docs) {
      const cat = doc.categoria || 'SIN_CATEGORIA';
      if (!g[cat]) g[cat] = [];
      g[cat].push(doc);
    }
    return g;
  };

  const [grupos, setGrupos] = useState(() => buildGrupos(documentos));
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [draggingDoc, setDraggingDoc] = useState<DocumentoAdjunto | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const dragEnterCount = useRef<Record<string, number>>({});
  const confirmar = useConfirm();
  const toast = useToast();

  // Elimina un documento PROPIO (solo esa categoría). Confirma, llama al DELETE del
  // backend (borra de R2 + caché) y actualiza el estado local de forma optimista.
  const handleDelete = async (doc: DocumentoAdjunto & { categoria?: string }) => {
    const ok = await confirmar({
      titulo: '¿Eliminar documento?',
      mensaje: `"${doc.nombre}" se eliminará de forma permanente. Esta acción no se puede deshacer.`,
      confirmarLabel: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;

    const cat = (doc.categoria || 'SIN_CATEGORIA');
    // Optimista: sacarlo de su caja.
    setGrupos(prev => {
      const next: typeof prev = {};
      for (const k in prev) next[k] = prev[k].filter(d => d.nombre !== doc.nombre);
      return next;
    });
    try {
      const res = await fetch(`/api/documentos/${encodeURIComponent(codigoDecoded)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: doc.url_local || doc.url, nombre: doc.nombre }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      toast.success('Documento eliminado');
      onRefrescar();
    } catch (e: any) {
      // Revertir si falló.
      setGrupos(prev => {
        const next: typeof prev = {};
        for (const k in prev) next[k] = [...prev[k]];
        next[cat] = [...(next[cat] || []), doc];
        return next;
      });
      toast.error('No se pudo eliminar', e?.message);
    }
  };

  // Sube un documento propio a la caja indicada: presign → PUT directo a R2 → guardar
  // en documentos_cache con su categoría (así la IA lo incluye en análisis posteriores).
  const handleUpload = async (file: File, categoria: string) => {
    setSubiendo(categoria);
    setErrorSubida(null);
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('El archivo supera los 100 MB.');
      const pres = await fetch('/api/documentos/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacionCodigo: codigoDecoded,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });
      const presData = await pres.json();
      if (!pres.ok || !presData.uploadUrl) throw new Error(presData.error || 'No se pudo preparar la subida');

      const put = await fetch(presData.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) throw new Error(`Error subiendo a R2 (HTTP ${put.status})`);

      const save = await fetch('/api/documentos/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licitacionCodigo: codigoDecoded,
          documentoNombre: file.name,
          url: presData.publicUrl,
          size: file.size,
          categoria,
        }),
      });
      const saveData = await save.json();
      if (!save.ok || !saveData.success) throw new Error(saveData.error || 'No se pudo registrar el documento');

      onRefrescar();
    } catch (e: any) {
      setErrorSubida(e.message || 'Error al subir el documento');
    } finally {
      setSubiendo(null);
    }
  };

  // Re-sincronizar cuando cambian los docs desde el padre
  useEffect(() => {
    setGrupos(buildGrupos(documentos));
  }, [documentos]);

  const handleDragStart = (e: React.DragEvent, doc: DocumentoAdjunto) => {
    setDraggingDoc(doc);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', doc.nombre);
  };

  const handleDragEnd = () => {
    setDraggingDoc(null);
    setDragOver(null);
    dragEnterCount.current = {};
  };

  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    dragEnterCount.current[key] = (dragEnterCount.current[key] || 0) + 1;
    setDragOver(key);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    const key = dragOver;
    if (!key) return;
    dragEnterCount.current[key] = (dragEnterCount.current[key] || 1) - 1;
    if (dragEnterCount.current[key] <= 0) {
      dragEnterCount.current[key] = 0;
      setDragOver(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    setDragOver(null);
    dragEnterCount.current = {};
    if (!draggingDoc) return;

    const sourceKey = (draggingDoc as any).categoria || 'SIN_CATEGORIA';
    if (sourceKey === targetKey) { setDraggingDoc(null); return; }

    const docConCategoria = { ...draggingDoc, categoria: targetKey };

    // Actualización optimista
    setGrupos(prev => {
      const next: typeof prev = {};
      for (const k in prev) next[k] = [...prev[k]];
      next[sourceKey] = next[sourceKey].filter(d => d.nombre !== draggingDoc.nombre);
      next[targetKey] = [...(next[targetKey] || []), docConCategoria];
      return next;
    });
    setDraggingDoc(null);

    // Persistir en DB
    try {
      await fetch('/api/documentos/clasificar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: codigoDecoded,
          documento_nombre: draggingDoc.nombre,
          nueva_categoria: targetKey,
        }),
      });
    } catch {
      // Si falla, revertir
      setGrupos(prev => {
        const next: typeof prev = {};
        for (const k in prev) next[k] = [...prev[k]];
        next[targetKey] = next[targetKey].filter(d => d.nombre !== draggingDoc.nombre);
        next[sourceKey] = [...(next[sourceKey] || []), draggingDoc];
        return next;
      });
    }
  };

  const isDraggingActive = draggingDoc !== null;

  // Cajas FIJAS: las 6 de la taxonomía v2.0, siempre visibles (aunque estén vacías).
  // DOCUMENTOS_PROPIOS debe existir SIEMPRE como destino para los documentos que las
  // Fases 3/4 generarán a futuro (fichas, cotización, tabla de costeo). Además, las
  // cajas vacías sirven de destino para reclasificar arrastrando. Si aparece una
  // categoría desconocida (datos viejos), también se muestra al final.
  const clavesExtra = Object.keys(grupos).filter(
    k => k !== 'SIN_CATEGORIA' && !ORDEN_CAJAS.includes(k) && (grupos[k]?.length || 0) > 0,
  ).sort();

  const cajasVisibles: CajaConfig[] = [...ORDEN_CAJAS, ...clavesExtra]
    .map(key => ({ key, label: labelDeCaja(key), ...ESTILO_CAJA }));

  return (
    <div
      onDragEnd={handleDragEnd}
      className="space-y-3"
    >
      {/* Grid de 3 columnas — 6 cajas fijas (taxonomía v2.0) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cajasVisibles.map((caja) => (
          <CajaDroppable
            key={caja.key}
            caja={caja}
            docs={grupos[caja.key] || []}
            isDragOver={dragOver === caja.key}
            isDraggingActive={isDraggingActive}
            draggingDoc={draggingDoc}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onView={onView}
            onOpenIA={onOpenIA}
            onUpload={handleUpload}
            onDelete={handleDelete}
            subiendo={subiendo}
          />
        ))}
      </div>

      {errorSubida && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[11.5px] text-red-700">
          <AlertTriangle size={12} className="flex-shrink-0" /> {errorSubida}
          <button onClick={() => setErrorSubida(null)} className="ml-auto font-semibold hover:underline">Cerrar</button>
        </div>
      )}

      {/* Sin categoría — debajo del grid */}
      {(grupos['SIN_CATEGORIA']?.length || 0) > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
            Sin clasificar
          </p>
          <div className="space-y-1">
            {grupos['SIN_CATEGORIA'].map((doc) => (
              <DocItem
                key={doc.nombre}
                doc={doc}
                onDragStart={handleDragStart}
                isDragging={draggingDoc?.nombre === doc.nombre}
                onView={onView}
                onOpenIA={onOpenIA}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sección principal ────────────────────────────────────────────────────────
// ─── Banner de progreso (descarga / clasificación) ────────────────────────────
// La clasificación se resuelve en una sola llamada al servidor (no doc-por-doc),
// por eso la barra es indeterminada (animada) y no un porcentaje exacto. Muestra
// la fase actual y el conteo de documentos cuando se conoce.
function ProgresoBanner({ fase, totalDocs }: { fase: 'descargando' | 'clasificando'; totalDocs: number }) {
  const esDescarga = fase === 'descargando';
  const titulo = esDescarga
    ? 'Descargando documentos desde Mercado Público…'
    : `Clasificando ${totalDocs > 0 ? `${totalDocs} documento${totalDocs !== 1 ? 's' : ''}` : 'documentos'}…`;
  const colorTexto = esDescarga ? 'text-indigo-700' : 'text-violet-700';
  const colorBg = esDescarga ? 'bg-indigo-50 border-indigo-200' : 'bg-violet-50 border-violet-200';
  const colorBar = esDescarga ? 'bg-indigo-500' : 'bg-violet-500';
  const colorTrack = esDescarga ? 'bg-indigo-100' : 'bg-violet-100';

  return (
    <div className={`px-4 py-3 rounded-xl border ${colorBg} space-y-2`}>
      <div className={`flex items-center gap-2.5 text-sm font-medium ${colorTexto}`}>
        <Loader2 size={15} className="animate-spin flex-shrink-0" />
        {titulo}
      </div>
      {/* Barra indeterminada animada */}
      <div className={`h-1.5 w-full rounded-full overflow-hidden ${colorTrack}`}>
        <div className={`h-full w-1/3 rounded-full ${colorBar} progreso-indeterminado`} />
      </div>
      <style jsx>{`
        @keyframes progreso-slide {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(420%); }
        }
        .progreso-indeterminado {
          animation: progreso-slide 1.1s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export function DocumentosSection({
  codigoDecoded, mpUrl, documentosCache, cargandoDocs,
  descargandoAuto, handleAutoDescargar, fetchDocumentos,
  clasificando, onReClasificar, resumenClasificacion,
}: {
  codigoDecoded: string;
  mpUrl: string;
  documentosCache: DocumentoAdjunto[];
  cargandoDocs: boolean;
  descargandoAuto: boolean;
  handleAutoDescargar: () => void;
  fetchDocumentos: () => void;
  clasificando?: boolean;
  onReClasificar?: () => void;
  resumenClasificacion?: { estado: 'completo' | 'incompleto'; falta: string[] } | null;
}) {
  const yaClasificados = documentosCache.some(d => (d as any).categoria);
  // Documento abierto en el visor inline (modal). null = cerrado.
  const [visorDoc, setVisorDoc] = useState<VisorDoc | null>(null);
  // Documento abierto en el chat rápido de IA (modal). null = cerrado.
  const [iaDoc, setIaDoc] = useState<{ nombre: string; url: string } | null>(null);

  // Regeneración del Excel de costeo desde el informe IA ya guardado (sin re-analizar:
  // reusa el manifiesto y solo vuelve a armar el Excel con la plantilla actual).
  const [regenerandoCosteo, setRegenerandoCosteo] = useState(false);
  const [costeoError, setCosteoError] = useState<string | null>(null);

  const handleRegenerarCosteo = async () => {
    setRegenerandoCosteo(true);
    setCosteoError(null);
    try {
      const r = await fetch(`/api/documentos/generar-costeo/${encodeURIComponent(codigoDecoded)}`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setCosteoError(j.error || 'No se pudo regenerar el costeo.'); return; }
      fetchDocumentos(); // refresca la lista para que aparezca el archivo nuevo
    } catch {
      setCosteoError('Error de red al regenerar el costeo.');
    } finally {
      setRegenerandoCosteo(false);
    }
  };

  // Generación/regeneración del PDF del informe de viabilidad desde el informe guardado
  // (sin re-analizar). Sirve tanto para crearlo la primera vez como para actualizarlo.
  const [generandoInforme, setGenerandoInforme] = useState(false);
  const [informeError, setInformeError] = useState<string | null>(null);

  const handleGenerarInforme = async () => {
    setGenerandoInforme(true);
    setInformeError(null);
    try {
      const r = await fetch(`/api/documentos/generar-informe/${encodeURIComponent(codigoDecoded)}`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setInformeError(j.error || 'No se pudo generar el informe.'); return; }
      fetchDocumentos();
    } catch {
      setInformeError('Error de red al generar el informe.');
    } finally {
      setGenerandoInforme(false);
    }
  };

  return (
    <div className="space-y-4 fade-in">
      <SectionHeader
        icon={<FolderOpen size={18} />}
        title="Documentos y Bases"
        subtitle="Arrastra los documentos entre cajas para reclasificarlos"
        badge={(
          <>
            {!cargandoDocs && documentosCache.length > 0 && (
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-semibold">
                {documentosCache.length} docs
              </span>
            )}
            {yaClasificados && (
              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-semibold flex items-center gap-0.5">
                <Sparkles size={9} /> Clasificados
              </span>
            )}
          </>
        )}
        action={(
          <button onClick={fetchDocumentos} title="Recargar documentos"
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <RefreshCw size={14} />
          </button>
        )}
      />

      <div className="card p-5 space-y-4">

        {/* Botón descarga automática */}
        <button
          onClick={handleAutoDescargar}
          disabled={descargandoAuto}
          className="
            w-full flex items-center justify-center gap-2.5
            bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400
            text-white text-sm font-bold py-3.5 px-4 rounded-xl
            transition-all duration-200 shadow-md shadow-indigo-200
            hover:shadow-lg hover:shadow-indigo-300 hover:-translate-y-px
            disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0
          "
        >
          {descargandoAuto ? (
            <><Loader2 size={17} className="animate-spin" /> Conectando con Mercado Público...</>
          ) : (
            <><Bot size={17} /> Descargar Bases Automáticamente</>
          )}
        </button>

        {/* Banner de progreso — descarga o clasificación (la descarga tiene prioridad visual) */}
        {descargandoAuto ? (
          <ProgresoBanner fase="descargando" totalDocs={documentosCache.length} />
        ) : clasificando ? (
          <ProgresoBanner fase="clasificando" totalDocs={documentosCache.length} />
        ) : null}

        {/* Banner costeo generado — aparece cuando hay un COSTEO_ en DOCUMENTOS_PROPIOS */}
        {!clasificando && (() => {
          const costeo = documentosCache.find(d =>
            d.nombre?.startsWith('COSTEO_') && (d as any).categoria === 'DOCUMENTOS_PROPIOS',
          );
          if (!costeo) return null;
          return (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <TableProperties size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-emerald-800">
                  Excel de Costeo generado automáticamente
                </p>
                <p className="text-[11.5px] text-emerald-700 mt-0.5 truncate">
                  {costeo.nombre} — disponible en <strong>Documentos Propios</strong>
                </p>
                {costeoError && (
                  <p className="text-[11px] text-red-600 mt-1">{costeoError}</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleRegenerarCosteo}
                disabled={regenerandoCosteo}
                title="Regenerar el Excel desde el informe guardado (sin volver a analizar)"
                className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-100 hover:bg-indigo-200 disabled:opacity-60 px-2.5 py-1 rounded-lg transition-colors"
              >
                {regenerandoCosteo
                  ? <><Loader2 size={11} className="animate-spin" /> Regenerando…</>
                  : <><RefreshCw size={11} /> Regenerar</>}
              </button>
              <a
                href={(costeo as any).url_local || (costeo as any).url}
                download={costeo.nombre}
                className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 bg-emerald-100 hover:bg-emerald-200 px-2.5 py-1 rounded-lg transition-colors"
              >
                <Download size={11} /> Descargar
              </a>
            </div>
          );
        })()}

        {/* Banner informe PDF — si existe, ofrece regenerar/descargar; si hubo análisis (hay costeo)
            pero aún no hay PDF (análisis previo a esta función), ofrece generarlo. */}
        {!clasificando && (() => {
          const informe = documentosCache.find(d =>
            d.nombre?.startsWith('INFORME_') && (d as any).categoria === 'DOCUMENTOS_PROPIOS');
          const hayAnalisis = documentosCache.some(d => d.nombre?.startsWith('COSTEO_'));
          if (informe) {
            return (
              <div className="flex items-start gap-2.5 px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl">
                <FileText size={14} className="text-violet-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-semibold text-violet-800">Informe de viabilidad (PDF)</p>
                  <p className="text-[11.5px] text-violet-700 mt-0.5 truncate">
                    {informe.nombre} — disponible en <strong>Documentos Propios</strong>
                  </p>
                  {informeError && <p className="text-[11px] text-red-600 mt-1">{informeError}</p>}
                </div>
                <button
                  type="button"
                  onClick={handleGenerarInforme}
                  disabled={generandoInforme}
                  title="Regenerar el PDF desde el informe guardado (sin volver a analizar)"
                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-100 hover:bg-indigo-200 disabled:opacity-60 px-2.5 py-1 rounded-lg transition-colors"
                >
                  {generandoInforme
                    ? <><Loader2 size={11} className="animate-spin" /> Regenerando…</>
                    : <><RefreshCw size={11} /> Regenerar</>}
                </button>
                <a
                  href={(informe as any).url_local || (informe as any).url}
                  download={informe.nombre}
                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-violet-700 hover:text-violet-900 bg-violet-100 hover:bg-violet-200 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Download size={11} /> Descargar
                </a>
              </div>
            );
          }
          if (hayAnalisis) {
            return (
              <div className="flex items-center gap-2.5 px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl">
                <FileText size={14} className="text-violet-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-semibold text-violet-800">Generar el informe en PDF</p>
                  <p className="text-[11.5px] text-violet-700 mt-0.5">Crea el documento del informe de viabilidad para descargar/compartir.</p>
                  {informeError && <p className="text-[11px] text-red-600 mt-1">{informeError}</p>}
                </div>
                <button
                  type="button"
                  onClick={handleGenerarInforme}
                  disabled={generandoInforme}
                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  {generandoInforme
                    ? <><Loader2 size={11} className="animate-spin" /> Generando…</>
                    : <><FileText size={11} /> Generar PDF</>}
                </button>
              </div>
            );
          }
          return null;
        })()}

        {/* Banner set incompleto */}
        {!clasificando && resumenClasificacion?.estado === 'incompleto' && resumenClasificacion.falta.length > 0 && (
          <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[12.5px] font-semibold text-amber-800">Set de documentos incompleto</p>
              <p className="text-[11.5px] text-amber-700 mt-0.5">
                No se detectaron: {resumenClasificacion.falta.map(f => f.replace(/_/g, ' ').toLowerCase()).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* Contenido */}
        {cargandoDocs ? (
          <div className="flex items-center justify-center py-8 gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-indigo-500" /> Cargando documentos...
          </div>
        ) : documentosCache.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle size={13} className="text-emerald-500" />
                <p className="text-[12.5px] font-semibold text-slate-600">
                  {documentosCache.length} documento{documentosCache.length !== 1 ? 's' : ''} guardado{documentosCache.length !== 1 ? 's' : ''}
                </p>
              </div>
              {onReClasificar && !clasificando && (
                <button
                  onClick={onReClasificar}
                  className="flex items-center gap-1 text-[11px] text-violet-600 hover:text-violet-800 font-semibold transition-colors"
                >
                  <Sparkles size={10} /> Re-clasificar
                </button>
              )}
            </div>

            <DocumentosGrid
              documentos={documentosCache as (DocumentoAdjunto & { categoria?: string })[]}
              codigoDecoded={codigoDecoded}
              onView={setVisorDoc}
              onOpenIA={setIaDoc}
              onRefrescar={fetchDocumentos}
            />
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <FileText size={20} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">Sin documentos aún</p>
            <p className="text-xs text-slate-400 mt-1">
              Haz clic en <strong>Descargar Bases Automáticamente</strong> para obtenerlos desde Mercado Público
            </p>
          </div>
        )}
      </div>

      {/* Visor inline de documentos (PDF/imagen/Office) — sin descargar */}
      <DocumentViewerModal doc={visorDoc} onClose={() => setVisorDoc(null)} />

      {/* Chat rápido de IA sobre un documento puntual */}
      <DocumentoIAModal doc={iaDoc} codigo={codigoDecoded} onClose={() => setIaDoc(null)} />
    </div>
  );
}
