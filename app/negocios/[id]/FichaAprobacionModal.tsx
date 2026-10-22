'use client';

// Ficha técnica de UNA línea de «Qué se va a aprobar»: a la izquierda el documento de la ficha (del modelo que se compra a ese proveedor) y a la
// derecha la comparativa contra las bases. La comparativa es la misma de la matriz de precios (TecnicoDeCelda): mismo panel, mismas fichas.
import { useState } from 'react';
import { Modal } from '@/app/components/ui/Modal';
import { DocumentViewerModal, tipoDe, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { compararPrecioConCosteo } from '@/app/lib/compras-precio-vs-costeo';
import { useFichasCompras, opcionesDeCelda, TecnicoDeCelda } from './FichasEnCotizacion';
import { IconLoader2 as Loader2 } from '@tabler/icons-react';

export function FichaAprobacionModal({ negocioId, productoId, producto, proveedor, proveedorRut, compraUnit, costeadoUnit, puedeOperar, onClose }: {
  negocioId: number; productoId: number; producto: string; proveedor: string; proveedorRut: string | null;
  compraUnit: number | null; costeadoUnit: number | null; puedeOperar: boolean; onClose: () => void;
}) {
  const { panel, cargando, recargar } = useFichasCompras(negocioId);
  const fichas = opcionesDeCelda(panel, productoId, proveedor, proveedorRut)
    .flatMap(o => o.fichas.filter((f): f is { nombre: string; url: string } => !!f.url).map(f => ({ ...f, modelo: [o.marca, o.modelo].filter(Boolean).join(' ') })));
  const [activa, setActiva] = useState(0);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const f = fichas[Math.min(activa, fichas.length - 1)] ?? null;
  const tipo = f ? tipoDe(f.nombre, f.url) : null;

  return (
    <Modal open onClose={onClose} size="xl" title={`Ficha técnica · ${producto}`} subtitle={proveedor}>
      <div className="grid lg:grid-cols-2 gap-4" data-testid="ficha-aprobacion-modal">
        <section className="min-w-0 flex flex-col">
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <h3 className="text-sm font-medium text-slate-800">Documento</h3>
            {fichas.length > 1 && fichas.map((x, i) => (
              <button key={x.url} type="button" onClick={() => setActiva(i)}
                className={`text-xs ${i === activa ? 'font-semibold text-teal-700 underline underline-offset-4' : 'text-slate-500 hover:text-slate-800'}`}>{x.nombre}</button>
            ))}
            {f && <button type="button" onClick={() => setVisor({ nombre: f.nombre, url: f.url })} className="ml-auto text-xs font-semibold text-teal-700 hover:text-teal-900">Ver en pantalla completa</button>}
          </div>
          {cargando && !panel && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando la ficha…</p>}
          {panel && !f && <p className="text-xs text-slate-500">No hay un documento de ficha de {proveedor} para este producto.</p>}
          {f && f.modelo && <p className="text-xs text-slate-500 mb-2">Modelo {f.modelo}</p>}
          {f && (tipo === 'pdf' || tipo === 'img')
            ? <iframe key={f.url} src={`/api/proxy?url=${encodeURIComponent(f.url)}&inline=1`} title={f.nombre} className="w-full h-[65vh] rounded-xl border border-slate-200 bg-slate-50" />
            : f && <p className="text-xs text-slate-500">Este formato no se ve aquí: usa «Ver en pantalla completa».</p>}
        </section>
        <section className="min-w-0 overflow-y-auto max-h-[72vh]">
          {/* Sin el panel todavía, TecnicoDeCelda diría «no hay ficha» mientras carga. */}
          {panel && <TecnicoDeCelda negocioId={negocioId} productoId={productoId} proveedor={proveedor} proveedorRut={proveedorRut}
            precioVeredicto={compararPrecioConCosteo(compraUnit, costeadoUnit).veredicto} panel={panel} cargando={cargando} recargar={recargar} puedeOperar={puedeOperar} />}
        </section>
      </div>
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </Modal>
  );
}
