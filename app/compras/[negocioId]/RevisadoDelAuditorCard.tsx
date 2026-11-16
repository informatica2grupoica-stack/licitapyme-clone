'use client';

// «REVISADO DEL AUDITOR» (Costeo y auditoría): lo que el asistente ya cargó y revisó en el Auditor, por producto.
// «Usar» pasa la cotización a las cotizaciones de Compras o la ficha al panel de fichas, sin volver a subirlas ni leerlas.
// El servidor decide qué se puede usar (app/lib/compras-del-auditor.ts); esta pantalla solo lo muestra y manda el clic.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/app/components/ui/toast';
import { DocumentViewerModal, type VisorDoc } from '@/app/components/DocumentViewerModal';
import { Boton } from '@/app/components/ui/kit/Boton';
import { Estado } from '@/app/components/ui/kit/Tarjeta';
import { useCompras } from '@/app/compras/[negocioId]/ComprasContext';
import {
  IconLoader2 as Loader2, IconReceipt as Receipt, IconFileText as FileText, IconCheck as Check, IconEye as Eye, IconRefresh as Refresh,
  IconArrowRight as Flecha, IconAlertTriangle as Alerta,
} from '@tabler/icons-react';
import type { PanelDelAuditor, ItemDelAuditor } from '@/app/lib/compras-del-auditor';

const clp = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);
const COLOR_ESTADO: Record<string, string> = { aprobada: '#16a34a', en_aprobacion: '#16a34a', definitiva: '#16a34a', verificada: '#0d9488', formalizada: '#d97706', tanteo: '#d97706' };
const fechaCorta = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('-') : null);

