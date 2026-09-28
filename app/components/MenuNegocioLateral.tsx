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

export interface NavSeccionesNegocioInput {
  documentosCount: number | null;
  // ¿Ya sabemos si ganamos o perdimos? (usar tieneResultado() de app/lib/pipeline.ts)
  hayResultado: boolean;
  itemsCount?: number | null;
  hayCosteo?: boolean;
  hayAuditorTecnico?: boolean;
  auditorCount?: number | null;
  auditorAlerta?: boolean;
}

// Arma la lista de ítems del menú lateral: MISMO orden, MISMAS etiquetas y MISMO criterio de
// visibilidad para /negocios/[id] y /licitacion/[codigo] (antes cada página armaba su propio
// NAV_SECTIONS y solo se sincronizaba el orden a mano). Fechas, Criterios y Comentarios viven
// como pestañas DENTRO de "Resumen" (ver SeccionTabs más abajo); Competencia vive como pestaña
// dentro de "Resultado". Resultado, Competencia y Preguntas solo aparecen cuando el negocio ya
// tiene resultado (Ganada o Perdida) — pedido del usuario, 28-sep-2026.
export function construirNavSeccionesNegocio(input: NavSeccionesNegocioInput): ItemMenuNegocio[] {
  const { documentosCount, hayResultado, itemsCount, hayCosteo, hayAuditorTecnico, auditorCount, auditorAlerta } = input;
  return [
    { key: 'resumen',    label: 'Resumen',    count: null },
    ...(hayResultado ? [{ key: 'resultado', label: 'Resultado', count: null }] : []),
    { key: 'documentos', label: 'Documentos', count: documentosCount || null },
    { key: 'viabilidad', label: 'Viabilidad', count: null },
    { key: 'items',      label: 'Líneas',     count: itemsCount || null },
    ...(hayResultado ? [{ key: 'preguntas', label: 'Preguntas', count: null }] : []),
    ...(hayCosteo ? [{ key: 'costeo', label: 'Costeo', count: null }] : []),
    ...(hayAuditorTecnico ? [{ key: 'comercial', label: 'Auditor Técnico', count: auditorCount || null, alerta: !!auditorAlerta }] : []),
  ];
}

export interface TabItemNegocio { key: string; label: string; count?: number | null }

// Barra de pestañas internas dentro de una sección del menú (Resumen agrupa
// Resumen/Fechas/Criterios; Resultado agrupa Resultado/Competencia). Mismo componente en ambas
// páginas para que la UI no vuelva a divergir entre ellas.
export function SeccionTabs({ items, activo, onSelect }: { items: TabItemNegocio[]; activo: string; onSelect: (key: string) => void }) {
  return (
    <div className="flex gap-4 mb-5 border-b border-zinc-200">
      {items.map(it => (
        <button
          key={it.key}
          onClick={() => onSelect(it.key)}
          className={`flex items-center gap-1.5 pb-2.5 -mb-px text-[13px] font-semibold border-b-2 transition-colors ${
            activo === it.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-zinc-400 hover:text-zinc-700'
          }`}
        >
          {it.label}
          {it.count != null && it.count > 0 && (
            <span className={`text-[10px] px-1.5 py-px rounded-full font-bold ${activo === it.key ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-400'}`}>
              {it.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
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
