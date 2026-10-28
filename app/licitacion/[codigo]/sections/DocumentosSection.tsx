'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRealtime } from '@/app/lib/use-realtime';
import { IconFileText as FileText, IconRefresh as RefreshCw, IconLoader2 as Loader2, IconDownload as Download, IconFolderOpen as FolderOpen, IconFolder as Folder, IconAlertTriangle as AlertTriangle, IconTableOptions as TableProperties, IconUpload as Upload, IconTrash as Trash2, IconPencil as Pencil, IconCheck as Check, IconX as X, IconFolderPlus as FolderPlus, IconScissors as Scissors, IconMessageQuestion as Preguntar, IconCloudDownload as CloudDownload } from '@tabler/icons-react';
import { DocumentoAdjunto } from '@/app/types/search.types';
import { getFileIcon, formatFileSize, esUrlAnalizable } from '../utils';
import { urlDescarga } from '@/app/lib/descargas-cliente';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { DocumentoIAModal } from '@/app/components/DocumentoIAModal';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Esqueleto } from '@/app/components/ui/kit/Estructura';
import { DocSplitLoader } from '@/app/components/ui/DocSplitLoader';
import { useSession } from '@/app/lib/session-context';
import { useConfirm } from '@/app/components/ui/confirm';
import { useToast } from '@/app/components/ui/toast';
import { registrarVerDocumento } from '@/app/lib/actividad-cliente';

// Documento de la licitación con los campos que solo existen en documentos_cache (no en la
// API de MP): categoria (caja donde vive) y origen_manual (lo subió el usuario a mano
// directamente en esa caja, a diferencia de lo descargado de Mercado Público — ver
// CATS_BORRABLES más abajo, que ahora también respeta esta marca para habilitar "Eliminar").
// generado_separar: lo produjo "Separar anexos" a partir de un documento más largo — ver
// documentos_generados_separar (migration-89) y CATS_PARA_AUDITOR más abajo para dónde se pinta.
type DocLicitacion = DocumentoAdjunto & { categoria?: string; origen_manual?: boolean | number; generado_separar?: boolean | number };

// Rellenar anexos y enviarlos al Auditor ya NO se hace desde Documentos: se hace desde el Auditor
// (Auditor → Anexos, «Generar anexo» en cada punto). Decisión del dueño, 28-oct-2026 — esta
// pantalla queda para ver, ordenar, subir y separar documentos.
type DocRef = { id: number; nombre: string; url: string };

// "Separar anexos" ADEMÁS acepta PDF (14-ago-2026, pedido explícito del usuario: "sacar los
// anexos de un PDF y dejarlos en Word, sin tocar el PDF") — el backend
// (cargarDocumentoBaseParaSeparar, anexos-datos.ts) lo convierte con LibreOffice antes de dividir.
// A propósito NO se reusa para "rellenar": un PDF convertido es una aproximación de LibreOffice,
// no la estructura Word real que publicó el organismo — mandarlo al auto-relleno arriesgaría
// escribir sobre algo que no es lo que se va a presentar.
function esAnexoSeparable(doc: DocLicitacion): boolean {
  return /\.(docx?|pdf)$/i.test(doc.nombre || '') && doc.id != null;
}

// Categoría de documentos SUBIDOS por el equipo (los únicos que se pueden eliminar;
// los oficiales descargados de Mercado Público quedan protegidos).
const CAT_PROPIOS = 'DOCUMENTOS_PROPIOS';

// Las 3 cajas de anexos YA SEPARADOS por categoría (ver anexos-dividir.ts `clasificarAnexo` +
// POST /api/anexos/separar) — pedido explícito del usuario (13-ago-2026): quedan en "Documentos
// y Bases" (nunca en "Documentos Propios"), pero siguen siendo archivos que GENERAMOS nosotros
// (nunca oficiales de MP), así que son borrables/renombrables igual que DOCUMENTOS_PROPIOS —
// ver CATS_BORRABLES abajo y el mismo criterio espejado en app/api/documentos/[codigo]/route.ts.
const CAT_ANEXOS_ADMIN = 'ANEXOS_ADMINISTRATIVOS';
const CAT_ANEXOS_TECNICOS = 'ANEXOS_TECNICOS';
const CAT_ANEXOS_ECONOMICOS = 'ANEXOS_ECONOMICOS';
const CATS_BORRABLES = new Set([CAT_PROPIOS, CAT_ANEXOS_ADMIN, CAT_ANEXOS_TECNICOS, CAT_ANEXOS_ECONOMICOS]);

// Colores de estado de un documento en "Documentos y Bases" (corregido 7-sep-2026, pedido
// explícito del usuario tras ver el primer intento):
//  · NARANJO = lo generó "Separar anexos" (documentos_generados_separar) — es un ARCHIVO NUESTRO,
//    recién partido de uno más largo, todavía no dice nada sobre si ya se usó para algo.
//  · VERDE = ya se mandó al Auditor Técnico (su URL vive en checklist_comercial_documentos de
//    este negocio) — ver urlsEnAuditor/refrescarUrlsAuditor más abajo. Manda sobre el naranjo: un
//    anexo separado Y YA enviado se ve verde, porque "ya está en el Auditor" es el estado más
//    avanzado de los dos.
// Ninguno de los dos depende de la CAJA/categoría — a diferencia del primer intento, que pintaba
// verde por estar en Anexos Administrativos/Técnicos/Económicos y mezclaba "recién separado" con
// "ya enviado", que para el usuario son dos cosas distintas.

// Estado de un documento ya enviado al Auditor Técnico (pedido 23-sep-2026): en revisión, aprobado
// u observado. Sale del estado real del punto del checklist donde quedó pegado (ver
// /comercial/documentos-auditor). Se muestra como punto + texto (skill licitank-ui).
type EstadoAuditor = 'REVISION' | 'APROBADO' | 'OBSERVADO';
const ESTILO_AUDITOR: Record<EstadoAuditor, { color: string; label: string; tip: string }> = {
  REVISION:  { color: '#d97706', label: 'En el Auditor', tip: 'En revisión del Auditor Técnico' },
  APROBADO:  { color: '#16a34a', label: 'Aprobado',      tip: 'Aprobado por el Auditor Técnico' },
  OBSERVADO: { color: '#e11d48', label: 'Observado',     tip: 'Observado por el Auditor Técnico' },
};

// Estilo del sistema de diseño (skill licitank-ui) para cajas, filas y botones de ícono.
const CAJA_BASE = 'break-inside-avoid mb-3 rounded-2xl border bg-white shadow-tarjeta transition-[border-color,background-color,box-shadow] duration-150 dark:bg-slate-900';
const CAJA_ESTADO = (isDragOver: boolean, punteada: boolean) => isDragOver
  ? 'border-marca ring-2 ring-marca/20 bg-marca-suave/50 dark:bg-teal-950/30'
  : punteada ? 'border-dashed border-slate-300 dark:border-slate-600' : 'border-linea dark:border-slate-800';
const ACCION = 'p-1.5 rounded-md text-slate-400 hover:text-tinta hover:bg-slate-100 transition-colors dark:hover:bg-slate-700 dark:hover:text-slate-100 disabled:opacity-50';
const ACCIONES_VISIBLES = 'flex items-center gap-0.5 flex-shrink-0 lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100 transition-opacity';

