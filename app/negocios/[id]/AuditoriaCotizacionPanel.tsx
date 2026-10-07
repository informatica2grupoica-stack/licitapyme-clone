'use client';

// COMPARACIÓN DE PRECIO por cotización × producto (compras-auditoria-cotizacion.ts).
// Lo que audita Compras en una cotización es el PRECIO contra lo que el asistente costeó al ofertar:
// ¿es mejor o peor, y por cuánto? El cumplimiento técnico NO se juzga acá: es otro documento (la ficha
// técnica del producto) y otra revisión. El detalle (plazo, vigencia, pérdida, RUT) queda plegado.
import { useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { IconLoader2 as Loader2, IconRefresh as Refresh, IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconTrendingDown as Baja, IconTrendingUp as Sube, IconEqual as Igual, IconHelpCircle as Duda, IconPlus as Plus, IconTrash as Trash } from '@tabler/icons-react';

type Cumple = 'CUMPLE' | 'MEJORA' | 'INFERIOR_NEGOCIABLE' | 'INFERIOR_INSALVABLE' | 'NO_ES_EL_PRODUCTO';
// Los cuatro últimos solo existen en comparaciones técnicas guardadas antes del cambio a precio.
type Dictamen = 'PRECIO_MEJOR' | 'PRECIO_IGUAL' | 'PRECIO_PEOR' | 'SIN_COMPARAR' | 'APTA' | 'CON_OBSERVACIONES' | 'NO_APTA' | 'NO_ES_EL_PRODUCTO' | 'NO_VERIFICABLE';

export interface AdicionalUI { id: number; concepto: string; cantidad: number; precioUnitario: number }
export interface ItemPrecioUI { precioUnitario: number | null; precioBase: number | null; adicionales: AdicionalUI[] }
const CONCEPTOS = ['Quemador a gas', 'Bandejas', 'Carro', 'Puesta en marcha', 'Flete', 'Accesorios', 'Instalación'];
const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

export interface RevisionUI {
  area: string; criterio: string; requerido: string | null; cotizado: string | null;
  resultado: 'CUMPLE' | 'NO_CUMPLE' | 'NO_VERIFICABLE'; gravedad: 'critico' | 'aviso' | 'info'; explicacion: string; origen: 'codigo' | 'ia';
  citaCotizacion: string | null; citaCotizacionVerificada: boolean; citaRequisito: string | null; citaRequisitoVerificada: boolean;
}
export interface AuditoriaUI {
  cotizacionId: number; productoId: number; dictamen: Dictamen; resumen: string | null; revisiones: RevisionUI[];
  generadoAt: string; generadoPorNombre: string | null; cumpleAplicado: Cumple | null;
  override: { cumple: Cumple; motivo: string; porNombre: string | null; at: string } | null;
}

const VEREDICTO: Record<Dictamen, { label: string; cls: string; borde: string; Icono: typeof Baja }> = {
  PRECIO_MEJOR: { label: 'Más barata que lo costeado', cls: 'text-emerald-800 bg-emerald-100', borde: 'border-emerald-300 bg-emerald-50/50', Icono: Baja },
  PRECIO_IGUAL: { label: 'Igual a lo costeado', cls: 'text-sky-800 bg-sky-100', borde: 'border-sky-300 bg-sky-50/50', Icono: Igual },
  PRECIO_PEOR: { label: 'Más cara que lo costeado', cls: 'text-rose-800 bg-rose-100', borde: 'border-rose-300 bg-rose-50/50', Icono: Sube },
  SIN_COMPARAR: { label: 'No se pudo comparar', cls: 'text-zinc-700 bg-zinc-200', borde: 'border-zinc-300 bg-zinc-50', Icono: Duda },
  // Antiguos (comparación técnica):
  APTA: { label: 'Revisión técnica antigua: apta', cls: 'text-zinc-700 bg-zinc-200', borde: 'border-zinc-300 bg-zinc-50', Icono: Duda },
  CON_OBSERVACIONES: { label: 'Revisión técnica antigua: con observaciones', cls: 'text-zinc-700 bg-zinc-200', borde: 'border-zinc-300 bg-zinc-50', Icono: Duda },
  NO_APTA: { label: 'Revisión técnica antigua: no apta', cls: 'text-zinc-700 bg-zinc-200', borde: 'border-zinc-300 bg-zinc-50', Icono: Duda },
  NO_ES_EL_PRODUCTO: { label: 'Revisión técnica antigua: no es el producto', cls: 'text-zinc-700 bg-zinc-200', borde: 'border-zinc-300 bg-zinc-50', Icono: Duda },
  NO_VERIFICABLE: { label: 'Revisión técnica antigua: no verificable', cls: 'text-zinc-700 bg-zinc-200', borde: 'border-zinc-300 bg-zinc-50', Icono: Duda },
};

const ES_PRECIO = (r: RevisionUI) => r.criterio === 'Precio vs. lo costeado';

export function AuditoriaCotizacionPanel({ negocioId, cotizacionId, productoId, productoNombre, auditoria, item, puedeOperar, onCambio }: {
  negocioId: number; cotizacionId: number; productoId: number; productoNombre: string;
  auditoria: AuditoriaUI | undefined; item?: ItemPrecioUI; puedeOperar: boolean; onCambio: () => Promise<void>;
}) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [comparando, setComparando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [baseTxt, setBaseTxt] = useState('');
  const [filas, setFilas] = useState<Array<{ concepto: string; cantidad: string; precio: string }>>([]);

  const abrirEditor = () => {
    setBaseTxt(item?.precioBase != null ? String(Math.round(item.precioBase)) : '');
    const actuales = (item?.adicionales || []).map(a => ({ concepto: a.concepto, cantidad: String(a.cantidad), precio: String(Math.round(a.precioUnitario)) }));
    setFilas(actuales.length ? actuales : [{ concepto: '', cantidad: '1', precio: '' }]);   // parte con una fila lista para escribir
    setEditando(true);
  };
  const num = (t: string) => Number(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  const guardarAdicionales = async () => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${cotizacionId}/adicionales`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoId, precioBase: baseTxt.trim() ? num(baseTxt) : undefined, adicionales: filas.filter(f => f.concepto.trim() || f.precio.trim()).map(f => ({ concepto: f.concepto, cantidad: num(f.cantidad || '1'), precioUnitario: num(f.precio) })) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      toast.success('Adicionales guardados', 'El precio comparado ya los incluye.');
      setEditando(false);
      await onCambio();
    } catch (e: any) {
      toast.error('No se pudieron guardar los adicionales', e.message);
    } finally { setGuardando(false); }
  };

  const comparar = async () => {
    setComparando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/cotizaciones/${cotizacionId}/auditar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productoId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo comparar');
      await onCambio();
    } catch (e: any) {
      toast.error('No se pudo comparar el precio', e.message);
    } finally { setComparando(false); }
  };

  if (!auditoria) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-zinc-600 bg-zinc-50 border border-dashed border-zinc-300 rounded-lg px-3 py-2">
        <span className="font-semibold text-zinc-800 truncate">{productoNombre}</span>
        <span className="text-zinc-500">— el precio aún no se compara con lo costeado.</span>
        {puedeOperar && (
          <button onClick={comparar} disabled={comparando} className="ml-auto flex items-center gap-1 font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50 flex-shrink-0">
            {comparando ? <Loader2 size={13} className="animate-spin" /> : <Refresh size={13} />} Comparar precio
          </button>
        )}
      </div>
    );
  }

  const v = VEREDICTO[auditoria.dictamen];
  const precio = auditoria.revisiones.find(ES_PRECIO);
  const otros = auditoria.revisiones.filter(r => !ES_PRECIO(r) && r.origen === 'codigo');
  const conProblema = otros.filter(r => r.resultado !== 'CUMPLE').length;

  return (
    <div className={`border rounded-lg ${v.borde}`}>
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2 flex-wrap">
          <p className="text-[13px] font-bold text-zinc-900 flex-1 min-w-[200px]">{productoNombre}</p>
          <span className={`inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-full ${v.cls}`}><v.Icono size={13} /> {v.label}</span>
          {puedeOperar && (
            <button onClick={comparar} disabled={comparando} title="Volver a comparar" className="text-zinc-400 hover:text-teal-700 disabled:opacity-50">
              {comparando ? <Loader2 size={14} className="animate-spin" /> : <Refresh size={14} />}
            </button>
          )}
        </div>
        {precio && precio.resultado !== 'NO_VERIFICABLE' && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div><p className="text-[11px] font-bold text-zinc-400 uppercase">Lo costeado</p><p className="text-[14px] font-bold text-zinc-800">{precio.requerido?.replace(/^Hasta /, '').replace(' (lo costeado)', '') || '—'}</p></div>
            <div><p className="text-[11px] font-bold text-zinc-400 uppercase">Esta cotización</p><p className="text-[14px] font-bold text-zinc-800">{precio.cotizado || '—'}</p></div>
          </div>
        )}
        {item && item.adicionales.length > 0 && !editando && (
          <ul className="mt-2 text-[12.5px] text-zinc-700 space-y-0.5 bg-white/70 border border-zinc-200 rounded-lg px-3 py-2">
            <li className="flex justify-between"><span>El producto, según la cotización</span><b>{item.precioBase != null ? fmt(item.precioBase) : '—'}</b></li>
            {item.adicionales.map(a => (
              <li key={a.id} className="flex justify-between"><span>+ {a.concepto}{a.cantidad !== 1 ? ` (${a.cantidad} × ${fmt(a.precioUnitario)})` : ''}</span><b>{fmt(a.cantidad * a.precioUnitario)}</b></li>
            ))}
            <li className="flex justify-between border-t border-zinc-200 pt-0.5 text-zinc-900"><span>= Precio que se compara</span><b>{item.precioUnitario != null ? fmt(item.precioUnitario) : '—'}</b></li>
          </ul>
        )}
        {auditoria.resumen && <p className="text-[12.5px] text-zinc-700 mt-2">{auditoria.resumen}</p>}
        {puedeOperar && item && !editando && (
          <button onClick={abrirEditor} className="mt-1.5 mr-3 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-700 hover:text-indigo-900">
            <Plus size={13} /> {item.adicionales.length ? 'Editar adicionales' : 'Agregar adicionales (quemador, bandejas…)'}
          </button>
        )}
        {editando && (
          <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2.5">
            <p className="text-[12.5px] text-indigo-900">La cotización a veces trae el producto solo y lo demás aparte. Agrega aquí lo que hace falta para <b>entregar este producto</b>: se suma al precio que se compara. Valores netos, por unidad del producto.</p>
            <label className="block text-[12px] font-semibold text-zinc-600">Precio del producto solo (neto)
              <input value={baseTxt} onChange={e => setBaseTxt(e.target.value)} inputMode="numeric" placeholder="Ej.: 12000000"
                className="mt-0.5 w-full sm:w-56 text-[13px] font-normal border border-zinc-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-indigo-500" />
            </label>
            <datalist id={`conceptos-${cotizacionId}-${productoId}`}>{CONCEPTOS.map(c => <option key={c} value={c} />)}</datalist>
            {filas.map((f, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <label className="col-span-12 sm:col-span-6 text-[11.5px] font-semibold text-zinc-500">Qué es
                  <input list={`conceptos-${cotizacionId}-${productoId}`} value={f.concepto} onChange={e => setFilas(fs => fs.map((x, j) => j === i ? { ...x, concepto: e.target.value } : x))} placeholder="Quemador a gas"
                    className="mt-0.5 w-full text-[13px] font-normal border border-zinc-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-indigo-500" /></label>
                <label className="col-span-4 sm:col-span-2 text-[11.5px] font-semibold text-zinc-500">Cantidad
                  <input value={f.cantidad} onChange={e => setFilas(fs => fs.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))} inputMode="decimal"
                    className="mt-0.5 w-full text-[13px] font-normal border border-zinc-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-indigo-500" /></label>
                <label className="col-span-6 sm:col-span-3 text-[11.5px] font-semibold text-zinc-500">Precio neto c/u
                  <input value={f.precio} onChange={e => setFilas(fs => fs.map((x, j) => j === i ? { ...x, precio: e.target.value } : x))} inputMode="numeric" placeholder="800000"
                    className="mt-0.5 w-full text-[13px] font-normal border border-zinc-300 rounded-lg px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-indigo-500" /></label>
                <button type="button" onClick={() => setFilas(fs => fs.filter((_, j) => j !== i))} title="Quitar" className="col-span-2 sm:col-span-1 pb-2 text-rose-500 hover:text-rose-700"><Trash size={15} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setFilas(fs => [...fs, { concepto: '', cantidad: '1', precio: '' }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-indigo-700 hover:text-indigo-900"><Plus size={14} /> Otro adicional</button>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={guardarAdicionales} disabled={guardando} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3.5 py-1.5 rounded-lg">
                {guardando ? <Loader2 size={13} className="animate-spin" /> : null} Guardar
              </button>
              <button onClick={() => setEditando(false)} disabled={guardando} className="text-[13px] text-zinc-500 hover:text-zinc-800">Cancelar</button>
            </div>
          </div>
        )}
        {otros.length > 0 && (
          <button onClick={() => setAbierto(a => !a)} className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-teal-700 hover:text-teal-800">
            {abierto ? 'Ocultar' : 'Ver'} otros controles{conProblema > 0 ? ` (${conProblema} con aviso)` : ''} {abierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>
      {abierto && (
        <ul className="px-3 pb-3 space-y-1.5 border-t border-zinc-200/70 pt-2">
          {otros.map((r, i) => (
            <li key={i} className="text-[12.5px] text-zinc-700 flex gap-2">
              <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${r.resultado === 'CUMPLE' ? 'bg-emerald-500' : r.resultado === 'NO_CUMPLE' ? 'bg-rose-500' : 'bg-amber-400'}`} />
              <span><b className="text-zinc-900">{r.criterio}.</b> {r.explicacion}</span>
            </li>
          ))}
          <li className="text-[11px] text-zinc-400 pt-1">Comparado {auditoria.generadoAt}. El cumplimiento técnico no se mira aquí: va con la ficha técnica del producto.</li>
        </ul>
      )}
    </div>
  );
}
