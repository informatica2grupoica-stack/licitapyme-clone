'use client';

// AVISO DE PROYECTO GANADO — Frente F.1, Fase 3.
//
// Este SÍ es bloqueante, a diferencia de AprobacionPendienteModal ("Ahora no" lo silencia por la
// sesión). El spec pide un aviso que todos los involucrados deban ver y reconocer cada vez que
// ganamos un proyecto.
//
// POR QUÉ BLOQUEAR ACÁ ES ACEPTABLE: la salida es UN CLIC y es exactamente la acción que se pide
// ("Acuso recibo"). No es un callejón sin salida ni una tarea larga: se reconoce y se sigue
// trabajando. Bloquear se vuelve abusivo cuando la salida cuesta; acá no cuesta.
//
// Si hay varios proyectos ganados pendientes, se muestran de a uno (el más antiguo primero) y al
// acusar recibo aparece el siguiente, hasta que no queda ninguno.
import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Trophy, Loader2, ArrowRight } from 'lucide-react';
import { useSession } from '@/app/lib/session-context';
import { suscribirRealtime } from '@/app/lib/use-realtime';
import { useToast } from '@/app/components/ui/toast';

interface EntregaPendiente {
  negocioId: number;
  licitacionCodigo: string;
  licitacionNombre: string | null;
  abiertaAt: string;
}

export function EntregaPendienteModal() {
  const { usuario } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pendientes, setPendientes] = useState<EntregaPendiente[]>([]);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    if (!usuario || usuario.rol === 'externo') return;
    try {
      const res = await fetch('/api/entregas?pendientes=1');
      const data = await res.json();
      if (data.success) setPendientes(data.entregas || []);
    } catch { /* silencioso: nunca dejar la app inutilizable por este aviso */ }
  }, [usuario]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!usuario || usuario.rol === 'externo') return;
    // Si el resultado llega mientras la persona está con la app abierta, el aviso aparece solo.
    // El bus emite 'cambio' (tableros) y 'notificacion' (campana). El aviso de proyecto
    // ganado llega por los dos caminos, así que se recarga con cualquiera de ellos.
    return suscribirRealtime(() => cargar());
  }, [usuario, cargar]);

  const actual = pendientes[0];

  const acusar = async () => {
    if (!actual || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch('/api/entregas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negocioId: actual.negocioId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      setPendientes(prev => prev.slice(1)); // saca este y muestra el siguiente (si hay)
      toast.success(
        'Acuse de recibo registrado',
        data.completada
          ? 'Todos los involucrados ya reconocieron el proyecto.'
          : 'Queda registrado que recibiste el proyecto.',
      );
    } catch (e: any) {
      toast.error('No se pudo registrar el acuse', e.message);
    } finally {
      setEnviando(false);
    }
  };

  const verDetalle = () => router.push('/entregas');

  if (!actual) return null;
  // En /entregas el aviso se calla: ahí ESTÁ el detalle y el botón para acusar recibo. Dejarlo
  // encima taparía justo lo que la persona vino a leer (detectado probando: "Ver el detalle"
  // navegaba correctamente pero el modal seguía cubriendo la página).
  if (pathname === '/entregas') return null;

  const restantes = pendientes.length - 1;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Cabecera celebratoria: ganar es una buena noticia, no una alerta de error. */}
        <div className="px-6 py-5 bg-gradient-to-br from-amber-50 to-orange-50 border-b border-amber-100 flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-white border border-amber-200 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Trophy size={20} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-zinc-900">¡Ganamos un proyecto!</h2>
            <p className="text-[12px] text-zinc-600 mt-0.5">
              Mercado Público publicó el acta. Necesitamos que confirmes que lo recibiste.
            </p>
          </div>
        </div>

        <div className="px-6 py-5">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">Licitación adjudicada</p>
          <p className="text-[15px] font-semibold text-zinc-900 mt-1 leading-snug">
            {actual.licitacionNombre || actual.licitacionCodigo}
          </p>
          <p className="text-[12px] text-zinc-500 mt-1 font-mono">{actual.licitacionCodigo}</p>

          {restantes > 0 && (
            <p className="mt-4 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {restantes === 1
                ? 'Hay 1 proyecto más esperando tu acuse de recibo.'
                : `Hay ${restantes} proyectos más esperando tu acuse de recibo.`}
            </p>
          )}
        </div>

        <div className="px-6 pb-5 flex gap-2.5">
          <button
            onClick={verDetalle}
            className="flex-1 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-zinc-600 border border-zinc-200 hover:bg-zinc-50 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            Ver el detalle <ArrowRight size={14} />
          </button>
          <button
            onClick={acusar}
            disabled={enviando}
            className="flex-1 px-4 py-2.5 rounded-lg text-[13px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 transition-colors inline-flex items-center justify-center gap-2"
          >
            {enviando ? <><Loader2 size={14} className="animate-spin" /> Registrando…</> : 'Acuso recibo'}
          </button>
        </div>
      </div>
    </div>
  );
}
