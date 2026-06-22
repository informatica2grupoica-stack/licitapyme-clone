import { cn } from '@/app/lib/utils';
import { FileText, BookOpen, BarChart2, ClipboardList, FileCheck, HelpCircle } from 'lucide-react';

export type DocCategoria =
  | 'BASES_ADMINISTRATIVAS'
  | 'BASES_TECNICAS'
  | 'CRITERIOS_EVALUACION'
  | 'ANEXOS_OFERENTE'
  | 'DOCUMENTOS_PROCESO'
  | 'OTROS';

interface DocCategoriaBadgeProps {
  categoria?: DocCategoria | string | null;
  className?: string;
  size?: 'sm' | 'md';
}

const CONFIG: Record<DocCategoria, { label: string; shortLabel: string; className: string; icon: React.ReactNode }> = {
  BASES_ADMINISTRATIVAS: {
    label: 'Bases Administrativas',
    shortLabel: 'Bases Admin',
    className: 'bg-blue-50 text-blue-700 border border-blue-200',
    icon: <BookOpen size={10} />,
  },
  BASES_TECNICAS: {
    label: 'Bases Técnicas',
    shortLabel: 'Bases Téc.',
    className: 'bg-purple-50 text-purple-700 border border-purple-200',
    icon: <FileText size={10} />,
  },
  CRITERIOS_EVALUACION: {
    label: 'Criterios de Evaluación',
    shortLabel: 'Criterios',
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
    icon: <BarChart2 size={10} />,
  },
  ANEXOS_OFERENTE: {
    label: 'Anexos Oferente',
    shortLabel: 'Anexos',
    className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    icon: <ClipboardList size={10} />,
  },
  DOCUMENTOS_PROCESO: {
    label: 'Documentos de Proceso',
    shortLabel: 'Proceso',
    className: 'bg-slate-100 text-slate-600 border border-slate-200',
    icon: <FileCheck size={10} />,
  },
  OTROS: {
    label: 'Otros',
    shortLabel: 'Otros',
    className: 'bg-rose-50 text-rose-700 border border-rose-200',
    icon: <HelpCircle size={10} />,
  },
};

export function DocCategoriaBadge({ categoria, className, size = 'sm' }: DocCategoriaBadgeProps) {
  if (!categoria) return null;
  const cfg = CONFIG[categoria as DocCategoria] || {
    label: categoria,
    shortLabel: categoria,
    className: 'bg-slate-100 text-slate-600 border border-slate-200',
    icon: <FileText size={10} />,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md font-semibold',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]',
        cfg.className,
        className,
      )}
      title={cfg.label}
    >
      {cfg.icon}
      {size === 'sm' ? cfg.shortLabel : cfg.label}
    </span>
  );
}

// Panel de resumen de categorías
interface DocCategoriaSummaryProps {
  documentos: Array<{ categoria?: string | null }>;
}

export function DocCategoriaSummary({ documentos }: DocCategoriaSummaryProps) {
  const counts: Partial<Record<DocCategoria, number>> = {};
  for (const doc of documentos) {
    if (doc.categoria) {
      const cat = doc.categoria as DocCategoria;
      counts[cat] = (counts[cat] || 0) + 1;
    }
  }

  const entries = Object.entries(counts) as [DocCategoria, number][];
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([cat, count]) => {
        const cfg = CONFIG[cat];
        if (!cfg) return null;
        return (
          <span
            key={cat}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold',
              cfg.className,
            )}
          >
            {cfg.icon}
            {cfg.shortLabel}
            <span className="ml-0.5 opacity-70">({count})</span>
          </span>
        );
      })}
    </div>
  );
}
