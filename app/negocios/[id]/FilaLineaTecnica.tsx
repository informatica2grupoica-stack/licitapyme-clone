'use client';

// AUDITOR TÉCNICO (Fase 1) — fila del bloque TECNICO para un item tipo='linea_tecnica'.
// InformacionComercialSection.tsx renderiza esto en vez de FilaItem para esas filas.
//
// La fila es solo el resumen (para poder escanear 100+ líneas de un vistazo, ver la barra de
// InformacionComercialSection.tsx): estado, título, criticidad y "N de M cumple". El detalle —
// comparación por característica exigido/ofertado, precio y plazo de la línea, documento fuente —
// vive en ModalAuditorLineaTecnica.tsx, que se abre con "Ver comparación".
import { useState } from 'react';
import { Check, X, Wrench, Undo2, Loader2, Upload } from 'lucide-react';
import { ModalAuditorLineaTecnica } from '@/app/components/ModalAuditorLineaTecnica';
import { useToast } from '@/app/components/ui/toast';

interface ResumenTecnico { total: number; cumplen: number; noCumplen: number; conComplemento: number; sinEvaluar: number; pendientesProveedor: number }

interface ItemLineaTecnica {
  id: number;
  titulo: string;
  descripcion: string | null;
  criticidad: string;
  estado: 'PENDIENTE' | 'CARGADO' | 'APROBADO' | 'OBSERVADO';
  resumen_tecnico: ResumenTecnico | null;
}

