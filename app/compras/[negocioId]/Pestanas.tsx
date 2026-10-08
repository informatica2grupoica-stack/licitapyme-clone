'use client';

// Sub-pestañas de un paso de Compras: reemplaza la pila de secciones plegables (mucho scroll) por una barra de pestañas.
// Igual que `Seccion`, TODOS los paneles quedan montados (solo se ocultan con CSS): no se pierde lo escrito ni se vuelven
// a pedir los datos al cambiar de pestaña. Una pestaña se puede abrir desde otra parte con `irAPestana(clave)`.
import { useEffect, useState } from 'react';

export interface PestanaDef {
  clave: string;
  /** Texto corto de la pestaña (p. ej. «1 · Productos»). */
  titulo: string;
  /** Una frase que explica para qué sirve; se muestra bajo la barra cuando la pestaña está activa. */
  ayuda: string;
  badge?: string | number | null;
  tono?: 'alerta' | 'pendiente' | 'ok' | 'neutral';
  contenido: React.ReactNode;
}

export function irAPestana(clave: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('compras:pestana', { detail: { clave } }));
}

const chip = (t?: PestanaDef['tono']) => t === 'alerta' ? 'bg-rose-100 text-rose-700' : t === 'pendiente' ? 'bg-amber-100 text-amber-700' : t === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600';

export function Pestanas({ id, pestanas, inicial }: { id: string; pestanas: PestanaDef[]; inicial?: string }) {
  const [activa, setActiva] = useState(inicial && pestanas.some(p => p.clave === inicial) ? inicial : pestanas[0]?.clave);

  // La pestaña activa se recuerda mientras dure la sesión del navegador (por paso).
  useEffect(() => {
    try {
      const guardada = sessionStorage.getItem(`compras-pestana-${id}`);
      if (guardada && pestanas.some(p => p.clave === guardada)) setActiva(guardada);
    } catch { /* sin sessionStorage: arranca en la inicial */ }
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: Event) => {
      const clave = (e as CustomEvent<{ clave: string }>).detail?.clave;
      if (clave && pestanas.some(p => p.clave === clave)) setActiva(clave);
    };
    window.addEventListener('compras:pestana', h);
    return () => window.removeEventListener('compras:pestana', h);
  }, [pestanas]);

  const elegir = (clave: string) => {
    setActiva(clave);
    try { sessionStorage.setItem(`compras-pestana-${id}`, clave); } catch { /* opcional */ }
  };
  const actual = pestanas.find(p => p.clave === activa) ?? pestanas[0];

  return (
    <div className="space-y-3" data-testid={`pestanas-${id}`}>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-zinc-200 -mx-1 px-1">
        {pestanas.map(p => {
          const on = p.clave === actual?.clave;
          return (
            <button key={p.clave} type="button" role="tab" aria-selected={on} onClick={() => elegir(p.clave)} data-testid={`pestana-${p.clave}`}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${on ? 'border-teal-600 text-teal-800' : 'border-transparent text-zinc-500 hover:text-zinc-800 hover:border-zinc-300'}`}>
              {p.titulo}
              {p.badge != null && p.badge !== '' && <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${chip(p.tono)}`}>{p.badge}</span>}
            </button>
          );
        })}
      </div>
      {actual && <p className="text-[12.5px] text-zinc-500 px-1">{actual.ayuda}</p>}
      {pestanas.map(p => (
        <div key={p.clave} role="tabpanel" className={p.clave === actual?.clave ? '[&>div]:!border-0 [&>div]:!shadow-none [&>div]:!rounded-none [&>div]:!bg-transparent' : 'hidden'}>{p.contenido}</div>
      ))}
    </div>
  );
}
