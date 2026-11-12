'use client';

// «Entrega y acta»: las órdenes de compra del negocio en miniatura (la del cliente y las de proveedores); se pincha y se ve grande.
import { useEffect, useRef, useState } from 'react';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { OrdenCompraVisor } from './OrdenCompraVisor';
import { MiniaturaDoc, urlInline } from './MiniaturaDoc';

interface Datos { cliente: Array<{ nombre: string; url: string }>; proveedores: Array<{ folio: string; proveedor: string | null; estado: string | null }> }

// Caché de la sesión: al cambiar de pestaña y volver, o al reentrar al negocio, las miniaturas salen al instante (y el navegador revalida por ETag).
const LISTAS = new Map<string, Datos>();
const BLOBS = new Map<string, string>();

// La OC de proveedor la arma Licitank como PDF (no hay archivo guardado): se pide una vez y se usa de miniatura.
function MiniaturaOcProveedor({ negocioId, folio, proveedor, estado, onAbrir }: { negocioId: number; folio: string; proveedor: string | null; estado: string | null; onAbrir: () => void }) {
  const clave = `${negocioId}:${folio}`;
  const [src, setSrc] = useState<string | null>(BLOBS.get(clave) ?? null);
  const [visible, setVisible] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  // Hay OC que son 15 o más: la miniatura se arma solo cuando la tarjeta aparece en pantalla.
  useEffect(() => {
    const el = caja.current; if (!el) return;
    const o = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setVisible(true); o.disconnect(); } }, { rootMargin: '200px' });
    o.observe(el); return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || BLOBS.has(clave)) return;
    let vivo = true;
    fetch(`/api/compras/${negocioId}/orden-compra-obuma/documento?folio=${encodeURIComponent(folio)}`)
      .then(r => (r.ok ? r.blob() : Promise.reject()))
      .then(b => { const u = URL.createObjectURL(b); BLOBS.set(clave, u); if (vivo) setSrc(u); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [negocioId, folio, visible, clave]);
  return <div ref={caja}><MiniaturaDoc src={src} titulo={`OC ${folio}`} detalle={[proveedor, estado].filter(Boolean).join(' · ') || null} onAbrir={onAbrir} /></div>;
}

export function OcMiniaturas({ negocioId }: { negocioId: number }) {
  const [datos, setDatos] = useState<Datos | null>(LISTAS.get(String(negocioId)) ?? null);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  const [folio, setFolio] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/ocs`).then(r => r.json()).then(d => { if (vivo && d?.success) { LISTAS.set(String(negocioId), d); setDatos(d); } }).catch(() => {});
    return () => { vivo = false; };
  }, [negocioId]);

  if (!datos || (datos.cliente.length === 0 && datos.proveedores.length === 0)) return null;
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 mb-3" data-testid="oc-miniaturas">
      <p className="text-[11px] font-bold text-zinc-500 uppercase mb-2.5">Órdenes de compra · pincha una para verla</p>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {datos.cliente.map(c => (
          <MiniaturaDoc key={c.nombre} src={urlInline(c.url)} titulo={c.nombre.replace(/\.pdf$/i, '')} detalle="Del cliente" onAbrir={() => setVisor({ nombre: c.nombre, url: c.url })} />
        ))}
        {datos.proveedores.filter(p => p.estado !== 'ANULADA').map(p => (
          <MiniaturaOcProveedor key={p.folio} negocioId={negocioId} folio={p.folio} proveedor={p.proveedor} estado={p.estado} onAbrir={() => setFolio(p.folio)} />
        ))}
      </div>
      {datos.proveedores.some(p => p.estado === 'ANULADA') && <p className="text-[11px] text-zinc-400 mt-2">{datos.proveedores.filter(p => p.estado === 'ANULADA').length} orden(es) anulada(s) no se muestran.</p>}
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
      {folio && <OrdenCompraVisor negocioId={negocioId} folio={folio} onCerrar={() => setFolio(null)} />}
    </div>
  );
}
