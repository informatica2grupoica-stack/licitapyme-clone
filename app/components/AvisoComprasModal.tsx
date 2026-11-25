'use client';

// Aviso al CENTRO de la pantalla para el encargado de Compras cuando el jefe de ventas decide sobre una compuerta
// (aprobó / aprobó con cambios / rechazó): muestra el mensaje y lleva directo al paso donde hay que corregir.
// No bloquea la app («Más tarde» lo cierra). Llega en vivo (SSE) y, si el encargado no estaba conectado, al entrar
// aparece el último aviso sin leer. Cerrarlo lo silencia por esta sesión del navegador; la campana y el correo siguen.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle as Alerta, IconCircleCheck as Check, IconPencil as Lapiz, IconX as X } from '@tabler/icons-react';
import { useSession } from '@/app/lib/session-context';
import { suscribirRealtime } from '@/app/lib/use-realtime';
import { enfocarProducto } from '@/app/compras/[negocioId]/comprasNavegacion';

interface Aviso { id: number; tipo: string; mensaje: string; url: string }

const clave = (id: number) => `aviso-compras-visto-${id}`;
// historial_eventos.tipo es varchar(40): los tipos son COMPRAS_APROB_<COMPRA|MARGEN|PRODUCTO>_<RECHAZADA|CAMBIOS|APROBADA> (los viejos «…_AVIS» truncados también cuentan).
const esAvisoCompras = (tipo?: string) => !!tipo && (tipo.startsWith('COMPRAS_APROB_') || tipo.startsWith('COMPRAS_APROBACION_') || tipo === 'COMPRAS_INCIDENCIA_FICHA');

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

  // Se cierra sola a los 10 s: ya no estorba y queda en la campana.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => {
      try { sessionStorage.setItem(clave(aviso.id), '1'); } catch { /* sin storage */ }
      setAviso(null);
    }, 10000);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => {
    if (!usuario) return;
    // Solo avisos en vivo: al entrar ya no reaparece el último (está en la campana).
    return suscribirRealtime(ev => {
      if (ev.tipo !== 'notificacion') return;
      const a = aAviso(ev.datos as any);
      if (a && !yaVisto(a.id)) setAviso(a);
    });
  }, [usuario]);

  const cerrar = () => {
    if (aviso) { try { sessionStorage.setItem(clave(aviso.id), '1'); } catch { /* no bloquear por storage */ } }
    setAviso(null);
  };
  const ir = () => {
    const u = aviso?.url; cerrar(); if (!u) return;
    // Si ya está en esa misma pantalla de Compras, router.push no cambia de paso: se usa el evento que escucha el stepper.
    const [ruta, query = ''] = u.split('?');
    const q = new URLSearchParams(query);
    const fase = q.get('fase');
    if (fase && ruta === window.location.pathname) {
      window.dispatchEvent(new CustomEvent('compras:ir', { detail: { fase } }));
      const pid = Number(q.get('producto'));
      if (q.get('pestana') || pid) enfocarProducto(q.get('pestana'), pid > 0 ? pid : null);
    }
    else router.push(u);
  };

  if (!aviso) return null;
  const aprobada = /_APROBADA(_AVIS\w*)?$/.test(aviso.tipo);
  const cambios = /_CAMBIOS(_AVIS\w*)?$/.test(aviso.tipo);
  const incidencia = aviso.tipo === 'COMPRAS_INCIDENCIA_FICHA';
  const titulo = incidencia ? 'Nueva incidencia en una ficha técnica' : aprobada ? 'Te aprobaron lo que enviaste' : cambios ? 'Te aprobaron con cambios' : 'Te rechazaron una aprobación';
  const tono = incidencia ? { caja: 'bg-amber-50 border-amber-200', icono: 'text-amber-600', boton: 'bg-amber-600 hover:bg-amber-700' } : aprobada ? { caja: 'bg-emerald-50 border-emerald-200', icono: 'text-emerald-600', boton: 'bg-emerald-600 hover:bg-emerald-700' }
    : cambios ? { caja: 'bg-cyan-50 border-cyan-200', icono: 'text-cyan-600', boton: 'bg-cyan-600 hover:bg-cyan-700' }
      : { caja: 'bg-rose-50 border-rose-200', icono: 'text-rose-600', boton: 'bg-rose-600 hover:bg-rose-700' };
  const Icono = aprobada ? Check : cambios ? Lapiz : Alerta;

  // Tarjeta discreta abajo a la derecha (sin fondo oscuro, no tapa la pantalla). Se cierra sola;
  // el aviso queda siempre en la campana, que lleva a la misma pantalla.
  return (
    <div className="fixed bottom-4 right-4 z-[110] w-[calc(100vw-2rem)] max-w-sm bg-white rounded-xl border border-zinc-200 shadow-flotante overflow-hidden" role="status" aria-labelledby="aviso-compras-titulo" data-testid="aviso-compras-modal">
      <div className="px-4 py-3.5 flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${tono.caja}`}>
          <Icono size={16} className={tono.icono} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="aviso-compras-titulo" className="text-[13px] font-semibold text-zinc-900">{titulo}</h2>
          <p className="text-[12px] text-zinc-600 mt-1 leading-snug break-words line-clamp-3">{aviso.mensaje}</p>
          {aviso.url && (
            <button onClick={ir} className="mt-2 text-[12px] font-semibold text-teal-600 hover:text-teal-700">
              {aprobada ? 'Abrir Compras' : incidencia ? 'Ver el producto' : 'Ir a corregir'}
            </button>
          )}
        </div>
        <button onClick={cerrar} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors flex-shrink-0" aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
