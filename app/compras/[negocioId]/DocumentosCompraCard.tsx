'use client';
// Cotizaciones y fichas técnicas del negocio, solo para abrirlas (perfil Auditor de Compras: sin precios ni comparación).
import { useEffect, useState } from 'react';
import { IconFileText as FileText, IconExternalLink as ExternalLink } from '@tabler/icons-react';

interface Cot { id: number; proveedor: string; nombre: string; url: string; fecha: string | null }
interface Ficha { proveedor: string | null; nombre: string; url: string }

function Fila({ titulo, sub, url }: { titulo: string; sub?: string | null; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
      <span className="flex items-center gap-2 min-w-0">
        <FileText size={15} className="text-zinc-400 flex-shrink-0" />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-zinc-800 truncate">{titulo}</span>
          {sub && <span className="block text-[12px] text-zinc-500 truncate">{sub}</span>}
        </span>
      </span>
      <ExternalLink size={14} className="text-zinc-400 flex-shrink-0" />
    </a>
  );
}

export default function DocumentosCompraCard({ negocioId }: { negocioId: number | string }) {
  const [datos, setDatos] = useState<{ cotizaciones: Cot[]; fichas: Ficha[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/compras/${negocioId}/documentos-compra`)
      .then(r => r.json())
      .then(d => { if (!vivo) return; if (!d.success) setError(d.error || 'No se pudieron cargar los documentos.'); else setDatos({ cotizaciones: d.cotizaciones, fichas: d.fichas }); })
      .catch(() => vivo && setError('No se pudieron cargar los documentos.'));
    return () => { vivo = false; };
  }, [negocioId]);

  if (error) return <p className="text-[13px] text-rose-600">{error}</p>;
  if (!datos) return <p className="text-[13px] text-zinc-400">Cargando documentos…</p>;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-4">
      <div>
        <h3 className="text-[14px] font-bold text-zinc-900">Cotizaciones y fichas técnicas</h3>
        <p className="text-[12.5px] text-zinc-500 mt-0.5">Los archivos que subió Compras para este negocio. Se abren en una pestaña nueva.</p>
      </div>
      <section className="space-y-1.5">
        <h4 className="text-[12px] font-bold uppercase tracking-wide text-zinc-500">Cotizaciones ({datos.cotizaciones.length})</h4>
        {datos.cotizaciones.length === 0 ? <p className="text-[13px] text-zinc-400">Aún no hay cotizaciones con archivo.</p>
          : datos.cotizaciones.map(c => <Fila key={c.id} titulo={c.proveedor} sub={[c.nombre, c.fecha].filter(Boolean).join(' · ')} url={c.url} />)}
      </section>
      <section className="space-y-1.5">
        <h4 className="text-[12px] font-bold uppercase tracking-wide text-zinc-500">Fichas técnicas ({datos.fichas.length})</h4>
        {datos.fichas.length === 0 ? <p className="text-[13px] text-zinc-400">Aún no hay fichas técnicas.</p>
          : datos.fichas.map((f, i) => <Fila key={i} titulo={f.nombre} sub={f.proveedor} url={f.url} />)}
      </section>
    </div>
  );
}
