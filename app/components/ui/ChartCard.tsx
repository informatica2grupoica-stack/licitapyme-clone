'use client';

// Tarjeta de GRÁFICO única — contenedor estándar para los Recharts de los dashboards.
// Mismo lenguaje que StatCard: rounded-2xl, borde slate-200, título con icono.
export function ChartCard({ title, icon, children, className = '', accion, sub }: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  accion?: React.ReactNode;  // control opcional a la derecha (selector, link…)
  sub?: string;              // subtítulo opcional bajo el título
}) {
  return (
    <div className={`bg-white border border-linea rounded-xl shadow-tarjeta p-4 sm:p-5 dark:bg-slate-900 dark:border-slate-800 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-tinta dark:text-slate-100 flex items-center gap-2">
            {icon && <span className="text-slate-400">{icon}</span>}
            <span className="truncate">{title}</span>
          </h3>
          {sub && <p className="text-xs text-tinta-2 dark:text-slate-400 mt-0.5">{sub}</p>}
        </div>
        {accion && <div className="flex-shrink-0">{accion}</div>}
      </div>
      {children}
    </div>
  );
}
