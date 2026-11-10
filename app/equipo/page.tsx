'use client';

// Mi equipo: el admin de la empresa administra a SU gente — perfil, permisos de los módulos que contrató, clave y estado.
// Todas las reglas (permisos válidos, último admin, tope del plan) las impone /api/equipo; aquí solo se dibujan.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast } from '@/app/components/ui/toast';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Encabezado, Vacio, Esqueleto } from '@/app/components/ui/kit/Estructura';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { NOMBRE_MODULO } from '@/app/lib/modulos';

interface Persona { id: number; nombre: string | null; email: string; rol: string; activo: number; ultimo_login: string | null; permisos: Record<string, boolean> }
interface PermisoDef { clave: string; modulo: string; etiqueta: string; ayuda: string }
interface Perfil { id: string; nombre: string; descripcion: string; rol: 'admin' | 'usuario' | 'externo'; permisos: string[] }
interface Borrador { nombre: string; perfil: string; permisos: Set<string> }

const PERSONALIZADO = 'personalizado';
const campo = 'w-full rounded-lg border border-linea bg-white px-2.5 py-1.5 text-sm text-tinta focus:outline-none focus:ring-2 focus:ring-marca/60 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100';
const rotulo = 'text-[11px] text-tinta-2 dark:text-slate-400';

const fechaCorta = (s: string | null) => s ? new Date(s).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Nunca ha entrado';

