'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { IconBrandWhatsapp as Whatsapp, IconLoader2 as Loader2, IconPlugConnectedX as Desvincular, IconRefresh as Refrescar, IconSend as Send } from '@tabler/icons-react';

type Estado = 'open' | 'connecting' | 'close' | 'sin_instancia';
interface Fila { id: number; tipo: string; licitacion_codigo: string; estado: string; intentos: number; error: string | null; creado_at: string; enviado_at: string | null; nombre: string | null }
interface Datos {
  configurado: boolean; estado?: Estado; numero?: string | null; migracion?: boolean;
  resumen?: { pendientes: number; errores: number; enviadosHoy: number; topeDiario: number; ultimos: Fila[] } | null;
}

const TIPO: Record<string, string> = { ganada: 'Ganada', perdida: 'Perdida', apertura: 'Apertura' };
const ESTADO: Record<string, string> = { pendiente: 'text-amber-600', enviado: 'text-emerald-600', error: 'text-red-600' };
const fmtNumero = (n: string | null | undefined) => (n && /^56\d{9}$/.test(n) ? `+56 ${n[2]} ${n.slice(3, 7)} ${n.slice(7)}` : n ? `+${n}` : '');

export default function AvisosWhatsappPage() {
  const { usuario } = useSession();
  const toast = useToast();
  const [d, setD] = useState<Datos | null>(null);
  const [qr, setQr] = useState<{ img: string | null; codigo: string | null } | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/whatsapp/estado');
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'No se pudo consultar'); return; }
      setError(''); setD(j);
      if (j.estado === 'open') setQr(null);
    } catch { setError('Error de conexión'); }
  }, []);

  useEffect(() => { if (usuario) cargar(); }, [usuario, cargar]);
  useEffect(() => {
    if (d?.estado !== 'connecting') return;
    const t = setInterval(cargar, 3000);
    return () => clearInterval(t);
  }, [d?.estado, cargar]);

  const accion = async (nombre: string, fn: () => Promise<Response>, ok?: string) => {
    setOcupado(nombre); setError('');
    try {
      const r = await fn(); const j = await r.json();
      if (!r.ok) { setError(j.error || 'No se pudo completar'); return null; }
      if (ok) toast.success(ok);
      return j;
    } catch { setError('Error de conexión'); return null; }
    finally { setOcupado(null); }
  };

  const conectar = async () => {
    const j = await accion('qr', () => fetch('/api/admin/whatsapp/estado', { method: 'POST' }));
    if (j) { setQr({ img: j.qr, codigo: j.codigo }); await cargar(); }
  };
  const desvincular = async () => {
    if (!confirm('¿Desvincular el número emisor? Dejarán de salir avisos por WhatsApp hasta volver a vincularlo.')) return;
    if (await accion('del', () => fetch('/api/admin/whatsapp/estado', { method: 'DELETE' }), 'Número desvinculado')) { setQr(null); await cargar(); }
  };
  const prueba = () => accion('prueba', () => fetch('/api/admin/whatsapp/estado', { method: 'PUT' }), 'Mensaje de prueba enviado a tu celular');
  const reintentar = async () => { if (await accion('retry', () => fetch('/api/admin/whatsapp/estado', { method: 'PATCH' }), 'Reintento hecho')) cargar(); };

  if (!usuario) return null;
  const r = d?.resumen;

  return (
    <AppLayout breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Avisos por WhatsApp' }]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600"><Whatsapp size={20} /></div>
          <div>
            <h1 className="text-[15px] font-bold text-slate-900">Avisos por WhatsApp</h1>
            <p className="text-xs text-slate-500">Desde el número de la empresa, al equipo: licitaciones ganadas, perdidas y aperturas</p>
          </div>
        </div>

        {error && <div className="px-4 py-3 rounded-xl text-[13px] bg-red-50 border border-red-200 text-red-700">{error}</div>}
        {d && !d.configurado && <div className="px-4 py-3 rounded-xl text-[13px] bg-amber-50 border border-amber-200 text-amber-800">El servicio de WhatsApp no está configurado en este servidor (faltan EVOLUTION_API_URL y EVOLUTION_API_KEY).</div>}
        {d?.configurado && d.migracion === false && <div className="px-4 py-3 rounded-xl text-[13px] bg-amber-50 border border-amber-200 text-amber-800">Falta aplicar la migración 178 (tablas de avisos): <code>node scripts/aplicar-migration-178.mjs</code></div>}
        {!d && !error && <div className="flex justify-center py-12 text-slate-400"><Loader2 className="animate-spin" /></div>}

        {d?.configurado && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Número emisor</p>
            {d.estado === 'open' ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Conectado {d.numero ? `· ${fmtNumero(d.numero)}` : ''}</span>
                <span className="flex-1" />
                <button type="button" onClick={prueba} disabled={!!ocupado} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  {ocupado === 'prueba' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Enviarme una prueba
                </button>
                <button type="button" onClick={desvincular} disabled={!!ocupado} className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-red-600"><Desvincular size={14} /> Desvincular</button>
              </div>
            ) : (
              <div className="text-center py-2">
                {qr?.img ? (
                  <>
                    <img src={qr.img} alt="Código QR de WhatsApp" className="w-60 h-60 mx-auto rounded-lg border border-slate-200" />
                    <p className="text-[13px] font-semibold text-slate-800 mt-3">Escanéalo desde el celular del número emisor</p>
                    <p className="text-[12px] text-slate-500 mt-1">WhatsApp → Dispositivos vinculados → Vincular un dispositivo. Vence en ~1 minuto.</p>
                  </>
                ) : (
                  <p className="text-[13px] text-slate-600 mb-3">No hay un número vinculado. Vincula el celular desde el que saldrán los avisos.</p>
                )}
                <button type="button" onClick={conectar} disabled={!!ocupado} className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-[13px]">
                  {ocupado === 'qr' ? <Loader2 size={14} className="animate-spin" /> : qr?.img ? <Refrescar size={14} /> : <Whatsapp size={14} />} {qr?.img ? 'Generar otro código' : 'Mostrar código QR'}
                </button>
              </div>
            )}
            <p className="text-[11.5px] text-slate-400 mt-4 leading-snug">
              Se vincula como un dispositivo más de WhatsApp (conexión no oficial): úsalo con un número de la empresa que ya conozcan tus contactos, solo para avisar al equipo. Los envíos salen de a uno, con pausa y un tope diario.
            </p>
          </div>
        )}

        {r && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-3 text-[12.5px] text-slate-600">
              <span><b className="text-slate-900">{r.enviadosHoy}</b> enviados hoy (tope {r.topeDiario})</span>
              <span><b className="text-slate-900">{r.pendientes}</b> pendientes</span>
              {r.errores > 0 && <span className="text-red-600"><b>{r.errores}</b> con error</span>}
              <span className="flex-1" />
              {r.pendientes > 0 && <button type="button" onClick={reintentar} disabled={!!ocupado} className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">Reintentar ahora</button>}
            </div>
            {r.ultimos.length === 0 ? <p className="text-[12.5px] text-slate-400">Aún no se ha enviado ningún aviso.</p> : (
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[11px] text-slate-400 uppercase"><th className="py-1.5 font-semibold">Aviso</th><th className="font-semibold">Licitación</th><th className="font-semibold">Para</th><th className="font-semibold">Estado</th></tr></thead>
                <tbody>{r.ultimos.map(f => (
                  <tr key={f.id} className="border-t border-slate-100">
                    <td className="py-1.5">{TIPO[f.tipo] ?? f.tipo}</td>
                    <td className="font-mono text-[11.5px]">{f.licitacion_codigo}</td>
                    <td className="truncate max-w-[140px]">{f.nombre ?? '—'}</td>
                    <td className={`font-semibold ${ESTADO[f.estado] ?? ''}`} title={f.error ?? ''}>{f.estado}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
