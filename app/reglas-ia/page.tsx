'use client';

// Pantalla de reglas aprendidas de viabilidad (spec v4.0, P12). SOLO "CA" (permiso `reglas_ia`).
// Lista TODAS las reglas emitidas —activas e inactivas— con su origen, el comentario original y
// cuántos análisis las usaron. Desactivar es de un clic y la regla queda en el historial. Las
// `sin_destilar` (la IA no pudo convertir el comentario en regla) no se inyectan hasta que CA
// escribe la regla y la aprueba aquí.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { IconBrain as Brain, IconLoader2 as Loader2, IconPlayerPause as Pausa, IconPlayerPlay as Play, IconCheck as Check } from '@tabler/icons-react';

interface Regla {
  id: number; ambito: string; activa: boolean; sin_destilar: boolean; created_at: string;
  licitacion_codigo: string; autor: string | null; veredicto_ia: string | null; comentario: string; regla: string;
  desactivada_por: string | null; desactivada_en: string | null; veces_usada: number;
}

type FiltroTipo = 'todas' | 'global' | 'lectura';
type FiltroEstado = 'todas' | 'activas' | 'inactivas' | 'sin_destilar';
const fecha = (s: string) => new Date(s).toLocaleDateString('es-CL', { dateStyle: 'medium' });

