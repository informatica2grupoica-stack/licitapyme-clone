'use client';

// «Cómo se adapta la viabilidad a tu empresa» (migration-201): presupuesto mínimo y qué tan estricto es el calce con lo que la empresa vende.
// Se cambia en DOS lugares sin tocar código: Mi empresa (admin de la empresa) y la ficha de /admin/clientes (LICITANK).
// CriteriosViabilidadForm es la parte visual; CriteriosViabilidadEmpresa es la sección de Mi empresa.
import { useCallback, useEffect, useState } from 'react';
import { useSession, tieneModulo } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';
import { Boton } from '@/app/components/ui/kit/Boton';
import { MODOS_CALCE, type ConfigViabilidadEmpresa, type ModoCalce } from '@/app/lib/cv/viabilidad-empresa-core';

const campo = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900';

export function CriteriosViabilidadForm({ valor, onGuardar, ocupado }: {
  valor: ConfigViabilidadEmpresa; onGuardar: (c: { minimo_neto: number | null; calce: ModoCalce }) => void; ocupado?: boolean;
}) {
  const [calce, setCalce] = useState<ModoCalce>(valor.calce);
  const [minimo, setMinimo] = useState(valor.minimo_neto == null ? '' : String(valor.minimo_neto));
  useEffect(() => { setCalce(valor.calce); setMinimo(valor.minimo_neto == null ? '' : String(valor.minimo_neto)); }, [valor.calce, valor.minimo_neto]);
  const sucio = calce !== valor.calce || (minimo === '' ? null : Number(minimo)) !== valor.minimo_neto;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] text-slate-500">Qué tan estricto es el calce con lo que vendes</p>
        <div role="radiogroup" aria-label="Calce con lo que vendes" className="mt-1.5 space-y-1.5">
          {MODOS_CALCE.map(m => (
            <label key={m.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition ${calce === m.id ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-900/10' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}>
              <input type="radio" name="modo-calce" className="mt-0.5 accent-teal-700" checked={calce === m.id} onChange={() => setCalce(m.id)} />
              <span><span className="block text-[13px] font-medium text-slate-800 dark:text-slate-200">{m.titulo}</span><span className="block text-xs text-slate-500">{m.ayuda}</span></span>
            </label>
          ))}
        </div>
      </div>
      <label className="block max-w-xs text-[11px] text-slate-500">Presupuesto neto mínimo (pesos)
        <input className={`${campo} mt-0.5`} inputMode="numeric" value={minimo} placeholder="Valor del sistema" onChange={e => setMinimo(e.target.value.replace(/[^0-9]/g, ''))} />
        <span className="mt-0.5 block text-xs text-slate-500">Las licitaciones con menos presupuesto salen como EXCLUIDAS. Déjalo vacío para usar el valor del sistema.</span>
      </label>
      <Boton tamano="sm" variante="primario" disabled={ocupado || !sucio} onClick={() => onGuardar({ minimo_neto: minimo === '' ? null : Number(minimo), calce })}>Guardar</Boton>
    </div>
  );
}

export function CriteriosViabilidadEmpresa() {
  const { usuario } = useSession();
  const toast = useToast();
  const aplica = usuario?.rol === 'admin' && !!usuario.clienteId && usuario.clienteId !== 1 && tieneModulo(usuario, 'viabilidad');
  const [config, setConfig] = useState<ConfigViabilidadEmpresa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const cargar = useCallback(async () => {
    const r = await fetch('/api/mi-empresa/viabilidad').then(x => x.json()).catch(() => ({}));
    if (r.config) setConfig(r.config);
  }, []);
  useEffect(() => { if (aplica) cargar(); }, [aplica, cargar]);
  if (!aplica || !config) return null;

  const guardar = async (c: { minimo_neto: number | null; calce: ModoCalce }) => {
    setOcupado(true);
    try {
      const r = await fetch('/api/mi-empresa/viabilidad', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error('No se guardó', j.error || `HTTP ${r.status}`); return; }
      setConfig(j.config); toast.success('Guardado', 'Rige en los próximos análisis.');
    } finally { setOcupado(false); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Cómo se adapta la viabilidad a tu empresa</h2>
      <p className="mt-0.5 mb-3 text-sm text-slate-500">El nivel de atractivo de cada licitación se ajusta a lo que tú vendes (lo que completaste arriba en el perfil: productos, rubros y montos) y a estas opciones.</p>
      <CriteriosViabilidadForm valor={config} onGuardar={guardar} ocupado={ocupado} />
    </section>
  );
}
