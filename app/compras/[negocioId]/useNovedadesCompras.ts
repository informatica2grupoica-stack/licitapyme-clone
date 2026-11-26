'use client';

// «DESDE TU ÚLTIMA VISITA»: lo que OTRA persona hizo en esta licitación desde la última vez que esta persona miró el avance.
// Lee la misma bitácora de la pestaña Actividad (no hay tabla nueva). La marca de «visto» queda en el navegador de cada persona:
// es solo una comodidad de lectura, no un dato del negocio. Se refresca al volver a la pestaña y cada minuto.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/app/lib/session-context';

export interface EventoNovedad { tipo: string; mensaje: string; actor: string | null; creadoAt: string }

const clave = (negocioId: number, usuarioId: number) => `compras-avance-visto-${negocioId}-${usuarioId}`;
const leer = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const guardar = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* sin almacenamiento: la marca no persiste */ } };

export function useNovedadesCompras(negocioId: number) {
  const { usuario } = useSession();
  const [eventos, setEventos] = useState<EventoNovedad[]>([]);
  const [visto, setVisto] = useState<string | null>(null);
  const ultimo = useRef<string | null>(null);
  // Marca de lo que esta pantalla ya cargó: lo que otra persona haga después significa que lo mostrado quedó desfasado.
  const [cargadoHasta, setCargadoHasta] = useState<string | null | undefined>(undefined);
  const usuarioId = usuario?.id ?? null;
  const nombre = usuario?.nombre ?? null;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/compras/${negocioId}/actividad`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) return;
      const evs: EventoNovedad[] = data.eventos || [];
      setEventos(evs);
      ultimo.current = evs.reduce<string | null>((m, e) => (!m || e.creadoAt > m ? e.creadoAt : m), null);
      setCargadoHasta(prev => (prev === undefined ? ultimo.current : prev));
      // Primera vez en esta licitación: todo lo anterior cuenta como visto, para no llenar de «novedades» viejas.
      if (usuarioId != null && leer(clave(negocioId, usuarioId)) == null && ultimo.current) { guardar(clave(negocioId, usuarioId), ultimo.current); setVisto(ultimo.current); }
    } catch { /* sin red: se reintenta en el próximo ciclo */ }
  }, [negocioId, usuarioId]);

  useEffect(() => { if (usuarioId != null) setVisto(leer(clave(negocioId, usuarioId))); }, [negocioId, usuarioId]);
  useEffect(() => {
    cargar();
    const t = setInterval(() => { if (document.visibilityState === 'visible') cargar(); }, 30_000);
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [cargar]);

  const novedades = eventos.filter(e => !!e.actor && e.actor !== nombre && e.tipo !== 'PROYECTO_GANADO' && e.tipo !== 'RESULTADO_ADJUDICACION' && (visto == null || e.creadoAt > visto));
  const marcarVistas = useCallback(() => {
    if (usuarioId == null || !ultimo.current) return;
    guardar(clave(negocioId, usuarioId), ultimo.current);
    setVisto(ultimo.current);
  }, [negocioId, usuarioId]);

  // Cambios hechos por OTRA persona después de que esta pantalla cargó sus datos (hay que recargar para verlos).
  const cambiosAjenos = cargadoHasta === undefined ? [] : eventos.filter(e => !!e.actor && e.actor !== nombre && e.creadoAt > (cargadoHasta ?? ''));
  const datosAlDia = useCallback(() => { setCargadoHasta(ultimo.current); }, []);
  return { novedades, marcarVistas, recargarNovedades: cargar, cambiosAjenos, datosAlDia };
}
