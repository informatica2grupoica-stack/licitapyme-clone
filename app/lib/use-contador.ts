'use client';

// Contador animado para KPIs: interpola de 0 (o del valor anterior) al valor nuevo
// con easing, vía requestAnimationFrame. Respeta prefers-reduced-motion (salta directo).
import { useEffect, useRef, useState } from 'react';

const DURACION_MS = 700;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function useContador(objetivo: number): number {
  const [valor, setValor] = useState(objetivo);
  const previo = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(objetivo)) { setValor(objetivo); return; }
    const reducido = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducido) { previo.current = objetivo; setValor(objetivo); return; }

    const desde = previo.current;
    previo.current = objetivo;
    if (desde === objetivo) { setValor(objetivo); return; }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / DURACION_MS);
      setValor(desde + (objetivo - desde) * easeOut(p));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [objetivo]);

  return valor;
}
