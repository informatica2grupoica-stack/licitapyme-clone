'use client';

// Solicitudes de alta que llegan del formulario público /registro. Solo el superusuario y los admin de Grupo ICA.
// Aprobar crea la empresa y su administrador y muestra UNA vez el enlace para que cree su clave; rechazar guarda el motivo.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/app/components/AppLayout';
import { useToast } from '@/app/components/ui/toast';
import { Modal } from '@/app/components/ui/Modal';
import { EnlaceBienvenida } from '@/app/components/EnlaceBienvenida';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { NOMBRE_PLAN, PLANES, type Plan } from '@/app/lib/modulos';

interface Solicitud {
  id: number; razon_social: string; rut: string; contacto_nombre: string; contacto_email: string; contacto_telefono: string | null;
  mensaje: string | null; estado: string; cliente_id: number | null; motivo: string | null; created_at: string; resuelta_at: string | null;
}

const input = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
const chip: Record<string, string> = {
  PENDIENTE: 'bg-amber-50 text-amber-800 border-amber-200', APROBADA: 'bg-emerald-50 text-emerald-800 border-emerald-200', RECHAZADA: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function SolicitudesPage() {
  const toast = useToast();
  const [lista, setLista] = useState<Solicitud[] | null>(null);
  const [aprobando, setAprobando] = useState<Solicitud | null>(null);
  const [rechazando, setRechazando] = useState<Solicitud | null>(null);
  const [plan, setPlan] = useState<Plan>('BASICO');
  const [maxUsuarios, setMaxUsuarios] = useState('3');
  const [venceAt, setVenceAt] = useState('');
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [entrega, setEntrega] = useState<{ email: string; clave: string; empresa: string; enlace: string | null } | null>(null);

  const cargar = useCallback(async () => {
    const d = await fetch('/api/admin/solicitudes').then(r => r.json()).catch(() => ({}));
    if (d.error) { toast.error('No se pudieron leer', d.error); setLista([]); return; }
    setLista(d.solicitudes || []);
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const abrirAprobar = (s: Solicitud) => {
    setAprobando(s); setPlan('BASICO'); setMaxUsuarios('3');
    const d = new Date(); d.setFullYear(d.getFullYear() + 1); setVenceAt(d.toISOString().slice(0, 10));
  };

  const post = async (cuerpo: Record<string, unknown>) => {
    setTrabajando(true);
    const r = await fetch('/api/admin/solicitudes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json().catch(() => ({}));
    setTrabajando(false);
    return { ok: r.ok, d };
  };

  const aprobar = async () => {
    if (!aprobando) return;
    const { ok, d } = await post({ accion: 'aprobar', id: aprobando.id, plan, maxUsuarios: Number(maxUsuarios) || 1, venceAt: venceAt || null });
    if (!ok) { toast.error('No se pudo aprobar', d.error || 'Error'); return; }
    setEntrega({ email: d.email, clave: d.clave, enlace: d.enlace ?? null, empresa: aprobando.razon_social });
    setAprobando(null); cargar();
  };
  const rechazar = async () => {
    if (!rechazando) return;
    const { ok, d } = await post({ accion: 'rechazar', id: rechazando.id, motivo });
    if (!ok) { toast.error('No se pudo rechazar', d.error || 'Error'); return; }
    toast.success('Solicitud rechazada', rechazando.razon_social);
    setRechazando(null); setMotivo(''); cargar();
  };

  const pendientes = (lista || []).filter(s => s.estado === 'PENDIENTE').length;

  return (
    <AppLayout breadcrumb={[{ label: 'Empresas-cliente', href: '/admin/clientes' }, { label: 'Solicitudes' }]}>
      <div className="@container mx-auto max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
        <Encabezado
          titulo={`Solicitudes de alta${lista ? ` · ${pendientes} pendiente${pendientes === 1 ? '' : 's'}` : ''}`}
          descripcion="Llegan del formulario público /registro. Nada se crea ni se gasta hasta que apruebas."
          acciones={<Link href="/admin/clientes" className="text-sm font-medium text-teal-700 hover:underline">Ver empresas-cliente</Link>}
        />

        {lista === null ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Esqueleto key={i} className="h-20" />)}</div>
        ) : lista.length === 0 ? (
          <Vacio titulo="Aún no hay solicitudes" texto="Cuando una empresa complete /registro, aparecerá aquí." />
        ) : (
          <ul className="space-y-2">
            {lista.map(s => (
              <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900 dark:text-slate-50">{s.razon_social}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${chip[s.estado] || chip.RECHAZADA}`}>{s.estado === 'PENDIENTE' ? 'Pendiente' : s.estado === 'APROBADA' ? 'Aprobada' : 'Rechazada'}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">RUT {s.rut} · {s.contacto_nombre} · {s.contacto_email}{s.contacto_telefono ? ` · ${s.contacto_telefono}` : ''}</p>
                    {s.mensaje && <p className="mt-1 text-sm text-slate-500">“{s.mensaje}”</p>}
                    <p className="mt-1 text-xs text-slate-400">Recibida {s.created_at}{s.resuelta_at ? ` · resuelta ${s.resuelta_at}` : ''}{s.motivo ? ` · motivo: ${s.motivo}` : ''}</p>
                  </div>
                  {s.estado === 'PENDIENTE' && (
                    <div className="flex gap-2">
                      <Boton variante="primario" onClick={() => abrirAprobar(s)}>Aprobar</Boton>
                      <Boton onClick={() => { setRechazando(s); setMotivo(''); }}>Rechazar</Boton>
                    </div>
                  )}
                  {s.estado === 'APROBADA' && s.cliente_id && <Link href="/admin/clientes" className="text-sm font-medium text-teal-700 hover:underline">Ver empresa #{s.cliente_id}</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={!!aprobando} onClose={() => setAprobando(null)} size="md" title="Aprobar solicitud" subtitle={aprobando ? `${aprobando.razon_social} · RUT ${aprobando.rut}` : ''}
        footer={<><Boton onClick={() => setAprobando(null)}>Cancelar</Boton><Boton variante="primario" disabled={trabajando} onClick={aprobar}>{trabajando ? 'Creando…' : 'Aprobar y crear empresa'}</Boton></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Se crea la empresa, su administrador ({aprobando?.contacto_email}) y se encola la evaluación de su RUT en Mercado Público. Todo se puede cambiar después en su ficha.</p>
          <label className="block text-sm">Plan
            <select className={input} value={plan} onChange={e => setPlan(e.target.value as Plan)}>
              {PLANES.map(p => <option key={p} value={p}>{NOMBRE_PLAN[p]}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Usuarios máximos<input className={input} type="number" min={1} value={maxUsuarios} onChange={e => setMaxUsuarios(e.target.value)} /></label>
            <label className="block text-sm">Vence<input className={input} type="date" value={venceAt} onChange={e => setVenceAt(e.target.value)} /></label>
          </div>
        </div>
      </Modal>

      <Modal open={!!rechazando} onClose={() => setRechazando(null)} size="md" title="Rechazar solicitud" subtitle={rechazando?.razon_social}
        footer={<><Boton onClick={() => setRechazando(null)}>Cancelar</Boton><Boton variante="primario" disabled={trabajando} onClick={rechazar}>Rechazar</Boton></>}>
        <label className="block text-sm">Motivo (solo lo ves tú)
          <textarea className={input} rows={3} maxLength={300} value={motivo} onChange={e => setMotivo(e.target.value)} />
        </label>
        <p className="mt-2 text-xs text-slate-500">Al rechazar se borran el teléfono y el mensaje de la solicitud.</p>
      </Modal>

      <Modal open={!!entrega} onClose={() => setEntrega(null)} size="md" title="Empresa creada" subtitle={entrega?.empresa}
        footer={<Boton variante="primario" onClick={() => setEntrega(null)}>Listo, ya lo copié</Boton>}>
        {entrega?.enlace ? (
          <>
            <p className="mb-3 text-sm text-slate-600">La empresa ya está creada. Envíale este enlace a su administrador: con él crea su propia clave e ingresa con su correo.</p>
            <EnlaceBienvenida ruta={entrega.enlace} email={entrega.email} />
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">No se pudo crear el enlace. Entrégale estos datos de acceso. La clave <b>no se vuelve a mostrar</b>; si se pierde, genera un enlace desde la ficha de la empresa.</p>
            <dl className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div><dt className="text-xs text-slate-500">Correo</dt><dd className="font-mono">{entrega?.email}</dd></div>
              <div><dt className="text-xs text-slate-500">Clave temporal</dt><dd className="font-mono text-base">{entrega?.clave}</dd></div>
            </dl>
          </>
        )}
      </Modal>
    </AppLayout>
  );
}
