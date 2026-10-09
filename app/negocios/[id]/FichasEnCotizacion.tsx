'use client';

// FICHA TÉCNICA DENTRO DE LA MATRIZ DE PRECIOS. Cada celda (producto × proveedor) ya dice cuánto cuesta frente a lo costeado; aquí se le suma
// qué dice la ficha técnica de ESE modelo de ESE proveedor contra las bases. Al abrir el detalle de la celda se ve la conclusión conjunta
// (precio + técnico), los requisitos con su resultado y se pueden complementar los «Falta dato». Los datos son los del paso «3 · Fichas
// técnicas» (mismo panel, mismas fichas): lo que se cambie aquí se ve allá y al revés.
import { useCallback, useEffect, useState } from 'react';
import { IconLoader2 as Loader2, IconSparkles as Chispa } from '@tabler/icons-react';
import { useToast } from '@/app/components/ui/toast';
import { irAPestana } from '@/app/compras/[negocioId]/Pestanas';
import { OpcionFila } from './FichasTecnicasCard';
import type { PanelFichasDTO, OpcionFichaDTO } from '@/app/lib/compras-fichas';
import type { VeredictoPrecio } from '@/app/lib/compras-precio-vs-costeo';

export const EVENTO_FICHAS = 'compras:fichas-cambio';
const normP = (x: string | null | undefined) => (x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Carga el panel de fichas una vez y lo vuelve a pedir cuando algo cambia (aquí o en el paso «Fichas técnicas»). */
export function useFichasCompras(negocioId: number) {
  const [panel, setPanel] = useState<PanelFichasDTO | null>(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    try {
      const d = await fetch(`/api/compras/${negocioId}/fichas`).then(r => r.json());
      if (d.success) setPanel(d.panel);
    } catch { /* la matriz sigue sin la columna técnica */ }
    finally { setCargando(false); }
  }, [negocioId]);
  useEffect(() => { recargar(); }, [recargar]);
  useEffect(() => {
    const h = () => { recargar(); };
    window.addEventListener(EVENTO_FICHAS, h);
    return () => window.removeEventListener(EVENTO_FICHAS, h);
  }, [recargar]);
  return { panel, cargando, recargar };
}

export interface TecnicoCelda { estado: string; cumple: number; total: number; modelo: string }

/** Peor estado entre las opciones con ficha: una sola que no cumpla ya es una mala noticia. */
const peor = (o: OpcionFichaDTO[]): OpcionFichaDTO | null => {
  const orden: Record<string, number> = { NO_CUMPLE: 0, CON_PENDIENTES: 1, NO_CORRIDO: 2, SIN_EVALUAR: 2, CUMPLE: 3 };
  return [...o].sort((a, b) => (orden[a.tecnico.estado] ?? 2) - (orden[b.tecnico.estado] ?? 2))[0] ?? null;
};

export function opcionesDeCelda(panel: PanelFichasDTO | null, productoId: number, proveedor: string): OpcionFichaDTO[] {
  const p = panel?.productos.find(x => x.productoId === productoId);
  return (p?.opciones || []).filter(o => normP(o.proveedor) === normP(proveedor));
}

/** "cotizaciónId:productoId" → resultado técnico de la ficha de ese proveedor para ese producto (solo si tiene ficha). */
export function tecnicoPorCelda(panel: PanelFichasDTO | null, cotizaciones: Array<{ id: number; proveedorNombre: string; items: Array<{ productoId: number }> }>): Record<string, TecnicoCelda> {
  const out: Record<string, TecnicoCelda> = {};
  if (!panel) return out;
  for (const c of cotizaciones) for (const it of c.items) {
    const con = opcionesDeCelda(panel, it.productoId, c.proveedorNombre).filter(o => o.fichas.length > 0);
    const o = peor(con);
    if (o) out[`${c.id}:${it.productoId}`] = { estado: o.tecnico.estado, cumple: o.tecnico.resumen?.cumple ?? 0, total: o.tecnico.resumen?.total ?? 0, modelo: [o.marca, o.modelo].filter(Boolean).join(' ') };
  }
  return out;
}