function EncabezadoCaja({ label, cantidad, children }: { label: string; cantidad: number; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
      <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0 dark:bg-slate-800 dark:text-slate-400"><Folder size={15} /></span>
      <span className="flex-1 min-w-0 text-[13.5px] font-semibold text-tinta dark:text-slate-100 truncate">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-tinta-3">{cantidad}</span>
      {children}
    </div>
  );
}

function EstadoDoc({ estado, separado }: { estado?: EstadoAuditor; separado?: boolean }) {
  if (estado) {
    const e = ESTILO_AUDITOR[estado];
    return <span className="inline-flex items-center gap-1" title={e.tip}><span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: e.color }} />{e.label}</span>;
  }
  if (separado) {
    return <span className="inline-flex items-center gap-1" title="Generado al separar un documento con varios anexos pegados"><span aria-hidden className="w-1.5 h-1.5 rounded-full bg-orange-500" />Separado</span>;
  }
  return null;
}

// Etiqueta legible por categoría conocida. El ORDEN aquí define el orden de render.
// Las cajas se muestran de forma DINÁMICA: solo aparece la que tiene documentos
// (más una caja "Sin clasificar" para los que no tienen categoría).
const CAJA_LABELS: Record<string, string> = {
  BASES_ADMINISTRATIVAS: 'Bases Administrativas',
  BASES_TECNICAS: 'Bases Técnicas',
  ANEXOS_OFERENTE: 'Anexos Oferente',
  ANEXOS_ADMINISTRATIVOS: 'Anexos Administrativos',
  ANEXOS_TECNICOS: 'Anexos Técnicos',
  ANEXOS_ECONOMICOS: 'Anexos Económicos',
  DOCUMENTOS_PROCESO: 'Documentos Proceso',
  DOCUMENTOS_PROPIOS: 'Documentos Propios',
  OTROS: 'Otros',
};

// Orden preferente de las cajas. Categorías desconocidas van al final.
const ORDEN_CAJAS = [
  'BASES_ADMINISTRATIVAS',
  'BASES_TECNICAS',
  'ANEXOS_OFERENTE',
  'ANEXOS_ADMINISTRATIVOS',
  'ANEXOS_TECNICOS',
  'ANEXOS_ECONOMICOS',
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
}

