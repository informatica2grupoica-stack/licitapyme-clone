'use client';

// Configuración inicial de una empresa-cliente: lo que vendió en Mercado Público (OC + actas, leído por su RUT)
// se le entrega como SUGERENCIA de perfil y palabras clave. Ella marca lo que quiere y guarda. Nada se aplica sin su clic.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/app/lib/session-context';
import { PERFIL_VACIO, type Perfil } from '@/app/components/PerfilEmpresaForm';

interface Resultado {
  ordenes: number; licitaciones: number; actasConLineasGanadas: number; lineas: number; diasRevisados: number; resumen: string;
  compradores: string[]; regiones: string[]; montoTipico: { p10: number | null; p90: number | null };
  sugeridas: string[]; posibles: { rubro: string; palabras: string[] }[]; negativas: string[]; perfil: Partial<Perfil>;
}
interface Estado { pendiente: boolean; evaluacion: { estado: string; progreso: string; resultado: Resultado | null } | null; perfil: Perfil | null; palabras: { keyword: string; es_negativa: number }[] }

const campo = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
const clp = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);

function Casillas({ palabras, marcadas, alternar }: { palabras: string[]; marcadas: Set<string>; alternar: (k: string) => void }) {
  return (
    <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {palabras.map(k => (
        <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="accent-teal-700" checked={marcadas.has(k)} onChange={() => alternar(k)} />{k}
        </label>
      ))}
    </div>
  );
}

