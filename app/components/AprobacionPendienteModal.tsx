'use client';

// Aviso NO bloqueante: cuando queda algo esperando aprobación en /aprobaciones, aparece un
// popup difícil de ignorar (spec Auditor Técnico §8.6) — a diferencia de CierreVencidoModal,
// este SÍ se puede cerrar ("Ahora no"): la spec no pide bloquear el uso de la app, solo un
// aviso destacado con acceso directo. Se vuelve a mostrar en la próxima sesión (o si llega una
// notificación en vivo) mientras siga habiendo pendientes; cerrarlo solo lo silencia por esta
// sesión de navegador (sessionStorage), no descarta el pendiente.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, X } from 'lucide-react';
import { useSession } from '@/app/lib/session-context';
import { suscribirRealtime } from '@/app/lib/use-realtime';

const clave = (userId: number) => `aprobaciones-popup-visto-${userId}`;

export function AprobacionPendienteModal() {
  const { usuario } = useSession();
  const router = useRouter();
  const [totalPendientes, setTotalPendientes] = useState(0);
  const [visible, setVisible] = useState(false);

  const puedeAprobar = usuario?.rol === 'admin' || !!usuario?.permisos?.aprobar_comercial;

  const cargar = useCallback(async () => {
    if (!usuario || !puedeAprobar) return;
    try {
      const res = await fetch('/api/aprobaciones/resumen');
      const data = await res.json();
      if (!data.success) return;
      const total = data.totalPendientes || 0;
      setTotalPendientes(total);
      const yaVisto = sessionStorage.getItem(clave(usuario.id)) === '1';
      setVisible(total > 0 && !yaVisto);
    } catch { /* silencioso: nunca bloquear la app por esto */ }
  }, [usuario, puedeAprobar]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!puedeAprobar) return;
    return suscribirRealtime(ev => { if (ev.tipo === 'cambio') cargar(); });
  }, [puedeAprobar, cargar]);

  const cerrar = () => {
    if (usuario) { try { sessionStorage.setItem(clave(usuario.id), '1'); } catch { /* no bloquear por storage */ } }
    setVisible(false);
  };

  const ir = () => {
    cerrar();
    router.push('/aprobaciones');
  };

  if (!visible || !puedeAprobar) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center flex-shrink-0">
            <ClipboardCheck size={18} className="text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-zinc-900">
              {totalPendientes === 1 ? 'Hay 1 negocio esperando tu aprobación' : `Hay ${totalPendientes} negocios esperando tu aprobación`}
            </h2>
            <p className="text-[12px] text-zinc-500 mt-1">
              Bloque técnico y/o comercial cargados por el asistente, listos para revisar.
            </p>
          </div>
          <button onClick={cerrar} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors flex-shrink-0" aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 pb-5 flex gap-2.5">
          <button onClick={cerrar} className="flex-1 px-4 py-2 rounded-lg text-[13px] font-semibold text-zinc-600 border border-zinc-200 hover:bg-zinc-50 transition-colors">
            Ahora no
          </button>
          <button onClick={ir} className="flex-1 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-violet-600 hover:bg-violet-700 transition-colors">
            Ir a Aprobaciones
          </button>
        </div>
      </div>
    </div>
  );
}
