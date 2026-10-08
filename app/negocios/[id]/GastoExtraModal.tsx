'use client';

// «+» DE GASTOS EXTRA: registrar un gasto real del proyecto (flete, garantía, horas extras…) sin salir del
// Comparativo. Usa el mismo endpoint que la tarjeta «Gastos extra» (/api/compras/[id]/gastos).
import { useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { IconX as X, IconLoader2 as Loader2, IconPaperclip as Paperclip } from '@tabler/icons-react';

interface Categoria { clave: string; etiqueta: string }
const GARANTIA = 'Garantía de fiel cumplimiento';

export function GastoExtraModal({ negocioId, categoriaInicial, descripcionInicial, montoInicial, onCerrar, onGuardado }: {
  negocioId: number; categoriaInicial?: string; descripcionInicial?: string; montoInicial?: number; onCerrar: () => void; onGuardado: () => void;
}) {
  const toast = useToast();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [form, setForm] = useState({ categoriaClave: '', categoriaLibre: categoriaInicial || '', descripcion: descripcionInicial || '', monto: montoInicial != null ? String(Math.round(montoInicial)) : '', fechaGasto: '' });

  useEffect(() => {
    fetch('/api/compras/gastos/categorias').then(r => r.json()).then(d => { if (d.success) setCategorias(d.categorias || []); }).catch(() => {});
  }, []);

  const guardar = async () => {
    if (!form.descripcion.trim() || !form.monto.trim()) return;
    setGuardando(true);
    try {
      const monto = Number(form.monto.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(monto) || monto <= 0) throw new Error('El monto debe ser un número mayor a cero.');
      let res: Response;
      if (archivo) {
        const fd = new FormData();
        fd.set('file', archivo);
        if (form.categoriaClave) fd.set('categoriaClave', form.categoriaClave); else if (form.categoriaLibre.trim()) fd.set('categoriaLibre', form.categoriaLibre.trim());
        fd.set('descripcion', form.descripcion.trim()); fd.set('monto', String(monto)); fd.set('moneda', 'CLP');
        if (form.fechaGasto) fd.set('fechaGasto', form.fechaGasto);
        res = await fetch(`/api/compras/${negocioId}/gastos`, { method: 'POST', body: fd });
      } else {
        res = await fetch(`/api/compras/${negocioId}/gastos`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoriaClave: form.categoriaClave || null, categoriaLibre: form.categoriaClave ? null : (form.categoriaLibre.trim() || null),
            descripcion: form.descripcion.trim(), monto, moneda: 'CLP', fechaGasto: form.fechaGasto || null,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Gasto extra registrado');
      onGuardado();
    } catch (e: any) {
      toast.error('No se pudo registrar el gasto', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const campo = 'w-full text-[13px] border border-zinc-200 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-teal-500';
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={onCerrar} data-testid="gasto-extra-modal">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200">
          <p className="text-[14px] font-bold text-zinc-800">Agregar gasto extra</p>
          <button onClick={onCerrar} aria-label="Cerrar" className="text-zinc-500 hover:text-zinc-900"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-zinc-500">Lo que de verdad se pagó y no es un producto: flete, garantía, horas extras, un insumo que se agregó sobre la marcha… Suma al costo real del proyecto.</p>
          <div>
            <p className="text-[11px] font-semibold text-zinc-500 mb-1">Categoría</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button type="button" onClick={() => setForm(f => ({ ...f, categoriaClave: '', categoriaLibre: GARANTIA }))}
                className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border ${!form.categoriaClave && form.categoriaLibre === GARANTIA ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-zinc-600 border-zinc-200 hover:border-teal-400'}`}>{GARANTIA}</button>
            </div>
            <Select value={form.categoriaClave} minWidth={220} placeholder="Elegir una categoría…"
              onChange={v => setForm(f => ({ ...f, categoriaClave: v, categoriaLibre: v ? '' : f.categoriaLibre }))}
              options={categorias.map(c => ({ value: c.clave, label: c.etiqueta }))} />
            {!form.categoriaClave && (
              <input value={form.categoriaLibre} onChange={e => setForm(f => ({ ...f, categoriaLibre: e.target.value }))} placeholder="…o escribe una categoría nueva" className={`${campo} mt-2`} />
            )}
          </div>
          <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción (ej. Flete ABC SA, televisores, cobrado aparte)" className={campo} />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-semibold text-zinc-500">
              Monto neto (CLP)
              <input inputMode="numeric" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} placeholder="Ej. 23512" className={`${campo} mt-0.5 font-normal`} />
            </label>
            <label className="text-[11px] font-semibold text-zinc-500">
              Fecha del gasto (opcional)
              <input type="date" value={form.fechaGasto} onChange={e => setForm(f => ({ ...f, fechaGasto: e.target.value }))} className={`${campo} mt-0.5 font-normal`} />
            </label>
          </div>
          <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-teal-700 hover:text-teal-900 cursor-pointer">
            <Paperclip size={14} /> {archivo ? archivo.name : 'Adjuntar comprobante (opcional)'}
            <input type="file" className="hidden" onChange={e => setArchivo(e.target.files?.[0] ?? null)} />
          </label>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button onClick={onCerrar} className="text-[13px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
            <button onClick={guardar} disabled={guardando || !form.descripcion.trim() || !form.monto.trim()}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-4 py-2 rounded-lg">
              {guardando && <Loader2 size={13} className="animate-spin" />} Guardar gasto
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