// ─── Item draggable ───────────────────────────────────────────────────────────
// Clic en el nombre abre el visor; las acciones aparecen al pasar el mouse (siempre visibles en
// pantallas chicas, donde no hay hover).
function DocItem({
  doc,
  codigoDecoded,
  onDragStart,
  isDragging,
  onView,
  onOpenIA,
  onDelete,
  onSepararAnexo,
  estadoAuditor,
}: {
  doc: DocLicitacion;
  codigoDecoded: string;
  onDragStart: (e: React.DragEvent, doc: DocumentoAdjunto) => void;
  isDragging: boolean;
  onView: (doc: VisorDoc) => void;
  onOpenIA: (doc: { nombre: string; url: string }) => void;
  onDelete?: (doc: DocLicitacion) => void;
  // Separa un .docx que trae varios anexos pegados (ver anexos-dividir.ts) en un archivo por
  // anexo — útil para organizar ANTES de llenar nada (el relleno se hace desde el Auditor).
  onSepararAnexo?: (doc: DocRef) => void;
  // Estado en el Auditor Técnico si la URL de este documento ya vive en
  // checklist_comercial_documentos de este negocio (ver urlsEnAuditor en el componente padre).
  estadoAuditor?: EstadoAuditor;
}) {
  // Borrable si su categoría es de las nuestras (generadas por la app) O si el usuario lo
  // subió a mano directamente en una caja oficial (origen_manual) — en ese caso la caja
  // puede ser "Bases Administrativas" y aun así debe poder eliminarlo, a diferencia de un
  // documento real descargado de Mercado Público que cae en la misma caja.
  const esPropio = CATS_BORRABLES.has((doc.categoria || '').toUpperCase()) || !!doc.origen_manual;
  const separable = onSepararAnexo && esAnexoSeparable(doc);
  const url = doc.url_local || doc.url;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, doc)}
      className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing select-none transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${isDragging ? 'opacity-40' : ''}`}
    >
      <span className="text-lg flex-shrink-0 leading-none" aria-hidden>{getFileIcon(doc.nombre)}</span>
      <div className="min-w-0 flex-1">
        <button type="button" draggable={false} onClick={(e) => { e.stopPropagation(); onView({ nombre: doc.nombre, url }); }}
          className="block w-full text-left text-[13px] font-medium text-tinta dark:text-slate-100 leading-snug line-clamp-2 break-words hover:text-marca" title={`Ver «${doc.nombre}»`}>
          {doc.nombre}
        </button>
        <p className="mt-0.5 flex items-center gap-2 text-[11px] text-tinta-2 dark:text-slate-400">
          {doc.size ? <span className="tabular-nums">{formatFileSize(doc.size)}</span> : null}
          <EstadoDoc estado={estadoAuditor} separado={!!doc.generado_separar} />
        </p>
      </div>
      <div className={ACCIONES_VISIBLES}>
        {esUrlAnalizable(url) && (
          <button type="button" draggable={false} onClick={(e) => { e.stopPropagation(); onOpenIA({ nombre: doc.nombre, url }); }} className={ACCION} title="Preguntar sobre este documento"><Preguntar size={15} /></button>
        )}
        {separable && (
          <button type="button" draggable={false} onClick={(e) => { e.stopPropagation(); onSepararAnexo!({ id: doc.id as number, nombre: doc.nombre, url }); }} className={ACCION} title="Separar en anexos independientes (si trae varios pegados en un solo documento)"><Scissors size={15} /></button>
        )}
        <a href={urlDescarga(url)} download={doc.nombre} draggable={false}
          onClick={(e) => { e.stopPropagation(); registrarVerDocumento(codigoDecoded, doc.nombre, 'Descargó'); }}
          className={ACCION} title="Descargar"><Download size={15} /></a>
        {esPropio && onDelete && (
          <button type="button" draggable={false} onClick={(e) => { e.stopPropagation(); onDelete(doc); }} className={`${ACCION} hover:!text-urgente hover:!bg-red-50 dark:hover:!bg-red-950/40`} title="Eliminar documento propio"><Trash2 size={15} /></button>
        )}
      </div>
    </div>
  );
}

// ─── Caja droppable ───────────────────────────────────────────────────────────
function CajaDroppable({
  caja,
  docs,
  codigoDecoded,
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
  onSepararAnexo,
  subiendo,
  urlsEnAuditor,
}: {
  caja: CajaConfig;
  codigoDecoded: string;
  docs: DocLicitacion[];
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
  onUpload: (files: FileList | File[], categoria: string) => void;
  onDelete: (doc: DocLicitacion) => void;
  onSepararAnexo?: (doc: DocRef) => void;
  subiendo: string | null; // key de la caja que está subiendo un archivo
  // URLs ya enviadas al Auditor Técnico de este negocio — ver urlsEnAuditor en el padre.
  urlsEnAuditor: Map<string, EstadoAuditor>;
}) {
  const isDraggingHere = draggingDoc && docs.some(d => d.nombre === draggingDoc.nombre);
  const subiendoAqui = subiendo === caja.key;
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`${CAJA_BASE} ${CAJA_ESTADO(isDragOver, isDraggingActive && !isDraggingHere)}`}
      onDragOver={(e) => onDragOver(e, caja.key)}
      onDragEnter={(e) => onDragEnter(e, caja.key)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, caja.key)}
    >
      <EncabezadoCaja label={caja.label} cantidad={docs.length}>
        {/* Subida manual directa a esta caja — evita tener que "mover" un documento después.
            Se marca origen_manual en el backend para que quede borrable y protegida de que
            una re-clasificación IA la reasigne (ver handleUpload). */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length) onUpload(files, caja.key);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={subiendoAqui}
          title="Subir documento(s) a esta caja"
          className={ACCION}
        >
          {subiendoAqui ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
        </button>
      </EncabezadoCaja>

      <div className="px-1.5 pb-2">
        {docs.map((doc) => (
          <DocItem
            key={doc.nombre}
            doc={doc}
            codigoDecoded={codigoDecoded}
            onDragStart={onDragStart}
            isDragging={draggingDoc?.nombre === doc.nombre}
            onView={onView}
            onOpenIA={onOpenIA}
            onDelete={onDelete}
            onSepararAnexo={onSepararAnexo}
            estadoAuditor={urlsEnAuditor.get(doc.url_local || doc.url)}
          />
        ))}

        {/* Zona de drop */}
        {isDragOver && (
          <div className="mx-1 mt-1 flex items-center justify-center h-10 border-2 border-dashed border-marca/40 rounded-lg">
            <span className="text-xs font-medium text-marca">Soltar aquí</span>
          </div>
        )}
        {docs.length === 0 && !isDragOver && (
          <p className="px-2.5 pb-1.5 text-xs text-slate-400">Vacía · arrastra un documento o súbelo con el ícono</p>
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
  onSepararAnexo,
  modo,
  urlsEnAuditor,
}: {
  documentos: DocLicitacion[];
  codigoDecoded: string;
  onView: (doc: VisorDoc) => void;
  onOpenIA: (doc: { nombre: string; url: string }) => void;
  onRefrescar: () => void;
  // Habilita el botón de separar en la grilla (gateado por permiso desde el padre) — el handler
  // real vive ACÁ ABAJO porque necesita toast/confirm/onRefrescar, que ya están en este componente.
  onSepararAnexo?: true;
  // 'licitacion' = todas las cajas MENOS Documentos Propios (docs de la licitación);
  // 'propios' = SOLO la caja Documentos Propios (lo que creamos/editamos);
  // undefined = todas (comportamiento previo).
  modo?: 'licitacion' | 'propios';
  // URLs ya enviadas al Auditor Técnico de este negocio — ver urlsEnAuditor en DocumentosSection.
  urlsEnAuditor: Map<string, EstadoAuditor>;
}) {
  // Agrupa los documentos por su categoría real (sin pre-crear cajas vacías).
  const buildGrupos = (docs: DocLicitacion[]) => {
    const g: Record<string, DocLicitacion[]> = { SIN_CATEGORIA: [] };
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
  // Nombre del documento que se está separando ahora mismo (null = ninguno) — muestra el
  // overlay con DocSplitLoader mientras dura el fetch a /api/anexos/separar.
  const [separando, setSeparando] = useState<string | null>(null);
  const dragEnterCount = useRef<Record<string, number>>({});
  const confirmar = useConfirm();
  const toast = useToast();

  // Elimina un documento PROPIO (solo esa categoría). Confirma, llama al DELETE del
  // backend (borra de R2 + caché) y actualiza el estado local de forma optimista.
  const handleDelete = async (doc: DocLicitacion) => {
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

  // Separa un .docx (o un PDF, convertido primero a .docx con LibreOffice — ver
  // cargarDocumentoBaseParaSeparar en anexos-datos.ts) que trae varios anexos pegados, en un
  // archivo por anexo (nombrado por su título y clasificado admin/técnico/económico — ver
  // anexos-dividir.ts). Nunca toca el original: los resultados quedan en sus propias cajas de
  // "Documentos y Bases" (Anexos Administrativos/Técnicos/Económicos), no en Documentos Propios.
  const handleSepararAnexo = async (doc: DocRef) => {
    const esPdf = /\.pdf$/i.test(doc.nombre || '');
    const ok = await confirmar({
      titulo: '¿Separar anexos?',
      mensaje: (esPdf
        ? `Se convertirá "${doc.nombre}" a Word y se revisará en busca de varios anexos pegados. `
        : `Se revisará "${doc.nombre}" en busca de varios anexos pegados en un solo Word. `)
        + 'Si se detecta más de uno, cada uno queda como archivo Word independiente en su caja de anexos '
        + '(Administrativos/Técnicos/Económicos, según corresponda) — el original no se modifica.',
      confirmarLabel: 'Separar',
    });
    if (!ok) return;
    setSeparando(doc.nombre);
    try {
      const res = await fetch('/api/anexos/separar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigoDecoded, documentoId: doc.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo separar el documento');
      if (!data.separado) {
        toast.info('Nada que separar', data.mensaje);
        return;
      }
      toast.success(
        `Separado en ${data.archivos.length} anexos`,
        data.archivos.map((a: { nombre: string }) => a.nombre).join(', '),
      );
      onRefrescar();
    } catch (e: any) {
      toast.error('No se pudo separar', e?.message);
    } finally {
      setSeparando(null);
    }
  };

  // Sube uno o varios documentos manualmente a la caja indicada (oficial de la licitación,
  // p.ej. Bases Administrativas): presign → PUT directo a R2 → guardar en documentos_cache con
  // esa categoría. Se manda origenManual:true para que el backend marque el documento como
  // borrable/renombrable (origen_manual) y protegido de que una re-clasificación IA lo mueva de
  // caja (categoria_manual) — mismo criterio que usa el drag&drop entre cajas oficiales.
  const handleUpload = async (files: FileList | File[], categoria: string) => {
    const lista = Array.from(files);
    if (lista.length === 0) return;
    setSubiendo(categoria);
    setErrorSubida(null);
    const errores: string[] = [];
    let exitosos = 0;
    for (const file of lista) {
      try {
        if (file.size > 100 * 1024 * 1024) throw new Error(`"${file.name}" supera los 100 MB.`);
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
        if (!pres.ok || !presData.uploadUrl) throw new Error(presData.error || `No se pudo preparar la subida de "${file.name}"`);

        const put = await fetch(presData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!put.ok) throw new Error(`Error subiendo "${file.name}" (HTTP ${put.status})`);

        const save = await fetch('/api/documentos/guardar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licitacionCodigo: codigoDecoded,
            documentoNombre: file.name,
            url: presData.publicUrl,
            size: file.size,
            categoria,
            origenManual: true,
          }),
        });
        const saveData = await save.json();
        if (!save.ok || !saveData.success) throw new Error(saveData.error || `No se pudo registrar "${file.name}"`);
        exitosos++;
      } catch (e: any) {
        errores.push(e.message || file.name);
      }
    }
    setSubiendo(null);
    if (errores.length > 0) setErrorSubida(errores.join(' · '));
    if (exitosos > 0) onRefrescar();
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

    // Arrastre NATIVO desde el explorador de archivos del sistema (Windows/Finder/el escritorio),
    // no un reordenamiento interno de la app — pedido explícito del usuario (7-sep-2026): "que
    // desde mi pc pueda arrastrar documentos... dejarlo en una caja del programa, por ejemplo
    // administrativo, y que se cargue ahí". Mismo camino que el botón "Subir documento(s) a esta
    // caja" (handleUpload) — la única diferencia es que el archivo llega por `dataTransfer.files`
    // en vez de un `<input type="file">`. `draggingDoc` sigue null en este caso porque nunca se
    // llamó a handleDragStart (eso solo pasa al arrastrar una tarjeta YA dentro de la app).
    if (!draggingDoc) {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) await handleUpload(e.dataTransfer.files, targetKey);
      return;
    }

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
      const r = await fetch('/api/documentos/clasificar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: codigoDecoded,
          documento_nombre: draggingDoc.nombre,
          nueva_categoria: targetKey,
        }),
      });
      if (!r.ok) throw new Error();
      // Propaga el movimiento al padre (documentosCache): sin esto, el estado local optimista
      // se pierde al cambiar de pestaña (el componente se re-monta con la categoría vieja y el
      // documento "salta" de vuelta a su caja original hasta refrescar a mano).
      onRefrescar();
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

  // Según el modo, elegimos qué cajas se muestran (para separar "Documentos y Bases" de
  // "Documentos Propios" en dos apartados distintos).
  const baseKeys = modo === 'propios'
    ? [CAT_PROPIOS]
    : modo === 'licitacion'
      ? [...ORDEN_CAJAS.filter(k => k !== CAT_PROPIOS), ...clavesExtra]
      : [...ORDEN_CAJAS, ...clavesExtra];
  // Las cajas con documentos van primero y las vacías al final (siguen ahí como destino para
  // arrastrar o subir), en columnas que se rellenan sin dejar huecos.
  const cajasVisibles: CajaConfig[] = baseKeys
    .map(key => ({ key, label: labelDeCaja(key) }))
    .sort((a, b) => Number((grupos[a.key]?.length || 0) === 0) - Number((grupos[b.key]?.length || 0) === 0));

  return (
    <div
      onDragEnd={handleDragEnd}
      className="space-y-3"
    >
      <div className="columns-1 md:columns-2 2xl:columns-3 gap-3">
        {cajasVisibles.map((caja) => (
          <CajaDroppable
            key={caja.key}
            caja={caja}
            codigoDecoded={codigoDecoded}
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
            onSepararAnexo={onSepararAnexo ? handleSepararAnexo : undefined}
            subiendo={subiendo}
            urlsEnAuditor={urlsEnAuditor}
          />
        ))}
      </div>

      {errorSubida && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
          <AlertTriangle size={15} className="flex-shrink-0" /> {errorSubida}
          <button onClick={() => setErrorSubida(null)} className="ml-auto font-medium hover:underline">Cerrar</button>
        </div>
      )}

      {/* Sin categoría — debajo de las cajas */}
      {(grupos['SIN_CATEGORIA']?.length || 0) > 0 && (
        <div className={`${CAJA_BASE} border-linea dark:border-slate-800`}>
          <EncabezadoCaja label="Sin clasificar" cantidad={grupos['SIN_CATEGORIA'].length} />
          <div className="px-1.5 pb-2">
            {grupos['SIN_CATEGORIA'].map((doc) => (
              <DocItem
                key={doc.nombre}
                doc={doc}
                codigoDecoded={codigoDecoded}
                onDragStart={handleDragStart}
                isDragging={draggingDoc?.nombre === doc.nombre}
                onView={onView}
                onOpenIA={onOpenIA}
                estadoAuditor={urlsEnAuditor.get(doc.url_local || doc.url)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Overlay mientras corre POST /api/anexos/separar — el usuario no tiene forma de saber
          cuánto tarda (descarga + parsea + clasifica + sube N archivos), así que se le muestra
          la animación en vez de dejar el botón "colgado" sin feedback. No se puede cerrar a
          mano: desaparece sola cuando el fetch resuelve (éxito o error), en el finally de
          handleSepararAnexo. */}
      {separando && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm overlay-in">
          <div className="bg-white rounded-2xl shadow-2xl px-8 py-7 modal-in">
            <DocSplitLoader titulo="Separando anexos…" subtitulo={`Revisando "${separando}"`} />
          </div>
        </div>,
        document.body,
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
  const titulo = fase === 'descargando'
    ? 'Descargando documentos desde Mercado Público…'
    : `Clasificando ${totalDocs > 0 ? `${totalDocs} documento${totalDocs !== 1 ? 's' : ''}` : 'documentos'}…`;
  return (
    <div className="rounded-xl bg-marca-suave/70 px-4 py-3 space-y-2 dark:bg-teal-950/30">
      <div className="flex items-center gap-2.5 text-[13px] font-medium text-marca dark:text-teal-300">
        <Loader2 size={15} className="animate-spin flex-shrink-0" />
        {titulo}
      </div>
      {/* Barra indeterminada animada */}
      <div className="h-1.5 w-full rounded-full overflow-hidden bg-white/80 dark:bg-slate-800">
        <div className="h-full w-1/3 rounded-full bg-marca progreso-indeterminado" />
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

// Lista de "Documentos Propios" (los que creamos/editamos: costeo, informe, subidas). Formato lista
// con acciones por fila: Ver, Descargar, Renombrar (inline), Reemplazar (subir versión nueva) y Eliminar.
type DocPropio = DocumentoAdjunto & {
  categoria?: string; subcategoria?: string;
  subido_por_nombre?: string | null; subido_at?: string | null;
};

// "Subido por Fulano · 06-10-2026 14:32" (hora de Chile). Vacío si no hay ninguno de los dos datos.
function textoSubidoPor(nombre?: string | null, at?: string | null): string {
  const d = at ? new Date(at) : null;
  const cuando = d && !isNaN(d.getTime())
    ? d.toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '')
    : '';
  return [nombre ? `Subido por ${nombre}` : '', cuando].filter(Boolean).join(' · ');
}

const CAJA_SIN_CLASIFICAR = 'SIN_CLASIFICAR';
function claveCajaPropia(sub?: string | null) {
  return sub && sub.trim() ? sub.trim() : CAJA_SIN_CLASIFICAR;
}

// ─── Item dentro de una caja de "Documentos Propios" — a diferencia del DocItem de la
// licitación (documentos oficiales, protegidos), acá se puede renombrar/reemplazar/eliminar. ──
function DocPropioItem({
  doc, isDragging, isEditing, valorNombre, busy,
  onDragStart, onView, onDownloadClick, onReemplazar, onRenombrarClick, onEliminar,
  onGuardarNombre, onCancelarEdicion, onChangeValorNombre, estadoAuditor,
}: {
  doc: DocPropio;
  isDragging: boolean;
  isEditing: boolean;
  valorNombre: string;
  busy: boolean;
  onDragStart: (e: React.DragEvent, doc: DocPropio) => void;
  onView: () => void;
  onDownloadClick: () => void;
  onReemplazar: () => void;
  onRenombrarClick: () => void;
  onEliminar: () => void;
  onGuardarNombre: () => void;
  onCancelarEdicion: () => void;
  onChangeValorNombre: (v: string) => void;
  // Estado en el Auditor si la URL de este documento ya vive en checklist_comercial_documentos de
  // este negocio. Pedido del usuario (7-sep-2026): el anexo YA RELLENADO vive acá, en Documentos
  // Propios, y es justo el que de verdad se manda al Auditor.
  estadoAuditor?: EstadoAuditor;
}) {
  const urlDe = (doc as any).url_local || (doc as any).url;
  const subido = textoSubidoPor(doc.subido_por_nombre, doc.subido_at);
  return (
    <div
      draggable={!isEditing}
      onDragStart={(e) => onDragStart(e, doc)}
      className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing select-none transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${isDragging ? 'opacity-40' : ''}`}
    >
      <span className="text-lg flex-shrink-0 leading-none" aria-hidden>{getFileIcon(doc.nombre)}</span>
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            autoFocus value={valorNombre} onChange={e => onChangeValorNombre(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onGuardarNombre(); if (e.key === 'Escape') onCancelarEdicion(); }}
            aria-label="Nuevo nombre del documento"
            className="w-full h-8 text-[13px] px-2 border border-slate-300 rounded-md focus:outline-none focus:border-marca focus:ring-2 focus:ring-marca/15 dark:bg-slate-950 dark:border-slate-700"
          />
        ) : (
          <button type="button" draggable={false} onClick={(e) => { e.stopPropagation(); onView(); }}
            className="block w-full text-left text-[13px] font-medium text-tinta dark:text-slate-100 leading-snug line-clamp-2 break-words hover:text-marca" title={`Ver «${doc.nombre}»`}>
            {doc.nombre}
          </button>
        )}
        <p className="mt-0.5 flex items-center gap-2 flex-wrap text-[11px] text-tinta-2 dark:text-slate-400">
          {doc.size ? <span className="tabular-nums">{formatFileSize(doc.size)}</span> : null}
          {subido && <span>{subido}</span>}
          <EstadoDoc estado={estadoAuditor} />
        </p>
      </div>
      {busy && <Loader2 size={15} className="animate-spin text-slate-400 flex-shrink-0" />}
      {isEditing ? (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" onClick={onGuardarNombre} title="Guardar" className={`${ACCION} !text-marca`}><Check size={15} /></button>
          <button type="button" onClick={onCancelarEdicion} title="Cancelar" className={ACCION}><X size={15} /></button>
        </div>
      ) : (
        <div className={ACCIONES_VISIBLES}>
          <a href={urlDescarga(urlDe)} download={doc.nombre} onClick={(e) => { e.stopPropagation(); onDownloadClick(); }} className={ACCION} title="Descargar" draggable={false}><Download size={15} /></a>
          <button type="button" onClick={(e) => { e.stopPropagation(); onReemplazar(); }} disabled={busy} className={ACCION} title="Reemplazar (subir versión nueva)" draggable={false}><Upload size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onRenombrarClick(); }} disabled={busy} className={ACCION} title="Renombrar" draggable={false}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onEliminar(); }} disabled={busy} className={`${ACCION} hover:!text-urgente hover:!bg-red-50 dark:hover:!bg-red-950/40`} title="Eliminar" draggable={false}><Trash2 size={15} /></button>
        </div>
      )}
    </div>
  );
}

