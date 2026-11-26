'use client';

// WhatsApp PROPIO de la empresa-cliente (multiempresa): el admin vincula su celular por QR y los avisos de sus negocios salen desde ahí.
// Se vincula como un «dispositivo vinculado» más de WhatsApp (conexión no oficial). Cada persona del equipo agrega su celular en Mi perfil.
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';

type Estado = 'open' | 'connecting' | 'close' | 'sin_instancia';
interface Datos {
  configurado: boolean; estado?: Estado; numero?: string | null;
  resumen?: { pendientes: number; errores: number; enviadosHoy: number; topeDiario: number } | null;
  equipo?: { activos: number; conTelefono: number };
}

const boton = 'rounded-lg bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50';
const botonSec = 'rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const fmtNumero = (n: string | null | undefined) => (n && /^56\d{9}$/.test(n) ? `+56 ${n[2]} ${n.slice(3, 7)} ${n.slice(7)}` : n ? `+${n}` : '');

export function WhatsappEmpresa() {
  const { usuario } = useSession();
  const toast = useToast();
  const aplica = usuario?.rol === 'admin' && !!usuario.clienteId && usuario.clienteId !== 1;
  const [d, setD] = useState<Datos | null>(null);
  const [qr, setQr] = useState<{ img: string | null; codigo: string | null } | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/mi-empresa/whatsapp');
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'No se pudo consultar WhatsApp'); return; }
      setError(''); setD(j);
      if (j.estado === 'open') setQr(null);
    } catch { setError('Error de conexión'); }
  }, []);
  useEffect(() => { if (aplica) cargar(); }, [aplica, cargar]);
  // Mientras se espera el escaneo, se consulta cada 3 segundos hasta que quede conectado.
  useEffect(() => {
    if (!aplica || d?.estado !== 'connecting') return;
    const t = setInterval(cargar, 3000);
    return () => clearInterval(t);
  }, [aplica, d?.estado, cargar]);

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

  if (!aplica) return null;
  const conectar = async () => {
    const j = await accion('qr', () => fetch('/api/mi-empresa/whatsapp', { method: 'POST' }));
    if (j) { setQr({ img: j.qr, codigo: j.codigo }); await cargar(); }
  };
  const desvincular = async () => {
    if (!confirm('¿Desvincular el WhatsApp de la empresa? Dejarán de salir avisos por WhatsApp hasta volver a vincularlo.')) return;
    if (await accion('del', () => fetch('/api/mi-empresa/whatsapp', { method: 'DELETE' }), 'WhatsApp desvinculado')) { setQr(null); await cargar(); }
  };
  const prueba = () => accion('prueba', () => fetch('/api/mi-empresa/whatsapp', { method: 'PUT' }), 'Mensaje de prueba enviado a tu celular');

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-medium text-slate-900">Avisos por WhatsApp</h2>
      <p className="mt-1 text-sm text-slate-500">
        Vincula el WhatsApp de tu empresa escaneando un código QR. Desde ese número le avisamos a tu equipo cuando se gana o pierde una licitación,
        se abre una oferta o llega una orden de compra. Cada persona agrega su celular en <b>Mi perfil</b> para recibirlos.
      </p>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {d && !d.configurado && <p className="mt-3 text-sm text-amber-700">El servicio de WhatsApp aún no está disponible en este servidor.</p>}

      {d?.configurado && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {d.estado === 'open' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-emerald-700">● Conectado{d.numero ? ` · ${fmtNumero(d.numero)}` : ''}</span>
              <span className="flex-1" />
              <button type="button" className={botonSec} onClick={prueba} disabled={!!ocupado}>{ocupado === 'prueba' ? 'Enviando…' : 'Enviarme una prueba'}</button>
              <button type="button" className={botonSec} onClick={desvincular} disabled={!!ocupado}>Desvincular</button>
            </div>
          ) : (
            <div className="text-center">
              {qr?.img ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr.img} alt="Código QR de WhatsApp" className="mx-auto h-56 w-56 rounded-lg border border-slate-200" />
                  <p className="mt-3 text-sm font-medium text-slate-800">Escanéalo con el celular de tu empresa</p>
                  <p className="mt-1 text-xs text-slate-500">WhatsApp → Dispositivos vinculados → Vincular un dispositivo. El código vence en cerca de 1 minuto.</p>
                </>
              ) : (
                <p className="mb-3 text-sm text-slate-600">No hay un WhatsApp vinculado todavía.</p>
              )}
              <button type="button" className={boton} onClick={conectar} disabled={!!ocupado}>
                {ocupado === 'qr' ? 'Generando…' : qr?.img ? 'Generar otro código' : 'Mostrar código QR'}
              </button>
            </div>
          )}

          {d.equipo && (
            <p className="mt-3 text-xs text-slate-500">
              {d.equipo.conTelefono} de {d.equipo.activos} personas de tu equipo tienen celular en su perfil.
              {d.resumen && d.estado === 'open' ? ` Hoy se enviaron ${d.resumen.enviadosHoy} avisos (tope diario ${d.resumen.topeDiario}).` : ''}
            </p>
          )}
          <p className="mt-2 text-xs leading-snug text-slate-500">
            Se vincula como un dispositivo más de WhatsApp (conexión no oficial): usa un número de la empresa que ya conozcan tus contactos, solo para avisar a tu equipo.
            Los envíos salen de a uno y con pausa, para cuidar el número.
          </p>
        </div>
      )}
    </section>
  );
}
