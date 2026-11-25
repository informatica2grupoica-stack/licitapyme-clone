'use client';

// Aviso NO bloqueante: cuando queda algo esperando aprobación en /aprobaciones, aparece un
// popup difícil de ignorar (spec Auditor Técnico §8.6) — a diferencia de CierreVencidoModal,
// este SÍ se puede cerrar ("Ahora no"): la spec no pide bloquear el uso de la app, solo un
// aviso destacado con acceso directo. Se vuelve a mostrar en la próxima sesión (o si llega una
// notificación en vivo) mientras siga habiendo pendientes; cerrarlo solo lo silencia por esta
// sesión de navegador (sessionStorage), no descarta el pendiente.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { IconClipboardCheck as ClipboardCheck, IconX as X } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { suscribirRealtime } from '@/app/lib/use-realtime';
import { pedirResumenAprobaciones } from '@/app/lib/aprobaciones-resumen';

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
      const data = await pedirResumenAprobaciones();
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

  // Se cierra sola a los 10 s (queda silenciada esta sesión; los pendientes siguen en /aprobaciones).
  useEffect(() => {
    if (!visible || !usuario) return;
    const t = setTimeout(() => {
      try { sessionStorage.setItem(clave(usuario.id), '1'); } catch { /* sin storage */ }
      setVisible(false);
    }, 10000);
    return () => clearTimeout(t);
  }, [visible, usuario]);

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
    <div className="fixed bottom-4 right-4 z-[100] w-[calc(100vw-2rem)] max-w-sm bg-white rounded-xl border border-zinc-200 shadow-flotante overflow-hidden" role="status">
      <div className="px-4 py-3.5 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-cyan-50 border border-cyan-200 flex items-center justify-center flex-shrink-0">
          <ClipboardCheck size={16} className="text-cyan-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[13px] font-semibold text-zinc-900">
            {totalPendientes === 1 ? 'Hay 1 negocio esperando tu aprobación' : `Hay ${totalPendientes} negocios esperando tu aprobación`}
          </h2>
          <button onClick={ir} className="mt-2 text-[12px] font-semibold text-teal-600 hover:text-teal-700">
            Ir a Aprobaciones
          </button>
        </div>
        <button onClick={cerrar} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors flex-shrink-0" aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
