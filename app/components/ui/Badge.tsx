import { cn } from '@/app/lib/utils';

type Variant =
  | 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
  | 'bases-admin' | 'bases-tecnicas' | 'criterios' | 'anexos' | 'proceso' | 'otros';

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
  /** Se mantiene por compatibilidad: ahora el punto de color siempre se muestra. */
  dot?: boolean;
}

// licitank-ui: estados con punto de color + texto, sin fondo ni borde (nada de pastillas).
const variantMap: Record<Variant, string> = {
  default:         'text-tinta-2 dark:text-slate-300',
  primary:         'text-teal-700 dark:text-teal-300',
  success:         'text-emerald-700 dark:text-emerald-400',
  warning:         'text-amber-700 dark:text-amber-400',
  danger:          'text-red-700 dark:text-red-400',
  info:            'text-sky-700 dark:text-sky-400',
  'bases-admin':   'text-teal-700 dark:text-teal-400',
  'bases-tecnicas':'text-tinta-2 dark:text-slate-300',
  'criterios':     'text-amber-700 dark:text-amber-400',
  'anexos':        'text-emerald-700 dark:text-emerald-400',
  'proceso':       'text-tinta-2 dark:text-slate-300',
  'otros':         'text-red-700 dark:text-red-400',
};

const dotMap: Record<Variant, string> = {
  default:         'bg-slate-400',
  primary:         'bg-teal-500',
  success:         'bg-emerald-500',
  warning:         'bg-amber-500',
  danger:          'bg-red-500',
  info:            'bg-sky-500',
  'bases-admin':   'bg-blue-500',
  'bases-tecnicas':'bg-slate-500',
  'criterios':     'bg-amber-500',
  'anexos':        'bg-emerald-500',
  'proceso':       'bg-slate-400',
  'otros':         'bg-red-500',
};

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', variantMap[variant], className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotMap[variant])} />
      {children}
    </span>
  );
}
