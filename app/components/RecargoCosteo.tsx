'use client';

// «Recargo inicial del costeo»: con qué % sobre el costo nace un costeo NUEVO de esta empresa (antes, 27 % fijo en el código).
// Se cambia en DOS lugares: en Mi empresa (su admin) y en la ficha de /admin/clientes (LICITANK). En cada costeo se puede cambiar igual.
import { useCallback, useEffect, useState } from 'react';
import { useSession, tieneModulo } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { MARGEN_VENTA_DEFECTO } from '@/app/lib/costeo-editor-fusion';

export function CampoRecargo({ valor, onGuardar, deshabilitado }: { valor: number | null; onGuardar: (v: number | null) => void; deshabilitado?: boolean }) {
  const [texto, setTexto] = useState(valor == null ? '' : String(valor));
  useEffect(() => { setTexto(valor == null ? '' : String(valor)); }, [valor]);
  const guardar = () => {
    const v = texto.trim() === '' ? null : Number(texto.replace(',', '.'));
    if (v !== valor) onGuardar(v);
  };
  return (
    <div className="flex items-center gap-2">
      <input type="number" min={0} max={300} step="0.1" inputMode="decimal" aria-label="Recargo inicial del costeo, en porcentaje" disabled={deshabilitado}
        placeholder={String(MARGEN_VENTA_DEFECTO)} value={texto} onChange={e => setTexto(e.target.value)} onBlur={guardar}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900" />
      <span className="text-sm text-slate-600 dark:text-slate-300">% sobre el costo</span>
      <span className="text-xs text-slate-500">(vacío = {MARGEN_VENTA_DEFECTO} %)</span>
    </div>
  );
}

export function RecargoCosteoEmpresa() {
  const { usuario } = useSession();
  const toast = useToast();
  const aplica = usuario?.rol === 'admin' && !!usuario.clienteId && usuario.clienteId !== 1 && tieneModulo(usuario, 'costeo');
  const [valor, setValor] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch('/api/mi-empresa/opciones').then(x => x.json()).catch(() => ({}));
    if (r.opciones) setValor(r.opciones.recargo_costeo ?? null);
  }, []);
  useEffect(() => { if (aplica) cargar(); }, [aplica, cargar]);
  if (!aplica) return null;

  const guardar = async (v: number | null) => {
    setOcupado(true);
    try {
      const r = await fetch('/api/mi-empresa/opciones', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recargo_costeo: v }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error('No se guardó', j.error || `HTTP ${r.status}`); await cargar(); return; }
      setValor(j.opciones.recargo_costeo ?? null);
      toast.success('Guardado');
    } finally { setOcupado(false); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Recargo inicial del costeo</h2>
      <p className="mt-0.5 mb-3 text-sm text-slate-500">Cada costeo nuevo parte con este recargo. En cada uno lo puedes cambiar; los ya guardados no cambian.</p>
      <CampoRecargo valor={valor} onGuardar={guardar} deshabilitado={ocupado} />
    </section>
  );
}
