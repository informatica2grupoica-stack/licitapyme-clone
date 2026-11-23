import { cn } from '@/app/lib/utils';
import { IconFileText as FileText, IconBook2 as BookOpen, IconChartBar as BarChart2, IconClipboardList as ClipboardList, IconFileCheck as FileCheck, IconHelpCircle as HelpCircle } from '@tabler/icons-react';

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
    className: 'text-teal-700 dark:text-teal-400',
    icon: <BookOpen size={10} />,
  },
  BASES_TECNICAS: {
    label: 'Bases Técnicas',
    shortLabel: 'Bases Téc.',
    className: 'text-tinta-2 dark:text-slate-300',
    icon: <FileText size={10} />,
  },
  CRITERIOS_EVALUACION: {
    label: 'Criterios de Evaluación',
    shortLabel: 'Criterios',
    className: 'text-amber-700 dark:text-amber-400',
    icon: <BarChart2 size={10} />,
  },
  ANEXOS_OFERENTE: {
    label: 'Anexos Oferente',
    shortLabel: 'Anexos',
    className: 'text-emerald-700 dark:text-emerald-400',
    icon: <ClipboardList size={10} />,
  },
  DOCUMENTOS_PROCESO: {
    label: 'Documentos de Proceso',
    shortLabel: 'Proceso',
    className: 'text-tinta-2 dark:text-slate-300',
    icon: <FileCheck size={10} />,
  },
  OTROS: {
    label: 'Otros',
    shortLabel: 'Otros',
    className: 'text-red-700 dark:text-red-400',
    icon: <HelpCircle size={10} />,
  },
};

export function DocCategoriaBadge({ categoria, className, size = 'sm' }: DocCategoriaBadgeProps) {
  if (!categoria) return null;
  const cfg = CONFIG[categoria as DocCategoria] || {
    label: categoria,
    shortLabel: categoria,
    className: 'text-tinta-2 dark:text-slate-300',
    icon: <FileText size={10} />,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium',
        'text-xs',
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
