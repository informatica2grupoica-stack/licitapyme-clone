'use client';
// Chip «Facturada» de la cabecera de la ficha de Compras (pedido del dueño, 23-nov-2026): se ve a simple vista que la licitación
// ya tiene factura de venta y, al pincharlo, lleva a Entrega y cierre → Factura y cierre, donde está (y donde se abre).
import { useEffect, useState } from 'react';
import { IconReceipt as Receipt } from '@tabler/icons-react';
import { irAFase, enfocarProducto } from './[negocioId]/comprasNavegacion';

export function ChipFacturada({ negocioId, version }: { negocioId: number; version?: string }) {
  const [folios, setFolios] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/factura-venta`).then(r => r.json())
      .then(d => { if (vivo && d?.success) setFolios((d.facturas || []).map((f: { numero: string | null }) => f.numero || 's/n')); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [negocioId, version]);
  if (folios.length === 0) return null;
  const ir = () => { irAFase('entrega'); enfocarProducto('costoreal', null); };
  return (
    <button type="button" onClick={ir} data-testid="chip-facturada" title="Ver la factura de venta"
      className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-full px-2.5 py-1 whitespace-nowrap">
      <Receipt size={13} /> Facturada · N° {folios.join(', ')}
    </button>
  );
}