// ════════════════════════════════════════════════════════════════════════════════
export function FilaLineaTecnica({ item, negocioId, licitacionCodigo, puedeAprobar, bloqueado, ocupado, fueraDeLaOferta = false, onAccion }: {
  item: ItemLineaTecnica;
  negocioId: number;
  licitacionCodigo: string;
  puedeAprobar: boolean;
  bloqueado: boolean;
  ocupado: boolean;
  /** La línea quedó fuera del selector de líneas a ofertar: se muestra, pero atenuada y sin
   *  contar para el avance. NO se oculta — si ya traía características comparadas o aprobadas,
   *  esconderla haría desaparecer de la vista trabajo que sigue existiendo en la base. */
  fueraDeLaOferta?: boolean;
  onAccion: (itemId: number, accion: string, extra?: Record<string, unknown>) => Promise<boolean>;
}) {
  const toast = useToast();
  const [modalAbierto, setModalAbierto] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendoFicha, setSubiendoFicha] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  const resumen = item.resumen_tecnico;
  const puedeSoltar = !bloqueado && !ocupado && !subiendoFicha;
  const base = `/api/negocios/${negocioId}/comercial/${item.id}/caracteristicas`;

  // Sube y compara, EN LA LÍNEA, una o varias fichas soltadas encima de la fila — sin pasar por
  // el modal. Antes la única forma de cargar la ficha de una línea era el botón "Comparar contra
  // un documento" del bloque completo, que comparaba UN documento contra TODAS las líneas a la
  // vez: si esa ficha era de una sola línea, las demás salían con falsos "0 de N cumple" (ver
  // memoria project_ficha_por_linea_ago2026). Acá el documento nunca sale de ESTA línea.
  //
  // Varios archivos a la vez porque una línea puede traer más de un producto (hasta 30+ bajo la
  // misma línea de precio) — cada ficha se compara una por una, en orden, contra el trozo de
  // texto que le corresponde a su producto (ver comparar_ficha en el route de características).
  const procesarFichasSoltadas = async (files: FileList) => {
    setSubiendoFicha(true);
    try {
      if (!resumen || resumen.total === 0) {
        setProgreso('Clasificando las características de las bases…');
        const rVal = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'validar' }) });
        const dVal = await rVal.json().catch(() => ({}));
        if (!rVal.ok) { toast.error(dVal.error || 'No se pudo clasificar la línea'); return; }
      }

      const lista = Array.from(files);
      let comparadas = 0;
      for (let i = 0; i < lista.length; i++) {
        const file = lista[i];
        setProgreso(lista.length > 1 ? `Comparando ${i + 1}/${lista.length}: ${file.name}` : `Comparando "${file.name}"…`);
        const fd = new FormData();
        fd.append('licitacionCodigo', licitacionCodigo);
        fd.append('files', file);
        const rSubida = await fetch('/api/documentos/subir', { method: 'POST', body: fd });
        const dSubida = await rSubida.json().catch(() => ({}));
        if (!rSubida.ok || !dSubida.documentos?.length) { toast.error(dSubida.error || `No se pudo subir "${file.name}"`); continue; }
        const doc = dSubida.documentos[0];
        const rComp = await fetch(base, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'comparar_ficha', documentoUrl: doc.url, documentoNombre: doc.nombre }),
        });
        const dComp = await rComp.json().catch(() => ({}));
        if (!rComp.ok) { toast.error(dComp.error || `No se pudo comparar "${file.name}"`); continue; }
        comparadas++;
      }
      if (comparadas > 0) toast.success(comparadas === 1 ? 'Ficha comparada' : `${comparadas} fichas comparadas`, item.titulo);
    } catch (e) {
      toast.error('Error de red', String(e));
    } finally {
      setSubiendoFicha(false);
      setProgreso(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    if (!puedeSoltar) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) procesarFichasSoltadas(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={e => { if (puedeSoltar) { e.preventDefault(); setArrastrando(true); } }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={onDrop}
      className={`px-4 py-3 transition-colors ${item.estado === 'OBSERVADO' ? 'bg-orange-50/40' : ''} ${fueraDeLaOferta ? 'opacity-55' : ''} ${arrastrando ? 'bg-violet-50 ring-2 ring-inset ring-violet-300' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          {item.estado === 'APROBADO'
            ? <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><Check size={12} className="text-white" /></div>
            : item.estado === 'OBSERVADO'
              ? <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center"><X size={12} className="text-white" /></div>
              : <div className={`w-5 h-5 rounded-full border-2 ${item.estado === 'CARGADO' ? 'border-indigo-400 bg-indigo-50' : 'border-zinc-200'}`} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-zinc-800 leading-snug flex items-center gap-1.5">
            <Wrench size={12} className="text-zinc-400 flex-shrink-0" />
            {item.titulo}
            {fueraDeLaOferta && (
              <span className="flex-shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
                Fuera de la oferta
              </span>
            )}
          </p>
          <div className="mt-1">
            {resumen && resumen.total > 0 ? (
              <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${
                resumen.noCumplen > 0 ? 'bg-rose-100 text-rose-700'
                : (resumen.conComplemento > 0 || resumen.pendientesProveedor > 0) ? 'bg-amber-100 text-amber-700'
                : 'bg-emerald-100 text-emerald-700'
              }`}>
                {resumen.cumplen} de {resumen.total} cumple
                {resumen.noCumplen > 0 && ` · ${resumen.noCumplen} no cumple`}
                {resumen.conComplemento > 0 && ` · ${resumen.conComplemento} con complemento`}
                {resumen.pendientesProveedor > 0 && ` · ${resumen.pendientesProveedor} por confirmar`}
              </span>
            ) : (
              <span className="inline-block text-[11px] font-medium text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">Sin validar todavía</span>
            )}
          </div>
          {item.descripcion && <p className="text-[11.5px] text-zinc-500 leading-snug mt-1">{item.descripcion}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 ml-8 flex-wrap">
        <button onClick={() => setModalAbierto(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold text-violet-600 hover:bg-violet-50 rounded-lg transition-colors">
          Ver comparación
        </button>

        {puedeAprobar && item.estado === 'CARGADO' && (
          <button onClick={() => onAccion(item.id, 'APROBAR')} disabled={ocupado}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold rounded-lg disabled:opacity-50 transition-colors">
            {ocupado ? <Loader2 size={11} className="animate-spin" /> : <Check size={12} />} Aprobar línea
          </button>
        )}
        {puedeAprobar && item.estado === 'APROBADO' && (
          <button onClick={() => onAccion(item.id, 'REABRIR')} title="Reabrir esta línea"
            className="p-1.5 text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors">
            <Undo2 size={13} />
          </button>
        )}

        {subiendoFicha || arrastrando ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-600">
            {subiendoFicha ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {progreso || 'Suelta la(s) ficha(s) técnica(s) acá'}
          </span>
        ) : !bloqueado && (
          // Pista permanente, tenue: sin esto no hay ninguna señal en la fila de que se puede
          // arrastrar la ficha del proveedor directo acá — la única pista era el comentario en
          // el código, invisible para quien usa la pantalla.
          <span className="inline-flex items-center gap-1 text-[10.5px] text-zinc-300">
            <Upload size={10} /> o arrastra la ficha técnica acá
          </span>
        )}
      </div>

      {modalAbierto && (
        <ModalAuditorLineaTecnica
          negocioId={negocioId}
          itemId={item.id}
          licitacionCodigo={licitacionCodigo}
          puedeAprobar={puedeAprobar}
          bloqueado={bloqueado}
          onClose={() => setModalAbierto(false)}
          onAccion={onAccion}
        />
      )}
    </div>
  );
}