export default function ReglasIAPage() {
  const { usuario, cargando } = useSession();
  const { error: toastError, success } = useToast();
  const [reglas, setReglas] = useState<Regla[] | null>(null);
  const [tipo, setTipo] = useState<FiltroTipo>('todas');
  const [estado, setEstado] = useState<FiltroEstado>('activas');
  const [trabajando, setTrabajando] = useState<number | null>(null);
  const [borrador, setBorrador] = useState<Record<number, string>>({});
  const esCA = !!usuario?.permisos?.reglas_ia;

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/viabilidad/reglas').then(x => x.json());
      if (r.success) setReglas(r.reglas); else { setReglas([]); toastError(r.error || 'No se pudieron leer las reglas'); }
    } catch { setReglas([]); toastError('No se pudieron leer las reglas'); }
  }, [toastError]);
  useEffect(() => { if (esCA) cargar(); }, [esCA, cargar]);

  const patch = async (id: number, body: object, ok: string) => {
    setTrabajando(id);
    try {
      const r = await fetch('/api/viabilidad/reglas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) }).then(x => x.json());
      if (r.success) { setReglas(r.reglas); success(ok); } else toastError(r.error || 'No se pudo actualizar');
    } catch { toastError('No se pudo actualizar'); }
    setTrabajando(null);
  };

  const visibles = useMemo(() => (reglas || []).filter(r =>
    (tipo === 'todas' || r.ambito === tipo) &&
    (estado === 'todas' || (estado === 'activas' && r.activa && !r.sin_destilar) || (estado === 'inactivas' && !r.activa) || (estado === 'sin_destilar' && r.sin_destilar && r.activa))
  ), [reglas, tipo, estado]);
  const nSin = (reglas || []).filter(r => r.sin_destilar && r.activa).length;

  const chip = (act: boolean) => `px-3 py-1.5 rounded-full text-[12px] font-semibold border transition ${act ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`;

  return (
    <AppLayout breadcrumb={[{ label: 'Reglas de la IA' }]}>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center gap-2 mb-1"><Brain size={22} className="text-indigo-600" /><h1 className="text-xl font-bold text-slate-800">Reglas que aprende la IA de viabilidad</h1></div>
        <p className="text-sm text-slate-500 mb-5">Solo CA ve y crea estas reglas. Una regla enseña qué <b>leer, reportar o advertir</b>; nunca mueve el nivel de atractivo ni cómo se adjudica (eso lo decide el sistema). Desactivar una regla la deja en el historial.</p>

        {cargando ? <Loader2 className="animate-spin text-slate-400" /> : !esCA ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Esta pantalla es solo para CA. Si debería tener acceso, pídele al administrador el permiso «Reglas de la IA (CA)» en Usuarios.</div>
        ) : reglas === null ? <Loader2 className="animate-spin text-slate-400" /> : (
          <>
            {nSin > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-4 text-sm text-amber-800">
                {nSin} {nSin === 1 ? 'regla quedó' : 'reglas quedaron'} sin convertir (la IA no pudo expresarla como regla general). No se usan hasta que escribas la regla y la apruebes.
              </div>
            )}
            <div className="flex flex-wrap gap-2 mb-4">
              {(['todas', 'global', 'lectura'] as FiltroTipo[]).map(t => <button key={t} className={chip(tipo === t)} onClick={() => setTipo(t)}>{t === 'todas' ? 'Todos los tipos' : t === 'global' ? 'Viabilidad' : 'Lectura'}</button>)}
              <span className="w-px bg-slate-200 mx-1" />
              {(['activas', 'inactivas', 'sin_destilar', 'todas'] as FiltroEstado[]).map(e => <button key={e} className={chip(estado === e)} onClick={() => setEstado(e)}>{e === 'activas' ? 'Activas' : e === 'inactivas' ? 'Inactivas' : e === 'sin_destilar' ? 'Sin convertir' : 'Todas'}</button>)}
            </div>

            {visibles.length === 0 ? <p className="text-sm text-slate-500">No hay reglas con ese filtro.</p> : (
              <ul className="space-y-3">
                {visibles.map(r => (
                  <li key={r.id} className={`rounded-xl border p-4 ${r.activa ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-80'}`}>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] mb-2">
                      <span className={`px-2 py-0.5 rounded-full font-bold ${r.ambito === 'lectura' ? 'bg-cyan-100 text-cyan-700' : 'bg-indigo-100 text-indigo-700'}`}>{r.ambito === 'lectura' ? 'Lectura' : 'Viabilidad'}</span>
                      <span className={`px-2 py-0.5 rounded-full font-bold ${r.activa ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{r.activa ? 'Activa' : 'Inactiva'}</span>
                      {r.sin_destilar && <span className="px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-700">Sin convertir</span>}
                      <span className="text-slate-500">{fecha(r.created_at)} · {r.licitacion_codigo}{r.autor ? ` · ${r.autor}` : ''}</span>
                      <span className="ml-auto text-slate-500">Usada en {r.veces_usada} {r.veces_usada === 1 ? 'análisis' : 'análisis'}</span>
                    </div>

                    {r.sin_destilar ? (
                      <div className="space-y-2">
                        <p className="text-[13px] text-slate-600"><b>Comentario original:</b> {r.comentario}</p>
                        <textarea className="w-full rounded-lg border border-slate-300 p-2 text-[13px]" rows={2} maxLength={400}
                          placeholder="Escribe la regla general (condicional: «Si las bases … entonces …»), máx. 240 caracteres"
                          value={borrador[r.id] ?? ''} onChange={e => setBorrador(b => ({ ...b, [r.id]: e.target.value }))} />
                        <button disabled={trabajando === r.id || (borrador[r.id] || '').trim().length < 8} onClick={() => patch(r.id, { regla: borrador[r.id] }, 'Regla aprobada')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold disabled:opacity-40"><Check size={14} /> Aprobar regla</button>
                      </div>
                    ) : (
                      <>
                        <p className="text-[14px] text-slate-800 font-medium">{r.regla}</p>
                        <p className="text-[12px] text-slate-500 mt-1"><b>Comentario original:</b> {r.comentario}</p>
                        {r.veredicto_ia && <p className="text-[12px] text-slate-400 mt-0.5">Nivel que vio CA: {r.veredicto_ia}</p>}
                      </>
                    )}

                    <div className="flex items-center gap-3 mt-3">
                      {r.activa
                        ? <button disabled={trabajando === r.id} onClick={() => patch(r.id, { activa: false }, 'Regla desactivada')} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-40"><Pausa size={14} /> Desactivar</button>
                        : <button disabled={trabajando === r.id} onClick={() => patch(r.id, { activa: true }, 'Regla activada')} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-40"><Play size={14} /> Volver a activar</button>}
                      {!r.activa && r.desactivada_en && <span className="text-[11px] text-slate-500">Desactivada {fecha(r.desactivada_en)}{r.desactivada_por ? ` por ${r.desactivada_por}` : ''}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
