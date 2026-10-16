'use client';

// REGISTRO DE GASTOS — pedido del usuario (09-sep-2026): ver TODOS los gastos reales del negocio en
// un solo lugar (flete, horas extras, productos extra, etc.), no mezclado con la tarjeta de Entrega
// (que es sobre la entrega física) ni con los escenarios (que son una estimación, no un gasto real).
import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { Select } from '@/app/components/ui/Select';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import { IconReceipt as Receipt, IconLoader2 as Loader2, IconPlus as Plus, IconX as X, IconTrash as Trash2, IconPaperclip as Paperclip } from '@tabler/icons-react';

interface Gasto {
  id: number; categoriaClave: string | null; categoriaEtiqueta: string | null;
  descripcion: string; monto: number; moneda: string; fechaGasto: string | null;
  comprobanteUrl: string | null; registradoPorNombre: string | null; createdAt: string;
}
interface Categoria { clave: string; etiqueta: string }

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export function GastosCard({ negocioId, puedeOperar }: { negocioId: number; puedeOperar: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompartido } = useCompras();
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
      recargarCompartido();
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
      recargarCompartido();
    } catch (e: any) {
      toast.error('No se pudo eliminar', e.message);
    } finally {
      setEliminando(null);
    }
  };

  if (loading) return <p className="text-[12.5px] text-zinc-400 px-1">Cargando…</p>;

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 space-y-1.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[13px] font-bold text-zinc-800 flex items-center gap-1.5"><Receipt size={15} /> Gastos extra del proyecto</p>
          {puedeOperar && (
            <button onClick={() => setFormAbierto(v => !v)} data-testid="gasto-agregar"
              className="flex-shrink-0 flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 px-3.5 py-2 rounded-lg">
              <Plus size={14} /> {formAbierto ? 'Cerrar' : 'Anotar un gasto'}
            </button>
          )}
        </div>
        <p className="text-[12px] text-zinc-600">Aquí anotas la plata que se gastó <b>además de comprar los productos</b>: por ejemplo el flete, el combustible, horas extras o algo que hubo que agregar sobre la marcha. Sirve para saber cuánto costó de verdad el proyecto. <b>Si no hubo ningún gasto así, no tienes que hacer nada aquí.</b></p>
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
        <div className="border-b border-zinc-100 px-4 py-4 space-y-3 bg-zinc-50/60" data-testid="gasto-form">
          <div>
            <p className="text-[12.5px] font-bold text-zinc-800 mb-1">1. ¿Qué tipo de gasto es?</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {categorias.map(c => {
                const on = form.categoriaClave === c.clave;
                return (
                  <button key={c.clave} type="button" onClick={() => setForm(f => ({ ...f, categoriaClave: on ? '' : c.clave, categoriaLibre: '' }))}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-zinc-700 border-zinc-300 hover:border-teal-400'}`}>{c.etiqueta}</button>
                );
              })}
            </div>
            {!form.categoriaClave && (
              <input value={form.categoriaLibre} onChange={e => setForm(f => ({ ...f, categoriaLibre: e.target.value }))}
                placeholder="Si no está en la lista, escribe cuál es (ej: viáticos)" className="mt-1.5 w-full max-w-sm text-[12.5px] border border-zinc-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
            )}
          </div>
          <div>
            <p className="text-[12.5px] font-bold text-zinc-800 mb-1">2. ¿En qué se gastó?</p>
            <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Ej: flete de Santiago a Coyhaique, camión de la empresa X" className="w-full text-[12.5px] border border-zinc-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
          </div>
          <div>
            <p className="text-[12.5px] font-bold text-zinc-800 mb-1">3. ¿Cuánto fue?</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] text-zinc-400">$</span>
              <input inputMode="numeric" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                placeholder="Monto, solo números" className="w-44 text-[13px] border border-zinc-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              <Select value={form.moneda} onChange={v => setForm(f => ({ ...f, moneda: v }))} minWidth={90}
                options={[{ value: 'CLP', label: 'Pesos (CLP)' }, { value: 'USD', label: 'Dólares (USD)' }]} />
            </div>
            {form.moneda !== 'CLP' && <p className="mt-1 text-[11.5px] text-amber-700">Un gasto en dólares queda visible en la lista, pero no se suma al total (no se convierte solo).</p>}
          </div>
          <div>
            <p className="text-[12.5px] font-bold text-zinc-800 mb-1">4. Datos opcionales</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-[11.5px] font-semibold text-zinc-500">
                Fecha en que se pagó
                <input type="date" value={form.fechaGasto} onChange={e => setForm(f => ({ ...f, fechaGasto: e.target.value }))}
                  className="mt-0.5 w-full text-[12px] font-normal border border-zinc-300 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-500" />
              </label>
              <label className="text-[11.5px] font-semibold text-zinc-500">
                Boleta o factura (foto o PDF)
                <input type="file" accept=".pdf,image/*" onChange={e => setArchivo(e.target.files?.[0] || null)}
                  className="mt-0.5 w-full text-[11.5px] text-zinc-600 file:mr-2 file:text-[11.5px] file:font-semibold file:text-teal-700 file:bg-teal-50 file:border-0 file:rounded-lg file:px-2 file:py-1" />
              </label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={crear} disabled={!form.descripcion.trim() || !form.monto || guardando}
              className="text-[12.5px] font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-4 py-2 rounded-lg">
              {guardando ? <Loader2 size={13} className="animate-spin" /> : 'Guardar gasto'}
            </button>
            <button onClick={() => setFormAbierto(false)} className="text-[12px] text-zinc-500 hover:text-zinc-700">Cancelar</button>
            {(!form.descripcion.trim() || !form.monto) && <span className="text-[11.5px] text-zinc-400">Falta llenar el punto 2 y el 3 para guardar.</span>}
          </div>
        </div>
      )}

      {gastos.length === 0 ? (
        <div className="px-4 py-6 text-center space-y-1">
          <p className="text-[13px] font-semibold text-zinc-600">Todavía no se anotó ningún gasto extra.</p>
          <p className="text-[12px] text-zinc-400">{puedeOperar ? 'Si ya se pagó un flete, combustible u otra cosa, aprieta «Anotar un gasto». Si no hubo, puedes seguir con lo siguiente.' : 'Cuando el encargado anote un gasto, aparecerá aquí.'}</p>
        </div>
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
