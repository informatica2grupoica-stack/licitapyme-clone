'use client';

// Mi equipo: el admin de la empresa agrega a las personas de su empresa, dentro del tope de su plan.
import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast } from '@/app/components/ui/toast';

interface Persona { id: number; nombre: string | null; email: string; rol: string; activo: number; ultimo_login: string | null }
const input = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';

export default function EquipoPage() {
  const toast = useToast();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [max, setMax] = useState<number | null>(null);
  const [admin, setAdmin] = useState(false);
  const [f, setF] = useState({ nombre: '', email: '', clave: '' });
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/equipo'); const d = await r.json().catch(() => ({}));
    if (r.ok) { setPersonas(d.personas); setMax(d.maxUsuarios); setAdmin(d.puedeAdministrar); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const activos = personas.filter(p => p.activo).length;
  const lleno = max != null && activos >= max;

  const agregar = async () => {
    setEnviando(true);
    const r = await fetch('/api/equipo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
    const d = await r.json().catch(() => ({})); setEnviando(false);
    if (!r.ok) { toast.error('No se agregó', d.error || `HTTP ${r.status}`); return; }
    toast.success('Persona agregada', 'Entra con su correo y la clave temporal.'); setF({ nombre: '', email: '', clave: '' }); cargar();
  };
  const cambiarActivo = async (p: Persona) => {
    const r = await fetch('/api/equipo', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.id, activo: !p.activo }) });
    if (!r.ok) toast.error('No se pudo cambiar', (await r.json().catch(() => ({}))).error || ''); else cargar();
  };

  return (
    <AppLayout breadcrumb={[{ label: 'Mi equipo' }]}>
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
        <header>
          <h1 className="text-lg font-medium text-slate-900">Mi equipo</h1>
          <p className="text-sm text-slate-500">{activos} de {max ?? '∞'} personas activas en tu plan.</p>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-100">
            {personas.map(p => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{p.nombre || p.email}</p>
                  <p className="text-xs text-slate-500">{p.email} · {p.rol === 'admin' ? 'Admin' : 'Usuario'}{p.activo ? '' : ' · desactivado'}</p>
                </div>
                {admin && p.rol !== 'admin' && (
                  <button onClick={() => cambiarActivo(p)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    {p.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {admin && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-medium text-slate-900">Agregar una persona</h2>
            {lleno ? (
              <p className="mt-1 text-sm text-slate-500">Llegaste al tope de tu plan. Para sumar más personas, escríbenos.</p>
            ) : (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="text-[11px] text-slate-500">Nombre<input className={`${input} mt-0.5`} value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} /></label>
                  <label className="text-[11px] text-slate-500">Correo (su usuario)<input type="email" className={`${input} mt-0.5`} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
                  <label className="text-[11px] text-slate-500">Clave temporal (mín. 8)<input className={`${input} mt-0.5`} value={f.clave} onChange={e => setF({ ...f, clave: e.target.value })} /></label>
                </div>
                <button disabled={enviando || !f.email || f.clave.length < 8} onClick={agregar}
                  className="mt-3 rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">Agregar</button>
              </>
            )}
          </section>
        )}
      </div>
    </AppLayout>
  );
}
