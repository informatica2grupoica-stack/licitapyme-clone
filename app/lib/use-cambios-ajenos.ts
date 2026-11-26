'use client';

// «Otra persona cambió esta licitación»: el equipo trabaja en paralelo y cada ficha carga sus datos al abrirse, así que lo
// que otra persona guarda no se ve hasta recargar. Este hook escucha el stream en vivo (use-realtime) y avisa cuando el
// cambio es de ESTE negocio y lo hizo otra persona. No recarga solo: quien tiene la ficha abierta decide (no se pierde lo que escribe).
import { useCallback, useEffect, useState } from 'react';
import { suscribirRealtime } from '@/app/lib/use-realtime';
import { useSession } from '@/app/lib/session-context';

export function useCambiosAjenos(negocioId: number | null | undefined) {
  const { usuario } = useSession();
  const miId = usuario?.id ?? null;
  const [hay, setHay] = useState(false);

  useEffect(() => {
    setHay(false);
    if (!negocioId) return;
    return suscribirRealtime(ev => {
      if (ev.tipo !== 'cambio' || ev.negocioId !== negocioId) return;
      if (miId != null && ev.actorId === miId) return;   // lo hice yo: ya lo veo
      setHay(true);
    });
  }, [negocioId, miId]);

  const limpiar = useCallback(() => setHay(false), []);
  return { hay, limpiar };
}
