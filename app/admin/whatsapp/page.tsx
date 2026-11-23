'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Banner } from '@/app/components/ui/Banner';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Encabezado, Esqueleto } from '@/app/components/ui/kit/Estructura';
import { Estado as EstadoPunto } from '@/app/components/ui/kit/Tarjeta';
import { IconBrandWhatsapp as Whatsapp, IconLoader2 as Loader2, IconPlugConnectedX as Desvincular, IconRefresh as Refrescar, IconSend as Send } from '@tabler/icons-react';

type Estado = 'open' | 'connecting' | 'close' | 'sin_instancia';
interface Fila { id: number; tipo: string; licitacion_codigo: string; estado: string; intentos: number; error: string | null; creado_at: string; enviado_at: string | null; nombre: string | null }
interface Datos {
  configurado: boolean; estado?: Estado; numero?: string | null; migracion?: boolean;
  resumen?: { pendientes: number; errores: number; enviadosHoy: number; topeDiario: number; ultimos: Fila[] } | null;
}

const TIPO: Record<string, string> = { ganada: 'Ganada', perdida: 'Perdida', estado_mp: 'Cerrada/revocada/desierta', apertura: 'Apertura', oc: 'Orden de compra', oc_vencer: 'OC por vencer', cierra_pronto: 'Cierra pronto', radar: 'Radar' };
const ESTADO_COLOR: Record<string, string> = { pendiente: '#d97706', enviado: '#16a34a', error: '#dc2626' };
const ESTADO_TEXTO: Record<string, string> = { pendiente: 'Pendiente', enviado: 'Enviado', error: 'Con error' };
const fmtNumero = (n: string | null | undefined) => (n && /^56\d{9}$/.test(n) ? `+56 ${n[2]} ${n.slice(3, 7)} ${n.slice(7)}` : n ? `+${n}` : '');
const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';

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
      <div className="@container p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
        <Encabezado
          titulo="Avisos por WhatsApp"
          descripcion="Desde el número de la empresa, a quien corresponde: ganadas, perdidas, estados, aperturas, órdenes de compra, cierres y radar."
        />

        {error && <Banner variante="error">{error}</Banner>}
        {d && !d.configurado && <Banner variante="warning">El servicio de WhatsApp no está configurado en este servidor (faltan EVOLUTION_API_URL y EVOLUTION_API_KEY).</Banner>}
        {d?.configurado && d.migracion === false && <Banner variante="warning">Falta aplicar la migración 178 (tablas de avisos): <code>node scripts/aplicar-migration-178.mjs</code></Banner>}
        {!d && !error && <div className="space-y-3"><Esqueleto className="h-32 rounded-xl" /><Esqueleto className="h-40 rounded-xl" /></div>}

        {d?.configurado && (
          <div className={`${SUPERFICIE} p-5`}>
            <h2 className="text-[15px] font-semibold text-tinta dark:text-slate-100 mb-3">Número emisor</h2>
            {d.estado === 'open' ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] font-medium text-tinta dark:text-slate-100">
                  <EstadoPunto color="#16a34a">Conectado {d.numero ? `· ${fmtNumero(d.numero)}` : ''}</EstadoPunto>
                </span>
                <span className="flex-1" />
                <Boton onClick={prueba} disabled={!!ocupado} icono={ocupado === 'prueba' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} stroke={1.75} />}>Enviarme una prueba</Boton>
                <Boton variante="peligro" onClick={desvincular} disabled={!!ocupado} icono={<Desvincular size={16} stroke={1.75} />}>Desvincular</Boton>
              </div>
            ) : (
              <div className="text-center py-2">
                {qr?.img ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr.img} alt="Código QR de WhatsApp" className="w-60 h-60 mx-auto rounded-lg border border-linea dark:border-slate-700" />
                    <p className="text-[13px] font-medium text-tinta dark:text-slate-100 mt-3">Escanéalo desde el celular del número emisor</p>
                    <p className="text-xs text-tinta-2 dark:text-slate-400 mt-1">WhatsApp → Dispositivos vinculados → Vincular un dispositivo. Vence en ~1 minuto.</p>
                  </>
                ) : (
                  <p className="text-[13px] text-tinta-2 dark:text-slate-300 mb-3">No hay un número vinculado. Vincula el celular desde el que saldrán los avisos.</p>
                )}
                <div className="mt-3">
                  <Boton variante="primario" onClick={conectar} disabled={!!ocupado}
                    icono={ocupado === 'qr' ? <Loader2 size={16} className="animate-spin" /> : qr?.img ? <Refrescar size={16} stroke={1.75} /> : <Whatsapp size={16} stroke={1.75} />}>
                    {qr?.img ? 'Generar otro código' : 'Mostrar código QR'}
                  </Boton>
                </div>
              </div>
            )}
            <p className="text-xs text-tinta-2 dark:text-slate-400 mt-4 leading-snug">
              Se vincula como un dispositivo más de WhatsApp (conexión no oficial): úsalo con un número de la empresa que ya conozcan tus contactos, solo para avisar al equipo. Los envíos salen de a uno, con pausa y un tope diario.
            </p>
          </div>
        )}

        {r && (
          <div className={`${SUPERFICIE} p-5`}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-3 text-[13px] text-tinta-2 dark:text-slate-300">
              <span><b className="font-semibold text-tinta dark:text-slate-50 tabular-nums">{r.enviadosHoy}</b> enviados hoy (tope {r.topeDiario})</span>
              <span><b className="font-semibold text-tinta dark:text-slate-50 tabular-nums">{r.pendientes}</b> pendientes</span>
              {r.errores > 0 && <span className="text-urgente"><b className="font-semibold tabular-nums">{r.errores}</b> con error</span>}
              <span className="flex-1" />
              {r.pendientes > 0 && <Boton variante="fantasma" tamano="sm" onClick={reintentar} disabled={!!ocupado}>Reintentar ahora</Boton>}
            </div>
            {r.ultimos.length === 0 ? <p className="text-[13px] text-tinta-2 dark:text-slate-400">Aún no se ha enviado ningún aviso.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-[11px] text-tinta-2 dark:text-slate-400"><th className="h-9 font-medium">Aviso</th><th className="font-medium">Licitación</th><th className="font-medium">Para</th><th className="font-medium">Estado</th></tr></thead>
                  <tbody>{r.ultimos.map(f => (
                    <tr key={f.id} className="h-11 border-t border-linea dark:border-slate-800 text-tinta dark:text-slate-100">
                      <td>{TIPO[f.tipo] ?? f.tipo}</td>
                      <td className="font-mono text-xs">{f.licitacion_codigo}</td>
                      <td className="truncate max-w-[140px]">{f.nombre ?? <span className="text-tinta-3">—</span>}</td>
                      <td title={f.error ?? ''}><EstadoPunto color={ESTADO_COLOR[f.estado] ?? '#64748b'}>{ESTADO_TEXTO[f.estado] ?? f.estado}</EstadoPunto></td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
