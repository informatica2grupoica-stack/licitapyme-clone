'use client';

// Sección plegable de un paso de Compras. Cada paso apilaba 3-5 tarjetas largas sin explicar para qué
// sirve cada una: ahora cada tarjeta lleva título, una frase en lenguaje simple y se puede plegar.
// El contenido queda SIEMPRE montado (solo se oculta con CSS) para no perder lo escrito ni volver a
// pedir los datos al abrir y cerrar.
import { useState } from 'react';
import { IconChevronDown as ChevronDown } from '@tabler/icons-react';

export function Seccion({ titulo, ayuda, badge, tono = 'neutral', defaultAbierta = false, children }: {
  titulo: string; ayuda: string; badge?: string | number | null; tono?: 'alerta' | 'pendiente' | 'ok' | 'neutral'; defaultAbierta?: boolean; children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(defaultAbierta);
  const chip = tono === 'alerta' ? 'bg-rose-100 text-rose-700' : tono === 'pendiente' ? 'bg-amber-100 text-amber-700' : tono === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600';
  return (
    <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <button type="button" onClick={() => setAbierta(v => !v)} aria-expanded={abierta}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors">
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-zinc-900">{titulo}</span>
            {badge != null && badge !== '' && <span className={`text-[11.5px] font-bold px-2 py-0.5 rounded-full ${chip}`}>{badge}</span>}
          </span>
          <span className="block text-[12.5px] text-zinc-500 mt-0.5">{ayuda}</span>
        </span>
        <ChevronDown size={18} className={`text-zinc-400 flex-shrink-0 transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>
      {/* Las tarjetas de adentro traen su propia caja: se aplanan para no tener cajas dentro de cajas. */}
      <div className={abierta ? 'border-t border-zinc-100 p-3 sm:p-4 [&>div]:!border-0 [&>div]:!shadow-none [&>div]:!rounded-none [&>div]:!bg-transparent' : 'hidden'}>{children}</div>
    </section>
  );
}