/** Lo que dicen JUNTOS el precio y la ficha técnica. */
export function conclusionConjunta(precio: VeredictoPrecio, estado: string | null): { texto: string; clase: string } {
  const p = precio === 'MEJOR' ? 'más bajo que lo costeado' : precio === 'IGUAL' ? 'igual a lo costeado' : precio === 'PEOR' ? 'más alto que lo costeado' : 'sin comparar con el costeo';
  if (estado == null) return { texto: `Precio: ${p}. Todavía no hay ficha técnica de este modelo, así que no se puede decir si cumple lo que piden las bases.`, clase: 'border-zinc-200 bg-zinc-50 text-zinc-700' };
  if (estado === 'NO_CUMPLE') return { texto: `No cumple técnicamente: no conviene aunque el precio esté ${p}.`, clase: 'border-rose-200 bg-rose-50 text-rose-800' };
  if (estado === 'CUMPLE') {
    return precio === 'PEOR'
      ? { texto: 'Cumple lo técnico, pero el precio está más caro que lo costeado: negociar o evaluar otra opción.', clase: 'border-amber-200 bg-amber-50 text-amber-900' }
      : { texto: `Conviene: cumple lo técnico y el precio está ${p}.`, clase: 'border-emerald-200 bg-emerald-50 text-emerald-800' };
  }
  if (estado === 'CON_PENDIENTES') return { texto: `Precio ${p}, pero faltan datos técnicos por cerrar: complementa los «Falta dato» o pídeselos al proveedor.`, clase: 'border-amber-200 bg-amber-50 text-amber-900' };
  return { texto: `Precio ${p}. Hay ficha, pero todavía no se compara contra las bases: usa «Comparar».`, clase: 'border-amber-200 bg-amber-50 text-amber-900' };
}

export function TecnicoDeCelda({ negocioId, productoId, proveedor, precioVeredicto, panel, cargando, recargar, puedeOperar }: {
  negocioId: number; productoId: number; proveedor: string; precioVeredicto: VeredictoPrecio;
  panel: PanelFichasDTO | null; cargando: boolean; recargar: () => Promise<void>; puedeOperar: boolean;
}) {
  const toast = useToast();
  const [comparando, setComparando] = useState(false);
  const opciones = opcionesDeCelda(panel, productoId, proveedor);
  const conFicha = opciones.filter(o => o.fichas.length > 0);
  const o = peor(conFicha);
  const concl = conclusionConjunta(precioVeredicto, o ? o.tecnico.estado : null);

  const post = async (cuerpo: object) => {
    const r = await fetch(`/api/compras/${negocioId}/fichas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.error || 'No se pudo completar');
    window.dispatchEvent(new Event(EVENTO_FICHAS));
    return d;
  };
  const comparar = async () => {
    setComparando(true);
    try { await post({ accion: 'comparar', productoCompraId: productoId }); toast.success('Comparación lista'); }
    catch (e: any) { toast.error('No se pudo comparar', e.message); }
    finally { setComparando(false); }
  };

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3 space-y-2.5" data-testid="tecnico-de-celda">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[13px] font-bold text-zinc-800">Ficha técnica de {proveedor}</p>
        {puedeOperar && conFicha.length > 0 && (
          <button type="button" onClick={comparar} disabled={comparando} className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 px-3 py-1.5 rounded-lg">
            {comparando ? <Loader2 size={12} className="animate-spin" /> : <Chispa size={13} />} {o && o.tecnico.estado !== 'NO_CORRIDO' ? 'Comparar de nuevo' : 'Comparar con las bases'}
          </button>
        )}
      </div>

      <div className={`rounded-lg border px-3 py-2 text-[12.5px] font-semibold ${concl.clase}`} data-testid="conclusion-conjunta">{concl.texto}</div>

      {cargando && !panel && <p className="text-[12px] text-zinc-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando la ficha…</p>}
      {panel && opciones.length === 0 && (
        <p className="text-[12.5px] text-zinc-500">
          No hay ninguna ficha de {proveedor} para este producto.{' '}
          <button type="button" onClick={() => irAPestana('fichas')} className="font-semibold text-teal-700 hover:text-teal-900 underline">Subirla en «3 · Fichas técnicas»</button>
        </p>
      )}
      {opciones.map(op => (
        <OpcionFila key={op.opcionId} o={op} cotizados={[proveedor]} puedeOperar={puedeOperar}
          onProveedor={async (x, prov) => { try { await post({ accion: 'proveedor', opcionId: x.opcionId, proveedor: prov || null }); } catch (e: any) { toast.error('No se pudo cambiar el proveedor', e.message); } }}
          onQuitar={async x => { try { await post({ accion: 'quitar_modelo', opcionId: x.opcionId }); } catch (e: any) { toast.error('No se pudo quitar', e.message); } }}
          onQuitarFicha={async (x, url) => { try { await post({ accion: 'quitar_ficha', opcionId: x.opcionId, url }); toast.success('Ficha quitada', 'Si quedaron otras fichas de este modelo, vuelve a comparar.'); } catch (e: any) { toast.error('No se pudo quitar la ficha', e.message); } }}
          onComplementar={async (x, n, resultado, dato, fuente) => { try { await post({ accion: 'complementar', opcionId: x.opcionId, n, resultado, dato, fuente }); toast.success(resultado ? 'Complemento guardado' : 'Complemento quitado'); } catch (e: any) { toast.error('No se pudo guardar el complemento', e.message); throw e; } }} />
      ))}
    </div>
  );
}