export function ConfigurarEmpresa({ alGuardar }: { alGuardar?: () => void }) {
  const { usuario } = useSession();
  const esAdmin = usuario?.rol === 'admin';
  const [d, setD] = useState<Estado | null>(null);
  const [p, setP] = useState<Perfil>(PERFIL_VACIO);
  const [pos, setPos] = useState<Set<string>>(new Set());
  const [neg, setNeg] = useState<Set<string>>(new Set());
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const cargar = useCallback(async () => {
    const r = await fetch('/api/mi-empresa/configuracion').then(x => x.json()).catch(() => null);
    if (r?.aplica) setD(r);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  // Mientras la evaluación corre (minutos), se vuelve a preguntar.
  useEffect(() => {
    if (d?.evaluacion?.estado !== 'EN_CURSO') return;
    const t = setTimeout(cargar, 5000);
    return () => clearTimeout(t);
  }, [d, cargar]);

  const res = d?.evaluacion?.estado === 'LISTO' ? d.evaluacion.resultado : null;
  // Al llegar las sugerencias: se precargan una sola vez (el perfil actual manda si ya tiene algo escrito).
  useEffect(() => {
    if (!d || listo || (d.evaluacion?.estado === 'EN_CURSO')) return;
    const actual = d.perfil;
    const tieneActual = !!(actual && (actual.descripcion.trim() || actual.productos_si.trim()));
    setP({ ...PERFIL_VACIO, ...(tieneActual ? actual : { ...actual, ...res?.perfil }) } as Perfil);
    const ya = new Set(d.palabras.map(k => k.keyword));
    setPos(new Set([...(res?.sugeridas || []), ...d.palabras.filter(k => !k.es_negativa).map(k => k.keyword)]));
    setNeg(new Set([...(res?.negativas || []).filter(k => !ya.has(k)), ...d.palabras.filter(k => k.es_negativa).map(k => k.keyword)]));
    setListo(true);
  }, [d, res, listo]);

  const alternar = (s: Set<string>, set: (x: Set<string>) => void) => (k: string) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); set(n); };
  const todasPosibles = useMemo(() => (res?.posibles || []).flatMap(g => g.palabras), [res]);

  const guardar = async () => {
    setGuardando(true); setMsg('');
    const r = await fetch('/api/mi-empresa/configuracion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ perfil: p, palabras: [...pos], negativas: [...neg] }) });
    const j = await r.json().catch(() => ({}));
    setGuardando(false);
    if (!r.ok) { setMsg(j.error || 'No se pudo guardar'); return; }
    setMsg(`Listo. ${j.agregadas} palabras clave nuevas en tu radar.`);
    await cargar(); alGuardar?.();
  };

  if (!d) return <p className="text-sm text-slate-500">Cargando…</p>;
  const ev = d.evaluacion;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-medium text-slate-900">Lo que vendiste en Mercado Público</h2>
        {!ev && <p className="mt-1 text-sm text-slate-500">Tu empresa no tiene RUT registrado, así que no hay historial para sugerirte. Completa el perfil a mano.</p>}
        {ev?.estado === 'EN_CURSO' && <p className="mt-1 text-sm text-slate-600">Estamos revisando tus órdenes de compra y actas de adjudicación por tu RUT. Toma unos minutos; puedes dejar esta página abierta. <span className="text-slate-500">{ev.progreso}</span></p>}
        {ev?.estado === 'ERROR' && <p className="mt-1 text-sm text-red-600">No pudimos leer tu historial: {ev.progreso}. Puedes completar el perfil a mano.</p>}
        {res && (
          <>
            {res.resumen && <p className="mt-1 text-sm text-slate-700">{res.resumen}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
              <div><dt className="text-[11px] text-slate-500">Órdenes de compra</dt><dd className="text-sm font-bold tabular-nums text-slate-800">{res.ordenes}</dd></div>
              <div><dt className="text-[11px] text-slate-500">Actas con líneas ganadas</dt><dd className="text-sm font-bold tabular-nums text-slate-800">{res.actasConLineasGanadas}</dd></div>
              <div><dt className="text-[11px] text-slate-500">Productos vendidos</dt><dd className="text-sm font-bold tabular-nums text-slate-800">{res.lineas}</dd></div>
              <div><dt className="text-[11px] text-slate-500">Monto típico por orden</dt><dd className="text-sm font-bold tabular-nums text-slate-800">{clp(res.montoTipico.p10)} a {clp(res.montoTipico.p90)}</dd></div>
            </dl>
            {res.compradores.length > 0 && <p className="mt-2 text-xs text-slate-600"><span className="text-slate-500">Te compran más: </span>{res.compradores.slice(0, 5).join(' · ')}</p>}
            <p className="mt-1 text-[11px] text-slate-500">Revisamos los últimos {res.diasRevisados} días.</p>
          </>
        )}
      </section>

      {ev?.estado !== 'EN_CURSO' && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-medium text-slate-900">Palabras clave de tu radar</h2>
            <p className="text-xs text-slate-500">Con estas palabras te avisamos de licitaciones nuevas. Marca las que quieras; después puedes cambiarlas en Radar.</p>
            {res && res.sugeridas.length > 0 && <><h3 className="mt-3 text-sm font-medium text-slate-800">Recomendadas para ti <span className="text-xs font-normal text-slate-500">(lo que más vendes)</span></h3>
              <Casillas palabras={res.sugeridas} marcadas={pos} alternar={alternar(pos, setPos)} /></>}
            {res?.posibles.map(g => (
              <div key={g.rubro} className="mt-3">
                <h3 className="text-sm font-medium text-slate-800">{g.rubro} <span className="text-xs font-normal text-slate-500">· otras posibles</span></h3>
                <Casillas palabras={g.palabras} marcadas={pos} alternar={alternar(pos, setPos)} />
              </div>
            ))}
            {todasPosibles.length > 0 && <button className="mt-2 text-xs font-medium text-teal-700 hover:underline" onClick={() => setPos(new Set([...pos, ...todasPosibles]))}>Marcar todas las posibles</button>}
            {res && res.negativas.length > 0 && <><h3 className="mt-4 text-sm font-medium text-slate-800">Para descartar <span className="text-xs font-normal text-slate-500">(licitaciones con estas palabras no te llegan)</span></h3>
              <Casillas palabras={res.negativas} marcadas={neg} alternar={alternar(neg, setNeg)} /></>}
            <p className="mt-3 text-xs tabular-nums text-slate-600">{pos.size} palabras y {neg.size} para descartar marcadas</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-medium text-slate-900">Perfil de tu empresa</h2>
            <p className="text-xs text-slate-500">La viabilidad lo usa para decirte si una licitación te conviene.{res ? ' Te lo dejamos propuesto desde tus ventas: corrígelo si algo no calza.' : ''}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[11px] text-slate-500 sm:col-span-2">Qué hace tu empresa<textarea disabled={!esAdmin} rows={2} className={`${campo} mt-0.5`} value={p.descripcion} onChange={e => setP({ ...p, descripcion: e.target.value })} /></label>
              <label className="text-[11px] text-slate-500">Rubros<input disabled={!esAdmin} className={`${campo} mt-0.5`} value={p.rubros} onChange={e => setP({ ...p, rubros: e.target.value })} /></label>
              <label className="text-[11px] text-slate-500">Regiones donde entregas<input disabled={!esAdmin} className={`${campo} mt-0.5`} value={p.regiones} onChange={e => setP({ ...p, regiones: e.target.value })} /></label>
              <label className="text-[11px] text-slate-500">Productos o servicios que SÍ ofreces<textarea disabled={!esAdmin} rows={3} className={`${campo} mt-0.5`} value={p.productos_si} onChange={e => setP({ ...p, productos_si: e.target.value })} /></label>
              <label className="text-[11px] text-slate-500">Que NO ofreces<textarea disabled={!esAdmin} rows={3} className={`${campo} mt-0.5`} value={p.productos_no} onChange={e => setP({ ...p, productos_no: e.target.value })} /></label>
              <label className="text-[11px] text-slate-500">Monto mínimo que te interesa (CLP)<input disabled={!esAdmin} type="number" className={`${campo} mt-0.5`} value={p.monto_min ?? ''} onChange={e => setP({ ...p, monto_min: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label className="text-[11px] text-slate-500">Monto máximo (CLP)<input disabled={!esAdmin} type="number" className={`${campo} mt-0.5`} value={p.monto_max ?? ''} onChange={e => setP({ ...p, monto_max: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label className="text-[11px] text-slate-500 sm:col-span-2">Reglas propias<textarea disabled={!esAdmin} rows={2} className={`${campo} mt-0.5`} value={p.reglas} onChange={e => setP({ ...p, reglas: e.target.value })} /></label>
            </div>
          </section>

          {esAdmin
            ? <div className="flex items-center gap-3"><button disabled={guardando} onClick={guardar} className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar configuración'}</button>{msg && <span className="text-xs text-slate-600">{msg}</span>}</div>
            : <p className="text-xs text-slate-500">Solo el admin de la empresa puede guardar la configuración.</p>}
        </>
      )}
    </div>
  );
}
