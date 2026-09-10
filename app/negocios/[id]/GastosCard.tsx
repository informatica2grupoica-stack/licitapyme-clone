'use client';

// REGISTRO DE GASTOS — pedido del usuario (09-sep-2026): ver TODOS los gastos reales del negocio en
// un solo lugar (flete, horas extras, productos extra, etc.), no mezclado con la tarjeta de Entrega
// (que es sobre la entrega física) ni con los escenarios (que son una estimación, no un gasto real).
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { Receipt, Loader2, Plus, X, Trash2, Paperclip } from 'lucide-react';

interface Gasto {
  id: number; categoriaClave: string | null; categoriaEtiqueta: string | null;
  descripcion: string; monto: number; moneda: string; fechaGasto: string | null;
  comprobanteUrl: string | null; registradoPorNombre: string | null; createdAt: string;
}
interface Categoria { clave: string; etiqueta: string }

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function GastosCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [resumen, setResumen] = useState<{ total: number; porCategoria: Array<{ clave: string | null; etiqueta: string; total: number }> }>({ total: 0, porCategoria: [] });
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [formAbierto, setFormAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState<number | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [form, setForm] = useState({ categoriaClave: '', categoriaLibre: '', descripcion: '', monto: '', moneda: 'CLP', fechaGasto: '' });

  const cargar = useCallback(async () => {
    try {
      const [rG, rC] = await Promise.all([fetch(`/api/compras/${negocioId}/gastos`), fetch(`/api/compras/gastos/categorias`)]);
      const [dG, dC] = await Promise.all([rG.json(), rC.json()]);
      if (dG.success) { setGastos(dG.gastos || []); setResumen(dG.resumen || { total: 0, porCategoria: [] }); }
      if (dC.success) setCategorias(dC.categorias || []);
    } catch (e: any) {
      toast.error('No se pudieron cargar los gastos', e.message);
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => { cargar(); }, [cargar]);

  const crear = async () => {
    if (!form.descripcion.trim() || !form.monto) return;
    setGuardando(true);
    try {
      let res: Response;
      if (archivo) {
        const fd = new FormData();
        fd.set('file', archivo);
        if (form.categoriaClave) fd.set('categoriaClave', form.categoriaClave);
        else if (form.categoriaLibre.trim()) fd.set('categoriaLibre', form.categoriaLibre.trim());
        fd.set('descripcion', form.descripcion.trim());
        fd.set('monto', form.monto);
        fd.set('moneda', form.moneda);
        if (form.fechaGasto) fd.set('fechaGasto', form.fechaGasto);
        res = await fetch(`/api/compras/${negocioId}/gastos`, { method: 'POST', body: fd });
      } else {
        res = await fetch(`/api/compras/${negocioId}/gastos`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoriaClave: form.categoriaClave || null, categoriaLibre: form.categoriaClave ? null : (form.categoriaLibre.trim() || null),
            descripcion: form.descripcion.trim(), monto: Number(form.monto), moneda: form.moneda, fechaGasto: form.fechaGasto || null,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar');
      toast.success('Gasto registrado');
      setForm({ categoriaClave: '', categoriaLibre: '', descripcion: '', monto: '', moneda: 'CLP', fechaGasto: '' });
      setArchivo(null);
      setFormAbierto(false);
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo registrar el gasto', e.message);
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (id: number) => {
    setEliminando(id);
    try {
      const res = await fetch(`/api/compras/${negocioId}/gastos?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar');
      await cargar();
    } catch (e: any) {
      toast.error('No se pudo eliminar', e.message);
    } finally {
      setEliminando(null);
    }
  };

  if (loading) return null;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-50 border-b border-zinc-100">
        <div>
          <p className="text-[12.5px] font-bold text-zinc-700 flex items-center gap-1.5"><Receipt size={14} /> Gastos del negocio</p>
          <p className="text-[10.5px] text-zinc-400 mt-0.5">Todo lo que de verdad se pagó — flete, horas extras, un producto que se agregó sobre la marcha, etc. No es la estimación de los escenarios.</p>
        </div>
        {puedeOperar && (
          <button onClick={() => setFormAbierto(v => !v)} className="flex-shrink-0 flex items-center gap-1 text-[11.5px] font-semibold text-teal-700 hover:text-teal-800">
            <Plus size={13} /> Agregar gasto
          </button>
        )}
      </div>

      {resumen.total > 0 && (
        <div className="px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[13px] font-bold text-zinc-800">Total: {fmtCLP(resumen.total)}</span>
          {resumen.porCategoria.map(c => (
            <span key={c.clave || 'sin'} className="text-[11px] text-zinc-500">{c.etiqueta}: <span className="font-semibold text-zinc-700">{fmtCLP(c.total)}</span></span>
          ))}
        </div>
      )}

      {formAbierto && (
        <div className="border-b border-zinc-100 px-4 py-3 space-y-2 bg-zinc-50/60">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Select value={form.categoriaClave} minWidth={150} placeholder="Categoría…"
              onChange={v => setForm(f => ({ ...f, categoriaClave: v }))}
              options={categorias.map(c => ({ value: c.clave, label: c.etiqueta }))} />
            {!form.categoriaClave && (
              <input value={form.categoriaLibre} onChange={e => setForm(f => ({ ...f, categoriaLibre: e.target.value }))}
                placeholder="…o nueva categoría" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            )}
            <input inputMode="numeric" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
              placeholder="Monto" className="text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            <Select value={form.moneda} onChange={v => setForm(f => ({ ...f, moneda: v }))} minWidth={90}
              options={[{ value: 'CLP', label: 'CLP' }, { value: 'USD', label: 'USD' }]} />
          </div>
          {form.moneda !== 'CLP' && <p className="text-[10.5px] text-amber-600">Un gasto en otra moneda queda visible en la lista, pero no entra al total (no se convierte solo).</p>}
          <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            placeholder="Descripción del gasto" className="w-full text-[12px] border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-semibold text-zinc-500">
              Fecha del gasto (opcional)
              <input type="date" value={form.fechaGasto} onChange={e => setForm(f => ({ ...f, fechaGasto: e.target.value }))}
                className="mt-0.5 w-full text-[12px] font-normal border border-zinc-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            </label>
            <label className="text-[11px] font-semibold text-zinc-500">
              Comprobante (opcional)
              <input type="file" accept=".pdf,image/*" onChange={e => setArchivo(e.target.files?.[0] || null)}
                className="mt-0.5 w-full text-[11px] text-zinc-600 file:mr-2 file:text-[11px] file:font-semibold file:text-teal-700 file:bg-teal-50 file:border-0 file:rounded-lg file:px-2 file:py-1" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={crear} disabled={!form.descripcion.trim() || !form.monto || guardando}
              className="text-[12px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1.5 rounded-lg">
              {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
            </button>
            <button onClick={() => setFormAbierto(false)} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
          </div>
        </div>
      )}

      {gastos.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-zinc-400">Sin gastos registrados todavía.</p>
      ) : (
        <div className="divide-y divide-zinc-100">
          {gastos.map(g => (
            <div key={g.id} className="px-4 py-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="text-[12px] text-zinc-800">
                  {g.categoriaEtiqueta && <span className="text-[9.5px] font-bold text-zinc-500 bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded-full mr-1.5">{g.categoriaEtiqueta}</span>}
                  {g.descripcion}
                </p>
                <p className="text-[10.5px] text-zinc-400">
                  {g.fechaGasto || g.createdAt.slice(0, 10)}{g.registradoPorNombre && ` · ${g.registradoPorNombre}`}
                  {g.comprobanteUrl && (
                    <a href={g.comprobanteUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-teal-600 hover:text-teal-700 font-semibold">
                      <Paperclip size={10} /> Comprobante
                    </a>
                  )}
                </p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                <span className="text-[12.5px] font-bold text-zinc-800">{g.moneda !== 'CLP' ? `${g.moneda} ${g.monto.toLocaleString('es-CL')}` : fmtCLP(g.monto)}</span>
                {puedeOperar && (
                  <button onClick={() => eliminar(g.id)} disabled={eliminando === g.id} className="text-zinc-300 hover:text-rose-500 disabled:opacity-50">
                    {eliminando === g.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
