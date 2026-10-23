'use client';

// Perfil de negocio de la empresa-cliente: lo que la IA usa para dictaminar si una licitación le conviene.
import { useEffect, useState } from 'react';
import { useSession } from '@/app/lib/session-context';

export interface Perfil { descripcion: string; rubros: string; productos_si: string; productos_no: string; monto_min: number | null; monto_max: number | null; regiones: string; reglas: string }
export const PERFIL_VACIO: Perfil = { descripcion: '', rubros: '', productos_si: '', productos_no: '', monto_min: null, monto_max: null, regiones: '', reglas: '' };
const campo = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';

export function PerfilEmpresaForm() {
  const { usuario } = useSession();
  const esAdmin = usuario?.rol === 'admin';
  const [p, setP] = useState<Perfil>(PERFIL_VACIO);
  const [msg, setMsg] = useState('');
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    fetch('/api/cv/perfil').then(r => r.json()).then(d => { if (d.perfil) setP({ ...PERFIL_VACIO, ...d.perfil }); }).finally(() => setCargando(false));
  }, []);
  const guardar = async () => {
    const r = await fetch('/api/cv/perfil', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
    setMsg(r.ok ? 'Perfil guardado.' : (await r.json().catch(() => ({}))).error || 'No se pudo guardar');
  };
  if (cargando) return <p className="text-sm text-slate-500">Cargando…</p>;
  const lock = !esAdmin;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-[11px] text-slate-500 sm:col-span-2">Qué hace tu empresa<textarea disabled={lock} rows={2} className={`${campo} mt-0.5`} value={p.descripcion} onChange={e => setP({ ...p, descripcion: e.target.value })} /></label>
      <label className="text-[11px] text-slate-500">Rubros (separados por coma)<input disabled={lock} className={`${campo} mt-0.5`} value={p.rubros} onChange={e => setP({ ...p, rubros: e.target.value })} /></label>
      <label className="text-[11px] text-slate-500">Regiones donde puedes entregar<input disabled={lock} className={`${campo} mt-0.5`} value={p.regiones} onChange={e => setP({ ...p, regiones: e.target.value })} /></label>
      <label className="text-[11px] text-slate-500">Productos o servicios que SÍ ofreces <b className="text-teal-700">(lo más importante)</b>
        <textarea disabled={lock} rows={4} placeholder="Ej: refrigeradores industriales, cámaras de frío, balones, mallas, herramientas manuales…" className={`${campo} mt-0.5`} value={p.productos_si} onChange={e => setP({ ...p, productos_si: e.target.value })} /></label>
      <label className="text-[11px] text-slate-500">Que NO ofreces
        <textarea disabled={lock} rows={4} placeholder="Ej: maquinaria pesada, vehículos, obras civiles, software…" className={`${campo} mt-0.5`} value={p.productos_no} onChange={e => setP({ ...p, productos_no: e.target.value })} /></label>
      <label className="text-[11px] text-slate-500">Monto mínimo (CLP)<input disabled={lock} type="number" className={`${campo} mt-0.5`} value={p.monto_min ?? ''} onChange={e => setP({ ...p, monto_min: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      <label className="text-[11px] text-slate-500">Monto máximo (CLP)<input disabled={lock} type="number" className={`${campo} mt-0.5`} value={p.monto_max ?? ''} onChange={e => setP({ ...p, monto_max: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      <label className="text-[11px] text-slate-500 sm:col-span-2">Reglas propias (ej. «no postulamos con garantía mayor a 5%»)<textarea disabled={lock} rows={2} className={`${campo} mt-0.5`} value={p.reglas} onChange={e => setP({ ...p, reglas: e.target.value })} /></label>
      {esAdmin
        ? <div className="flex items-center gap-3 sm:col-span-2"><button onClick={guardar} className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800">Guardar perfil</button>{msg && <span className="text-xs text-slate-600">{msg}</span>}</div>
        : <p className="text-xs text-slate-500 sm:col-span-2">Solo el admin de la empresa puede editar el perfil.</p>}
    </div>
  );
}
