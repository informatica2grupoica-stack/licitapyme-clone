'use client';

// FRANJA de Compras: aviso de incidencias abiertas, a la vista en todos los pasos.
import { IconAlertTriangle as AlertTriangle } from '@tabler/icons-react';

export function FranjaCompra({ incidenciasAbiertas, onIrIncidencias, ocultar = false }: {
  incidenciasAbiertas: number; onIrIncidencias: () => void;
  // ocultar: la franja que la contiene ya habla de las incidencias.
  ocultar?: boolean;
}) {
  if (incidenciasAbiertas <= 0 || ocultar) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="franja-compra">
      <button type="button" onClick={onIrIncidencias}
        className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 font-semibold rounded-lg border border-rose-300 bg-rose-50 text-rose-800 hover:shadow-sm transition-colors">
        <AlertTriangle size={14} /> {incidenciasAbiertas} incidencia{incidenciasAbiertas === 1 ? '' : 's'}
      </button>
    </div>
  );
}
