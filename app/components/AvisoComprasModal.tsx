'use client';

// Aviso al CENTRO de la pantalla para el encargado de Compras cuando el jefe de ventas decide sobre una compuerta
// (aprobó / aprobó con cambios / rechazó): muestra el mensaje y lleva directo al paso donde hay que corregir.
// No bloquea la app («Más tarde» lo cierra). Llega en vivo (SSE) y, si el encargado no estaba conectado, al entrar
// aparece el último aviso sin leer. Cerrarlo lo silencia por esta sesión del navegador; la campana y el correo siguen.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle as Alerta, IconCircleCheck as Check, IconPencil as Lapiz, IconX as X } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { suscribirRealtime } from '@/app/lib/use-realtime';

interface Aviso { id: number; tipo: string; mensaje: string; url: string }

const clave = (id: number) => `aviso-compras-visto-${id}`;
// historial_eventos.tipo es varchar(40): los tipos son COMPRAS_APROB_<COMPRA|MARGEN|PRODUCTO>_<RECHAZADA|CAMBIOS|APROBADA> (los viejos «…_AVIS» truncados también cuentan).
const esAvisoCompras = (tipo?: string) => !!tipo && (tipo.startsWith('COMPRAS_APROB_') || tipo.startsWith('COMPRAS_APROBACION_'));

function aAviso(e: { id?: number; tipo?: string; mensaje: string; metadata?: unknown }): Aviso | null {
  if (!e.id || !esAvisoCompras(e.tipo)) return null;
  let url = '';
  try {
    const m = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;
    url = typeof (m as { url?: unknown } | null)?.url === 'string' ? (m as { url: string }).url : '';
  } catch { /* metadata ilegible: el aviso igual se muestra, sin enlace */ }
  return { id: e.id, tipo: e.tipo!, mensaje: e.mensaje, url };
}

export function AvisoComprasModal() {
  const { usuario } = useSession();
  const router = useRouter();
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const yaVisto = (id: number) => { try { return sessionStorage.getItem(clave(id)) === '1'; } catch { return false; } };

  // Al entrar: el aviso sin leer más reciente (por si no estaba conectado cuando se decidió).
  const cargar = useCallback(async () => {
    try {
      const d = await fetch('/api/historial?limit=15').then(r => r.json());
      if (!d.success) return;
      const a = (d.eventos as any[]).filter(e => !e.leido).map(aAviso).find((x): x is Aviso => !!x && !yaVisto(x.id));
      if (a) setAviso(a);
    } catch { /* silencioso: nunca bloquear la app por un aviso */ }
  }, []);

  useEffect(() => {
    if (!usuario) return;
    cargar();
    return suscribirRealtime(ev => {
      if (ev.tipo !== 'notificacion') return;
      const a = aAviso(ev.datos as any);
      if (a && !yaVisto(a.id)) setAviso(a);
    });
  }, [usuario, cargar]);

  const cerrar = () => {
    if (aviso) { try { sessionStorage.setItem(clave(aviso.id), '1'); } catch { /* no bloquear por storage */ } }
    setAviso(null);
  };
  const ir = () => {
    const u = aviso?.url; cerrar(); if (!u) return;
    // Si ya está en esa misma pantalla de Compras, router.push no cambia de paso: se usa el evento que escucha el stepper.
    const [ruta, query = ''] = u.split('?');
    const fase = new URLSearchParams(query).get('fase');
    if (fase && ruta === window.location.pathname) window.dispatchEvent(new CustomEvent('compras:ir', { detail: { fase } }));
    else router.push(u);
  };

  if (!aviso) return null;
  const aprobada = /_APROBADA(_AVIS\w*)?$/.test(aviso.tipo);
  const cambios = /_CAMBIOS(_AVIS\w*)?$/.test(aviso.tipo);
  const titulo = aprobada ? 'Te aprobaron lo que enviaste' : cambios ? 'Te aprobaron con cambios' : 'Te rechazaron una aprobación';
  const tono = aprobada ? { caja: 'bg-emerald-50 border-emerald-200', icono: 'text-emerald-600', boton: 'bg-emerald-600 hover:bg-emerald-700' }
    : cambios ? { caja: 'bg-violet-50 border-violet-200', icono: 'text-violet-600', boton: 'bg-violet-600 hover:bg-violet-700' }
      : { caja: 'bg-rose-50 border-rose-200', icono: 'text-rose-600', boton: 'bg-rose-600 hover:bg-rose-700' };
  const Icono = aprobada ? Check : cambios ? Lapiz : Alerta;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" role="alertdialog" aria-labelledby="aviso-compras-titulo" data-testid="aviso-compras-modal">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
        <div className="px-6 py-5 flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${tono.caja}`}>
            <Icono size={18} className={tono.icono} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="aviso-compras-titulo" className="text-[15px] font-bold text-zinc-900">{titulo}</h2>
            <p className="text-[13px] text-zinc-600 mt-1.5 leading-relaxed break-words">{aviso.mensaje}</p>
          </div>
          <button onClick={cerrar} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors flex-shrink-0" aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 pb-5 flex gap-2.5">
          <button onClick={cerrar} className="flex-1 px-4 py-2 rounded-lg text-[13px] font-semibold text-zinc-600 border border-zinc-200 hover:bg-zinc-50 transition-colors">Más tarde</button>
          {aviso.url && (
            <button onClick={ir} className={`flex-1 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors ${tono.boton}`}>
              {aprobada ? 'Abrir Compras' : 'Ir a corregir'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
