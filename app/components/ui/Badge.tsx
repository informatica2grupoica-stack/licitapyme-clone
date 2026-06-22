import { cn } from '@/app/lib/utils';

type Variant =
  | 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
  | 'bases-admin' | 'bases-tecnicas' | 'criterios' | 'anexos' | 'proceso' | 'otros';

interface BadgeProps {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const variantMap: Record<Variant, string> = {
  default:         'bg-slate-100 text-slate-600 border border-slate-200',
  primary:         'bg-indigo-50 text-indigo-700 border border-indigo-200',
  success:         'bg-emerald-50 text-emerald-700 border border-emerald-200',
  warning:         'bg-amber-50 text-amber-700 border border-amber-200',
  danger:          'bg-rose-50 text-rose-700 border border-rose-200',
  info:            'bg-sky-50 text-sky-700 border border-sky-200',
  'bases-admin':   'bg-blue-50 text-blue-700 border border-blue-200',
  'bases-tecnicas':'bg-purple-50 text-purple-700 border border-purple-200',
  'criterios':     'bg-amber-50 text-amber-700 border border-amber-200',
  'anexos':        'bg-emerald-50 text-emerald-700 border border-emerald-200',
  'proceso':       'bg-slate-100 text-slate-600 border border-slate-200',
  'otros':         'bg-rose-50 text-rose-700 border border-rose-200',
};

const dotMap: Record<Variant, string> = {
  default:         'bg-slate-400',
  primary:         'bg-indigo-500',
  success:         'bg-emerald-500',
  warning:         'bg-amber-500',
  danger:          'bg-rose-500',
  info:            'bg-sky-500',
  'bases-admin':   'bg-blue-500',
  'bases-tecnicas':'bg-purple-500',
  'criterios':     'bg-amber-500',
  'anexos':        'bg-emerald-500',
  'proceso':       'bg-slate-400',
  'otros':         'bg-rose-500',
};

export function Badge({ variant = 'default', children, className, dot }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold',
      variantMap[variant],
      className,
    )}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotMap[variant])} />}
      {children}
    </span>
  );
}