export function RevisadoDelAuditorCard({ negocioId, puedeOperar, soloLectura = false }: { negocioId: number; puedeOperar: boolean; soloLectura?: boolean }) {
  const toast = useToast();
  const { recargar: recargarCompras } = useCompras();
  const [panel, setPanel] = useState<PanelDelAuditor | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<Set<string>>(new Set());
  const [todo, setTodo] = useState(false);
  const [visor, setVisor] = useState<VisorDoc | null>(null);
  /** Producto elegido a mano para un documento (clave → productoId) y filas con el selector abierto. */
  const [destino, setDestino] = useState<Record<string, number>>({});
  const [cambiando, setCambiando] = useState<Set<string>>(new Set());
  const puede = puedeOperar && !soloLectura;

  const cargar = useCallback(async () => {
    try {
      const d = await fetch(`/api/compras/${negocioId}/del-auditor`).then(r => r.json());
      if (d.success) { setPanel(d.panel); setError(null); } else setError(d.error || 'No se pudo cargar lo revisado en el Auditor.');
    } catch { setError('No se pudo cargar lo revisado en el Auditor.'); }
    finally { setCargando(false); }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar]);

  const avisarCambio = useCallback((i: ItemDelAuditor) => {
    window.dispatchEvent(new Event(i.tipo === 'cotizacion' ? 'compras:cotizaciones-cambio' : 'compras:fichas-cambio'));
  }, []);

  // Manda UN documento. Si la compra ya está aprobada, el servidor pide confirmar antes de meter una cotización nueva.
  const enviar = useCallback(async (i: ItemDelAuditor, confirmado = false): Promise<{ ok: boolean; error?: string; ya?: boolean }> => {
    const res = await fetch(`/api/compras/${negocioId}/del-auditor`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: i.tipo === 'cotizacion' ? 'cotizacion' : 'ficha', clave: i.clave, productoId: destino[i.clave] ?? null, confirmar: confirmado }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 409 && d.confirmar) {
      if (!window.confirm(`${d.error}\n\n¿Pasar igual esta cotización a Compras?`)) return { ok: false, error: 'cancelado' };
      return enviar(i, true);
    }
    return res.ok && d.success ? { ok: true, ya: !!d.resultado?.yaEstaba } : { ok: false, error: d.error || 'No se pudo pasar el documento.' };
  }, [negocioId, destino]);

  const usar = async (i: ItemDelAuditor) => {
    setTrabajando(s => new Set(s).add(i.clave));
    try {
      const r = await enviar(i);
      if (r.ok && r.ya) { toast.info('Ya estaba en Compras', i.nombre); await cargar(); }
      else if (r.ok) {
        toast.success(i.tipo === 'cotizacion' ? 'Cotización pasada a Compras' : 'Ficha pasada a Compras', i.nombre);
        avisarCambio(i); await Promise.all([cargar(), recargarCompras()]);
      } else if (r.error !== 'cancelado') toast.error(`No se pudo pasar «${i.nombre}»`, r.error || '');
    } finally { setTrabajando(s => { const n = new Set(s); n.delete(i.clave); return n; }); }
  };

  // «Usar todo lo elegido»: primero las cotizaciones (la ficha de un proveedor se ve en Compras cuando ese proveedor ya cotizó) y después las fichas.
  const usarTodo = async () => {
    if (!panel) return;
    const lista = panel.productos.flatMap(p => p.items).filter(i => i.elegida && !i.yaEnCompras && !i.motivoNoUsable)
      .sort((a, b) => Number(b.tipo === 'cotizacion') - Number(a.tipo === 'cotizacion'));
    if (lista.length === 0) { toast.info('Nada por pasar', 'No hay documentos elegidos en el Auditor pendientes.'); return; }
    const hayCot = lista.some(i => i.tipo === 'cotizacion');
    if (!window.confirm(`Se van a pasar ${lista.length} documento(s) elegidos en el Auditor a Compras.${hayCot && panel.compraAprobada ? '\n\nLa compra de este negocio ya está aprobada: las cotizaciones nuevas pueden cambiar lo aprobado.' : ''}`)) return;
    setTodo(true);
    let ok = 0; const fallas: string[] = [];
    for (const i of lista) {
      const r = await enviar(i, panel.compraAprobada);
      if (r.ok) { ok++; avisarCambio(i); } else fallas.push(`${i.nombre}: ${r.error}`);
    }
    setTodo(false);
    if (ok) toast.success('Pasado a Compras', `${ok} documento(s).`);
    if (fallas.length) toast.error(`${fallas.length} no se pudieron pasar`, fallas.slice(0, 2).join(' · '));
    await Promise.all([cargar(), recargarCompras()]);
  };

  if (cargando) return <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-6"><Loader2 size={15} className="animate-spin" /> Leyendo lo que revisó el Auditor…</div>;
  if (error || !panel) return <div className="text-[13px] text-rose-700 py-3">{error || 'No se pudo cargar.'} <button type="button" className="underline" onClick={() => { setCargando(true); cargar(); }}>Reintentar</button></div>;
  const hayElegidos = panel.productos.some(p => p.items.some(i => i.elegida && !i.yaEnCompras && !i.motivoNoUsable));

  const fila = (i: ItemDelAuditor, productoPorDefecto: number | null) => {
    const ocupado = trabajando.has(i.clave);
    const nombreOpcion = [i.marca, i.modelo].filter(Boolean).join(' ');
    const elegido = destino[i.clave] ?? productoPorDefecto;
    const abierto = productoPorDefecto == null || cambiando.has(i.clave);
    const destinosValidos = panel.destinos.filter(d => i.tipo === 'cotizacion' || d.conLinea);
    return (
      <div key={i.clave} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 border-t border-zinc-100 px-4 py-2.5" data-testid={`del-auditor-${i.clave}`}>
        {i.tipo === 'cotizacion' ? <Receipt size={18} className="text-zinc-500" /> : <FileText size={18} className="text-zinc-500" />}
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-zinc-900 truncate">
            {i.tipo === 'cotizacion'
              ? <>Cotización {i.proveedor || 'sin proveedor identificado'}{i.precioNeto != null ? <> · {clp(i.precioNeto)} neto</> : null}</>
              : <>Ficha {nombreOpcion || i.nombre}{i.proveedor ? <> · {i.proveedor}</> : null}</>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-zinc-500">
            <Estado color={COLOR_ESTADO[i.estadoOpcion] ?? '#71717a'}>{i.estadoTexto}</Estado>
            {i.tipo === 'cotizacion' && i.ivaDeclarado != null && <span>{i.ivaDeclarado ? 'IVA declarado' : 'IVA sin declarar'}</span>}
            {i.tipo === 'ficha' && i.cumple && <span>{i.cumple}{i.noCumple ? ` · ${i.noCumple} no cumple` : ''}{i.sinVeredicto ? ` · ${i.sinVeredicto} falta dato` : ''}</span>}
            {i.subidoPor && <span>subió {i.subidoPor}{i.subidoAt ? `, ${fechaCorta(i.subidoAt)}` : ''}</span>}
            <button type="button" className="inline-flex items-center gap-1 text-teal-700 hover:underline" onClick={() => setVisor({ nombre: i.nombre, url: i.url })}><Eye size={12} /> Ver</button>
            {puede && !i.motivoNoUsable && !i.yaEnCompras && productoPorDefecto != null && !abierto && (
              <button type="button" className="text-zinc-500 hover:underline" onClick={() => setCambiando(s => new Set(s).add(i.clave))}>Cambiar producto</button>
            )}
          </div>
          {puede && !i.motivoNoUsable && !i.yaEnCompras && abierto && (
            <label className="mt-1.5 flex items-center gap-2 text-[12px] text-zinc-600">
              <span className="flex-shrink-0">Va en</span>
              <select value={elegido ?? ''} onChange={e => setDestino(d => ({ ...d, [i.clave]: Number(e.target.value) }))}
                className="min-w-0 max-w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-900" data-testid={`destino-${i.clave}`}>
                <option value="" disabled>Elige el producto…</option>
                {destinosValidos.map(d => <option key={d.productoId} value={d.productoId}>{d.descripcion}{d.cantidad != null ? ` (${d.cantidad})` : ''}</option>)}
              </select>
            </label>
          )}
          {i.motivoNoUsable && <div className="mt-0.5 text-[12px] text-amber-800">{i.motivoNoUsable}</div>}
        </div>
        <div className="flex-shrink-0 text-right">
          {i.yaEnCompras
            ? <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700"><Check size={14} /> Ya está en Compras</span>
            : puede && !i.motivoNoUsable
              ? <Boton tamano="sm" disabled={ocupado || todo || elegido == null} title={elegido == null ? 'Elige primero el producto' : undefined} icono={ocupado ? <Loader2 size={13} className="animate-spin" /> : undefined} onClick={() => usar(i)}>{i.tipo === 'cotizacion' ? 'Usar en cotizaciones' : 'Usar en fichas'}</Boton>
              : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3" data-testid="revisado-del-auditor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-zinc-500 max-w-[62ch]">Lo que el asistente ya cargó y revisó en el Auditor. «Usar» lo pasa a Compras sin volver a subirlo ni a leerlo.</p>
        <div className="flex items-center gap-2">
          <Boton tamano="sm" variante="fantasma" icono={<Refresh size={14} />} onClick={() => { setCargando(true); cargar(); }}>Actualizar</Boton>
          {puede && <Boton tamano="sm" variante="primario" icono={todo ? <Loader2 size={14} className="animate-spin" /> : <Flecha size={14} />} disabled={todo || !hayElegidos} onClick={usarTodo}>Usar todo lo elegido</Boton>}
        </div>
      </div>

      {panel.compraAprobada && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          <Alerta size={15} className="mt-0.5 flex-shrink-0" />
          <span>La compra de este negocio ya está aprobada. Pasar una cotización nueva puede cambiar lo aprobado, por eso se te pedirá confirmar cada vez.</span>
        </div>
      )}

      {panel.productos.length === 0 && panel.sinProducto.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-[13px] text-zinc-500">
          {panel.sinCosteo ? 'Este negocio todavía no tiene costeo guardado, así que no hay nada que cruzar con el Auditor.' : 'El Auditor todavía no tiene cotizaciones ni fichas técnicas de los productos de este negocio.'}
        </div>
      )}

      {panel.productos.map(p => (
        <section key={p.productoId} className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <header className="flex flex-wrap items-baseline justify-between gap-x-3 bg-zinc-50 px-4 py-2.5">
            <h4 className="text-[13.5px] font-semibold text-zinc-900">L{p.item} · {p.descripcion}</h4>
            <span className="text-[12px] text-zinc-500">{p.cantidad != null ? `cant. ${p.cantidad}` : ''}{p.costeadoNeto != null ? ` · costeado ${clp(p.costeadoNeto)} neto` : ''}</span>
          </header>
          {p.items.map(i => fila(i, p.productoId))}
        </section>
      ))}

      {panel.sinProducto.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12.5px] text-zinc-600">Estas líneas del Auditor no calzan con un producto de Compras (se renunció, no se adjudicó o el producto se creó por otro lado). Elige a qué producto va cada documento.</p>
          {panel.sinProducto.map(g => (
            <section key={g.filaId} className="rounded-xl border border-dashed border-zinc-300 bg-white overflow-hidden">
              <header className="bg-zinc-50 px-4 py-2.5"><h4 className="text-[13.5px] font-semibold text-zinc-900">Auditor · L{g.item} · {g.descripcion}</h4></header>
              {g.items.map(i => fila(i, null))}
            </section>
          ))}
        </div>
      )}
      <DocumentViewerModal doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
