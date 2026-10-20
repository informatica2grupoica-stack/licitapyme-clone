'use client';

// Incidencias desde un ítem de las fichas técnicas: se eligen uno o más tipos (selector múltiple) y un comentario.
// Cada tipo se crea como una tarea de la licitación en Compras y se avisa a los encargados (campana, aviso central y correo).
import { useState } from 'react';
import { IconLoader2 as Loader2 } from '@tabler/icons-react';
import { Modal } from '@/app/components/ui/Modal';
import { MultiSelect } from '@/app/components/ui/MultiSelect';
import { useToast } from '@/app/components/ui/toast';
import { TIPOS_INCIDENCIA_FICHA } from '@/app/lib/compras-incidencias-ficha-tipos';

export function IncidenciaFichaModal({ negocioId, productos, onClose, onCreada }: {
  negocioId: number; productos: Array<{ productoId: number; descripcion: string }>; onClose: () => void; onCreada: () => void;
}) {
  const toast = useToast();
  const [tipos, setTipos] = useState<string[]>([]);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cerrar = () => { if (enviando) return; setTipos([]); setComentario(''); onClose(); };
  const enviar = async () => {
    if (productos.length === 0) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/incidencias-ficha`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoIds: productos.map(x => x.productoId), tipos, comentario }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo crear la incidencia.');
      toast.success(d.tareas === 1 ? 'Incidencia creada' : `${d.tareas} incidencias creadas`, 'Quedaron como tareas aparte y se avisó a los encargados.');
      setTipos([]); setComentario('');
      onCreada();
    } catch (e: any) {
      toast.error('No se pudo crear la incidencia', e.message);
    } finally { setEnviando(false); }
  };

  return (
    <Modal open={productos.length > 0} onClose={cerrar} size="sm" title="Crear incidencia" subtitle={productos.length === 1 ? productos[0].descripcion : `${productos.length} ítems seleccionados`}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={cerrar} className="text-[13px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
          <button type="button" onClick={enviar} disabled={enviando || tipos.length === 0 || (tipos.includes('otra') && !comentario.trim())} data-testid="incidencia-ficha-crear"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 px-4 py-2 rounded-lg">
            {enviando && <Loader2 size={13} className="animate-spin" />} Crear {tipos.length * productos.length > 1 ? `${tipos.length * productos.length} incidencias` : 'incidencia'}
          </button>
        </div>
      }>
      <div className="space-y-3">
        <p className="text-[12.5px] text-zinc-500">Elige una o más. Cada tipo, en cada ítem, se crea como una tarea aparte de esta licitación y le llega un aviso al encargado (y al coencargado) por la campana y por correo.</p>
        <MultiSelect label={tipos.length ? `${tipos.length} tipo(s) elegido(s)` : 'Tipo de incidencia'} options={TIPOS_INCIDENCIA_FICHA.map(t => ({ value: t.value, label: t.label }))}
          selected={tipos} onChange={setTipos} minWidth={320} />
        <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={4} maxLength={1500} placeholder="Comentario (qué viste, qué falta, con quién hablar…)"
          className="w-full text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-amber-500" />
      </div>
    </Modal>
  );
}
