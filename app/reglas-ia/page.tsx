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
import { Banner } from '@/app/components/ui/Banner';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { IconPlayerPause as Pausa, IconPlayerPlay as Play, IconCheck as Check, IconBrain as Brain } from '@tabler/icons-react';

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

  const chip = (act: boolean) => `h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 ${act ? 'border-marca bg-marca-suave text-marca' : 'border-linea bg-white text-tinta-2 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`;

  return (
    <AppLayout breadcrumb={[{ label: 'Reglas de la IA' }]}>
      <div className="@container max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo="Reglas que aprende la IA de viabilidad"
          descripcion="Solo CA ve y crea estas reglas. Una regla enseña qué leer, reportar o advertir; nunca mueve el nivel de atractivo ni cómo se adjudica (eso lo decide el sistema). Desactivar una regla la deja en el historial."
        />

        {cargando || (esCA && reglas === null) ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <Esqueleto key={i} className="h-24 rounded-xl" />)}</div>
        ) : !esCA ? (
          <Banner variante="warning">Esta pantalla es solo para CA. Si debería tener acceso, pídele al administrador el permiso «Reglas de la IA (CA)» en Usuarios.</Banner>
        ) : (
          <>
            {nSin > 0 && (
              <div className="mb-4">
                <Banner variante="warning">
                  {nSin} {nSin === 1 ? 'regla quedó' : 'reglas quedaron'} sin convertir (la IA no pudo expresarla como regla general). No se usan hasta que escribas la regla y la apruebes.
                </Banner>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {(['todas', 'global', 'lectura'] as FiltroTipo[]).map(t => <button key={t} aria-pressed={tipo === t} className={chip(tipo === t)} onClick={() => setTipo(t)}>{t === 'todas' ? 'Todos los tipos' : t === 'global' ? 'Viabilidad' : 'Lectura'}</button>)}
              <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" aria-hidden="true" />
              {(['activas', 'inactivas', 'sin_destilar', 'todas'] as FiltroEstado[]).map(e => <button key={e} aria-pressed={estado === e} className={chip(estado === e)} onClick={() => setEstado(e)}>{e === 'activas' ? 'Activas' : e === 'inactivas' ? 'Inactivas' : e === 'sin_destilar' ? 'Sin convertir' : 'Todas'}</button>)}
            </div>

            {visibles.length === 0 ? (
              <Vacio icono={<Brain size={28} stroke={1.75} />} titulo="No hay reglas con ese filtro" texto="Cambia el tipo o el estado para ver otras reglas." />
            ) : (
              <ul className="space-y-3">
                {visibles.map(r => (
                  <li key={r.id} className={`rounded-xl border border-linea p-4 shadow-tarjeta dark:border-slate-800 ${r.activa ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 opacity-80 dark:bg-slate-900/50'}`}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-2">
                      <span className="font-medium text-tinta dark:text-slate-200"><Estado color={r.ambito === 'lectura' ? '#0891b2' : '#0d9488'}>{r.ambito === 'lectura' ? 'Lectura' : 'Viabilidad'}</Estado></span>
                      <span className="font-medium text-tinta dark:text-slate-200"><Estado color={r.activa ? '#16a34a' : '#94a3b8'}>{r.activa ? 'Activa' : 'Inactiva'}</Estado></span>
                      {r.sin_destilar && <span className="font-medium text-alerta">Sin convertir</span>}
                      <span className="text-tinta-2 dark:text-slate-400">{fecha(r.created_at)} · {r.licitacion_codigo}{r.autor ? ` · ${r.autor}` : ''}</span>
                      <span className="ml-auto text-tinta-2 dark:text-slate-400 tabular-nums">Usada en {r.veces_usada} {r.veces_usada === 1 ? 'análisis' : 'análisis'}</span>
                    </div>

                    {r.sin_destilar ? (
                      <div className="space-y-2">
                        <p className="text-[13px] text-tinta-2 dark:text-slate-300"><b className="font-semibold text-tinta dark:text-slate-100">Comentario original:</b> {r.comentario}</p>
                        <textarea className="w-full rounded-lg border border-linea bg-white p-2.5 text-[13px] text-tinta outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" rows={2} maxLength={400}
                          aria-label="Regla general"
                          placeholder="Escribe la regla general (condicional: «Si las bases … entonces …»), máx. 240 caracteres"
                          value={borrador[r.id] ?? ''} onChange={e => setBorrador(b => ({ ...b, [r.id]: e.target.value }))} />
                        <Boton variante="primario" tamano="sm" disabled={trabajando === r.id || (borrador[r.id] || '').trim().length < 8} onClick={() => patch(r.id, { regla: borrador[r.id] }, 'Regla aprobada')} icono={<Check size={16} stroke={1.75} />}>Aprobar regla</Boton>
                      </div>
                    ) : (
                      <>
                        <p className="text-[15px] text-tinta dark:text-slate-50 font-medium">{r.regla}</p>
                        <p className="text-[13px] text-tinta-2 dark:text-slate-400 mt-1"><b className="font-semibold">Comentario original:</b> {r.comentario}</p>
                        {r.veredicto_ia && <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">Nivel que vio CA: {r.veredicto_ia}</p>}
                      </>
                    )}

                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-linea dark:border-slate-800">
                      {r.activa
                        ? <Boton variante="peligro" tamano="sm" disabled={trabajando === r.id} onClick={() => patch(r.id, { activa: false }, 'Regla desactivada')} icono={<Pausa size={16} stroke={1.75} />}>Desactivar</Boton>
                        : <Boton tamano="sm" disabled={trabajando === r.id} onClick={() => patch(r.id, { activa: true }, 'Regla activada')} icono={<Play size={16} stroke={1.75} />}>Volver a activar</Boton>}
                      {!r.activa && r.desactivada_en && <span className="text-xs text-tinta-2 dark:text-slate-400">Desactivada {fecha(r.desactivada_en)}{r.desactivada_por ? ` por ${r.desactivada_por}` : ''}</span>}
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
