'use client';

// BANNER de estado unificado — para estados PERSISTENTES de página (error de carga,
// degradación, aviso). Para el RESULTADO de una acción puntual usar useToast().
//
// Uso:
//   <Banner variante="error">{mensaje}</Banner>
//   <Banner variante="warning" accion={{ label: 'Reintentar', onClick: recargar }}>
//     No se pudo cargar el detalle de adjudicación.
//   </Banner>
import { AlertTriangle, XCircle, Info, CheckCircle2, RefreshCw } from 'lucide-react';

type Variante = 'error' | 'warning' | 'info' | 'success';

const ESTILOS: Record<Variante, { caja: string; icono: React.ReactNode; boton: string }> = {
  error: {
    caja: 'bg-rose-50 border-rose-200 text-rose-700',
    icono: <XCircle size={15} className="text-rose-500" />,
    boton: 'text-rose-700 hover:bg-rose-100 border-rose-200',
  },
  warning: {
    caja: 'bg-amber-50 border-amber-200 text-amber-800',
    icono: <AlertTriangle size={15} className="text-amber-500" />,
    boton: 'text-amber-800 hover:bg-amber-100 border-amber-200',
  },
  info: {
    caja: 'bg-sky-50 border-sky-200 text-sky-800',
    icono: <Info size={15} className="text-sky-500" />,
    boton: 'text-sky-800 hover:bg-sky-100 border-sky-200',
  },
  success: {
    caja: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    icono: <CheckCircle2 size={15} className="text-emerald-500" />,
    boton: 'text-emerald-800 hover:bg-emerald-100 border-emerald-200',
  },
};

export function Banner({ variante = 'info', children, accion, className = '' }: {
  variante?: Variante;
  children: React.ReactNode;
  accion?: { label: string; onClick: () => void; cargando?: boolean };
  className?: string;
}) {
  const s = ESTILOS[variante];
  return (
    <div className={`flex items-center gap-2.5 border px-4 py-3 rounded-xl text-[13px] fade-in ${s.caja} ${className}`} role="status">
      <span className="flex-shrink-0">{s.icono}</span>
      <div className="flex-1 min-w-0">{children}</div>
      {accion && (
        <button onClick={accion.onClick} disabled={accion.cargando}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold border rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50 ${s.boton}`}>
          <RefreshCw size={12} className={accion.cargando ? 'animate-spin' : ''} /> {accion.label}
        </button>
      )}
    </div>
  );
}
