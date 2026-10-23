'use client';

// Panel del superusuario: empresas-cliente, módulos contratados, vencimiento y estado.
// Activar un módulo = marcar la casilla; rige al instante (el cliente lo ve desbloqueado en su próxima carga).
import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast } from '@/app/components/ui/toast';
import { NOMBRE_MODULO, type Modulo } from '@/app/lib/modulos';

interface Cliente {
  id: number; nombre: string; rut: string | null; plan: string; estado: string; max_usuarios: number | null;
  modulos: Modulo[]; vence_at: string | null; usuarios: number; contacto_email: string | null; notas: string | null;
}
interface Mov { cliente_id: number; accion: string; detalle: unknown; created_at: string; por: string | null }

const input = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';

export default function ClientesPage() {
  const toast = useToast();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [catalogo, setCatalogo] = useState<Modulo[]>([]);
  const [bitacora, setBitacora] = useState<Mov[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState({ nombre: '', rut: '', adminNombre: '', adminEmail: '', clave: '', venceAt: '' });
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/admin/clientes');
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error('No se pudo cargar', d.error || `HTTP ${r.status}`); setCargando(false); return; }
    setClientes(d.clientes); setCatalogo(d.catalogo); setBitacora(d.bitacora || []); setCargando(false);
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = async (id: number, cambio: Record<string, unknown>) => {
    const r = await fetch('/api/admin/clientes', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...cambio }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) toast.error('No se guardó', d.error || `HTTP ${r.status}`); else cargar();
  };
  const alternarModulo = (c: Cliente, m: Modulo) =>
    cambiar(c.id, { modulos: c.modulos.includes(m) ? c.modulos.filter(x => x !== m) : [...c.modulos, m] });

  const crear = async () => {
    setCreando(true);
    const r = await fetch('/api/admin/clientes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...nuevo, venceAt: nuevo.venceAt || null }) });
    const d = await r.json().catch(() => ({}));
    setCreando(false);
    if (!r.ok) { toast.error('No se creó', d.error || `HTTP ${r.status}`); return; }
    toast.success('Empresa creada', 'Entra con el mismo login. Entrega la clave temporal por un canal seguro.');
    setNuevo({ nombre: '', rut: '', adminNombre: '', adminEmail: '', clave: '', venceAt: '' });
    cargar();
  };

  return (
    <AppLayout breadcrumb={[{ label: 'Empresas-cliente' }]}>
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        <header>
          <h1 className="text-lg font-medium text-slate-900">Empresas-cliente</h1>
          <p className="text-sm text-slate-500">Cada empresa usa el mismo LICITANK. Aquí decides qué módulos tiene activos.</p>
        </header>

        {cargando && <p className="text-sm text-slate-500">Cargando…</p>}

        {clientes.map(c => (
          <section key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-medium text-slate-900">{c.nombre}</h2>
                <p className="text-xs text-slate-500">{c.rut || 'sin RUT'} · {c.usuarios} de {c.max_usuarios ?? '∞'} usuarios · {c.contacto_email || 'sin contacto'}</p>
              </div>
              {c.id === 1 ? (
                <span className="text-xs text-slate-500">Grupo ICA · todos los módulos</span>
              ) : (
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.estado === 'ACTIVO' ? 'text-slate-700' : 'text-red-600'}`}>
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${c.estado === 'ACTIVO' ? 'bg-emerald-500' : 'bg-red-500'}`} />{c.estado === 'ACTIVO' ? 'Activa' : c.estado === 'SUSPENDIDO' ? 'Suspendida' : 'De baja'}
                </span>
              )}
            </div>

            {c.id !== 1 && (
              <>
                <dl className="mt-3 border-t border-slate-100 pt-3">
                  <dt className="text-[11px] text-slate-500">Módulos activos</dt>
                  <dd className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                    {catalogo.map(m => (
                      <label key={m} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" className="accent-teal-700" checked={c.modulos.includes(m)} onChange={() => alternarModulo(c, m)} />
                        {NOMBRE_MODULO[m]}
                      </label>
                    ))}
                  </dd>
                </dl>
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                  <label className="text-[11px] text-slate-500">Vence
                    <input type="date" defaultValue={c.vence_at || ''} className={`${input} mt-0.5 w-40`} onBlur={e => e.target.value !== (c.vence_at || '') && cambiar(c.id, { venceAt: e.target.value || null })} />
                  </label>
                  <label className="text-[11px] text-slate-500">Usuarios máx.
                    <input type="number" min={1} defaultValue={c.max_usuarios ?? 1} className={`${input} mt-0.5 w-24`} onBlur={e => Number(e.target.value) !== c.max_usuarios && cambiar(c.id, { maxUsuarios: Number(e.target.value) })} />
                  </label>
                  <button onClick={() => cambiar(c.id, { estado: c.estado === 'ACTIVO' ? 'SUSPENDIDO' : 'ACTIVO' })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${c.estado === 'ACTIVO' ? 'border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-teal-700 text-white hover:bg-teal-800'}`}>
                    {c.estado === 'ACTIVO' ? 'Suspender' : 'Reactivar'}
                  </button>
                </div>
              </>
            )}
          </section>
        ))}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="font-medium text-slate-900">Nueva empresa</h2>
          <p className="text-xs text-slate-500">Parte con Radar y Negocios y un perfil admin. Los demás módulos se activan arriba cuando los pague.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-slate-500">Razón social<input className={`${input} mt-0.5`} value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">RUT<input className={`${input} mt-0.5`} value={nuevo.rut} onChange={e => setNuevo({ ...nuevo, rut: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Nombre del admin<input className={`${input} mt-0.5`} value={nuevo.adminNombre} onChange={e => setNuevo({ ...nuevo, adminNombre: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Correo del admin (su usuario)<input type="email" className={`${input} mt-0.5`} value={nuevo.adminEmail} onChange={e => setNuevo({ ...nuevo, adminEmail: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Clave temporal (mín. 8)<input type="text" className={`${input} mt-0.5`} value={nuevo.clave} onChange={e => setNuevo({ ...nuevo, clave: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Vence (opcional)<input type="date" className={`${input} mt-0.5`} value={nuevo.venceAt} onChange={e => setNuevo({ ...nuevo, venceAt: e.target.value })} /></label>
          </div>
          <button disabled={creando || !nuevo.nombre || !nuevo.adminEmail || nuevo.clave.length < 8} onClick={crear}
            className="mt-3 rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">
            {creando ? 'Creando…' : 'Crear empresa'}
          </button>
        </section>

        {bitacora.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-medium text-slate-900">Últimos movimientos</h2>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {bitacora.map((m, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span className="text-slate-700">{clientes.find(c => c.id === m.cliente_id)?.nombre || `#${m.cliente_id}`} · {m.accion} <span className="text-xs text-slate-400">{JSON.stringify(m.detalle)}</span></span>
                  <span className="text-xs tabular-nums text-slate-500">{m.por || '—'} · {new Date(m.created_at).toLocaleString('es-CL')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
