'use client';

// Viabilidad IA de una empresa-cliente: su perfil (qué vende) y el dictamen de ESTA licitación para ELLA.
// Es independiente del panel de Grupo ICA.
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/app/lib/session-context';

interface Perfil { descripcion: string; rubros: string; productos_si: string; productos_no: string; monto_min: number | null; monto_max: number | null; regiones: string; reglas: string }
interface Dictamen { veredicto: 'POSTULAR' | 'EVALUAR' | 'NO_POSTULAR'; puntaje: number; resumen: string; razones: string[]; riesgos: string[]; requisitos: string[]; plazos_y_garantias: string; recomendacion: string; docsLeidos?: number }
const VACIO: Perfil = { descripcion: '', rubros: '', productos_si: '', productos_no: '', monto_min: null, monto_max: null, regiones: '', reglas: '' };
const campo = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
const ETIQ: Record<string, { txt: string; color: string }> = {
  POSTULAR: { txt: 'Conviene postular', color: 'bg-emerald-500' },
  EVALUAR: { txt: 'Evaluar con cuidado', color: 'bg-amber-500' },
  NO_POSTULAR: { txt: 'No conviene', color: 'bg-red-500' },
};

export function ViabilidadClientePanel({ codigo }: { codigo: string }) {
  const { usuario } = useSession();
  const esAdmin = usuario?.rol === 'admin';
  const [perfil, setPerfil] = useState<Perfil>(VACIO);
  const [editando, setEditando] = useState(false);
  const [dictamen, setDictamen] = useState<Dictamen | null>(null);
  const [cupo, setCupo] = useState<{ usados: number; cupo: number } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [analizando, setAnalizando] = useState(false);
  const [aviso, setAviso] = useState('');
  const perfilCompleto = !!(perfil.descripcion.trim() || perfil.productos_si.trim() || perfil.rubros.trim());

  const cargar = useCallback(async () => {
    const [p, v] = await Promise.all([
      fetch('/api/cv/perfil').then(r => r.json()).catch(() => ({})),
      fetch(`/api/cv/viabilidad/${encodeURIComponent(codigo)}`).then(r => r.json()).catch(() => ({})),
    ]);
    if (p.perfil) setPerfil({ ...VACIO, ...p.perfil }); else setEditando(true);
    setDictamen(v.dictamen ?? null); setCupo(v.cupo ?? p.cupo ?? null); setCargando(false);
  }, [codigo]);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    const r = await fetch('/api/cv/perfil', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(perfil) });
    if (r.ok) { setEditando(false); setAviso('Perfil guardado.'); } else setAviso((await r.json().catch(() => ({}))).error || 'No se pudo guardar');
  };
  const analizar = async () => {
    setAnalizando(true); setAviso('');
    const r = await fetch(`/api/cv/viabilidad/${encodeURIComponent(codigo)}`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    setAnalizando(false);
    if (!r.ok) { setAviso(d.error || 'No se pudo analizar'); return; }
    setDictamen(d.dictamen); setCupo(d.cupo);
  };

  if (cargando) return <p className="text-sm text-slate-500">Cargando…</p>;
  const v = dictamen ? ETIQ[dictamen.veredicto] : null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium text-slate-900">Viabilidad para tu empresa</h3>
          {cupo && <span className="text-xs tabular-nums text-slate-500">{cupo.usados} de {cupo.cupo} análisis este mes</span>}
        </div>
        {!dictamen && <p className="mt-1 text-sm text-slate-500">La IA lee los documentos de la licitación y dice si le conviene postular a tu empresa, según lo que vende.</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={analizar} disabled={analizando || !perfilCompleto}
            className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">
            {analizando ? 'Analizando… (hasta 1 minuto)' : dictamen ? 'Volver a analizar' : 'Analizar esta licitación'}
          </button>
          {!perfilCompleto && <span className="text-xs text-amber-600">Primero completa el perfil de tu empresa.</span>}
          {aviso && <span className="text-xs text-slate-600">{aviso}</span>}
        </div>
      </section>

      {dictamen && v && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-900"><span aria-hidden className={`h-2 w-2 rounded-full ${v.color}`} />{v.txt}</span>
            <span className="text-sm font-bold tabular-nums text-slate-900">{dictamen.puntaje}/100</span>
          </div>
          <p className="mt-2 text-sm text-slate-700">{dictamen.resumen}</p>
          <dl className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
            {[['Por qué', dictamen.razones], ['Riesgos', dictamen.riesgos], ['Requisitos para postular', dictamen.requisitos]].map(([t, l]) => (
              (l as string[]).length > 0 && <div key={t as string}><dt className="text-[11px] text-slate-500">{t as string}</dt>
                <dd><ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-slate-700">{(l as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul></dd></div>
            ))}
            {dictamen.plazos_y_garantias && <div><dt className="text-[11px] text-slate-500">Plazos y garantías</dt><dd className="mt-1 text-sm text-slate-700">{dictamen.plazos_y_garantias}</dd></div>}
            {dictamen.recomendacion && <div><dt className="text-[11px] text-slate-500">Qué hacer</dt><dd className="mt-1 text-sm text-slate-700">{dictamen.recomendacion}</dd></div>}
          </dl>
          <p className="mt-3 text-[11px] text-slate-400">Basado en {dictamen.docsLeidos ?? 0} documento(s) oficial(es) leído(s). Es una ayuda para decidir, no reemplaza revisar las bases.</p>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium text-slate-900">Perfil de tu empresa</h3>
          {esAdmin && !editando && <button className="text-sm font-medium text-teal-700 hover:underline" onClick={() => setEditando(true)}>Editar</button>}
        </div>
        {editando && esAdmin ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-slate-500 sm:col-span-2">Qué hace tu empresa<textarea rows={2} className={`${campo} mt-0.5`} value={perfil.descripcion} onChange={e => setPerfil({ ...perfil, descripcion: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Rubros<input className={`${campo} mt-0.5`} value={perfil.rubros} onChange={e => setPerfil({ ...perfil, rubros: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Regiones donde puedes entregar<input className={`${campo} mt-0.5`} value={perfil.regiones} onChange={e => setPerfil({ ...perfil, regiones: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Productos o servicios que SÍ ofreces<textarea rows={3} className={`${campo} mt-0.5`} value={perfil.productos_si} onChange={e => setPerfil({ ...perfil, productos_si: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Que NO ofreces<textarea rows={3} className={`${campo} mt-0.5`} value={perfil.productos_no} onChange={e => setPerfil({ ...perfil, productos_no: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Monto mínimo (CLP)<input type="number" className={`${campo} mt-0.5`} value={perfil.monto_min ?? ''} onChange={e => setPerfil({ ...perfil, monto_min: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label className="text-[11px] text-slate-500">Monto máximo (CLP)<input type="number" className={`${campo} mt-0.5`} value={perfil.monto_max ?? ''} onChange={e => setPerfil({ ...perfil, monto_max: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label className="text-[11px] text-slate-500 sm:col-span-2">Reglas propias (ej. «no postulamos con garantía mayor a 5%»)<textarea rows={2} className={`${campo} mt-0.5`} value={perfil.reglas} onChange={e => setPerfil({ ...perfil, reglas: e.target.value })} /></label>
            <div className="flex gap-2 sm:col-span-2">
              <button onClick={guardar} className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800">Guardar perfil</button>
              {perfilCompleto && <button onClick={() => { setEditando(false); cargar(); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancelar</button>}
            </div>
          </div>
        ) : perfilCompleto ? (
          <p className="mt-2 text-sm text-slate-600">{perfil.descripcion || perfil.productos_si}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Aún no hay perfil. {esAdmin ? 'Complétalo para poder analizar.' : 'Pídele al admin de tu empresa que lo complete.'}</p>
        )}
      </section>
    </div>
  );
}
