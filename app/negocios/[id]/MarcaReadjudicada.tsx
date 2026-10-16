'use client';

// Marca manual «readjudicada a nosotros» (solo admin, migration-149). Para cuando el organismo
// readjudica por decreto y la ficha de Mercado Público sigue mostrando al otro proveedor.
import { useEffect, useState } from 'react';

export function MarcaReadjudicada({ negocioId }: { negocioId: number }) {
  const [estado, setEstado] = useState<{ readjudicada: boolean; nota: string | null; por: string | null } | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/negocios/${negocioId}/readjudicada`).then(r => r.json()).then(setEstado).catch(() => {});
  }, [negocioId]);

  async function guardar(activa: boolean) {
    setGuardando(true); setError(null);
    const r = await fetch(`/api/negocios/${negocioId}/readjudicada`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activa, nota }),
    }).catch(() => null);
    setGuardando(false);
    if (r?.ok) window.location.reload();
    else setError((await r?.json().catch(() => null))?.error || 'No se pudo guardar');
  }

  if (!estado) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 text-[13px] text-slate-600">
      {estado.readjudicada ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span><b>Readjudicada a nosotros</b>{estado.nota ? ` — ${estado.nota}` : ''}{estado.por ? ` (marcado por ${estado.por})` : ''}. Esta marca prevalece sobre la ficha de Mercado Público.</span>
          <button disabled={guardando} onClick={() => guardar(false)} className="ml-auto text-indigo-600 font-semibold hover:underline">Quitar marca</button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span>¿El organismo readjudicó a nosotros pero Mercado Público no lo refleja?</span>
          <input value={nota} onChange={e => setNota(e.target.value)} maxLength={300} placeholder="Ej: Decreto Alcaldicio N.º 4253"
            className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-2 py-1" />
          <button disabled={guardando} onClick={() => guardar(true)} className="text-indigo-600 font-semibold hover:underline">Marcar como readjudicada</button>
        </div>
      )}
      {error && <p className="text-red-600 mt-2">{error}</p>}
    </div>
  );
}

// Insignia visible en el encabezado del detalle (cualquier rol): aparece solo si hay marca.
export function InsigniaReadjudicada({ negocioId }: { negocioId: number }) {
  const [info, setInfo] = useState<{ readjudicada: boolean; nota: string | null } | null>(null);
  useEffect(() => {
    fetch(`/api/negocios/${negocioId}/readjudicada`).then(r => r.json()).then(setInfo).catch(() => {});
  }, [negocioId]);
  if (!info?.readjudicada) return null;
  return (
    <span title={info.nota || 'Readjudicada a nosotros'}
      className="text-[11px] px-2.5 py-0.5 rounded-full font-bold border bg-emerald-50 text-emerald-700 border-emerald-200">
      Readjudicada
    </span>
  );
}