// ─── Caja droppable de "Documentos Propios" — la crea y arrastra el usuario, nunca la IA. ──
function CajaPropiaDroppable({
  cajaKey, label, docs, isDragOver, isDraggingActive, draggingDoc,
  onDragStart, onDragOver, onDragEnter, onDragLeave, onDrop,
  onView, onDownloadClick, onReemplazar, onRenombrarClick, onEliminar,
  editando, valorNombre, onGuardarNombre, onCancelarEdicion, onChangeValorNombre, ocupado,
  urlsEnAuditor,
}: {
  cajaKey: string;
  label: string;
  docs: DocPropio[];
  isDragOver: boolean;
  isDraggingActive: boolean;
  draggingDoc: DocPropio | null;
  onDragStart: (e: React.DragEvent, doc: DocPropio) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent, key: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, key: string) => void;
  onView: (doc: DocPropio) => void;
  onDownloadClick: (doc: DocPropio) => void;
  onReemplazar: (doc: DocPropio) => void;
  onRenombrarClick: (doc: DocPropio) => void;
  onEliminar: (doc: DocPropio) => void;
  editando: string | null;
  valorNombre: string;
  onGuardarNombre: (doc: DocPropio) => void;
  onCancelarEdicion: () => void;
  onChangeValorNombre: (v: string) => void;
  ocupado: string | null;
  urlsEnAuditor: Map<string, EstadoAuditor>;
}) {
  const isDraggingHere = draggingDoc && docs.some(d => d.nombre === draggingDoc.nombre);
  return (
    <div
      className={`${CAJA_BASE} ${CAJA_ESTADO(isDragOver, isDraggingActive && !isDraggingHere)}`}
      onDragOver={onDragOver}
      onDragEnter={(e) => onDragEnter(e, cajaKey)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, cajaKey)}
    >
      <EncabezadoCaja label={label} cantidad={docs.length} />
      <div className="px-1.5 pb-2">
        {docs.map(doc => (
          <DocPropioItem
            key={doc.nombre}
            doc={doc}
            isDragging={draggingDoc?.nombre === doc.nombre}
            isEditing={editando === doc.nombre}
            valorNombre={valorNombre}
            busy={ocupado === doc.nombre}
            onDragStart={onDragStart}
            onView={() => onView(doc)}
            onDownloadClick={() => onDownloadClick(doc)}
            onReemplazar={() => onReemplazar(doc)}
            onRenombrarClick={() => onRenombrarClick(doc)}
            onEliminar={() => onEliminar(doc)}
            onGuardarNombre={() => onGuardarNombre(doc)}
            onCancelarEdicion={onCancelarEdicion}
            onChangeValorNombre={onChangeValorNombre}
            estadoAuditor={urlsEnAuditor.get((doc as any).url_local || (doc as any).url)}
          />
        ))}
        {isDragOver && (
          <div className="mx-1 mt-1 flex items-center justify-center h-10 border-2 border-dashed border-marca/40 rounded-lg">
            <span className="text-xs font-medium text-marca">Soltar aquí</span>
          </div>
        )}
        {docs.length === 0 && !isDragOver && (
          <p className="px-2.5 pb-1.5 text-xs text-slate-400">Vacía · arrastra un documento aquí</p>
        )}
      </div>
    </div>
  );
}

