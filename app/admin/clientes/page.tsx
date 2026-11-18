'use client';

// Panel de LICITANK (superusuario y admin de Grupo ICA): empresas-cliente, su plan (Básico/Pro), adicionales, vencimiento y estado.
// Cambiar el plan o marcar un adicional rige al instante (el cliente lo ve en su próxima carga). Exportar y borrar: solo el superusuario.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast } from '@/app/components/ui/toast';
import { Modal } from '@/app/components/ui/Modal';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { NOMBRE_MODULO, NOMBRE_PLAN, PLANES, type Modulo, type Plan } from '@/app/lib/modulos';

interface Cliente {
  id: number; nombre: string; rut: string | null; plan: Plan; estado: string; max_usuarios: number | null;
  modulos: Modulo[]; adicionales: Modulo[]; cupo_ia_mensual: number; tope_ia_usd_mes: string | number | null; tope_mp_diario: number | null; ia_usd_mes: number; mp_hoy: number; vence_at: string | null; usuarios: number; contacto_email: string | null; notas: string | null;
}
interface Mov { cliente_id: number; accion: string; detalle: unknown; created_at: string; por: string | null }

const input = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';

// Baja de una empresa (Ley 21.719): exportar sus datos y borrarlos. Solo con la empresa suspendida; se confirma con su nombre.
function BajaEmpresa({ c, alTerminar }: { c: Cliente; alTerminar: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<{ pasos: { tabla: string; accion: string; filas: number }[]; negocios: number; usuarios: number; archivos: number } | null>(null);
  const [nombre, setNombre] = useState('');
  const [borrando, setBorrando] = useState(false);
  const verPlan = async () => {
    const d = await fetch(`/api/admin/clientes?borrado=${c.id}`).then(r => r.json()).catch(() => ({}));
    if (d.error) toast.error('No se pudo revisar', d.error); else setPlan(d);
  };
  const borrar = async () => {
    setBorrando(true);
    const r = await fetch('/api/admin/clientes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'borrar', clienteId: c.id, confirmar: nombre }) });
    const d = await r.json().catch(() => ({}));
    setBorrando(false);
    if (!r.ok) { toast.error('No se borró', d.error || `HTTP ${r.status}`); return; }
    const a = d.archivos;
    toast.success('Datos borrados', `${d.filas} filas de ${c.nombre}` + (a ? ` · archivos: ${a.borrados} borrados${a.compartidos ? `, ${a.compartidos} se dejan (los usa otra fila)` : ''}${a.fallidos ? `, ${a.fallidos} no se pudieron borrar` : ''}` : '')); alTerminar();
  };
  const total = plan?.pasos.filter(p => p.accion === 'borrar').reduce((a, p) => a + p.filas, 0) ?? 0;
  return (
    <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-slate-500">Baja de la empresa</span>
        <a href={`/api/admin/clientes?exportar=${c.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Exportar datos (JSON)</a>
        {!plan && <button onClick={verPlan} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Borrar todos los datos…</button>}
      </div>
      {plan && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
          <p className="text-sm text-red-800">Se borran <b>{total.toLocaleString('es-CL')}</b> filas ({plan.negocios} negocios, {plan.usuarios} usuarios) y sus <b>{plan.archivos}</b> archivos (los que ninguna otra fila use). No se puede deshacer: exporta antes si la empresa pidió sus datos.
            El gasto de IA queda sin nombres y la ficha queda «de baja» sin datos de contacto.</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 text-xs text-slate-700 sm:grid-cols-3">
            {plan.pasos.map(p => <li key={p.tabla + p.accion}>{p.tabla}: {p.filas}{p.accion !== 'borrar' ? ` (${p.accion})` : ''}</li>)}
          </ul>
          <label className="mt-3 block text-[11px] text-slate-600">Escribe <b>{c.nombre}</b> para confirmar
            <input className={`${input} mt-0.5 max-w-sm`} value={nombre} onChange={e => setNombre(e.target.value)} />
          </label>
          <div className="mt-2 flex gap-2">
            <button disabled={borrando || nombre.trim() !== c.nombre.trim()} onClick={borrar} className="rounded-lg bg-red-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">{borrando ? 'Borrando…' : 'Borrar definitivamente'}</button>
            <button onClick={() => { setPlan(null); setNombre(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Evaluación por RUT (OC + actas de MP → palabras clave y perfil). Mientras corre se consulta cada 5 s.
function EvaluacionRut({ clienteId }: { clienteId: number }) {
  const toast = useToast();
  const [ev, setEv] = useState<{ estado: string; progreso: string; resultado: any } | null>(null);
  const leer = useCallback(async () => {
    const d = await fetch(`/api/admin/clientes?evaluacion=${clienteId}`).then(r => r.json()).catch(() => ({}));
    setEv(d.evaluacion || null);
  }, [clienteId]);
  useEffect(() => { leer(); }, [leer]);
  const corriendo = ev?.estado === 'EN_CURSO' || ev?.estado === 'PENDIENTE'; // en cola o trabajándose (la mueve el scheduler)
  useEffect(() => {
    if (!corriendo) return;
    const t = setTimeout(leer, 5000);
    return () => clearTimeout(t);
  }, [ev, leer, corriendo]);
  const evaluar = async () => {
    const r = await fetch('/api/admin/clientes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'evaluar', clienteId }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) toast.error('No se pudo evaluar', d.error || `HTTP ${r.status}`); else setTimeout(leer, 1500);
  };
  const res = ev?.resultado;
  return (
    <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">Evaluación por RUT en Mercado Público (todas sus razones sociales){ev ? ` · ${ev.progreso}` : ' · sin evaluar'}</p>
        <button disabled={corriendo} onClick={evaluar}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {ev?.estado === 'PENDIENTE' ? 'En cola…' : ev?.estado === 'EN_CURSO' ? 'Evaluando…' : ev ? 'Volver a evaluar' : 'Evaluar'}
        </button>
      </div>
      {ev?.estado === 'ERROR' && <p className="mt-1 text-xs text-red-600">{ev.progreso}</p>}
      {res && ev?.estado === 'LISTO' && (
        <div className="mt-2 space-y-1.5 text-xs text-slate-600">
          <p>{res.ordenes} órdenes de compra · {res.licitaciones} licitaciones · {res.actasConLineasGanadas} actas con líneas ganadas · monto típico {res.montoTipico?.p10?.toLocaleString('es-CL') ?? '—'} a {res.montoTipico?.p90?.toLocaleString('es-CL') ?? '—'} CLP</p>
          {Array.isArray(res.ruts) && res.ruts.length > 0 && (
            <p><span className="text-slate-500">RUT revisados:</span> {res.ruts.map((r: any) => `${r.rut} (${r.codigoProveedor ? `${r.ordenes} OC` : 'no es proveedor en MP'})`).join(' · ')}</p>
          )}
          <p><span className="text-slate-500">Palabras clave:</span> {(res.sugeridas ?? res.palabras)?.join(', ')}</p>
          <p><span className="text-slate-500">Negativas:</span> {res.negativas?.join(', ') || '—'}</p>
          <p><span className="text-slate-500">Qué vende:</span> {res.perfil?.descripcion}</p>
          <p><span className="text-slate-500">Compradores frecuentes:</span> {res.compradores?.slice(0, 5).join('; ')}</p>
        </div>
      )}
    </div>
  );
}

type Tab = 'plan' | 'usuarios' | 'limites' | 'evaluacion' | 'historial';
const PESTANAS: { valor: Tab; etiqueta: string }[] = [
  { valor: 'plan', etiqueta: 'Plan' }, { valor: 'usuarios', etiqueta: 'Usuarios' }, { valor: 'limites', etiqueta: 'Límites' },
  { valor: 'evaluacion', etiqueta: 'Evaluación RUT' }, { valor: 'historial', etiqueta: 'Historial' },
];
// Lo que trae cada plan, en palabras del cliente (no los nombres internos de los módulos).
const BASICO_INCLUYE = ['Dashboard', 'Buscador', 'Radar y Puente', 'Negocios', 'Postuladas', 'Ganadas y perdidas', 'Descartadas', 'Órdenes de compra', 'Empresas', 'Avisos por WhatsApp', 'Administración de su empresa (equipo y datos)'];
const PRO_SUMA = ['Viabilidad IA', 'Resultado', 'Costeo', 'Auditor, Postulación y Ofertas de la competencia (cuando estén disponibles)'];

const DIA = 86400000;
function diasHasta(f: string | null): number | null {
  if (!f) return null;
  const [y, m, d] = f.split('-').map(Number);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - hoy.getTime()) / DIA);
}
function Vence({ f }: { f: string | null }) {
  const d = diasHasta(f);
  if (d == null) return <span className="text-slate-400">Sin fecha</span>;
  const [y, m, dd] = (f as string).split('-');
  const fecha = `${dd}-${m}-${y}`;
  if (d < 0) return <span className="text-red-600">Venció {fecha}</span>;
  if (d <= 14) return <span className="text-amber-600">En {d} {d === 1 ? 'día' : 'días'}</span>;
  return <span className="text-slate-600">{fecha}</span>;
}
function EstadoEmpresa({ estado }: { estado: string }) {
  const ok = estado === 'ACTIVO';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-slate-700' : 'text-red-600'}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />{ok ? 'Activa' : estado === 'SUSPENDIDO' ? 'Suspendida' : 'De baja'}
    </span>
  );
}

function Ficha({ c, tab, setTab, catalogo, activables, planes, puedeBorrar, bitacora, cambiar, cambiarPlan, alternarAdicional, cargar, cerrar }: {
  c: Cliente; tab: Tab; setTab: (t: Tab) => void; catalogo: Modulo[]; activables: Modulo[]; planes: Record<Plan, Modulo[]>; puedeBorrar: boolean; bitacora: Mov[];
  cambiar: (id: number, cambio: Record<string, unknown>) => void; cambiarPlan: (c: Cliente, p: Plan) => void; alternarAdicional: (c: Cliente, m: Modulo) => void;
  cargar: () => void; cerrar: () => void;
}) {
  const toast = useToast();
  const [equipo, setEquipo] = useState<{ id: number; nombre: string; email: string; rol: string; activo: number }[] | null>(null);
  const [otro, setOtro] = useState<{ nombre: string; email: string; clave: string; rol: string } | null>(null);
  const leerEquipo = useCallback(async () => {
    const d = await fetch(`/api/admin/clientes?usuarios=${c.id}`).then(r => r.json()).catch(() => ({}));
    setEquipo(d.usuarios || []);
  }, [c.id]);
  useEffect(() => { if (tab === 'usuarios') leerEquipo(); }, [tab, leerEquipo]);
  const extras = catalogo.filter(m => !planes[c.plan]?.includes(m) && activables.includes(m));
  const proximos = catalogo.filter(m => !activables.includes(m));
  const movs = bitacora.filter(m => m.cliente_id === c.id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">{c.nombre}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{c.rut || 'sin RUT'} · {c.contacto_email || 'sin contacto'}</p>
        </div>
        <div className="flex items-center gap-3">
          <EstadoEmpresa estado={c.estado} />
          <button onClick={cerrar} aria-label="Cerrar" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
      </div>
      <div className="border-b border-slate-100 px-5 py-2.5 dark:border-slate-800"><Pestanas id="ficha-cliente" opciones={PESTANAS} valor={tab} onCambio={setTab} /></div>

      <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
        {tab === 'plan' && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] text-slate-500">Plan</p>
              <div className="mt-1.5 flex gap-2">
                {PLANES.map(p => (
                  <Boton key={p} tamano="sm" variante={c.plan === p ? 'primario' : 'secundario'} aria-pressed={c.plan === p} onClick={() => p !== c.plan && cambiarPlan(c, p)}>{NOMBRE_PLAN[p]}</Boton>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Incluye el plan {NOMBRE_PLAN[c.plan]}</p>
              <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] text-slate-700 dark:text-slate-300 @xl:grid-cols-2">
                {(c.plan === 'PRO' ? [...BASICO_INCLUYE, ...PRO_SUMA] : BASICO_INCLUYE).map(t => <li key={t} className="flex gap-2"><span aria-hidden className="text-teal-700">✓</span>{t}</li>)}
              </ul>
              {c.plan === 'BASICO' && <p className="mt-2 text-xs text-slate-500">Los avisos por WhatsApp salen hoy desde el número de ICA; cada persona activa los suyos en su perfil.</p>}
            </div>
            <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-[11px] text-slate-500">Adicionales (se suman al plan)</p>
              {extras.length === 0 ? <p className="mt-1.5 text-xs text-slate-500">El plan Pro ya trae todo lo disponible.</p> : (
                <div className="mt-1.5 grid grid-cols-1 gap-1.5 @xl:grid-cols-2">
                  {extras.map(m => (
                    <label key={m} className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300">
                      <input type="checkbox" className="accent-teal-700" checked={c.adicionales.includes(m)} onChange={() => alternarAdicional(c, m)} />
                      {NOMBRE_MODULO[m]}
                    </label>
                  ))}
                </div>
              )}
              {proximos.length > 0 && <p className="mt-2 text-xs text-slate-400">Próximamente: {proximos.map(m => NOMBRE_MODULO[m]).join(', ')}.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <label className="text-[11px] text-slate-500">Vence
                <input key={`v${c.id}-${c.vence_at}`} type="date" defaultValue={c.vence_at || ''} className={`${input} mt-0.5 w-40`} onBlur={e => e.target.value !== (c.vence_at || '') && cambiar(c.id, { venceAt: e.target.value || null })} />
              </label>
              <div className="ml-auto self-end">
                <Boton tamano="sm" variante={c.estado === 'ACTIVO' ? 'secundario' : 'primario'} onClick={() => cambiar(c.id, { estado: c.estado === 'ACTIVO' ? 'SUSPENDIDO' : 'ACTIVO' })}>
                  {c.estado === 'ACTIVO' ? 'Suspender empresa' : 'Reactivar empresa'}
                </Boton>
              </div>
            </div>
            {c.estado !== 'ACTIVO' && puedeBorrar && <BajaEmpresa c={c} alTerminar={() => { cargar(); cerrar(); }} />}
          </div>
        )}

        {tab === 'usuarios' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">{c.usuarios} de {c.max_usuarios ?? '∞'} usuarios</p>
              {!otro && <Boton tamano="sm" onClick={() => setOtro({ nombre: '', email: '', clave: '', rol: 'usuario' })}>Agregar usuario</Boton>}
            </div>
            {equipo === null ? <p className="text-xs text-slate-500">Cargando…</p> : equipo.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">Esta empresa no tiene usuarios. Agrega el primero para que pueda entrar.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {equipo.map(u => (
                  <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0"><p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-200">{u.nombre}</p><p className="truncate text-xs text-slate-500">{u.email}</p></div>
                    <span className="shrink-0 text-xs text-slate-500">{u.rol === 'admin' ? 'Admin' : 'Usuario'}{u.activo ? '' : ' · inactivo'}</span>
                  </li>
                ))}
              </ul>
            )}
            {otro && (
              <div className="grid gap-3 border-t border-slate-100 pt-3 @xl:grid-cols-2 dark:border-slate-800">
                <label className="text-[11px] text-slate-500">Nombre<input className={`${input} mt-0.5`} value={otro.nombre} onChange={e => setOtro({ ...otro, nombre: e.target.value })} /></label>
                <label className="text-[11px] text-slate-500">Correo (su usuario)<input type="email" className={`${input} mt-0.5`} value={otro.email} onChange={e => setOtro({ ...otro, email: e.target.value })} /></label>
                <label className="text-[11px] text-slate-500">Clave temporal (mín. 8)<input className={`${input} mt-0.5`} value={otro.clave} onChange={e => setOtro({ ...otro, clave: e.target.value })} /></label>
                <label className="text-[11px] text-slate-500">Perfil
                  <select className={`${input} mt-0.5`} value={otro.rol} onChange={e => setOtro({ ...otro, rol: e.target.value })}>
                    <option value="usuario">Usuario</option><option value="admin">Admin de la empresa</option>
                  </select>
                </label>
                <div className="flex gap-2 @xl:col-span-2">
                  <Boton tamano="sm" variante="primario" disabled={!otro.email || otro.clave.length < 8}
                    onClick={async () => {
                      const r = await fetch('/api/admin/clientes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: 'usuario', clienteId: c.id, ...otro }) });
                      const d = await r.json().catch(() => ({}));
                      if (!r.ok) { toast.error('No se agregó', d.error || `HTTP ${r.status}`); return; }
                      toast.success('Usuario agregado', 'Entra con el mismo login. Entrega la clave temporal por un canal seguro.'); setOtro(null); cargar(); leerEquipo();
                    }}>Agregar</Boton>
                  <Boton tamano="sm" onClick={() => setOtro(null)}>Cancelar</Boton>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'limites' && (
          <div className="grid gap-3 @xl:grid-cols-2">
            <label className="text-[11px] text-slate-500">Usuarios máx.
              <input key={`u${c.id}-${c.max_usuarios}`} type="number" min={1} defaultValue={c.max_usuarios ?? 1} className={`${input} mt-0.5`} onBlur={e => Number(e.target.value) !== c.max_usuarios && cambiar(c.id, { maxUsuarios: Number(e.target.value) })} />
            </label>
            <label className="text-[11px] text-slate-500">Análisis de IA por mes
              <input key={`i${c.id}-${c.cupo_ia_mensual}`} type="number" min={0} defaultValue={c.cupo_ia_mensual ?? 0} className={`${input} mt-0.5`} onBlur={e => Number(e.target.value) !== c.cupo_ia_mensual && cambiar(c.id, { cupoIa: Number(e.target.value) })} />
            </label>
            <label className="text-[11px] text-slate-500">Tope IA USD/mes <span className="text-slate-400">(usado {c.ia_usd_mes ?? 0})</span>
              <input key={`t${c.id}-${c.tope_ia_usd_mes}`} type="number" min={0} step="0.5" placeholder="sin tope" defaultValue={c.tope_ia_usd_mes == null ? '' : Number(c.tope_ia_usd_mes)} className={`${input} mt-0.5`}
                onBlur={e => e.target.value !== (c.tope_ia_usd_mes == null ? '' : String(Number(c.tope_ia_usd_mes))) && cambiar(c.id, { topeIaUsd: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label className="text-[11px] text-slate-500">Tope consultas MP/día <span className="text-slate-400">(hoy {c.mp_hoy ?? 0})</span>
              <input key={`m${c.id}-${c.tope_mp_diario}`} type="number" min={0} placeholder="sin tope" defaultValue={c.tope_mp_diario ?? ''} className={`${input} mt-0.5`}
                onBlur={e => e.target.value !== String(c.tope_mp_diario ?? '') && cambiar(c.id, { topeMp: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <p className="text-xs text-slate-500 @xl:col-span-2">Los cambios se guardan al salir de cada campo.</p>
          </div>
        )}

        {tab === 'evaluacion' && (c.rut ? <EvaluacionRut clienteId={c.id} /> : <p className="text-xs text-slate-500">Esta empresa no tiene RUT. Agrégalo para evaluarla en Mercado Público.</p>)}

        {tab === 'historial' && (movs.length === 0 ? <p className="text-xs text-slate-500">Sin movimientos todavía.</p> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {movs.map((m, i) => (
              <li key={i} className="py-2">
                <p className="text-[13px] text-slate-700 dark:text-slate-300">{m.accion} <span className="text-xs text-slate-400">{JSON.stringify(m.detalle)}</span></p>
                <p className="text-xs tabular-nums text-slate-500">{m.por || '—'} · {new Date(m.created_at).toLocaleString('es-CL')}</p>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export default function ClientesPage() {
  const toast = useToast();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [catalogo, setCatalogo] = useState<Modulo[]>([]);
  const [activables, setActivables] = useState<Modulo[]>([]);
  const [planes, setPlanes] = useState<Record<Plan, Modulo[]>>({ BASICO: [], PRO: [] });
  const [puedeBorrar, setPuedeBorrar] = useState(false);
  const [bitacora, setBitacora] = useState<Mov[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busca, setBusca] = useState('');
  const [fPlan, setFPlan] = useState('');
  const [fEstado, setFEstado] = useState('');
  const [selId, setSelId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('plan');
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', rut: '', adminNombre: '', adminEmail: '', clave: '', venceAt: '', plan: 'BASICO' as Plan });
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/admin/clientes');
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error('No se pudo cargar', d.error || `HTTP ${r.status}`); setCargando(false); return; }
    setClientes(d.clientes); setCatalogo(d.catalogo); setActivables(d.activables || []); setBitacora(d.bitacora || []);
    if (d.planes) setPlanes(d.planes);
    setPuedeBorrar(!!d.puedeBorrar); setCargando(false);
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = async (id: number, cambio: Record<string, unknown>) => {
    const r = await fetch('/api/admin/clientes', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...cambio }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) toast.error('No se guardó', d.error || `HTTP ${r.status}`); else cargar();
  };
  // Solo se guardan los adicionales (lo que el plan no trae).
  const alternarAdicional = (c: Cliente, m: Modulo) =>
    cambiar(c.id, { modulos: c.adicionales.includes(m) ? c.adicionales.filter(x => x !== m) : [...c.adicionales, m] });
  // Al cambiar de plan se limpian los adicionales que el plan nuevo ya trae.
  const cambiarPlan = (c: Cliente, plan: Plan) =>
    cambiar(c.id, { plan, modulos: c.adicionales.filter(m => !planes[plan].includes(m)) });

  const crear = async () => {
    setCreando(true);
    const r = await fetch('/api/admin/clientes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...nuevo, venceAt: nuevo.venceAt || null }) });
    const d = await r.json().catch(() => ({}));
    setCreando(false);
    if (!r.ok) { toast.error('No se creó', d.error || `HTTP ${r.status}`); return; }
    toast.success('Empresa creada', 'Entra con el mismo login. Entrega la clave temporal por un canal seguro.');
    setNuevo({ nombre: '', rut: '', adminNombre: '', adminEmail: '', clave: '', venceAt: '', plan: 'BASICO' });
    setNuevoAbierto(false); cargar();
    if (d.id) { setSelId(d.id); setTab('plan'); }
  };

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return clientes.filter(c => (!q || [c.nombre, c.rut, c.contacto_email].some(x => String(x ?? '').toLowerCase().includes(q)))
      && (!fPlan || (c.id === 1 ? false : c.plan === fPlan))
      && (!fEstado || (fEstado === 'VENCE' ? (c.id !== 1 && (diasHasta(c.vence_at) ?? 999) <= 14) : c.estado === fEstado)));
  }, [clientes, busca, fPlan, fEstado]);
  const clientesReales = clientes.filter(c => c.id !== 1);
  const resumen = {
    activas: clientesReales.filter(c => c.estado === 'ACTIVO').length,
    porVencer: clientesReales.filter(c => (diasHasta(c.vence_at) ?? 999) <= 14).length,
    suspendidas: clientesReales.filter(c => c.estado !== 'ACTIVO').length,
    sinUsuarios: clientesReales.filter(c => c.usuarios === 0).length,
  };
  const sel = clientes.find(c => c.id === selId) || null;

  return (
    <AppLayout breadcrumb={[{ label: 'Empresas-cliente' }]}>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Empresas-cliente <span className="font-normal text-slate-400">· {clientesReales.length}</span></h1>
            <p className="text-sm text-slate-500">Cada empresa usa el mismo LICITANK. Haz clic en una para ver y cambiar su plan, usuarios y límites.</p>
          </div>
          <Boton variante="primario" onClick={() => setNuevoAbierto(true)}>Nueva empresa</Boton>
        </header>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span><b className="tabular-nums text-slate-700">{resumen.activas}</b> activas</span>
          <span><b className={`tabular-nums ${resumen.porVencer ? 'text-amber-600' : 'text-slate-700'}`}>{resumen.porVencer}</b> por vencer o vencidas</span>
          <span><b className={`tabular-nums ${resumen.suspendidas ? 'text-red-600' : 'text-slate-700'}`}>{resumen.suspendidas}</b> suspendidas</span>
          <span><b className="tabular-nums text-slate-700">{resumen.sinUsuarios}</b> sin usuarios</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nombre, RUT o correo" className={`${input} max-w-sm`} />
          <select value={fPlan} onChange={e => setFPlan(e.target.value)} className={`${input} w-auto`}>
            <option value="">Todos los planes</option>{PLANES.map(p => <option key={p} value={p}>{NOMBRE_PLAN[p]}</option>)}
          </select>
          <select value={fEstado} onChange={e => setFEstado(e.target.value)} className={`${input} w-auto`}>
            <option value="">Todos los estados</option><option value="ACTIVO">Activas</option><option value="SUSPENDIDO">Suspendidas</option><option value="VENCE">Por vencer o vencidas</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {cargando ? <p className="p-4 text-sm text-slate-500">Cargando…</p> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] text-slate-500 dark:border-slate-800">
                  <th className="px-4 py-2 font-normal">Empresa</th><th className="px-3 py-2 font-normal">Plan</th><th className="px-3 py-2 font-normal">Usuarios</th>
                  <th className="px-3 py-2 font-normal">IA del mes</th><th className="px-3 py-2 font-normal">Vence</th><th className="px-3 py-2 font-normal">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map(c => (
                  <tr key={c.id} onClick={c.id === 1 ? undefined : () => { setSelId(c.id); setTab('plan'); }}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${c.id === 1 ? '' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'} ${selId === c.id ? 'bg-teal-50/60 dark:bg-teal-900/10' : ''}`}>
                    <td className="px-4 py-2.5"><p className="font-medium text-slate-900 dark:text-slate-100">{c.nombre}</p><p className="text-xs text-slate-500">{c.rut || 'sin RUT'}</p></td>
                    {c.id === 1 ? <td colSpan={5} className="px-3 py-2.5 text-xs text-slate-500">Grupo ICA · todos los módulos · {c.usuarios} usuarios</td> : (
                      <>
                        <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">{NOMBRE_PLAN[c.plan]}{c.adicionales.length > 0 && <span className="text-xs text-slate-400"> +{c.adicionales.length}</span>}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700 dark:text-slate-300">{c.usuarios} de {c.max_usuarios ?? '∞'}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700 dark:text-slate-300">US$ {c.ia_usd_mes ?? 0}</td>
                        <td className="px-3 py-2.5 text-xs"><Vence f={c.vence_at} /></td>
                        <td className="px-3 py-2.5"><EstadoEmpresa estado={c.estado} /></td>
                      </>
                    )}
                  </tr>
                ))}
                {filtradas.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">Ninguna empresa coincide con la búsqueda. Cambia los filtros o crea una nueva.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {sel && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={() => setSelId(null)}>
          <aside onClick={e => e.stopPropagation()} className="@container h-full w-full max-w-xl bg-white shadow-flotante dark:bg-slate-900">
            <Ficha c={sel} tab={tab} setTab={setTab} catalogo={catalogo} activables={activables} planes={planes} puedeBorrar={puedeBorrar} bitacora={bitacora}
              cambiar={cambiar} cambiarPlan={cambiarPlan} alternarAdicional={alternarAdicional} cargar={cargar} cerrar={() => setSelId(null)} />
          </aside>
        </div>
      )}

      <Modal open={nuevoAbierto} onClose={() => setNuevoAbierto(false)} title="Nueva empresa" subtitle="Parte con el plan elegido y un perfil admin. Todo se cambia después desde su ficha."
        footer={<div className="flex justify-end gap-2"><Boton onClick={() => setNuevoAbierto(false)}>Cancelar</Boton>
          <Boton variante="primario" disabled={creando || !nuevo.nombre || !nuevo.adminEmail || nuevo.clave.length < 8} onClick={crear}>{creando ? 'Creando…' : 'Crear empresa'}</Boton></div>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] text-slate-500">Razón social<input className={`${input} mt-0.5`} value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">RUT<input className={`${input} mt-0.5`} value={nuevo.rut} onChange={e => setNuevo({ ...nuevo, rut: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">Nombre del admin<input className={`${input} mt-0.5`} value={nuevo.adminNombre} onChange={e => setNuevo({ ...nuevo, adminNombre: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">Correo del admin (su usuario)<input type="email" className={`${input} mt-0.5`} value={nuevo.adminEmail} onChange={e => setNuevo({ ...nuevo, adminEmail: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">Clave temporal (mín. 8)<input type="text" className={`${input} mt-0.5`} value={nuevo.clave} onChange={e => setNuevo({ ...nuevo, clave: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">Vence (opcional)<input type="date" className={`${input} mt-0.5`} value={nuevo.venceAt} onChange={e => setNuevo({ ...nuevo, venceAt: e.target.value })} /></label>
          <label className="text-[11px] text-slate-500">Plan
            <select className={`${input} mt-0.5`} value={nuevo.plan} onChange={e => setNuevo({ ...nuevo, plan: e.target.value as Plan })}>
              {PLANES.map(p => <option key={p} value={p}>{NOMBRE_PLAN[p]}</option>)}
            </select>
          </label>
        </div>
      </Modal>
    </AppLayout>
  );
}