export default function EquipoPage() {
  const toast = useToast();
  const [cargado, setCargado] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [catalogo, setCatalogo] = useState<PermisoDef[]>([]);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [max, setMax] = useState<number | null>(null);
  const [admin, setAdmin] = useState(false);
  const [yo, setYo] = useState<number | null>(null);

  const [editando, setEditando] = useState<number | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [claveMostrada, setClaveMostrada] = useState<{ id: number; clave: string } | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [nueva, setNueva] = useState({ nombre: '', email: '', clave: '', perfil: 'analista' });
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/equipo'); const d = await r.json().catch(() => ({}));
    if (r.ok) { setPersonas(d.personas); setMax(d.maxUsuarios); setAdmin(d.puedeAdministrar); setYo(d.yo); setCatalogo(d.catalogo ?? []); setPerfiles(d.perfiles ?? []); }
    setCargado(true);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const activos = personas.filter(p => p.activo).length;
  const lleno = max != null && activos >= max;
  const clavesCatalogo = useMemo(() => new Set(catalogo.map(c => c.clave)), [catalogo]);
  const porModulo = useMemo(() => {
    const m = new Map<string, PermisoDef[]>();
    for (const c of catalogo) m.set(c.modulo, [...(m.get(c.modulo) ?? []), c]);
    return [...m.entries()];
  }, [catalogo]);

  /** Qué perfil «es» una persona hoy: por rol, o por coincidencia exacta de permisos; si no calza ninguno, personalizado. */
  const perfilDe = useCallback((p: Persona): string => {
    if (p.rol === 'admin') return 'admin';
    if (p.rol === 'externo') return 'externo';
    const suyos = Object.keys(p.permisos).filter(k => p.permisos[k] && clavesCatalogo.has(k)).sort().join(',');
    const igual = perfiles.find(f => f.rol === 'usuario' && [...f.permisos].sort().join(',') === suyos);
    return igual?.id ?? PERSONALIZADO;
  }, [perfiles, clavesCatalogo]);
  const nombrePerfil = (id: string) => perfiles.find(f => f.id === id)?.nombre ?? 'Personalizado';

  const abrirEditor = (p: Persona) => {
    if (editando === p.id) { setEditando(null); setBorrador(null); return; }
    setEditando(p.id); setClaveMostrada(null);
    setBorrador({ nombre: p.nombre ?? '', perfil: perfilDe(p), permisos: new Set(Object.keys(p.permisos).filter(k => p.permisos[k] && clavesCatalogo.has(k))) });
  };
  const elegirPerfil = (id: string) => {
    if (!borrador) return;
    const f = perfiles.find(x => x.id === id);
    setBorrador({ ...borrador, perfil: id, permisos: new Set(f ? f.permisos : borrador.permisos) });
  };
  const marcar = (clave: string) => {
    if (!borrador) return;
    const s = new Set(borrador.permisos);
    if (s.has(clave)) s.delete(clave); else s.add(clave);
    setBorrador({ ...borrador, perfil: PERSONALIZADO, permisos: s });
  };

  const enviar = async (cuerpo: Record<string, unknown>, ok: string): Promise<{ claveTemporal?: string } | null> => {
    setOcupado(true);
    const r = await fetch('/api/equipo', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({})); setOcupado(false);
    if (!r.ok) { toast.error('No se pudo guardar', d.error || `HTTP ${r.status}`); return null; }
    toast.success(ok, ''); await cargar(); return d;
  };
  const guardar = async (p: Persona) => {
    if (!borrador) return;
    const esPersonalizado = borrador.perfil === PERSONALIZADO;
    const cuerpo = esPersonalizado
      ? { id: p.id, nombre: borrador.nombre, rol: 'usuario', permisos: Object.fromEntries([...borrador.permisos].map(k => [k, true])) }
      : { id: p.id, nombre: borrador.nombre, perfil: borrador.perfil };
    if (await enviar(cuerpo, 'Cambios guardados')) { setEditando(null); setBorrador(null); }
  };
  const restablecerClave = async (p: Persona) => {
    if (!window.confirm(`Se generará una clave nueva para ${p.nombre || p.email}. La clave actual dejará de servir. ¿Continuar?`)) return;
    const d = await enviar({ id: p.id, resetClave: true }, 'Clave restablecida');
    if (d?.claveTemporal) setClaveMostrada({ id: p.id, clave: d.claveTemporal });
  };
  const cambiarActivo = async (p: Persona) => {
    if (p.activo && !window.confirm(`${p.nombre || p.email} dejará de poder entrar. ¿Desactivar?`)) return;
    await enviar({ id: p.id, activo: !p.activo }, p.activo ? 'Persona desactivada' : 'Persona reactivada');
  };

  const generarClave = () => {
    const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = new Uint8Array(12); crypto.getRandomValues(b);
    setNueva(n => ({ ...n, clave: Array.from(b, x => a[x % a.length]).join('') }));
  };
  const agregar = async () => {
    setOcupado(true);
    const r = await fetch('/api/equipo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(nueva) });
    const d = await r.json().catch(() => ({})); setOcupado(false);
    if (!r.ok) { toast.error('No se agregó', d.error || `HTTP ${r.status}`); return; }
    toast.success('Persona agregada', 'Entra con su correo y la clave temporal. Entrégasela por un canal seguro.');
    setNueva({ nombre: '', email: '', clave: '', perfil: 'analista' }); setAgregando(false); cargar();
  };

  return (
    <AppLayout breadcrumb={[{ label: 'Mi equipo' }]}>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Encabezado
          titulo="Mi equipo"
          descripcion={cargado ? `${activos} de ${max ?? '∞'} personas activas en tu plan.` : undefined}
          acciones={admin && !lleno ? <Boton variante="primario" onClick={() => setAgregando(v => !v)}>{agregando ? 'Cerrar' : 'Agregar persona'}</Boton> : undefined}
        />

        {admin && lleno && (
          <p className="mb-4 rounded-xl border border-linea bg-white px-4 py-3 text-sm text-tinta-2 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
            Llegaste al tope de tu plan. Para sumar más personas, escríbenos.
          </p>
        )}

        {admin && agregando && !lleno && (
          <section className="mb-5 rounded-xl border border-linea bg-white p-4 shadow-tarjeta dark:bg-slate-900 dark:border-slate-800">
            <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100">Agregar una persona</h2>
            <div className="mt-3 grid gap-3 @container sm:grid-cols-2">
              <label className={rotulo}>Nombre<input className={`${campo} mt-0.5`} value={nueva.nombre} onChange={e => setNueva({ ...nueva, nombre: e.target.value })} /></label>
              <label className={rotulo}>Correo (será su usuario)<input type="email" className={`${campo} mt-0.5`} value={nueva.email} onChange={e => setNueva({ ...nueva, email: e.target.value })} /></label>
              <label className={rotulo}>Perfil
                <select className={`${campo} mt-0.5`} value={nueva.perfil} onChange={e => setNueva({ ...nueva, perfil: e.target.value })}>
                  {perfiles.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                </select>
              </label>
              <label className={rotulo}>Clave temporal (mínimo 8)
                <span className="mt-0.5 flex gap-2">
                  <input className={campo} value={nueva.clave} onChange={e => setNueva({ ...nueva, clave: e.target.value })} />
                  <Boton tamano="sm" onClick={generarClave} type="button">Generar</Boton>
                </span>
              </label>
            </div>
            <p className="mt-2 text-xs text-tinta-2 dark:text-slate-400">{perfiles.find(f => f.id === nueva.perfil)?.descripcion}</p>
            <div className="mt-3"><Boton variante="primario" disabled={ocupado || !nueva.email || nueva.clave.length < 8} onClick={agregar}>Agregar</Boton></div>
          </section>
        )}

        {!cargado ? (
          <div className="space-y-2"><Esqueleto className="h-16" /><Esqueleto className="h-16" /></div>
        ) : personas.length === 0 ? (
          <Vacio titulo="Todavía no hay personas" texto="Agrega a quienes van a trabajar contigo." />
        ) : (
          <ul className="divide-y divide-linea rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800 dark:divide-slate-800">
            {personas.map(p => {
              const esYo = p.id === yo;
              const abierto = editando === p.id && borrador;
              return (
                <li key={p.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-tinta dark:text-slate-100">{p.nombre || p.email}{esYo && <span className="ml-1.5 text-xs font-normal text-tinta-3">(tú)</span>}</p>
                      <p className="truncate text-xs text-tinta-2 dark:text-slate-400">{p.email} · {nombrePerfil(perfilDe(p))} · {fechaCorta(p.ultimo_login)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-tinta-2 dark:text-slate-300">
                        <Estado color={p.activo ? 'var(--color-exito, #16a34a)' : '#94a3b8'}>{p.activo ? 'Activa' : 'Desactivada'}</Estado>
                      </span>
                      {admin && <Boton tamano="sm" variante={abierto ? 'primario' : 'secundario'} onClick={() => abrirEditor(p)}>{abierto ? 'Cerrar' : 'Editar'}</Boton>}
                    </div>
                  </div>

                  {abierto && borrador && (
                    <div className="mt-3 space-y-4 border-t border-linea pt-3 dark:border-slate-800">
                      <div className="grid gap-3 @container sm:grid-cols-2">
                        <label className={rotulo}>Nombre<input className={`${campo} mt-0.5`} value={borrador.nombre} onChange={e => setBorrador({ ...borrador, nombre: e.target.value })} /></label>
                        <label className={rotulo}>Perfil
                          <select disabled={esYo} className={`${campo} mt-0.5 disabled:opacity-60`} value={borrador.perfil} onChange={e => elegirPerfil(e.target.value)}>
                            {perfiles.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                            {borrador.perfil === PERSONALIZADO && <option value={PERSONALIZADO}>Personalizado</option>}
                          </select>
                        </label>
                      </div>
                      <p className="text-xs text-tinta-2 dark:text-slate-400">
                        {esYo ? 'No puedes cambiarte tu propio perfil. ' : ''}{perfiles.find(f => f.id === borrador.perfil)?.descripcion ?? 'Permisos elegidos a mano.'}
                      </p>

                      {borrador.perfil !== 'admin' && borrador.perfil !== 'externo' && !esYo && (
                        <div className="space-y-3">
                          {porModulo.map(([modulo, defs]) => (
                            <fieldset key={modulo}>
                              <legend className="mb-1 text-xs font-semibold text-tinta dark:text-slate-200">{NOMBRE_MODULO[modulo as keyof typeof NOMBRE_MODULO] ?? modulo}</legend>
                              <div className="grid gap-x-4 gap-y-1 @container sm:grid-cols-2">
                                {defs.map(d => (
                                  <label key={d.clave} title={d.ayuda} className="flex items-start gap-2 py-0.5 text-[13px] text-tinta dark:text-slate-200">
                                    <input type="checkbox" className="mt-0.5 accent-teal-700" checked={borrador.permisos.has(d.clave)} onChange={() => marcar(d.clave)} />
                                    <span>{d.etiqueta}</span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          ))}
                        </div>
                      )}

                      {claveMostrada?.id === p.id && (
                        <div className="rounded-lg border border-linea bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-700">
                          <p className={rotulo}>Clave temporal (se muestra una sola vez; entrégasela por un canal seguro)</p>
                          <p className="mt-0.5 flex items-center gap-2 font-mono text-[15px] font-semibold tabular-nums text-tinta dark:text-slate-50">
                            {claveMostrada.clave}
                            <Boton tamano="sm" onClick={() => navigator.clipboard?.writeText(claveMostrada.clave).then(() => toast.success('Copiada', ''))}>Copiar</Boton>
                          </p>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Boton variante="primario" disabled={ocupado} onClick={() => guardar(p)}>Guardar cambios</Boton>
                        {!esYo && <Boton disabled={ocupado} onClick={() => restablecerClave(p)}>Restablecer clave</Boton>}
                        {!esYo && <Boton variante={p.activo ? 'peligro' : 'secundario'} disabled={ocupado} onClick={() => cambiarActivo(p)}>{p.activo ? 'Desactivar' : 'Reactivar'}</Boton>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppLayout>
  );
}
