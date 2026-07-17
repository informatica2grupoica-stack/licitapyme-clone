'use client';

// Modal bloqueante: al entrar a la plataforma, si el usuario tiene negocios cuyo
// plazo de postulación YA venció y siguen en un estado intermedio del pipeline,
// se le exige resolver cada uno (se postuló o se descartó, con su motivo) antes
// de poder seguir usando la app. No tiene botón de cerrar ni cierra con el fondo.

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Loader2, Send, Ban, Building2, CalendarClock } from 'lucide-react';
import { useSession } from '@/app/lib/session-context';
import { getEstadoPipeline } from '@/app/lib/pipeline';
import { MOTIVOS_DESCARTE, componerMotivo } from '@/app/lib/motivos-descarte';
import { Select } from '@/app/components/ui/Select';

interface Pendiente {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_cierre: string | null;
  estado_pipeline: string;
  usuario_nombre: string | null;
  usuario_email: string | null;
}

type Resolucion = 'postulo' | 'descarto';

function PendienteCard({ p, onResuelto }: { p: Pendiente; onResuelto: (id: number) => void }) {
  const [resolucion, setResolucion] = useState<Resolucion | null>(null);
  const [estadoPostulado, setEstadoPostulado] = useState('POSTULADA');
  const [motivoSel, setMotivoSel] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const pipeline = getEstadoPipeline(p.estado_pipeline);
  const cierre = p.licitacion_cierre
    ? new Date(p.licitacion_cierre).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  const guardar = async () => {
    if (!resolucion) return;
    const m = motivo.trim();
    if (resolucion === 'descarto') {
      if (!motivoSel) { setError('Selecciona el motivo del descarte'); return; }
      if (motivoSel === 'Otro' && !m) { setError('Describe el motivo del descarte'); return; }
    } else if (!m) {
      setError('Indica un comentario (n° de oferta, quién postuló, etc.)'); return;
    }
    setGuardando(true);
    setError('');
    try {
      const estado = resolucion === 'descarto' ? 'DESCARTADA' : estadoPostulado;
      const res = await fetch(`/api/negocios/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estado_pipeline: estado,
          motivo: resolucion === 'descarto' ? componerMotivo(motivoSel, m) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      // Si se postuló, el "por qué / cómo" queda en el hilo de comentarios.
      if (resolucion === 'postulo') {
        try {
          await fetch(`/api/negocios/${p.id}/comentarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comentario: `Postulada (plazo vencido, cierre de ciclo): ${m}` }),
          });
        } catch { /* no bloquea la resolución */ }
      }
      onResuelto(p.id);
    } catch (e: any) {
      setError(e.message);
      setGuardando(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-mono text-slate-400">{p.licitacion_codigo}</p>
          <p className="text-[13.5px] font-bold text-slate-800 leading-snug">{p.licitacion_nombre || p.licitacion_codigo}</p>
          {p.licitacion_organismo && (
            <p className="text-[11.5px] text-slate-500 mt-0.5 flex items-center gap-1">
              <Building2 size={11} className="flex-shrink-0" /> {p.licitacion_organismo}
            </p>
          )}
        </div>
        {pipeline && (
          <span style={{ backgroundColor: pipeline.color + '18', color: pipeline.color, borderColor: pipeline.color + '40' }}
            className="text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0">
            {pipeline.label}
          </span>
        )}
      </div>

      <p className="text-[11.5px] text-red-600 font-semibold mt-2 flex items-center gap-1.5">
        <CalendarClock size={12} /> Cerró el {cierre} — plazo de postulación vencido
      </p>

      {/* Resolución */}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => { setResolucion('postulo'); setError(''); }}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold border transition-colors ${
            resolucion === 'postulo'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
          }`}
        >
          <Send size={13} /> Se postuló
        </button>
        <button
          onClick={() => { setResolucion('descarto'); setError(''); }}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-semibold border transition-colors ${
            resolucion === 'descarto'
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-white text-slate-600 border-slate-200 hover:border-red-300'
          }`}
        >
          <Ban size={13} /> Se descartó
        </button>
      </div>

      {resolucion && (
        <div className="mt-3 space-y-2.5">
          {resolucion === 'postulo' && (
            <Select
              value={estadoPostulado}
              onChange={setEstadoPostulado}
              options={[{ value: 'POSTULADA', label: 'Postulada' }]} />
          )}
          {resolucion === 'descarto' && (
            <Select
              value={motivoSel}
              onChange={setMotivoSel}
              placeholder="— Selecciona el motivo del descarte —"
              options={MOTIVOS_DESCARTE.map(m => ({ value: m, label: m }))} />
          )}
          <textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            rows={2}
            placeholder={resolucion === 'descarto'
              ? (motivoSel === 'Otro' ? 'Describe el motivo (obligatorio)…' : 'Comentarios adicionales (opcional)…')
              : '¿Cómo se postuló? Comentario obligatorio (n° oferta, monto, responsable)…'}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          {error && <p className="text-[11.5px] text-red-600 font-medium">{error}</p>}
          <button
            onClick={guardar}
            disabled={guardando || (resolucion === 'descarto' ? (!motivoSel || (motivoSel === 'Otro' && !motivo.trim())) : !motivo.trim())}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors disabled:bg-slate-300 ${
              resolucion === 'descarto' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : null}
            {resolucion === 'descarto' ? 'Confirmar descarte' : 'Confirmar postulación'}
          </button>
        </div>
      )}
    </div>
  );
}

export function CierreVencidoModal() {
  const { usuario } = useSession();
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [cargado, setCargado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/negocios/vencidas-pendientes');
      const data = await res.json();
      if (data.success) setPendientes(data.pendientes || []);
    } catch { /* no bloquear la app si el endpoint falla */ }
    finally { setCargado(true); }
  }, []);

  useEffect(() => { if (usuario) cargar(); }, [usuario, cargar]);

  const resolver = (id: number) => setPendientes(prev => prev.filter(p => p.id !== id));

  if (!cargado || pendientes.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-50 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header — sin botón de cerrar: es obligatorio resolver */}
        <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-start gap-3 flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-slate-900">
              {pendientes.length === 1 ? 'Hay 1 licitación vencida sin resolver' : `Hay ${pendientes.length} licitaciones vencidas sin resolver`}
            </h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              El plazo de postulación ya venció. Para continuar debes indicar si <strong>se postuló</strong> o
              <strong> se descartó</strong> (y por qué). Esto mantiene el pipeline al día.
            </p>
          </div>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {pendientes.map(p => (
            <PendienteCard key={p.id} p={p} onResuelto={resolver} />
          ))}
        </div>
      </div>
    </div>
  );
}
