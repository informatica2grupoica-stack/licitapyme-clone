// app/components/MenuNegocioLateral.tsx
// Menú lateral ÚNICO de una licitación/negocio. Lo usan /negocios/[id] (padre) y
// /licitacion/[codigo] (solo para licitaciones que aún no son negocio): mismo título, mismo
// estilo, mismo orden. Las secciones las arma cada página (con sus contadores), pero el orden y
// las etiquetas salen de aquí para que no vuelvan a divergir.
'use client';

import Link from 'next/link';
import { IconArrowLeft as ArrowLeft } from '@tabler/icons-react';

export interface ItemMenuNegocio {
  key: string;
  label: string;
  count: number | null;
  alerta?: boolean;
}

// Orden canónico; las claves que una página no arma (p. ej. Costeo sin negocio) simplemente no salen.
export const ORDEN_MENU_NEGOCIO = [
  'resumen', 'resultado', 'documentos', 'viabilidad', 'criterios', 'items', 'fechas',
  'preguntas', 'competencia', 'comentarios', 'costeo', 'comercial',
] as const;

export const ETIQUETA_MENU_NEGOCIO: Record<string, string> = {
  resumen: 'Resumen', resultado: 'Resultado', documentos: 'Documentos', viabilidad: 'Viabilidad',
  criterios: 'Criterios', items: 'Líneas', fechas: 'Fechas', preguntas: 'Preguntas',
  competencia: 'Competencia', comentarios: 'Comentarios', costeo: 'Costeo', comercial: 'Auditor Técnico',
};

export function ordenarMenuNegocio<T extends { key: string }>(items: T[]): T[] {
  const pos = (k: string) => { const i = (ORDEN_MENU_NEGOCIO as readonly string[]).indexOf(k); return i < 0 ? 99 : i; };
  return [...items].sort((a, b) => pos(a.key) - pos(b.key));
}

interface Props {
  items: ItemMenuNegocio[];
  activa: string;
  onSelect: (key: string) => void;
  volverHref?: string;
  onVolver?: () => void;
  cargandoContadores?: boolean;
}

export function MenuNegocioLateral({ items, activa, onSelect, volverHref, onVolver, cargandoContadores }: Props) {
  const clsVolver = 'flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900 transition-colors font-medium';
  return (
    <aside className="hidden lg:flex flex-col w-44 border-r border-zinc-200/80 bg-white flex-shrink-0 overflow-y-auto">
      <div className="px-3 pt-4 pb-3">
        {volverHref ? (
          <Link href={volverHref} className={clsVolver}><ArrowLeft size={13} /> Volver</Link>
        ) : (
          <button onClick={onVolver} className={clsVolver}><ArrowLeft size={13} /> Volver</button>
        )}
      </div>
      <div className="px-3 pb-2">
        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest px-2 pb-1.5">El negocio</p>
        <nav className="space-y-0.5">
          {items.map(s => (
            <button
              key={s.key}
              onClick={() => onSelect(s.key)}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12.5px] transition-all ${
                activa === s.key ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 font-medium'
              }`}
            >
              <span>{s.label}</span>
              {s.count != null && s.count > 0 && (
                // Rojo cuando hay trabajo detenido esperando el visto bueno del asesor.
                <span className={`text-[10px] px-1.5 py-px rounded-full font-bold ${
                  s.alerta ? 'bg-rose-500 text-white' : activa === s.key ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-400'
                }`}>
                  {cargandoContadores ? '…' : s.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
}
