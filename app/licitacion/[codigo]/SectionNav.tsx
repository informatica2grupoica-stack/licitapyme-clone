'use client';

import {
  LayoutDashboard, Calendar, Package, FileText,
  BarChart3, MessageSquare, Send, Gauge,
} from 'lucide-react';

export type SeccionLicitacion =
  | 'resumen' | 'fechas' | 'items' | 'documentos' | 'preguntas'
  | 'criterios' | 'comentarios' | 'viabilidad' | 'inteligencia' | 'postulacion' | 'gestion';

interface NavItem { key: SeccionLicitacion; label: string; icon: React.ReactNode; }
interface NavGroup { label: string; items: NavItem[]; }

// Lista única y ordenada (radar). Orden definido por el equipo:
// Resumen · Documentos · Viabilidad · Criterios · Ítems · Fechas · Comentarios · Postulación.
const GROUPS: NavGroup[] = [
  {
    label: '',
    items: [
      { key: 'resumen',     label: 'Resumen',      icon: <LayoutDashboard size={14} /> },
      { key: 'documentos',  label: 'Documentos',   icon: <FileText        size={14} /> },
      { key: 'viabilidad',  label: 'Viabilidad',   icon: <Gauge           size={14} /> },
      { key: 'criterios',   label: 'Criterios',    icon: <BarChart3       size={14} /> },
      { key: 'items',       label: 'Ítems',        icon: <Package         size={14} /> },
      { key: 'fechas',      label: 'Fechas',       icon: <Calendar        size={14} /> },
      { key: 'comentarios', label: 'Comentarios',  icon: <MessageSquare   size={14} /> },
      { key: 'postulacion', label: 'Postulación',  icon: <Send            size={14} /> },
    ],
  },
];

export interface SectionCounts {
  documentos?: number;
  items?: number;
  fechas?: number;
  comentarios?: number;
  ia?: boolean;
  viabilidad?: string | null; // semáforo: VERDE | AMARILLO | ...
}

const SEMAFORO_DOT: Record<string, string> = {
  VERDE: '#10b981', AMARILLO: '#eab308', NARANJA: '#f97316', ROJO: '#ef4444', ROJO_DURO: '#b91c1c',
};

function BadgeCount({ n }: { n: number }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/20 font-bold flex-shrink-0 tabular-nums">
      {n}
    </span>
  );
}

export function SectionNav({ active, onChange, counts = {} }: {
  active: SeccionLicitacion;
  onChange: (s: SeccionLicitacion) => void;
  counts?: SectionCounts;
}) {
  const badgeFor = (key: SeccionLicitacion): React.ReactNode => {
    switch (key) {
      case 'documentos':  return counts.documentos ? <BadgeCount n={counts.documentos} /> : null;
      case 'items':       return counts.items ? <BadgeCount n={counts.items} /> : null;
      case 'fechas':      return counts.fechas ? <BadgeCount n={counts.fechas} /> : null;
      case 'comentarios': return counts.comentarios ? <BadgeCount n={counts.comentarios} /> : null;
      case 'viabilidad':
        return counts.viabilidad
          ? <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SEMAFORO_DOT[counts.viabilidad] || '#94a3b8' }} />
          : null;
      case 'inteligencia':
        return counts.ia
          ? <span className="w-2 h-2 rounded-full flex-shrink-0 bg-purple-400" />
          : null;
      default: return null;
    }
  };

  return (
    <>
      {/* Desktop: nav vertical */}
      <nav className="hidden lg:block w-56 flex-shrink-0">
        <div className="card p-2 sticky top-6 space-y-1">
          {GROUPS.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && <div className="h-px bg-slate-100 mx-2 my-2" />}
              {group.label && (
                <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const activo = active === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => onChange(item.key)}
                      className={`
                        w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium
                        transition-all duration-150 text-left relative
                        ${activo
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }
                      `}
                    >
                      {activo && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-500 rounded-full" />
                      )}
                      <span className={`flex-shrink-0 ${activo ? 'text-indigo-500' : 'text-slate-400'}`}>
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {badgeFor(item.key)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Mobile: pills con scroll */}
      <nav className="lg:hidden overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 mb-2">
        <div className="flex gap-1.5 pb-2 min-w-max">
          {GROUPS.flatMap(g => g.items).map(item => {
            const activo = active === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onChange(item.key)}
                className={`
                  flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold
                  whitespace-nowrap transition-all duration-150
                  ${activo
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-200 hover:text-indigo-600'
                  }
                `}
              >
                {item.icon}
                {item.label}
                {badgeFor(item.key)}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
