'use client';

// Cuentas propias de la empresa-cliente (multiempresa, Etapa 2): ticket de Mercado Público y correo de envío.
// Solo el admin de una empresa-cliente (no Grupo ICA). Los secretos nunca vuelven al navegador: solo se muestra la pista.
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';

type Item = { pista: string | null; verificado_at: string | null } | null;
const campo = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
const boton = 'rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50';
const botonSec = 'rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50';
const CORREO_VACIO = { host: '', port: '587', user: '', pass: '', from: '' };

export function IntegracionesEmpresa() {
  const { usuario } = useSession();
  const toast = useToast();
  const aplica = usuario?.rol === 'admin' && !!usuario.clienteId && usuario.clienteId !== 1;
  const [d, setD] = useState<{ mp_ticket: Item; correo: Item } | null>(null);
  const [ticket, setTicket] = useState('');
  const [correo, setCorreo] = useState(CORREO_VACIO);
  const [editando, setEditando] = useState<'mp_ticket' | 'correo' | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/mi-empresa/integraciones').then(x => x.json()).catch(() => ({}));
    if (r.integraciones) setD(r.integraciones);
  }, []);
  useEffect(() => { if (aplica) cargar(); }, [aplica, cargar]);
  if (!aplica) return null;

  const guardar = async (cuerpo: Record<string, unknown>) => {
    setOcupado(true);
    try {
      const r = await fetch('/api/mi-empresa/integraciones', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error('No se guardó', j.error || `HTTP ${r.status}`); return; }
      toast.success('Guardado y probado', j.aviso || undefined);
      setEditando(null); setTicket(''); setCorreo(CORREO_VACIO); cargar();
    } finally { setOcupado(false); }
  };
  const quitar = async (tipo: 'mp_ticket' | 'correo') => {
    if (!confirm(tipo === 'mp_ticket' ? '¿Quitar tu ticket? Volverás a usar el compartido, con el tope diario de tu plan.' : '¿Quitar tu correo de envío? No se podrán enviar correos a tu nombre.')) return;
    await fetch(`/api/mi-empresa/integraciones?tipo=${tipo}`, { method: 'DELETE' });
    cargar();
  };
  const estado = (i: Item) => i
    ? <span className="text-xs text-emerald-700">Configurado: {i.pista}</span>
    : <span className="text-xs text-slate-500">Sin configurar</span>;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-medium text-slate-900">Integraciones</h2>
      <p className="mt-1 text-sm text-slate-500">Tus propias cuentas. Las claves se guardan cifradas y nadie las vuelve a ver: para cambiarlas, escríbelas de nuevo.</p>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-slate-800">Ticket de Mercado Público</h3>
            <p className="text-xs text-slate-500">Con tu ticket, las consultas a Mercado Público salen con tu propia cuota. Sin él, usas el compartido con el tope diario de tu plan.
              Se pide gratis en <a className="text-teal-700 underline" href="https://api.mercadopublico.cl" target="_blank" rel="noreferrer">api.mercadopublico.cl</a> con la Clave Única de la persona a cargo.</p>
          </div>
          {estado(d?.mp_ticket ?? null)}
        </div>
        {editando === 'mp_ticket' ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <input className={`${campo} max-w-md font-mono`} placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" value={ticket} onChange={e => setTicket(e.target.value)} autoComplete="off" />
            <button className={boton} disabled={ocupado || ticket.trim().length < 20} onClick={() => guardar({ tipo: 'mp_ticket', ticket })}>{ocupado ? 'Probando…' : 'Probar y guardar'}</button>
            <button className={botonSec} onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <button className={botonSec} onClick={() => setEditando('mp_ticket')}>{d?.mp_ticket ? 'Cambiar' : 'Agregar ticket'}</button>
            {d?.mp_ticket && <button className={botonSec} onClick={() => quitar('mp_ticket')}>Quitar</button>}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-slate-800">Correo de envío</h3>
            <p className="text-xs text-slate-500">Lo que se manda a tu nombre (por ejemplo, órdenes de compra a proveedores) sale desde esta cuenta. Sirve cualquier servicio con SMTP: Google Workspace, Microsoft 365, Brevo, el correo de tu hosting.</p>
          </div>
          {estado(d?.correo ?? null)}
        </div>
        {editando === 'correo' ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] text-slate-500">Servidor SMTP<input className={`${campo} mt-0.5`} placeholder="smtp.gmail.com" value={correo.host} onChange={e => setCorreo({ ...correo, host: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Puerto (587 o 465)<input className={`${campo} mt-0.5`} inputMode="numeric" value={correo.port} onChange={e => setCorreo({ ...correo, port: e.target.value })} /></label>
            <label className="text-[11px] text-slate-500">Usuario (la casilla completa)<input className={`${campo} mt-0.5`} placeholder="ventas@tuempresa.cl" value={correo.user} onChange={e => setCorreo({ ...correo, user: e.target.value })} autoComplete="off" /></label>
            <label className="text-[11px] text-slate-500">Clave (o clave de aplicación)<input type="password" className={`${campo} mt-0.5`} value={correo.pass} onChange={e => setCorreo({ ...correo, pass: e.target.value })} autoComplete="new-password" /></label>
            <label className="text-[11px] text-slate-500 sm:col-span-2">Remitente que verán (opcional)<input className={`${campo} mt-0.5`} placeholder='Tu Empresa SpA <ventas@tuempresa.cl>' value={correo.from} onChange={e => setCorreo({ ...correo, from: e.target.value })} /></label>
            <div className="flex gap-2 sm:col-span-2">
              <button className={boton} disabled={ocupado || !correo.host || !correo.user || !correo.pass}
                onClick={() => guardar({ tipo: 'correo', ...correo, port: Number(correo.port), secure: Number(correo.port) === 465 })}>{ocupado ? 'Probando…' : 'Probar y guardar'}</button>
              <button className={botonSec} onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <button className={botonSec} onClick={() => setEditando('correo')}>{d?.correo ? 'Cambiar' : 'Agregar correo'}</button>
            {d?.correo && <button className={botonSec} onClick={() => quitar('correo')}>Quitar</button>}
          </div>
        )}
      </div>
    </section>
  );
}