// ─── Documentos Propios: cajas MANUALES ────────────────────────────────────────────────────
// A diferencia de DocumentosGrid (documentos de la licitación, clasificados por IA), acá NO
// hay taxonomía fija: la caja es lo que el usuario escriba y los archivos se arrastran a mano.
// Se persiste en `subcategoria` — una columna aparte de `categoria` (que sigue marcando el
// documento como DOCUMENTOS_PROPIOS). La clasificación IA (/api/documentos/clasificar) nunca
// corre sobre estos documentos ni toca esta columna — ver /api/documentos/organizar.
function DocumentosPropiosGrid({ docs, codigoDecoded, onView, onRefrescar, urlsEnAuditor }: {
  docs: DocPropio[];
  codigoDecoded: string;
  onView: (doc: VisorDoc) => void;
  onRefrescar: () => void;
  urlsEnAuditor: Map<string, EstadoAuditor>;
}) {
  const confirmar = useConfirm();
  const toast = useToast();

  const buildGrupos = (lista: DocPropio[]) => {
    const g: Record<string, DocPropio[]> = { [CAJA_SIN_CLASIFICAR]: [] };
    for (const d of lista) {
      const k = claveCajaPropia(d.subcategoria);
      if (!g[k]) g[k] = [];
      g[k].push(d);
    }
    return g;
  };

  const [grupos, setGrupos] = useState(() => buildGrupos(docs));
  const [cajasVacias, setCajasVacias] = useState<string[]>([]); // creadas por el usuario, sin docs aún
  const [creandoCaja, setCreandoCaja] = useState(false);
  const [nuevaCaja, setNuevaCaja] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [draggingDoc, setDraggingDoc] = useState<DocPropio | null>(null);
  const dragEnterCount = useRef<Record<string, number>>({});

  const [editando, setEditando] = useState<string | null>(null);
  const [valorNombre, setValorNombre] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [subiendoNuevo, setSubiendoNuevo] = useState<{ actual: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nuevoRef = useRef<HTMLInputElement>(null);
  const docReemplazarRef = useRef<DocPropio | null>(null);

  useEffect(() => { setGrupos(buildGrupos(docs)); }, [docs]);

  const urlDe = (d: DocPropio) => (d as any).url_local || (d as any).url;

  const eliminar = async (doc: DocPropio) => {
    const ok = await confirmar({ titulo: '¿Eliminar documento?', mensaje: `"${doc.nombre}" se eliminará de forma permanente.`, confirmarLabel: 'Eliminar', peligro: true });
    if (!ok) return;
    setOcupado(doc.nombre);
    try {
      const r = await fetch(`/api/documentos/${encodeURIComponent(codigoDecoded)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlDe(doc), nombre: doc.nombre }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast.error(j.error || 'No se pudo eliminar'); return; }
      onRefrescar();
    } catch { toast.error('Error de red al eliminar'); } finally { setOcupado(null); }
  };

  const guardarNombre = async (doc: DocPropio) => {
    const nuevo = valorNombre.trim();
    if (!nuevo || nuevo === doc.nombre) { setEditando(null); return; }
    setOcupado(doc.nombre);
    try {
      const r = await fetch(`/api/documentos/${encodeURIComponent(codigoDecoded)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlDe(doc), nombre: doc.nombre, nuevo_nombre: nuevo }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast.error(j.error || 'No se pudo renombrar'); return; }
      setEditando(null); onRefrescar();
    } catch { toast.error('Error de red al renombrar'); } finally { setOcupado(null); }
  };

  const onPickReemplazo = async (file: File) => {
    const doc = docReemplazarRef.current; docReemplazarRef.current = null;
    if (!doc) return;
    setOcupado(doc.nombre);
    try {
      const pres = await fetch('/api/documentos/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licitacionCodigo: codigoDecoded, filename: doc.nombre, contentType: file.type || 'application/octet-stream', size: file.size }),
      });
      const p = await pres.json();
      if (!pres.ok || !p.uploadUrl) throw new Error(p.error || 'presign');
      const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!put.ok) throw new Error('put');
      // Guarda con el MISMO nombre y categoría → reemplaza la versión anterior (conserva su caja).
      const save = await fetch('/api/documentos/guardar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licitacionCodigo: codigoDecoded, documentoNombre: doc.nombre, url: p.publicUrl, size: file.size, categoria: 'DOCUMENTOS_PROPIOS' }),
      });
      if (!save.ok) throw new Error('save');
      toast.success('Documento reemplazado'); onRefrescar();
    } catch { toast.error('No se pudo reemplazar el documento'); } finally { setOcupado(null); }
  };

  // Sube un único archivo a "Documentos para MP" (categoría DOCUMENTOS_PROPIOS).
  // Presign → PUT directo a R2 → guardar en documentos_cache.
  // `subcategoria`: cuando el archivo se suelta DIRECTO sobre una caja propia (arrastre nativo
  // desde el explorador de archivos — ver handleDrop), aterriza ahí mismo en vez de en "Sin
  // clasificar" — pedido explícito del usuario (7-sep-2026): "que se cargue en esa caja", no que
  // haya que reubicarlo a mano después de subirlo.
  const subirUnArchivo = async (file: File, subcategoria?: string) => {
    if (file.size > 100 * 1024 * 1024) throw new Error(`"${file.name}" supera los 100 MB.`);
    const pres = await fetch('/api/documentos/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licitacionCodigo: codigoDecoded, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size }),
    });
    const p = await pres.json();
    if (!pres.ok || !p.uploadUrl) throw new Error(p.error || `No se pudo preparar la subida de "${file.name}"`);
    const put = await fetch(p.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!put.ok) throw new Error(`Error subiendo "${file.name}"`);
    const save = await fetch('/api/documentos/guardar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licitacionCodigo: codigoDecoded, documentoNombre: file.name, url: p.publicUrl, size: file.size, categoria: 'DOCUMENTOS_PROPIOS', subcategoria }),
    });
    if (!save.ok) throw new Error(`No se pudo registrar "${file.name}"`);
  };

  // Sube uno o varios documentos NUEVOS a "Documentos para MP" (categoría DOCUMENTOS_PROPIOS).
  // Se suben en secuencia (no en paralelo) para no saturar el endpoint de presign; el botón
  // queda deshabilitado y muestra el progreso hasta terminar el lote completo. Sin `subcategoria`
  // aterrizan en "Sin clasificar" (botón genérico del encabezado); con ella, directo en esa caja
  // (arrastre nativo sobre una caja puntual).
  const subirNuevo = async (files: File[], subcategoria?: string) => {
    if (files.length === 0) return;
    let exitosos = 0;
    const errores: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setSubiendoNuevo({ actual: i + 1, total: files.length });
      try {
        await subirUnArchivo(files[i], subcategoria);
        exitosos++;
      } catch (e: any) {
        errores.push(e?.message || files[i].name);
      }
    }
    setSubiendoNuevo(null);
    if (exitosos > 0) {
      toast.success(
        exitosos === 1 ? 'Documento subido a «Documentos para MP»' : `${exitosos} documentos subidos a «Documentos para MP»`,
      );
      onRefrescar();
    }
    if (errores.length > 0) {
      toast.error(
        errores.length === 1 ? 'No se pudo subir el documento' : `No se pudieron subir ${errores.length} documento(s)`,
        errores.join(' · '),
      );
    }
  };

  // ── Drag & drop entre cajas — 100% manual, el usuario decide, nunca la IA ──
  const handleDragStart = (e: React.DragEvent, doc: DocPropio) => {
    setDraggingDoc(doc);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', doc.nombre);
  };
  const handleDragEnd = () => { setDraggingDoc(null); setDragOver(null); dragEnterCount.current = {}; };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDragEnter = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    dragEnterCount.current[key] = (dragEnterCount.current[key] || 0) + 1;
    setDragOver(key);
  };
  const handleDragLeave = () => {
    const key = dragOver;
    if (!key) return;
    dragEnterCount.current[key] = (dragEnterCount.current[key] || 1) - 1;
    if (dragEnterCount.current[key] <= 0) { dragEnterCount.current[key] = 0; setDragOver(null); }
  };
  const handleDrop = async (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    setDragOver(null); dragEnterCount.current = {};

    // Arrastre NATIVO desde el explorador de archivos del sistema, no un reordenamiento interno
    // — pedido explícito del usuario (7-sep-2026), reportado sobre ESTA sección ("Documentos para
    // MP"): "cuando quiero pasar un documento de mi pc arrastrándolo a una caja... no lo deja".
    // Mismo camino que subirNuevo() (el botón del encabezado), con la caja de destino ya elegida
    // en vez de caer siempre en "Sin clasificar".
    if (!draggingDoc) {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await subirNuevo(Array.from(e.dataTransfer.files), targetKey === CAJA_SIN_CLASIFICAR ? undefined : targetKey);
      }
      return;
    }
    const sourceKey = claveCajaPropia(draggingDoc.subcategoria);
    if (sourceKey === targetKey) { setDraggingDoc(null); return; }

    const nuevaSub = targetKey === CAJA_SIN_CLASIFICAR ? undefined : targetKey;
    const docActualizado = { ...draggingDoc, subcategoria: nuevaSub };

    setGrupos(prev => {
      const next: typeof prev = {};
      for (const k in prev) next[k] = [...prev[k]];
      next[sourceKey] = (next[sourceKey] || []).filter(d => d.nombre !== draggingDoc.nombre);
      next[targetKey] = [...(next[targetKey] || []), docActualizado];
      return next;
    });
    setCajasVacias(prev => prev.filter(c => c !== targetKey)); // ya tiene un documento real
    setDraggingDoc(null);

    try {
      const r = await fetch('/api/documentos/organizar', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigoDecoded, documento_nombre: draggingDoc.nombre, subcategoria: nuevaSub || null }),
      });
      if (!r.ok) throw new Error();
      // Propaga el movimiento al padre (documentosCache): sin esto, el estado local optimista
      // se pierde al cambiar de pestaña (el componente se re-monta con la subcategoría vieja).
      onRefrescar();
    } catch {
      toast.error('No se pudo mover el documento');
      setGrupos(prev => {
        const next: typeof prev = {};
        for (const k in prev) next[k] = [...prev[k]];
        next[targetKey] = (next[targetKey] || []).filter(d => d.nombre !== draggingDoc.nombre);
        next[sourceKey] = [...(next[sourceKey] || []), draggingDoc];
        return next;
      });
    }
  };

  const crearCaja = () => {
    const nombre = nuevaCaja.trim();
    setNuevaCaja(''); setCreandoCaja(false);
    if (!nombre) return;
    const yaExiste = Object.keys(grupos).some(k => k.toLowerCase() === nombre.toLowerCase())
      || cajasVacias.some(k => k.toLowerCase() === nombre.toLowerCase());
    if (!yaExiste) setCajasVacias(prev => [...prev, nombre]);
  };

  const clavesConDocs = Object.keys(grupos).filter(k => k !== CAJA_SIN_CLASIFICAR && (grupos[k]?.length || 0) > 0).sort();
  const cajas = [CAJA_SIN_CLASIFICAR, ...clavesConDocs, ...cajasVacias.filter(c => !clavesConDocs.includes(c))];

  return (
    <div onDragEnd={handleDragEnd} className="space-y-3">
      <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPickReemplazo(f); e.target.value = ''; }} />
      <input ref={nuevoRef} type="file" multiple className="hidden" onChange={e => { const files = Array.from(e.target.files || []); if (files.length) subirNuevo(files); e.target.value = ''; }} />

      <div className="flex items-center justify-end gap-2 flex-wrap">
        {docs.length > 0 && (
          creandoCaja ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus value={nuevaCaja} onChange={e => setNuevaCaja(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') crearCaja(); if (e.key === 'Escape') { setNuevaCaja(''); setCreandoCaja(false); } }}
                placeholder="Nombre de la caja"
                aria-label="Nombre de la caja nueva"
                className="h-8 text-[13px] px-2.5 border border-slate-300 rounded-lg focus:outline-none focus:border-marca focus:ring-2 focus:ring-marca/15 w-44 dark:bg-slate-950 dark:border-slate-700"
              />
              <button type="button" onClick={crearCaja} title="Crear" className={`${ACCION} !text-marca`}><Check size={16} /></button>
              <button type="button" onClick={() => { setNuevaCaja(''); setCreandoCaja(false); }} title="Cancelar" className={ACCION}><X size={16} /></button>
            </div>
          ) : (
            <Boton tamano="sm" icono={<FolderPlus size={15} />} onClick={() => setCreandoCaja(true)}>Nueva caja</Boton>
          )
        )}
        <Boton variante="primario" tamano="sm" onClick={() => nuevoRef.current?.click()} disabled={!!subiendoNuevo}
          icono={subiendoNuevo ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}>
          {subiendoNuevo ? `Subiendo ${subiendoNuevo.actual}/${subiendoNuevo.total}…` : 'Subir documentos'}
        </Boton>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center dark:border-slate-700">
          <p className="text-sm font-medium text-tinta dark:text-slate-100">Todavía no hay documentos para la oferta</p>
          <p className="mt-1 text-[13px] text-tinta-2 dark:text-slate-400">Sube los que presentarás a Mercado Público, o arrástralos desde tu computador.</p>
        </div>
      ) : (
        <div className="columns-1 md:columns-2 2xl:columns-3 gap-3">
          {cajas.map(key => (
            <CajaPropiaDroppable
              key={key}
              cajaKey={key}
              label={key === CAJA_SIN_CLASIFICAR ? 'Sin clasificar' : key}
              docs={grupos[key] || []}
              isDragOver={dragOver === key}
              isDraggingActive={!!draggingDoc}
              draggingDoc={draggingDoc}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onView={(doc) => onView({ nombre: doc.nombre, url: urlDe(doc) })}
              onDownloadClick={(doc) => registrarVerDocumento(codigoDecoded, doc.nombre, 'Descargó')}
              onReemplazar={(doc) => { docReemplazarRef.current = doc; fileRef.current?.click(); }}
              onRenombrarClick={(doc) => { setEditando(doc.nombre); setValorNombre(doc.nombre); }}
              onEliminar={eliminar}
              editando={editando}
              valorNombre={valorNombre}
              onGuardarNombre={guardarNombre}
              onCancelarEdicion={() => setEditando(null)}
              onChangeValorNombre={setValorNombre}
              ocupado={ocupado}
              urlsEnAuditor={urlsEnAuditor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DocumentosSection({
  codigoDecoded, documentosCache, cargandoDocs,
  descargandoAuto, handleAutoDescargar, fetchDocumentos,
  clasificando, onReClasificar, resumenClasificacion,
  negocioId,
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
  // Presente solo dentro de un negocio (nunca al mirar una licitación suelta) — muestra en cada
  // documento si ya está en el Auditor Técnico y en qué estado.
  negocioId?: number | null;
}) {
  // Separar anexos: admin o permiso "Anexos" (05-oct-2026).
  const { usuario } = useSession();
  const isAdmin = usuario?.rol === 'admin';
  const puedeAnexos = isAdmin || !!usuario?.permisos?.anexos;
  const yaClasificados = documentosCache.some(d => (d as any).categoria);
  // Separación en dos apartados: "Documentos y Bases" (los de la licitación) vs "Documentos Propios"
  // (los que NOSOTROS creamos o editamos: costeo, informe, y lo que subamos).
  const docsLicitacion = documentosCache.filter(d => ((d as any).categoria || '').toUpperCase() !== 'DOCUMENTOS_PROPIOS');
  const docsPropios = documentosCache.filter(d => ((d as any).categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS');
  // URLs que YA están en el Auditor Técnico de este negocio, con su estado (pedido del usuario,
  // 7-sep-2026). Se relee EN VIVO (nunca una marca guardada en el documento) para que quede al día
  // si el punto del checklist se borra o el documento se reemplaza — ver /comercial/documentos-auditor.
  const [urlsEnAuditor, setUrlsEnAuditor] = useState<Map<string, EstadoAuditor>>(new Map());
  const refrescarUrlsAuditor = () => {
    if (!negocioId) { setUrlsEnAuditor(new Map()); return; }
    fetch(`/api/negocios/${negocioId}/comercial/documentos-auditor`)
      .then(r => r.json())
      .then(d => { if (d?.success) setUrlsEnAuditor(new Map(Object.entries((d.estados || {}) as Record<string, EstadoAuditor>))); })
      .catch(() => {});
  };
  useEffect(refrescarUrlsAuditor, [negocioId]);
  // Tiempo real: cuando el auditor aprueba/observa un punto, el estado del documento cambia solo.
  useRealtime(refrescarUrlsAuditor);

  // Documento abierto en el visor inline (modal). null = cerrado.
  const [visorDoc, setVisorDoc] = useState<VisorDoc | null>(null);
  // Ver un documento: abre el visor Y registra la actividad "Vio el documento" (bitácora).
  const verYRegistrar = (doc: VisorDoc) => { registrarVerDocumento(codigoDecoded, doc.nombre, 'Vio'); setVisorDoc(doc); };
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

  const costeo = !clasificando ? documentosCache.find(d => d.nombre?.includes('COSTEO_') && (d as any).categoria === 'DOCUMENTOS_PROPIOS') : undefined;
  const BLOQUE = 'bg-white border border-linea rounded-2xl shadow-tarjeta p-5 dark:bg-slate-900 dark:border-slate-800';
  const ICONO = 'w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0 dark:bg-slate-800 dark:text-slate-400';

  return (
    <div className="space-y-4">
      {/* ── Encabezado: qué hay y cómo traer las bases ── */}
      <section className={BLOQUE}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className={ICONO}><FolderOpen size={18} /></span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50">Documentos de la licitación</h2>
              <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
                {cargandoDocs ? 'Cargando…' : `${docsLicitacion.length} documento${docsLicitacion.length !== 1 ? 's' : ''}`}
                {yaClasificados && ' · ordenados por tipo'}
                {' · arrastra entre cajas para reordenar'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Boton variante="fantasma" tamano="sm" onClick={fetchDocumentos} title="Recargar documentos" aria-label="Recargar documentos" icono={<RefreshCw size={15} />} />
            {onReClasificar && !clasificando && documentosCache.length > 0 && (
              <Boton tamano="sm" onClick={onReClasificar} title="Volver a ordenar los documentos por tipo">Re-clasificar</Boton>
            )}
            <Boton variante="primario" tamano="sm" onClick={handleAutoDescargar} disabled={descargandoAuto}
              icono={descargandoAuto ? <Loader2 size={15} className="animate-spin" /> : <CloudDownload size={15} />}>
              {descargandoAuto ? 'Conectando con Mercado Público…' : 'Descargar bases de Mercado Público'}
            </Boton>
          </div>
        </div>

        {(descargandoAuto || clasificando || costeo || (!clasificando && resumenClasificacion?.estado === 'incompleto' && resumenClasificacion.falta.length > 0)) && (
          <div className="mt-4 space-y-2.5">
            {/* Progreso — descarga o clasificación (la descarga tiene prioridad visual) */}
            {descargandoAuto ? (
              <ProgresoBanner fase="descargando" totalDocs={documentosCache.length} />
            ) : clasificando ? (
              <ProgresoBanner fase="clasificando" totalDocs={documentosCache.length} />
            ) : null}

            {/* Costeo generado — aparece cuando hay un COSTEO_ en DOCUMENTOS_PROPIOS */}
            {costeo && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
                <span className="w-8 h-8 rounded-lg bg-white text-exito flex items-center justify-center flex-shrink-0 shadow-tarjeta dark:bg-slate-900"><TableProperties size={16} /></span>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[13px] font-medium text-tinta dark:text-slate-100">Excel de costeo generado</p>
                  <p className="text-xs text-tinta-2 dark:text-slate-400 truncate">{costeo.nombre} · en Documentos para Mercado Público</p>
                  {costeoError && <p className="text-xs text-urgente mt-1">{costeoError}</p>}
                </div>
                <Boton tamano="sm" onClick={handleRegenerarCosteo} disabled={regenerandoCosteo}
                  title="Regenerar el Excel desde el informe guardado (sin volver a analizar)"
                  icono={regenerandoCosteo ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}>
                  {regenerandoCosteo ? 'Regenerando…' : 'Regenerar'}
                </Boton>
                <a href={urlDescarga((costeo as any).url_local || (costeo as any).url)} download={costeo.nombre}
                  className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium bg-marca text-white hover:bg-marca-fuerte shadow-tarjeta transition-colors duration-150">
                  <Download size={15} /> Descargar
                </a>
              </div>
            )}

            {/* Set incompleto */}
            {!clasificando && resumenClasificacion?.estado === 'incompleto' && resumenClasificacion.falta.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
                <AlertTriangle size={16} className="text-alerta flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[13px] font-medium text-amber-900 dark:text-amber-200">Faltan documentos en el set</p>
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                    No se detectaron: {resumenClasificacion.falta.map(f => f.replace(/_/g, ' ').toLowerCase()).join(', ')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Las cajas (con su botón de subida manual) se muestran SIEMPRE, incluso sin un solo
          documento todavía: es el único lugar para subir el primer documento a mano sin esperar
          la descarga automática (reportado 24-ago-2026). */}
      {cargandoDocs ? (
        <div className="columns-1 md:columns-2 2xl:columns-3 gap-3">
          {[0, 1, 2].map(k => (
            <div key={k} className={`${CAJA_BASE} border-linea p-4 space-y-3 dark:border-slate-800`}>
              <Esqueleto className="h-5 w-40" /><Esqueleto className="h-9 w-full" /><Esqueleto className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <DocumentosGrid
          documentos={docsLicitacion as DocLicitacion[]}
          codigoDecoded={codigoDecoded}
          onView={verYRegistrar}
          onOpenIA={setIaDoc}
          onRefrescar={fetchDocumentos}
          onSepararAnexo={puedeAnexos ? true : undefined}
          modo="licitacion"
          urlsEnAuditor={urlsEnAuditor}
        />
      )}

      {/* ── DOCUMENTOS PARA MERCADO PÚBLICO ── (lo que NOSOTROS subimos o generamos: costeo,
          informe, anexos rellenados y los archivos que presentaremos). Siempre visible: es el
          ÚNICO lugar para subir archivos propios. */}
      <section className={BLOQUE}>
        <div className="flex items-center gap-3 mb-4">
          <span className={ICONO}><FileText size={18} /></span>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-tinta dark:text-slate-50">Documentos para Mercado Público</h2>
            <p className="text-xs text-tinta-2 dark:text-slate-400 tabular-nums">
              {docsPropios.length > 0 ? `${docsPropios.length} documento${docsPropios.length !== 1 ? 's' : ''} · ` : ''}lo que presentarás en la oferta, más el costeo y el informe generados
            </p>
          </div>
        </div>
        <DocumentosPropiosGrid
          docs={docsPropios as DocPropio[]}
          codigoDecoded={codigoDecoded}
          onView={verYRegistrar}
          onRefrescar={fetchDocumentos}
          urlsEnAuditor={urlsEnAuditor}
        />
      </section>

      {/* Visor inline de documentos (PDF/imagen/Office) — sin descargar */}
      <DocumentViewerModal doc={visorDoc} onClose={() => setVisorDoc(null)} />

      {/* Chat rápido de IA sobre un documento puntual */}
      <DocumentoIAModal doc={iaDoc} codigo={codigoDecoded} onClose={() => setIaDoc(null)} />
    </div>
  );
}
