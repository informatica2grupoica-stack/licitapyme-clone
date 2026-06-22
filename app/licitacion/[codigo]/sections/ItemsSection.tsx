// app/licitacion/[codigo]/sections/ItemsSection.tsx
'use client';

import { Package } from 'lucide-react';
import { ItemProducto } from '@/app/types/search.types';
import { formatCLP, SectionHeader } from '../utils';
import { Resaltar } from '@/app/components/Resaltar';

export function ItemsSection({ items, keywords = [] }: { items?: ItemProducto[]; keywords?: string[] }) {
  const hayItems = !!items && items.length > 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Package size={18} />}
        title="Ítems y Cantidades"
        subtitle="Productos y servicios requeridos en el proceso"
        badge={hayItems && (
          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-semibold">{items!.length}</span>
        )}
      />

      {!hayItems ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center fade-in">
          <Package size={28} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600 mb-1">Sin ítems registrados</p>
          <p className="text-xs text-slate-400">Mercado Público no informó productos o servicios para esta licitación.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden fade-in">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left border-b border-slate-100">
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-10">#</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Producto / Servicio</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Categoría</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">Cant.</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right hidden sm:table-cell">Monto unit.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items!.map((item, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors slide-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                    <td className="px-4 py-3 text-slate-400 text-xs tabular-nums">{item.correlativo ?? i + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 text-[13px]"><Resaltar texto={item.nombre_producto} keywords={keywords} /></p>
                      {item.descripcion && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2"><Resaltar texto={item.descripcion} keywords={keywords} /></p>}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {item.categoria
                        ? <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium"><Resaltar texto={item.categoria} keywords={keywords} /></span>
                        : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] text-slate-800 font-medium tabular-nums">
                      {item.cantidad} <span className="text-slate-400 font-normal">{item.unidad}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      {item.monto_unitario
                        ? <span className="text-[13px] text-slate-800 font-semibold">{formatCLP(item.monto_unitario)}</span>
                        : <span className="text-xs text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {items!.length > 5 && (
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-100">
                    <td colSpan={5} className="px-4 py-2 text-xs text-slate-400 text-center">
                      {items!.length} ítems en total
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
