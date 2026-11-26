'use client';

// Panel de LICITANK (superusuario y admin de Grupo ICA): empresas-cliente, su plan (Básico/Pro), adicionales, vencimiento y estado.
// Cambiar el plan o marcar un adicional rige al instante (el cliente lo ve en su próxima carga). Exportar y borrar: solo el superusuario.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast } from '@/app/components/ui/toast';
import { Modal } from '@/app/components/ui/Modal';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Pestanas } from '@/app/components/ui/kit/Pestanas';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { SelectorAprobaciones } from '@/app/components/AprobacionesAuditor';
import type { OpcionesEmpresa } from '@/app/lib/opciones-empresa-core';
import { CriteriosViabilidadForm } from '@/app/components/CriteriosViabilidad';
import type { ConfigViabilidadEmpresa } from '@/app/lib/cv/viabilidad-empresa-core';
import { NOMBRE_MODULO, NOMBRE_PLAN, PLANES, type Modulo, type Plan } from '@/app/lib/modulos';

interface Cliente {
  id: number; nombre: string; rut: string | null; plan: Plan; estado: string; max_usuarios: number | null;
  modulos: Modulo[]; adicionales: Modulo[]; opciones: OpcionesEmpresa; viabilidad: ConfigViabilidadEmpresa; cupo_ia_mensual: number; tope_ia_usd_mes: string | number | null; tope_mp_diario: number | null; ia_usd_mes: number; mp_hoy: number; vence_at: string | null; usuarios: number; contacto_email: string | null; notas: string | null;
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
    <div className="mt-3 border-t border-linea dark:border-slate-800 pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-tinta-2 dark:text-slate-400">Baja de la empresa</span>
        <a href={`/api/admin/clientes?exportar=${c.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-tinta dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-950/40">Exportar datos (JSON)</a>
        {!plan && <button onClick={verPlan} className="inline-flex h-9 items-center rounded-lg border border-red-200 bg-white px-3.5 text-sm font-medium text-urgente shadow-tarjeta hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marca/60 dark:bg-slate-900 dark:border-red-900">Borrar todos los datos…</button>}
      </div>
      {plan && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
          <p className="text-sm text-red-800">Se borran <b>{total.toLocaleString('es-CL')}</b> filas ({plan.negocios} negocios, {plan.usuarios} usuarios) y sus <b>{plan.archivos}</b> archivos (los que ninguna otra fila use). No se puede deshacer: exporta antes si la empresa pidió sus datos.
            El gasto de IA queda sin nombres y la ficha queda «de baja» sin datos de contacto.</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 text-xs text-tinta dark:text-slate-200 @xl:grid-cols-3">
            {plan.pasos.map(p => <li key={p.tabla + p.accion}>{p.tabla}: {p.filas}{p.accion !== 'borrar' ? ` (${p.accion})` : ''}</li>)}
          </ul>
          <label className="mt-3 block text-xs text-tinta-2 dark:text-slate-400">Escribe <b>{c.nombre}</b> para confirmar
            <input className={`${input} mt-0.5 max-w-sm`} value={nombre} onChange={e => setNombre(e.target.value)} />
          </label>
          <div className="mt-2 flex gap-2">
            <button disabled={borrando || nombre.trim() !== c.nombre.trim()} onClick={borrar} className="rounded-lg bg-red-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">{borrando ? 'Borrando…' : 'Borrar definitivamente'}</button>
            <button onClick={() => { setPlan(null); setNombre(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-tinta dark:text-slate-200">Cancelar</button>
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
    <div className="mt-3 border-t border-linea dark:border-slate-800 pt-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-tinta-2 dark:text-slate-400">Evaluación por RUT en Mercado Público (todas sus razones sociales){ev ? ` · ${ev.progreso}` : ' · sin evaluar'}</p>
        <button disabled={corriendo} onClick={evaluar}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-tinta dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-950/40 disabled:opacity-50">
          {ev?.estado === 'PENDIENTE' ? 'En cola…' : ev?.estado === 'EN_CURSO' ? 'Evaluando…' : ev ? 'Volver a evaluar' : 'Evaluar'}
        </button>
      </div>
      {ev?.estado === 'ERROR' && <p className="mt-1 text-xs text-red-600">{ev.progreso}</p>}
      {res && ev?.estado === 'LISTO' && (
        <div className="mt-2 space-y-1.5 text-xs text-tinta-2 dark:text-slate-400">
          <p>{res.ordenes} órdenes de compra · {res.licitaciones} licitaciones · {res.actasConLineasGanadas} actas con líneas ganadas · monto típico {res.montoTipico?.p10?.toLocaleString('es-CL') ?? '—'} a {res.montoTipico?.p90?.toLocaleString('es-CL') ?? '—'} CLP</p>
          {Array.isArray(res.ruts) && res.ruts.length > 0 && (
            <p><span className="text-tinta-2 dark:text-slate-400">RUT revisados:</span> {res.ruts.map((r: any) => `${r.rut} (${r.codigoProveedor ? `${r.ordenes} OC` : 'no es proveedor en MP'})`).join(' · ')}</p>
          )}
          <p><span className="text-tinta-2 dark:text-slate-400">Palabras clave:</span> {(res.sugeridas ?? res.palabras)?.join(', ')}</p>
          <p><span className="text-tinta-2 dark:text-slate-400">Negativas:</span> {res.negativas?.join(', ') || '—'}</p>
          <p><span className="text-tinta-2 dark:text-slate-400">Qué vende:</span> {res.perfil?.descripcion}</p>
          <p><span className="text-tinta-2 dark:text-slate-400">Compradores frecuentes:</span> {res.compradores?.slice(0, 5).join('; ')}</p>
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
const PRO_SUMA = ['Viabilidad IA y sus criterios de evaluación', 'Resultado', 'Costeo', 'Auditor con aprobación simple'];

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
  return <span className="text-tinta-2 dark:text-slate-400">{fecha}</span>;
}
// Estado a la vista: verde = al día, naranjo = vence en 14 días o menos, rojo = vencida, gris = suspendida o de baja.
type EstadoVisual = 'activa' | 'por_vencer' | 'vencida' | 'suspendida';
function estadoVisual(c: { estado: string; vence_at: string | null }): EstadoVisual {
  if (c.estado !== 'ACTIVO') return 'suspendida';
  const d = diasHasta(c.vence_at);
  if (d != null && d < 0) return 'vencida';
  if (d != null && d <= 14) return 'por_vencer';
  return 'activa';
}
const ESTADO_UI: Record<EstadoVisual, { texto: string; punto: string; color: string }> = {
  activa: { texto: 'Activa', punto: 'bg-emerald-500', color: 'text-emerald-700' },
  por_vencer: { texto: 'Por vencer', punto: 'bg-orange-500', color: 'text-orange-600' },
  vencida: { texto: 'Vencida', punto: 'bg-red-500', color: 'text-red-600' },
  suspendida: { texto: 'Suspendida', punto: 'bg-slate-400', color: 'text-tinta-2 dark:text-slate-400' },
};
function EstadoEmpresa({ c }: { c: { estado: string; vence_at: string | null } }) {
  const e = ESTADO_UI[estadoVisual(c)];
  const texto = c.estado === 'BAJA' ? 'De baja' : e.texto;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${e.color}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${e.punto}`} />{texto}
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
  const [claveNueva, setClaveNueva] = useState<{ id: number; clave: string } | null>(null);
  const accionUsuario = async (cuerpo: Record<string, unknown>, ok: string) => {
    const r = await fetch('/api/admin/clientes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error('No se pudo', d.error || `HTTP ${r.status}`); return false; }
    toast.success(ok); cargar(); leerEquipo(); return true;
  };
  const poner = async (u: { id: number; email?: string }) => {
    if (!window.confirm('Esto cambia la clave de ' + (u.email || 'este usuario') + ' ahora mismo. ¿Continuar?')) return;
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const b = new Uint32Array(12); crypto.getRandomValues(b);
    const clave = Array.from(b, x => abc[x % abc.length]).join('');
    if (await accionUsuario({ accion: 'usuario_clave', usuarioId: u.id, clave }, 'Clave cambiada')) setClaveNueva({ id: u.id, clave });
  };
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
      <div className="flex items-start justify-between gap-3 border-b border-linea dark:border-slate-800 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100">{c.nombre}</h2>
          <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">{c.rut || 'sin RUT'} · {c.contacto_email || 'sin contacto'}</p>
        </div>
        <div className="flex items-center gap-3">
          <EstadoEmpresa c={c} />
          <button onClick={cerrar} aria-label="Cerrar" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-tinta dark:hover:text-slate-200">✕</button>
        </div>
      </div>
      <div className="border-b border-linea dark:border-slate-800 px-5 py-2.5 dark:border-slate-800"><Pestanas id="ficha-cliente" opciones={PESTANAS} valor={tab} onCambio={setTab} /></div>

      <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
        {tab === 'plan' && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-tinta-2 dark:text-slate-400">Plan</p>
              <div className="mt-1.5 flex gap-2">
                {PLANES.map(p => (
                  <Boton key={p} tamano="sm" variante={c.plan === p ? 'primario' : 'secundario'} aria-pressed={c.plan === p} onClick={() => p !== c.plan && cambiarPlan(c, p)}>{NOMBRE_PLAN[p]}</Boton>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-tinta-2 dark:text-slate-400">Incluye el plan {NOMBRE_PLAN[c.plan]}</p>
              <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] text-slate-700 dark:text-slate-300 @xl:grid-cols-2">
                {(c.plan === 'PRO' ? [...BASICO_INCLUYE, ...PRO_SUMA] : BASICO_INCLUYE).map(t => <li key={t} className="flex gap-2"><span aria-hidden className="text-teal-700">✓</span>{t}</li>)}
              </ul>
              {c.plan === 'BASICO' && <p className="mt-2 text-xs text-tinta-2 dark:text-slate-400">Los avisos por WhatsApp salen hoy desde el número de ICA; cada persona activa los suyos en su perfil.</p>}
            </div>
            <div className="border-t border-linea dark:border-slate-800 pt-3 dark:border-slate-800">
              <p className="text-xs text-tinta-2 dark:text-slate-400">Adicionales (se suman al plan)</p>
              {extras.length === 0 ? <p className="mt-1.5 text-xs text-tinta-2 dark:text-slate-400">El plan Pro ya trae todo lo disponible.</p> : (
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
            {c.modulos.includes('viabilidad') && c.viabilidad && (
              <div className="border-t border-linea dark:border-slate-800 pt-3 dark:border-slate-800">
                <p className="mb-1.5 text-xs text-tinta-2 dark:text-slate-400">Cómo se adapta la viabilidad a esta empresa (también lo cambia la empresa en Mi empresa)</p>
                <CriteriosViabilidadForm valor={c.viabilidad} onGuardar={v => cambiar(c.id, { viabilidadCalce: v.calce, viabilidadMinimoNeto: v.minimo_neto })} />
              </div>
            )}
            {c.modulos.includes('auditor') && (
              <div className="border-t border-linea dark:border-slate-800 pt-3 dark:border-slate-800">
                <p className="mb-1.5 text-xs text-tinta-2 dark:text-slate-400">Aprobaciones del Auditor (también las cambia la empresa en Mi empresa)</p>
                <SelectorAprobaciones valor={c.opciones?.aprobaciones_auditor ?? 'auto'} onCambio={m => cambiar(c.id, { aprobacionesAuditor: m })} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-linea dark:border-slate-800 pt-3 dark:border-slate-800">
              <label className="text-xs text-tinta-2 dark:text-slate-400">Vence
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
              <p className="text-xs text-tinta-2 dark:text-slate-400">{c.usuarios} de {c.max_usuarios ?? '∞'} usuarios</p>
              {!otro && <Boton tamano="sm" onClick={() => setOtro({ nombre: '', email: '', clave: '', rol: 'usuario' })}>Agregar usuario</Boton>}
            </div>
            {equipo === null ? <p className="text-xs text-tinta-2 dark:text-slate-400">Cargando…</p> : equipo.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-tinta-2 dark:text-slate-400">Esta empresa no tiene usuarios. Agrega el primero para que pueda entrar.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {equipo.map(u => (
                  <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="min-w-0"><p className="truncate text-[13px] font-medium text-tinta dark:text-slate-200">{u.nombre}</p><p className="truncate text-xs text-tinta-2 dark:text-slate-400">{u.email}</p></div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-tinta-2 dark:text-slate-400">{u.rol === 'admin' ? 'Admin' : 'Usuario'}{u.activo ? '' : ' · inactivo'}</span>
                      <Boton tamano="sm" onClick={() => poner(u)}>Nueva clave</Boton>
                      <Boton tamano="sm" variante={u.activo ? 'secundario' : 'primario'} onClick={() => accionUsuario({ accion: 'usuario_estado', usuarioId: u.id, activo: !u.activo }, u.activo ? 'Usuario desactivado' : 'Usuario activado')}>{u.activo ? 'Desactivar' : 'Activar'}</Boton>
                    </div>
                    {claveNueva?.id === u.id && (
                      <div className="basis-full rounded-lg border border-teal-200 bg-teal-50/60 p-2.5 text-xs text-slate-700 dark:border-teal-900 dark:bg-teal-900/10 dark:text-slate-300">
                        Clave temporal de {u.email}: <b className="select-all font-mono text-[13px]">{claveNueva.clave}</b>
                        <span className="block text-tinta-2 dark:text-slate-400">Se muestra una sola vez. Entrégala por un canal seguro; pueden cambiarla desde su perfil.</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {otro && (
              <div className="grid gap-3 border-t border-linea dark:border-slate-800 pt-3 @xl:grid-cols-2 dark:border-slate-800">
                <label className="text-xs text-tinta-2 dark:text-slate-400">Nombre<input className={`${input} mt-0.5`} value={otro.nombre} onChange={e => setOtro({ ...otro, nombre: e.target.value })} /></label>
                <label className="text-xs text-tinta-2 dark:text-slate-400">Correo (su usuario)<input type="email" className={`${input} mt-0.5`} value={otro.email} onChange={e => setOtro({ ...otro, email: e.target.value })} /></label>
                <label className="text-xs text-tinta-2 dark:text-slate-400">Clave temporal (mín. 8)<input className={`${input} mt-0.5`} value={otro.clave} onChange={e => setOtro({ ...otro, clave: e.target.value })} /></label>
                <label className="text-xs text-tinta-2 dark:text-slate-400">Perfil
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
            <label className="text-xs text-tinta-2 dark:text-slate-400">Usuarios máx.
              <input key={`u${c.id}-${c.max_usuarios}`} type="number" min={1} defaultValue={c.max_usuarios ?? 1} className={`${input} mt-0.5`} onBlur={e => Number(e.target.value) !== c.max_usuarios && cambiar(c.id, { maxUsuarios: Number(e.target.value) })} />
            </label>
            <label className="text-xs text-tinta-2 dark:text-slate-400">Análisis de IA por mes
              <input key={`i${c.id}-${c.cupo_ia_mensual}`} type="number" min={0} defaultValue={c.cupo_ia_mensual ?? 0} className={`${input} mt-0.5`} onBlur={e => Number(e.target.value) !== c.cupo_ia_mensual && cambiar(c.id, { cupoIa: Number(e.target.value) })} />
            </label>
            <label className="text-xs text-tinta-2 dark:text-slate-400">Tope IA USD/mes <span className="text-slate-400">(usado {c.ia_usd_mes ?? 0})</span>
              <input key={`t${c.id}-${c.tope_ia_usd_mes}`} type="number" min={0} step="0.5" placeholder="sin tope" defaultValue={c.tope_ia_usd_mes == null ? '' : Number(c.tope_ia_usd_mes)} className={`${input} mt-0.5`}
                onBlur={e => e.target.value !== (c.tope_ia_usd_mes == null ? '' : String(Number(c.tope_ia_usd_mes))) && cambiar(c.id, { topeIaUsd: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <label className="text-xs text-tinta-2 dark:text-slate-400">Tope consultas MP/día <span className="text-slate-400">(hoy {c.mp_hoy ?? 0})</span>
              <input key={`m${c.id}-${c.tope_mp_diario}`} type="number" min={0} placeholder="sin tope" defaultValue={c.tope_mp_diario ?? ''} className={`${input} mt-0.5`}
                onBlur={e => e.target.value !== String(c.tope_mp_diario ?? '') && cambiar(c.id, { topeMp: e.target.value === '' ? null : Number(e.target.value) })} />
            </label>
            <p className="text-xs text-tinta-2 dark:text-slate-400 @xl:col-span-2">Los cambios se guardan al salir de cada campo.</p>
          </div>
        )}

        {tab === 'evaluacion' && (c.rut ? <EvaluacionRut clienteId={c.id} /> : <p className="text-xs text-tinta-2 dark:text-slate-400">Esta empresa no tiene RUT. Agrégalo para evaluarla en Mercado Público.</p>)}

        {tab === 'historial' && (movs.length === 0 ? <p className="text-xs text-tinta-2 dark:text-slate-400">Sin movimientos todavía.</p> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {movs.map((m, i) => (
              <li key={i} className="py-2">
                <p className="text-[13px] text-slate-700 dark:text-slate-300">{m.accion} <span className="text-xs text-slate-400">{JSON.stringify(m.detalle)}</span></p>
                <p className="text-xs tabular-nums text-tinta-2 dark:text-slate-400">{m.por || '—'} · {new Date(m.created_at).toLocaleString('es-CL')}</p>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

// Empresa nueva: parte en Básico, 2 usuarios y un año de vigencia (editable).
function nuevoVacio() {
  const v = new Date(); v.setFullYear(v.getFullYear() + 1);
  return { nombre: '', rut: '', adminNombre: '', adminEmail: '', clave: '', venceAt: v.toISOString().slice(0, 10), plan: 'BASICO' as Plan, maxUsuarios: 2, modulos: [] as Modulo[] };
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
  // Solicitudes de alta pendientes (formulario público /registro): se avisan en el botón del encabezado.
  const [pendientesAlta, setPendientesAlta] = useState(0);
  useEffect(() => { fetch('/api/admin/solicitudes').then(r => r.json()).then(d => setPendientesAlta(Number(d.pendientes) || 0)).catch(() => {}); }, []);
  const [nuevo, setNuevo] = useState(nuevoVacio);
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
    setNuevo(nuevoVacio());
    setNuevoAbierto(false); cargar();
    if (d.id) { setSelId(d.id); setTab('plan'); }
  };

  const clientesReales = clientes.filter(c => c.id !== 1);
  const conteo = {
    todas: clientesReales.length,
    activa: clientesReales.filter(c => estadoVisual(c) === 'activa').length,
    por_vencer: clientesReales.filter(c => estadoVisual(c) === 'por_vencer').length,
    vencida: clientesReales.filter(c => estadoVisual(c) === 'vencida').length,
    suspendida: clientesReales.filter(c => estadoVisual(c) === 'suspendida').length,
  };
  // Lo urgente primero: vencidas, por vencer, activas, suspendidas; dentro de cada grupo, por nombre.
  const ORDEN: Record<EstadoVisual, number> = { vencida: 0, por_vencer: 1, activa: 2, suspendida: 3 };
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return clientesReales
      .filter(c => (!q || [c.nombre, c.rut, c.contacto_email].some(x => String(x ?? '').toLowerCase().includes(q)))
        && (!fPlan || c.plan === fPlan) && (!fEstado || estadoVisual(c) === fEstado))
      .sort((a, b) => ORDEN[estadoVisual(a)] - ORDEN[estadoVisual(b)] || a.nombre.localeCompare(b.nombre, 'es'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes, busca, fPlan, fEstado]);
  const ica = clientes.find(c => c.id === 1);
  const sel = clientes.find(c => c.id === selId) || null;
  const extrasNuevo = catalogo.filter(m => !planes[nuevo.plan]?.includes(m) && activables.includes(m));
  const nuevoValido = !!nuevo.nombre.trim() && /.+@.+\..+/.test(nuevo.adminEmail) && nuevo.clave.length >= 8;
  const generarClave = () => {
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const b = new Uint32Array(12); crypto.getRandomValues(b);
    setNuevo(n => ({ ...n, clave: Array.from(b, x => abc[x % abc.length]).join('') }));
  };

  return (
    <AppLayout breadcrumb={[{ label: 'Empresas-cliente' }]}>
      <div className="@container mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo={`Empresas-cliente · ${clientesReales.length}`}
          descripcion="Cada empresa usa el mismo LICITANK. Haz clic en una para ver y cambiar su plan, usuarios y límites."
          acciones={<div className="flex items-center gap-2"><a href="/admin/solicitudes" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Solicitudes de alta{pendientesAlta > 0 ? ` (${pendientesAlta})` : ''}</a><Boton variante="primario" onClick={() => setNuevoAbierto(true)}>Nueva empresa</Boton></div>}
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" /></svg>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nombre, RUT o correo" aria-label="Buscar empresa"
              className="h-9 w-full rounded-lg border border-linea dark:border-slate-800 bg-white dark:bg-slate-900 pl-8 pr-3 text-sm text-tinta dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </div>
          <Pestanas id="filtro-estado" valor={fEstado} onCambio={setFEstado} opciones={[
            { valor: '', etiqueta: 'Todas', contador: conteo.todas }, { valor: 'activa', etiqueta: 'Activas', contador: conteo.activa },
            { valor: 'por_vencer', etiqueta: 'Por vencer', contador: conteo.por_vencer }, { valor: 'vencida', etiqueta: 'Vencidas', contador: conteo.vencida },
            { valor: 'suspendida', etiqueta: 'Suspendidas', contador: conteo.suspendida },
          ]} />
          <Pestanas id="filtro-plan" valor={fPlan} onCambio={setFPlan} opciones={[
            { valor: '', etiqueta: 'Todos los planes' }, ...PLANES.map(p => ({ valor: p as string, etiqueta: NOMBRE_PLAN[p] })),
          ]} />
        </div>

        {cargando ? <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">{[1, 2, 3].map(i => <Esqueleto key={i} className="h-36 rounded-xl" />)}</div> : (
          <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
            {ica && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                <p className="font-medium text-tinta dark:text-slate-100">{ica.nombre}</p>
                <p className="text-xs text-tinta-2 dark:text-slate-400">Grupo ICA · todos los módulos</p>
                <p className="mt-3 text-xs text-tinta-2 dark:text-slate-400">{ica.usuarios} usuarios</p>
              </div>
            )}
            {filtradas.map(c => {
              const ev = estadoVisual(c);
              const d = diasHasta(c.vence_at);
              const venceColor = ev === 'vencida' ? 'text-red-600' : ev === 'por_vencer' ? 'text-orange-600' : 'text-tinta dark:text-slate-200';
              return (
                <button key={c.id} type="button" onClick={() => { setSelId(c.id); setTab('plan'); }}
                  className={`group rounded-xl border bg-white dark:bg-slate-900 p-4 text-left shadow-tarjeta transition duration-150 hover:-translate-y-px hover:shadow-tarjeta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:bg-slate-900 ${selId === c.id ? 'border-teal-600' : 'border-slate-200 dark:border-slate-800'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-tinta dark:text-slate-100">{c.nombre}</p>
                      <p className="text-xs text-tinta-2 dark:text-slate-400">{c.rut || 'sin RUT'}</p>
                    </div>
                    <EstadoEmpresa c={c} />
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-linea dark:border-slate-800 pt-3 dark:border-slate-800">
                    <div><dt className="text-xs text-tinta-2 dark:text-slate-400">Plan</dt><dd className="text-sm font-medium text-tinta dark:text-slate-200">{NOMBRE_PLAN[c.plan]}{c.adicionales.length > 0 && <span className="text-xs font-normal text-slate-400"> +{c.adicionales.length}</span>}</dd></div>
                    <div><dt className="text-xs text-tinta-2 dark:text-slate-400">Usuarios</dt><dd className={`text-sm font-medium tabular-nums ${c.usuarios === 0 ? 'text-orange-600' : 'text-tinta dark:text-slate-200'}`}>{c.usuarios} de {c.max_usuarios ?? '∞'}</dd></div>
                    <div><dt className="text-xs text-tinta-2 dark:text-slate-400">Vence</dt>
                      <dd className={`text-sm font-medium tabular-nums ${venceColor}`}>{c.vence_at ? c.vence_at.split('-').reverse().join('-') : 'Sin fecha'}</dd>
                      {d != null && <dd className={`text-xs ${venceColor}`}>{d < 0 ? `hace ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'hoy' : `en ${d} ${d === 1 ? 'día' : 'días'}`}</dd>}
                    </div>
                  </dl>
                </button>
              );
            })}
          </div>
        )}
        {!cargando && filtradas.length === 0 && (
          <Vacio titulo="Ninguna empresa coincide" texto="Cambia la búsqueda o los filtros, o crea una empresa nueva." />
        )}
      </div>

      {sel && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={() => setSelId(null)}>
          <aside onClick={e => e.stopPropagation()} className="@container h-full w-full max-w-xl bg-white dark:bg-slate-900 shadow-flotante dark:bg-slate-900">
            <Ficha c={sel} tab={tab} setTab={setTab} catalogo={catalogo} activables={activables} planes={planes} puedeBorrar={puedeBorrar} bitacora={bitacora}
              cambiar={cambiar} cambiarPlan={cambiarPlan} alternarAdicional={alternarAdicional} cargar={cargar} cerrar={() => setSelId(null)} />
          </aside>
        </div>
      )}

      <Modal open={nuevoAbierto} onClose={() => setNuevoAbierto(false)} size="lg" title="Nueva empresa" subtitle="Crea la empresa, su administrador y su plan. Todo se puede cambiar después desde su ficha."
        footer={<div className="flex items-center justify-between gap-2">
          <p className="text-xs text-tinta-2 dark:text-slate-400">{nuevoValido ? 'Listo para crear.' : 'Faltan razón social, un correo válido o una clave de 8 caracteres o más.'}</p>
          <div className="flex gap-2"><Boton onClick={() => setNuevoAbierto(false)}>Cancelar</Boton>
            <Boton variante="primario" disabled={creando || !nuevoValido} onClick={crear}>{creando ? 'Creando…' : 'Crear empresa'}</Boton></div></div>}>
        <div className="space-y-5">
          <section>
            <h3 className="text-[13px] font-semibold text-tinta dark:text-slate-100">Empresa</h3>
            <div className="mt-2 grid gap-3 @xl:grid-cols-2">
              <label className="text-xs text-tinta-2 dark:text-slate-400">Razón social
                <input className={`${input} mt-0.5`} value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Ej.: Comercial Andes SpA" /></label>
              <label className="text-xs text-tinta-2 dark:text-slate-400">RUT
                <input className={`${input} mt-0.5`} value={nuevo.rut} onChange={e => setNuevo({ ...nuevo, rut: e.target.value })} placeholder="76.123.456-7" /></label>
            </div>
            <p className="mt-1.5 text-xs text-tinta-2 dark:text-slate-400">Con RUT, LICITANK la evalúa en Mercado Público y le sugiere palabras clave y perfil de compra.</p>
          </section>

          <section className="border-t border-linea dark:border-slate-800 pt-4 dark:border-slate-800">
            <h3 className="text-[13px] font-semibold text-tinta dark:text-slate-100">Administrador de la empresa</h3>
            <div className="mt-2 grid gap-3 @xl:grid-cols-2">
              <label className="text-xs text-tinta-2 dark:text-slate-400">Nombre
                <input className={`${input} mt-0.5`} value={nuevo.adminNombre} onChange={e => setNuevo({ ...nuevo, adminNombre: e.target.value })} /></label>
              <label className="text-xs text-tinta-2 dark:text-slate-400">Correo (será su usuario)
                <input type="email" className={`${input} mt-0.5`} value={nuevo.adminEmail} onChange={e => setNuevo({ ...nuevo, adminEmail: e.target.value })} /></label>
              <label className="text-xs text-tinta-2 dark:text-slate-400 @xl:col-span-2">Clave temporal (mínimo 8 caracteres)
                <div className="mt-0.5 flex gap-2">
                  <input className={input} value={nuevo.clave} onChange={e => setNuevo({ ...nuevo, clave: e.target.value })} />
                  <Boton tamano="sm" type="button" className="shrink-0 self-stretch" onClick={generarClave}>Generar</Boton>
                </div></label>
            </div>
          </section>

          <section className="border-t border-linea dark:border-slate-800 pt-4 dark:border-slate-800">
            <h3 className="text-[13px] font-semibold text-tinta dark:text-slate-100">Plan y vigencia</h3>
            <div className="mt-2 grid gap-2 @xl:grid-cols-2">
              {PLANES.map(p => (
                <button key={p} type="button" aria-pressed={nuevo.plan === p} onClick={() => setNuevo({ ...nuevo, plan: p, modulos: nuevo.modulos.filter(m => !planes[p].includes(m)) })}
                  className={`rounded-lg border p-3 text-left transition ${nuevo.plan === p ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-900/10' : 'border-linea dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}>
                  <p className="text-sm font-medium text-tinta dark:text-slate-100">{NOMBRE_PLAN[p]}</p>
                  <p className="mt-0.5 text-xs text-tinta-2 dark:text-slate-400">{p === 'BASICO' ? 'Dashboard, Buscador, Negocios, Postuladas, Ganadas y perdidas, Descartadas, Órdenes de compra y administración de su empresa.' : 'Todo el Básico más Viabilidad IA, Resultado, Costeo y Auditor.'}</p>
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 @xl:grid-cols-2">
              <label className="text-xs text-tinta-2 dark:text-slate-400">Vence
                <input type="date" className={`${input} mt-0.5`} value={nuevo.venceAt} onChange={e => setNuevo({ ...nuevo, venceAt: e.target.value })} /></label>
              <label className="text-xs text-tinta-2 dark:text-slate-400">Usuarios máximos
                <input type="number" min={1} className={`${input} mt-0.5`} value={nuevo.maxUsuarios} onChange={e => setNuevo({ ...nuevo, maxUsuarios: Math.max(1, Number(e.target.value) || 1) })} /></label>
            </div>
            {extrasNuevo.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-tinta-2 dark:text-slate-400">Adicionales (se suman al plan)</p>
                <div className="mt-1.5 grid gap-1.5 @xl:grid-cols-2">
                  {extrasNuevo.map(m => (
                    <label key={m} className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300">
                      <input type="checkbox" className="accent-teal-700" checked={nuevo.modulos.includes(m)}
                        onChange={() => setNuevo({ ...nuevo, modulos: nuevo.modulos.includes(m) ? nuevo.modulos.filter(x => x !== m) : [...nuevo.modulos, m] })} />
                      {NOMBRE_MODULO[m]}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </Modal>
    </AppLayout>
  );
}
