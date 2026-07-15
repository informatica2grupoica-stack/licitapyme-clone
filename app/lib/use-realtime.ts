'use client';

// Tiempo real de la app sobre UNA SOLA conexión SSE compartida.
//
// POR QUÉ UN SINGLETON Y NO UN EventSource POR COMPONENTE:
// cada EventSource es una conexión HTTP/1.1 que queda abierta para siempre, y el navegador
// solo permite ~6 por dominio. Con una conexión por componente (la campana + cada tablero)
// se llegaba a 6 en cuanto navegabas un par de veces, y a partir de ahí TODO lo demás
// (/api/negocios, /api/historial…) quedaba encolado sin resolver nunca: la página se quedaba
// en "Cargando…" para siempre, sin error y sin nada en la consola. Con el bus compartido la
// app usa exactamente 1 conexión, la abra quien la abra.
//
// El bus vive a nivel de módulo (no en un contexto de React) para que la conexión sobreviva a
// los montajes/desmontajes de página y no dependa de dónde se coloque un provider.
import { useEffect, useRef } from 'react';

export type EventoRealtime =
  | { tipo: 'cambio' }                       // difusión: alguien movió el pipeline / llegó dato de MP
  | { tipo: 'notificacion'; datos: any };    // campana personal del usuario

type Oyente = (ev: EventoRealtime) => void;

const oyentes = new Set<Oyente>();
let fuente: EventSource | null = null;

function emitir(ev: EventoRealtime) {
  for (const fn of [...oyentes]) { try { fn(ev); } catch { /* un oyente roto no tumba al resto */ } }
}

function abrir() {
  if (fuente || typeof window === 'undefined') return;
  fuente = new EventSource('/api/historial/stream');
  fuente.addEventListener('cambio', () => emitir({ tipo: 'cambio' }));
  fuente.addEventListener('notificacion', (ev: MessageEvent) => {
    try { emitir({ tipo: 'notificacion', datos: JSON.parse(ev.data) }); } catch { /* payload raro */ }
  });
  fuente.onerror = () => { /* EventSource reconecta solo */ };
}

function cerrarSiNadieEscucha() {
  if (oyentes.size === 0 && fuente) { fuente.close(); fuente = null; }
}

/** Suscribe un oyente al stream. Abre la conexión si es el primero; la cierra si es el último. */
export function suscribirRealtime(fn: Oyente): () => void {
  oyentes.add(fn);
  abrir();
  return () => { oyentes.delete(fn); cerrarSiNadieEscucha(); };
}

/**
 * Recarga un tablero cuando algo cambia.
 * Respaldos por si el stream se cae (proxy, suspensión, Vercel sin SSE): refresco al volver a
 * la pestaña e intervalo mientras está visible.
 */
export function useRealtime(recargar: () => void, opciones?: { intervaloMs?: number }) {
  const intervalo = opciones?.intervaloMs ?? 60_000;
  // Ref: el efecto no se re-monta (ni resuscribe) aunque el callback cambie de identidad.
  const cb = useRef(recargar);
  cb.current = recargar;

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    // Una acción dispara varios eventos (estado + etiqueta + correo) y el cron publica en
    // ráfaga: una sola recarga por ráfaga.
    const pedir = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => cb.current(), 500);
    };

    const desuscribir = suscribirRealtime(pedir);
    const onVisible = () => { if (document.visibilityState === 'visible') cb.current(); };
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(() => { if (document.visibilityState === 'visible') cb.current(); }, intervalo);

    return () => {
      desuscribir();
      clearInterval(id);
      if (debounce) clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalo]);
}
